/**
 * Catalogue collections (PRO-374, specs/catalog-import.md → «Colecciones»,
 * specs/recipes.md → «Colecciones»): Cocina's editorial rows of the catalogue.
 *
 *   importCatalogCollection  the uploaded file checked (shape, §6 words) and its
 *                            recipes resolved — only published catalogue
 *                            recipes — then saved by slug (a new upload of the
 *                            same slug replaces it). Injected database, so the
 *                            rule is unit-tested (catalogCollections.test.ts).
 *   listCollectionCards      the `/recipes` row: published collections with at
 *                            least one recipe still visible, newest first.
 *   loadCollection           one collection and its visible recipe ids in order.
 *
 * A recipe that is retired or no longer published after the upload just stops
 * showing; the collection keeps its id in case it comes back.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  RETIRED_RECIPE_TAG,
  checkCatalogCollection,
  type CatalogCollectionAdminView,
  type CatalogCollectionCard,
  type CatalogCollectionFile,
  type Season,
} from '@ona/shared'
import { db } from '../db/connection.js'
import { catalogCollections, recipes } from '../db/schema.js'
import { PUBLISHED } from './recipeVisibility.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A catalogue recipe as the import sees it. */
export interface CollectionRecipeCandidate {
  id: string
  name: string
  status: string
  retired: boolean
}

export interface CollectionToSave {
  slug: string
  title: string
  subtitle: string | null
  season: Season | null
  recipeIds: string[]
  published: boolean
}

export interface CatalogCollectionImportDeps {
  /** Catalogue recipes (author NULL, any status) whose id is in `ids` or whose name folds to one of `names`. */
  findCatalogRecipes: (ids: string[], names: string[]) => Promise<CollectionRecipeCandidate[]>
  /** Insert or replace by slug; `created` is false when the slug already existed. */
  saveCollection: (c: CollectionToSave) => Promise<{ id: string; created: boolean }>
}

export type CatalogCollectionImportResult =
  | { ok: true; id: string; created: boolean; collection: CollectionToSave }
  | { ok: false; problems: string[] }

/** Lower case, no accents, single spaces: how a name in the file meets the catalogue. */
export function foldName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Each entry of the file to one catalogue recipe, or the problem in Spanish:
 * not found, two recipes with that name, a draft («en borrador»), retired.
 */
export function resolveCollectionRecipes(
  entries: readonly string[],
  candidates: readonly CollectionRecipeCandidate[],
): { ok: true; ids: string[] } | { ok: false; problems: string[] } {
  const byId = new Map(candidates.map((c) => [c.id.toLowerCase(), c]))
  const byName = new Map<string, CollectionRecipeCandidate[]>()
  for (const c of candidates) {
    const key = foldName(c.name)
    byName.set(key, [...(byName.get(key) ?? []), c])
  }
  const ids: string[] = []
  const problems: string[] = []
  for (const entry of entries) {
    const isId = UUID_RE.test(entry)
    let found: CollectionRecipeCandidate | undefined
    if (isId) {
      found = byId.get(entry.toLowerCase())
    } else {
      const named = byName.get(foldName(entry)) ?? []
      // A published one wins over a draft with the same name.
      const live = named.filter((c) => c.status === PUBLISHED && !c.retired)
      if (live.length > 1) {
        problems.push(`Hay ${live.length} recetas que se llaman «${entry}»: pon su id.`)
        continue
      }
      found = live[0] ?? named[0]
    }
    if (!found) problems.push(`La receta «${entry}» no está en el catálogo.`)
    else if (found.status !== PUBLISHED) problems.push(`La receta «${found.name}» está en borrador: solo van recetas publicadas.`)
    else if (found.retired) problems.push(`La receta «${found.name}» está retirada del catálogo.`)
    else if (ids.includes(found.id)) problems.push(`La receta «${found.name}» está dos veces.`)
    else ids.push(found.id)
  }
  return problems.length ? { ok: false, problems } : { ok: true, ids }
}

/** The uploaded file → a saved collection, or every problem found. Nothing is saved with a problem. */
export async function importCatalogCollection(
  input: unknown,
  deps: CatalogCollectionImportDeps,
): Promise<CatalogCollectionImportResult> {
  const check = checkCatalogCollection(input)
  if (!check.ok) return check
  const file: CatalogCollectionFile = check.collection
  const ids = file.recipes.filter((r) => UUID_RE.test(r))
  const names = file.recipes.filter((r) => !UUID_RE.test(r)).map(foldName)
  const resolved = resolveCollectionRecipes(file.recipes, await deps.findCatalogRecipes(ids, names))
  if (!resolved.ok) return resolved
  const collection: CollectionToSave = {
    slug: file.slug,
    title: file.title,
    subtitle: file.subtitle?.trim() || null,
    season: file.season ?? null,
    recipeIds: resolved.ids,
    published: file.published ?? true,
  }
  const saved = await deps.saveCollection(collection)
  return { ok: true, id: saved.id, created: saved.created, collection }
}

