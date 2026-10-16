/**
 * «Deseos del catálogo» (PRO-154, specs/catalog-import.md): dishes someone
 * wants and the catalogue doesn't have, with how many households ask for
 * each. Cocina reads the list (`GET /admin/catalog-wishes`, metrics token,
 * no personal data) to decide what to import next.
 *
 * Sources (`CatalogWishSource`):
 *   - `alta`       favourite dishes from the sign-up with no similar recipe
 *                  (saveOnboarding → recordWishesFromFavoriteDishes);
 *   - `me_encanta` a «Me encanta» with no similar recipe (reserved: today
 *                  every «Me encanta» is on a recipe we have);
 *   - `mimo`       a request to Mimo that ends as a note (pending: lives in
 *                  assistant/skills.ts, see the spec's «Pendiente»);
 *   - `evaluador`  «no está en el catálogo» from the menu evaluator (PRO-155).
 */
import { and, desc, eq, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { catalogWishes, catalogWishVotes, recipes } from '../db/schema.js'
import { normalize, stem } from './recipeLint.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'

type Db = typeof defaultDb

export const CATALOG_WISH_SOURCES = ['alta', 'me_encanta', 'mimo', 'evaluador'] as const
export type CatalogWishSource = (typeof CATALOG_WISH_SOURCES)[number]

const WISH_STOPWORDS = new Set([
  'con', 'de', 'del', 'la', 'las', 'el', 'los', 'al', 'a', 'y', 'e', 'o', 'u', 'en', 'mi', 'tu', 'su', 'para', 'sin',
  'un', 'una', 'unos', 'unas', 'estilo', 'casera', 'casero', 'caseras', 'caseros', 'receta', 'recetas', 'plato', 'platos',
])

/** Significant stemmed words of a dish or recipe name: «Croquetas de cocido» → ['croquet', 'cocid']. */
export function wishWords(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !WISH_STOPWORDS.has(w))
    .map(stem)
}

/** One key per dish, whatever the accents, plurals, order or filler words. */
export function dishKey(dish: string): string {
  return [...new Set(wishWords(dish))].sort().join(' ')
}

/**
 * Pure: the alternatives in one answer. «Cremas y sopas» means either, so
 * it's covered by a crema *or* a sopa; «pollo al curry» is one dish.
 * Splits on commas, slashes and a « y »/« o » that joins two single words.
 */
export function dishAlternatives(dish: string): string[] {
  const parts = dish.split(/[,/;]+/).map((p) => p.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    const m = /^\s*(\S+)\s+(?:y|o|e|u)\s+(\S+)\s*$/i.exec(p)
    if (m) out.push(m[1], m[2])
    else out.push(p)
  }
  return out
}

/**
 * Pure: does the catalogue already have something like this dish? Covered
 * when every significant word of one alternative is in one recipe's name
 * («carbonara» ⊂ «Espaguetis a la carbonara»). Sharing one word isn't
 * enough: «pastel de carne» is not covered by «Menestra con carne».
 */
export function catalogCoversDish(dish: string, recipeNames: readonly string[]): boolean {
  const nameWords = recipeNames.map((n) => new Set(wishWords(n)))
  for (const alt of dishAlternatives(dish)) {
    const words = wishWords(alt)
    if (words.length === 0) continue
    if (nameWords.some((set) => words.every((w) => set.has(w)))) return true
  }
  return false
}

/** Pure: the dishes of a list that no recipe covers (blank and repeated ones out). */
export function uncoveredDishes(dishes: readonly string[] | null | undefined, recipeNames: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of dishes ?? []) {
    const dish = raw.trim().replace(/\s+/g, ' ')
    const key = dishKey(dish)
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (!catalogCoversDish(dish, recipeNames)) out.push(dish)
  }
  return out
}

// ─── Store ──────────────────────────────────────────────────────

export interface CatalogWishStore {
  /** Create the wish if new (by key); add this voter's vote if not there yet. */
  upsert(input: { dish: string; dishKey: string; voterKey: string; householdId: string | null; userId: string | null; source: CatalogWishSource }): Promise<{ wishId: string; created: boolean; households: number }>
}

export function createDbCatalogWishStore(db: Db = defaultDb): CatalogWishStore {
  return {
    async upsert(input) {
      return db.transaction(async (tx) => {
        const inserted = await tx
          .insert(catalogWishes)
          .values({ dish: input.dish, dishKey: input.dishKey })
          .onConflictDoNothing({ target: catalogWishes.dishKey })
          .returning({ id: catalogWishes.id })
        const created = inserted.length > 0
        const [wish] = created
          ? inserted
          : await tx.select({ id: catalogWishes.id }).from(catalogWishes).where(eq(catalogWishes.dishKey, input.dishKey)).limit(1)
        await tx
          .insert(catalogWishVotes)
          .values({ wishId: wish.id, voterKey: input.voterKey, householdId: input.householdId, userId: input.userId, source: input.source })
          .onConflictDoNothing()
        await tx.update(catalogWishes).set({ updatedAt: new Date() }).where(eq(catalogWishes.id, wish.id))
        const [{ n }] = await tx
          .select({ n: sql<number>`count(DISTINCT ${catalogWishVotes.voterKey})::int` })
          .from(catalogWishVotes)
          .where(eq(catalogWishVotes.wishId, wish.id))
        return { wishId: wish.id, created, households: Number(n) }
      })
    },
  }
}

