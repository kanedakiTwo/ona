/**
 * PRO-1142 (E-68, specs/menus.md → Dislikes) — a dislike that names a dish
 * («Oreja a la plancha») keeps that recipe out of every automatic pick
 * (`violatesRestrictions` reads the dislikes against the recipe's name), and
 * between a dislike and a «Me apetece» («Me encanta», or 5 stars from
 * «¿repetimos?») on the same recipe the latest wins: a later dislike keeps it
 * out entirely, a later «Me apetece» lets it come out again.
 *
 * - `dislikeDates` (pure): when each dislike was added — the ficha's history
 *   (`profile_changes`) or, without a row there, when its fact was created.
 * - `dislikeOverrides` (pure): recipe id → the dislike terms its name matches
 *   that a later positive beats (`RestrictableRecipe.dislikesOverridden`).
 * - `loadDishDislikeOverrides(userId, recipes)`: both from the DB, for
 *   `loadMatchableRecipes`. A dislike with no date wins.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { householdMembers, profileChanges, profileFacts, recipeNotes, recipeVerdicts, userMemories, users } from '../db/schema.js'
import { compileRestrictions, nameHasTerm, normalizeText, restrictionKey, violatesRestrictions, type RestrictableRecipe } from './dietaryRestrictions.js'

type Db = typeof defaultDb

const BOOST_RATING = 5

const time = (d: Date | string) => (d instanceof Date ? d : new Date(d)).getTime()

function listOf(v: unknown): string[] {
  const value = v && typeof v === 'object' && !Array.isArray(v) ? (v as { value?: unknown }).value : v
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
}

/** Pure: dislike term (`restrictionKey`) → when it was last added (ms). */
export function dislikeDates(input: {
  /** The ficha's `dislikes` and `affinity` facts. */
  facts?: ReadonlyArray<{ type: string; value: unknown; createdAt: Date | string; updatedAt: Date | string }>
  /** `profile_changes` of `dislikes` facts (`before`/`after`: `{ value }`). */
  changes?: ReadonlyArray<{ before: unknown; after: unknown; createdAt: Date | string }>
  /** `user_memories.dislikes` rows, for a user without a household. */
  memory?: ReadonlyArray<{ value: unknown; updatedAt: Date | string }>
}): Map<string, number> {
  const out = new Map<string, number>()
  const mark = (raw: string, at: number) => {
    const key = restrictionKey(raw)
    if (key) out.set(key, Math.max(out.get(key) ?? 0, at))
  }
  for (const m of input.memory ?? []) for (const item of listOf(m.value)) mark(item, time(m.updatedAt))
  for (const f of input.facts ?? []) {
    if (f.type === 'dislikes') for (const item of listOf(f.value)) mark(item, time(f.createdAt))
    else if (f.type === 'affinity') {
      const v = f.value as { kind?: string; target?: string; score?: number }
      if (v?.kind === 'ingredient' && typeof v.target === 'string' && Number(v.score) <= -2) mark(v.target, time(f.updatedAt))
    }
  }
  for (const c of input.changes ?? []) {
    const before = new Set(listOf(c.before).map(restrictionKey))
    for (const item of listOf(c.after)) if (!before.has(restrictionKey(item))) mark(item, time(c.createdAt))
  }
  return out
}

/** Pure: recipe id → dislike terms its name matches that a later positive beats. */
export function dislikeOverrides(
  recipes: ReadonlyArray<{ id: string; name: string }>,
  dislikedAt: ReadonlyMap<string, number>,
  positiveAt: ReadonlyMap<string, number>,
): Map<string, string[]> {
  const out = new Map<string, string[]>()
  if (dislikedAt.size === 0 || positiveAt.size === 0) return out
  for (const r of recipes) {
    const at = positiveAt.get(r.id)
    if (at == null) continue
    const name = normalizeText(r.name)
    const terms = [...dislikedAt].filter(([t, since]) => at > since && nameHasTerm(name, t)).map(([t]) => t)
    if (terms.length > 0) out.set(r.id, terms)
  }
  return out
}

/**
 * Pure: ids of the recipes a dislike names (no later positive beating it).
 * «Elegir otra receta» (`?fitsMe=1`) hides them; ingredient dislikes stay
 * pickable there by hand (PRO-61).
 */
export function recipeIdsNamedByDislikes(recipes: ReadonlyArray<RestrictableRecipe & { id: string }>, dislikes: readonly string[]): string[] {
  const dishTerms = compileRestrictions([], dislikes).dishTerms ?? []
  if (dishTerms.length === 0) return []
  const rules = { allergens: new Set<never>(), terms: [], alcohol: false, halal: false, dishTerms }
  return recipes.filter((r) => violatesRestrictions(r, rules)).map((r) => r.id)
}

/** The household's dislike dates and last positives → `dislikeOverrides`. */
export async function loadDishDislikeOverrides(
  userId: string,
  recipes: ReadonlyArray<{ id: string; name: string }>,
  db: Db = defaultDb,
): Promise<Map<string, string[]>> {
  const [u] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
  const householdId = u?.householdId ?? null
  const memberIds = householdId
    ? Array.from(new Set([userId, ...(await db.select({ userId: householdMembers.userId }).from(householdMembers).where(eq(householdMembers.householdId, householdId))).map((m) => m.userId)]))
    : [userId]

  // «Me apetece» / «Me encanta» of any member, 5 stars of the household.
  const positiveAt = new Map<string, number>()
  const positive = (recipeId: string, at: Date) => positiveAt.set(recipeId, Math.max(positiveAt.get(recipeId) ?? 0, at.getTime()))
  const verdicts = await db
    .select({ recipeId: recipeVerdicts.recipeId, updatedAt: recipeVerdicts.updatedAt })
    .from(recipeVerdicts)
    .where(and(inArray(recipeVerdicts.userId, memberIds), inArray(recipeVerdicts.verdict, ['like', 'love'])))
  for (const v of verdicts) positive(v.recipeId, v.updatedAt)
  if (householdId) {
    const stars = await db
      .select({ recipeId: recipeNotes.recipeId, updatedAt: recipeNotes.updatedAt })
      .from(recipeNotes)
      .where(and(eq(recipeNotes.householdId, householdId), eq(recipeNotes.rating, BOOST_RATING)))
    for (const s of stars) positive(s.recipeId, s.updatedAt)
  }
  if (positiveAt.size === 0) return new Map()

  // With a household, the ficha's dates (the memory mirrors into it, and its
  // `updatedAt` moves with any edit of the list); without one, the memory's.
  // A dislike with no date is never overridden.
  const dates = householdId
    ? dislikeDates({
        facts: await db
          .select({ type: profileFacts.type, value: profileFacts.value, createdAt: profileFacts.createdAt, updatedAt: profileFacts.updatedAt })
          .from(profileFacts)
          .where(and(eq(profileFacts.householdId, householdId), eq(profileFacts.status, 'active'), inArray(profileFacts.type, ['dislikes', 'affinity']))),
        changes: await db
          .select({ before: profileChanges.before, after: profileChanges.after, createdAt: profileChanges.createdAt })
          .from(profileChanges)
          .where(and(eq(profileChanges.householdId, householdId), eq(profileChanges.factType, 'dislikes'))),
      })
    : dislikeDates({
        memory: await db
          .select({ value: userMemories.value, updatedAt: userMemories.updatedAt })
          .from(userMemories)
          .where(and(eq(userMemories.userId, userId), eq(userMemories.key, 'dislikes'))),
      })
  return dislikeOverrides(recipes, dates, positiveAt)
}