// ─── Database ──────────────────────────────────────────────────

const retiredSql = sql<boolean>`(${RETIRED_RECIPE_TAG} = ANY(coalesce(${recipes.internalTags}, ARRAY[]::text[])))`
const foldedNameSql = sql<string>`lower(translate(${recipes.name}, 'áéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙ', 'aeiouunAEIOUUNaeiouAEIOU'))`

export function createDbCollectionImportDeps(): CatalogCollectionImportDeps {
  return {
    findCatalogRecipes: async (ids, names) => {
      if (ids.length === 0 && names.length === 0) return []
      const rows = await db
        .select({ id: recipes.id, name: recipes.name, status: recipes.status, retired: retiredSql })
        .from(recipes)
        .where(and(
          isNull(recipes.authorId),
          sql`(${ids.length ? inArray(recipes.id, ids) : sql`FALSE`} OR ${names.length ? sql`regexp_replace(${foldedNameSql}, '\\s+', ' ', 'g') IN (${sql.join(names.map((n) => sql`${n}`), sql`, `)})` : sql`FALSE`})`,
        ))
      return rows.map((r) => ({ id: r.id, name: r.name, status: r.status, retired: !!r.retired }))
    },
    saveCollection: async (c) => {
      const [row] = await db
        .insert(catalogCollections)
        .values(c)
        .onConflictDoUpdate({
          target: catalogCollections.slug,
          set: { title: c.title, subtitle: c.subtitle, season: c.season, recipeIds: c.recipeIds, published: c.published },
        })
        .returning({ id: catalogCollections.id, created: sql<boolean>`(xmax = 0)` })
      return { id: row.id, created: !!row.created }
    },
  }
}

interface VisibleRecipe {
  id: string
  imageUrl: string | null
}

/** The published, not retired catalogue recipes among `ids`. */
async function visibleCatalogRecipes(ids: string[]): Promise<Map<string, VisibleRecipe>> {
  if (ids.length === 0) return new Map()
  const rows = await db
    .select({ id: recipes.id, imageUrl: recipes.imageUrl })
    .from(recipes)
    .where(and(inArray(recipes.id, ids), isNull(recipes.authorId), eq(recipes.status, PUBLISHED), sql`NOT ${retiredSql}`))
  return new Map(rows.map((r) => [r.id, r]))
}

type CollectionRow = typeof catalogCollections.$inferSelect

function cardOf(row: CollectionRow, visibleIds: string[], visible: Map<string, VisibleRecipe>): CatalogCollectionCard {
  return {
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    season: (row.season as Season | null) ?? null,
    recipeCount: visibleIds.length,
    imageUrl: visibleIds.map((id) => visible.get(id)?.imageUrl).find((u) => !!u) ?? null,
  }
}

const visibleIdsOf = (row: CollectionRow, visible: Map<string, VisibleRecipe>) => (row.recipeIds ?? []).filter((id) => visible.has(id))

/** The `/recipes` row: published collections with a recipe to show, newest first. */
export async function listCollectionCards(): Promise<CatalogCollectionCard[]> {
  const rows = await db.select().from(catalogCollections).where(eq(catalogCollections.published, true)).orderBy(desc(catalogCollections.createdAt))
  const visible = await visibleCatalogRecipes([...new Set(rows.flatMap((r) => r.recipeIds ?? []))])
  return rows
    .map((r) => cardOf(r, visibleIdsOf(r, visible), visible))
    .filter((c) => c.recipeCount > 0)
}

/** Admin: every collection, published or not, with what shows today. */
export async function listCollectionsForAdmin(): Promise<CatalogCollectionAdminView[]> {
  const rows = await db.select().from(catalogCollections).orderBy(desc(catalogCollections.createdAt))
  const visible = await visibleCatalogRecipes([...new Set(rows.flatMap((r) => r.recipeIds ?? []))])
  return rows.map((r) => ({ ...cardOf(r, visibleIdsOf(r, visible), visible), published: r.published, createdAt: r.createdAt.toISOString() }))
}

/** One published collection and its visible recipe ids in Cocina's order, or null. */
export async function loadCollection(slug: string): Promise<{ card: CatalogCollectionCard; recipeIds: string[] } | null> {
  const [row] = await db
    .select()
    .from(catalogCollections)
    .where(and(eq(catalogCollections.slug, slug), eq(catalogCollections.published, true)))
    .limit(1)
  if (!row) return null
  const visible = await visibleCatalogRecipes(row.recipeIds ?? [])
  const recipeIds = visibleIdsOf(row, visible)
  return { card: cardOf(row, recipeIds, visible), recipeIds }
}
