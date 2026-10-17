/**
 * «Afina tu menú» (PRO-146, specs/taste.md) — DB side: the catalogue as
 * cards, the verdicts (`recipe_verdicts`, one per user and recipe, the last
 * wins), the offers stamped on `users.taste_state`, the household sets the
 * menu generator reads, and the memory writes of «¿Qué es lo que no?».
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { TasteProteinGroup, TasteReason, TasteStatus, TasteVerdict, TasteVerdictRow } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { householdMembers, recipeVerdicts, recipes, users } from '../db/schema.js'
import { loadMatchableRecipes } from './matchableRecipes.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'
import { getMemoryForUser, setMemoryFact } from './userMemoryStore.js'
import { normalizeText } from './dietaryRestrictions.js'
import type { TasteRecipe } from './tasteDeck.js'
import type { TasteMemoryFact } from './tasteAI.js'

type Db = typeof defaultDb

export interface TasteState {
  introAt?: string
  introChoice?: 'start' | 'later'
  cardDismissedAt?: string
  onboardingAt?: string
  whatsappOfferedAt?: string
  flags?: TasteProteinGroup[]
}

/** Catalogue recipes the user can rate: the catalogue as the user sees it (not retired). */
export async function loadTasteCatalog(userId: string, db: Db = defaultDb): Promise<TasteRecipe[]> {
  const matchable = await loadMatchableRecipes(userId, db)
  const extra = await db
    .select({ id: recipes.id, imageUrl: recipes.imageUrl, totalTime: recipes.totalTime })
    .from(recipes)
    .where(isNull(recipes.authorId))
  const byId = new Map(extra.map((r) => [r.id, r]))
  return matchable
    .filter((r) => byId.has(r.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      imageUrl: byId.get(r.id)!.imageUrl ?? null,
      prepTime: r.prepTime ?? null,
      totalTime: byId.get(r.id)!.totalTime ?? null,
      tags: r.tags ?? [],
      equipment: r.equipment ?? [],
      course: r.course ?? null,
      ingredients: r.ingredients.map((i) => ({ ingredientName: i.ingredientName, quantity: i.quantity, unit: i.unit })),
    }))
}

export async function listVerdicts(userId: string, db: Db = defaultDb) {
  return db
    .select({
      recipeId: recipeVerdicts.recipeId,
      verdict: recipeVerdicts.verdict,
      reason: recipeVerdicts.reason,
      updatedAt: recipeVerdicts.updatedAt,
    })
    .from(recipeVerdicts)
    .where(eq(recipeVerdicts.userId, userId))
    .orderBy(recipeVerdicts.updatedAt)
}

/** For «Lo que recuerdo de ti»: every verdict with the recipe's name and photo, newest first. */
export async function listVerdictRows(userId: string, db: Db = defaultDb): Promise<TasteVerdictRow[]> {
  const rows = await db
    .select({
      recipeId: recipeVerdicts.recipeId,
      verdict: recipeVerdicts.verdict,
      reason: recipeVerdicts.reason,
      updatedAt: recipeVerdicts.updatedAt,
      name: recipes.name,
      imageUrl: recipes.imageUrl,
    })
    .from(recipeVerdicts)
    .innerJoin(recipes, eq(recipeVerdicts.recipeId, recipes.id))
    .where(eq(recipeVerdicts.userId, userId))
    .orderBy(sql`${recipeVerdicts.updatedAt} desc`)
  return rows.map((r) => ({
    recipeId: r.recipeId,
    name: r.name,
    imageUrl: r.imageUrl ?? null,
    verdict: r.verdict as TasteVerdict,
    reason: (r.reason as TasteReason | null) ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }))
}

/** Upsert: one row per user and recipe, the last verdict wins (idempotent). */
export async function saveVerdict(
  userId: string,
  input: { recipeId: string; verdict: TasteVerdict; reason?: TasteReason | null },
  db: Db = defaultDb,
): Promise<void> {
  const reason = input.verdict === 'nope' ? input.reason ?? null : null
  await db
    .insert(recipeVerdicts)
    .values({ userId, recipeId: input.recipeId, verdict: input.verdict, reason })
    .onConflictDoUpdate({
      target: [recipeVerdicts.userId, recipeVerdicts.recipeId],
      set: { verdict: input.verdict, reason, updatedAt: new Date() },
    })
}

export async function deleteVerdict(userId: string, recipeId: string, db: Db = defaultDb): Promise<void> {
  await db.delete(recipeVerdicts).where(and(eq(recipeVerdicts.userId, userId), eq(recipeVerdicts.recipeId, recipeId)))
}

export async function recipeExists(recipeId: string, db: Db = defaultDb): Promise<{ name: string } | null> {
  const [r] = await db.select({ name: recipes.name, authorId: recipes.authorId }).from(recipes).where(eq(recipes.id, recipeId)).limit(1)
  return r && r.authorId === null ? { name: r.name } : null
}

export async function getTasteState(userId: string, db: Db = defaultDb): Promise<{ state: TasteState; onboardingDone: boolean }> {
  const [u] = await db.select({ tasteState: users.tasteState, onboardingDone: users.onboardingDone }).from(users).where(eq(users.id, userId)).limit(1)
  return { state: ((u?.tasteState ?? {}) as TasteState), onboardingDone: Boolean(u?.onboardingDone) }
}