export interface RecordWishInput {
  dish: string
  source: CatalogWishSource
  userId: string
  /** Pass it when known; otherwise it's looked up (the user's own id when they have no household). */
  householdId?: string | null
}

/**
 * A request with no recipe creates the wish or adds this household to it.
 * Same household twice → still one household. Returns null for an empty dish.
 */
export async function recordCatalogWish(
  input: RecordWishInput,
  deps: { store?: CatalogWishStore; householdOf?: (userId: string) => Promise<string | null> } = {},
): Promise<{ wishId: string; created: boolean; households: number } | null> {
  const dish = input.dish.trim().replace(/\s+/g, ' ').slice(0, 120)
  const key = dishKey(dish)
  if (!key) return null
  const householdId = input.householdId !== undefined ? input.householdId : await (deps.householdOf ?? ((u) => getPrimaryHouseholdId(u)))(input.userId)
  const store = deps.store ?? createDbCatalogWishStore()
  return store.upsert({
    dish,
    dishKey: key,
    voterKey: householdId ?? input.userId,
    householdId: householdId ?? null,
    userId: householdId ? null : input.userId,
    source: input.source,
  })
}

/** Names of the published catalogue (what «tenemos» means). */
export async function publishedCatalogNames(db: Db = defaultDb): Promise<string[]> {
  const rows = await db
    .select({ name: recipes.name })
    .from(recipes)
    .where(and(sql`${recipes.authorId} IS NULL`, eq(recipes.status, 'published')))
  return rows.map((r) => r.name)
}

/**
 * Sign-up favourites → wishes for the ones the catalogue doesn't cover.
 * Best effort: a failure here never breaks the sign-up.
 */
export async function recordWishesFromFavoriteDishes(
  userId: string,
  dishes: readonly string[] | null | undefined,
  deps: { catalogNames?: () => Promise<string[]>; record?: typeof recordCatalogWish } = {},
): Promise<string[]> {
  try {
    if (!dishes || dishes.length === 0) return []
    const names = await (deps.catalogNames ?? (() => publishedCatalogNames()))()
    const missing = uncoveredDishes(dishes, names)
    const record = deps.record ?? recordCatalogWish
    for (const dish of missing) await record({ dish, source: 'alta', userId })
    return missing
  } catch (err) {
    console.warn('[catalogWishes] favourites → wishes failed (ignored):', (err as Error)?.message ?? err)
    return []
  }
}

// ─── Read (admin + Cocina) ──────────────────────────────────────

export interface CatalogWishRow {
  id: string
  dish: string
  status: string
  households: number
  sources: string[]
  recipeId: string | null
  createdAt: Date
  updatedAt: Date
}

/** Most-wanted first. Aggregates only: no user, no household ids. */
export async function listCatalogWishes(
  opts: { status?: string; limit?: number } = {},
  db: Db = defaultDb,
): Promise<CatalogWishRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000)
  const households = sql<number>`count(DISTINCT ${catalogWishVotes.voterKey})::int`
  const rows = await db
    .select({
      id: catalogWishes.id,
      dish: catalogWishes.dish,
      status: catalogWishes.status,
      recipeId: catalogWishes.recipeId,
      createdAt: catalogWishes.createdAt,
      updatedAt: catalogWishes.updatedAt,
      households,
      sources: sql<string[]>`coalesce(array_agg(DISTINCT ${catalogWishVotes.source}) FILTER (WHERE ${catalogWishVotes.source} IS NOT NULL), '{}')`,
    })
    .from(catalogWishes)
    .leftJoin(catalogWishVotes, eq(catalogWishVotes.wishId, catalogWishes.id))
    .where(opts.status ? eq(catalogWishes.status, opts.status) : undefined)
    .groupBy(catalogWishes.id)
    .orderBy(desc(households), desc(catalogWishes.updatedAt))
    .limit(limit)
  return rows.map((r) => ({ ...r, households: Number(r.households), sources: r.sources ?? [] }))
}

/**
 * After a batch is published: wishes that a new recipe now covers become
 * `cubierto`, pointing at it. Returns how many changed.
 */
export async function markWishesCovered(
  published: ReadonlyArray<{ id: string; name: string }>,
  db: Db = defaultDb,
): Promise<number> {
  if (published.length === 0) return 0
  const open = await db.select({ id: catalogWishes.id, dish: catalogWishes.dish }).from(catalogWishes).where(eq(catalogWishes.status, 'abierto'))
  let n = 0
  for (const w of open) {
    const hit = published.find((r) => catalogCoversDish(w.dish, [r.name]))
    if (!hit) continue
    await db.update(catalogWishes).set({ status: 'cubierto', recipeId: hit.id, updatedAt: new Date() }).where(eq(catalogWishes.id, w.id))
    n++
  }
  return n
}