/** Shallow-merge `patch` into `users.taste_state`. */
export async function patchTasteState(userId: string, patch: Partial<TasteState>, db: Db = defaultDb): Promise<void> {
  await db
    .update(users)
    .set({ tasteState: sql`${users.tasteState} || ${JSON.stringify(patch)}::jsonb` })
    .where(eq(users.id, userId))
}

/**
 * Pure: the offers. «Novedad» once for accounts that finished the sign-up
 * with no verdict and were never offered it (in the sign-up or here); the
 * card above the menu after «Ahora no», until they rate one or dismiss it.
 */
export function tasteOffers(input: { onboardingDone: boolean; verdictCount: number; state: TasteState }): { showIntro: boolean; showCard: boolean } {
  const { onboardingDone, verdictCount, state } = input
  const eligible = onboardingDone && verdictCount === 0
  return {
    showIntro: eligible && !state.introAt && !state.onboardingAt,
    showCard: eligible && state.introChoice === 'later' && !state.cardDismissedAt,
  }
}

export async function tasteStatus(userId: string, db: Db = defaultDb): Promise<TasteStatus> {
  const [catalog, verdicts, { state, onboardingDone }] = await Promise.all([
    loadTasteCatalog(userId, db),
    listVerdicts(userId, db),
    getTasteState(userId, db),
  ])
  const catalogIds = new Set(catalog.map((r) => r.id))
  return {
    rated: verdicts.filter((v) => v.verdict !== 'skip' && catalogIds.has(v.recipeId)).length,
    total: catalog.length,
    ...tasteOffers({ onboardingDone, verdictCount: verdicts.length, state }),
    offeredInOnboarding: Boolean(state.onboardingAt),
    flags: state.flags ?? [],
  }
}

/** Pure: verdict rows of the household → what the generator does with them. */
export function verdictSets(rows: ReadonlyArray<{ recipeId: string; verdict: string }>): {
  love: Set<string>
  like: Set<string>
  nope: Set<string>
} {
  const love = new Set<string>()
  const like = new Set<string>()
  const nope = new Set<string>()
  for (const r of rows) {
    if (r.verdict === 'nope') nope.add(r.recipeId)
    else if (r.verdict === 'love') love.add(r.recipeId)
    else if (r.verdict === 'like') like.add(r.recipeId)
  }
  // Anyone's «No para mí» wins: the recipe is not proposed to the household.
  for (const id of nope) {
    love.delete(id)
    like.delete(id)
  }
  for (const id of love) like.delete(id)
  return { love, like, nope }
}

/** Verdicts of every member of the user's household (just the user when there is none). */
export async function loadHouseholdVerdictSets(userId: string, db: Db = defaultDb) {
  const householdId = await getPrimaryHouseholdId(userId, db)
  let memberIds = [userId]
  if (householdId) {
    const rows = await db.select({ userId: householdMembers.userId }).from(householdMembers).where(eq(householdMembers.householdId, householdId))
    memberIds = Array.from(new Set([userId, ...rows.map((r) => r.userId)]))
  }
  const rows = await db
    .select({ recipeId: recipeVerdicts.recipeId, verdict: recipeVerdicts.verdict })
    .from(recipeVerdicts)
    .where(and(inArray(recipeVerdicts.userId, memberIds), inArray(recipeVerdicts.verdict, ['love', 'like', 'nope'])))
  return verdictSets(rows)
}

/**
 * Kitchen equipment assumed when the user says «no tengo horno» and has no
 * equipment list yet: the list is what they HAVE (specs/user-memory.md), so
 * we write the usual kit minus what they don't have.
 */
export const DEFAULT_KITCHEN_EQUIPMENT = [
  'fuegos', 'horno', 'microondas', 'sartén', 'olla', 'cazuela', 'batidora', 'plancha', 'freidora de aire', 'olla express', 'wok', 'robot de cocina', 'vaporera',
]

/** Pure: one fact merged into what is stored (lists only; dedupe and removals accent-insensitive). */
export function mergeTasteFact(existing: unknown, fact: TasteMemoryFact): string[] {
  const norm = (x: unknown) => normalizeText(String(x))
  const base: string[] = Array.isArray(existing)
    ? (existing as unknown[]).map(String)
    : fact.key === 'equipment' && fact.remove?.length
      ? [...DEFAULT_KITCHEN_EQUIPMENT]
      : []
  const removed = new Set((fact.remove ?? []).map(norm))
  const seen = new Set<string>()
  return [...base, ...fact.value].filter((item) => {
    const k = norm(item)
    if (!k || removed.has(k) || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Write «¿Qué es lo que no?» into the user's memory (the user said it: confidence 1). */
export async function applyTasteFacts(userId: string, facts: readonly TasteMemoryFact[]): Promise<void> {
  if (facts.length === 0) return
  const memory = await getMemoryForUser(userId)
  for (const f of facts) {
    const current = memory[f.key]
    const value = mergeTasteFact(current?.value, f)
    if (value.length === 0 && !current) continue
    const source = current?.source === 'manual' ? 'manual' : 'inferred'
    const fact = await setMemoryFact(userId, f.key, value, source, 1)
    memory[f.key] = fact
  }
}
