/**
 * PRO-1037 — the household recipes saved without minutes (the ones Mimo
 * created before PRO-308: «Salmón a la plancha con calabacín», «Merluza a la
 * plancha con ensalada», the tacos and fajitas of the test households) still
 * had `totalTime: null`, so «Mis recetas» and the menu showed no time and
 * Mimo said «No tengo guardados sus minutos». PRO-308 only covered what was
 * created after it, and a dish Mimo puts in the menu reuses the household's
 * recipe of the same name, so the old ones kept coming back without time.
 *
 * Every household recipe (`author_id IS NOT NULL`) without a total time gets
 * its minutes from the catalogue's estimator (`estimateRecipeTimes`): the
 * preparación / cocción it has win, the rest comes from its steps. Only
 * empty fields are written, never a value someone set (COALESCE, and the
 * total only while it is still empty): idempotent. A recipe it fills gets
 * the internal tag `times-estimated`, so the minutes are known to be
 * estimated (Mimo says so). A recipe with no steps and no times is left as
 * it is: there is nothing to estimate from.
 *
 * Runs after `db:migrate` (every API boot), like PRO-138's catalogue fill.
 * Every recipe it fills is logged («[household-recipe-times] …»).
 */
import { and, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { recipeSteps, recipes } from '../db/schema.js'
import { estimateRecipeTimes, type EstimatedTimes, type StepForTime } from './catalogRecipeTimes.js'

/** Internal tag of a recipe whose minutes were estimated, not given (PRO-1037). */
export const TIMES_ESTIMATED_TAG = 'times-estimated'

export interface HouseholdRecipeTimeRow {
  prepTime: number | null
  cookTime: number | null
  totalTime: number | null
}

const has = (n: number | null | undefined): n is number => typeof n === 'number' && n > 0

/** Pure: the minutes to fill for one household recipe; null = it has its time, or nothing to go on. */
export function planHouseholdRecipeTimes(
  recipe: HouseholdRecipeTimeRow,
  steps: readonly StepForTime[],
): EstimatedTimes | null {
  if (has(recipe.totalTime)) return null
  const est = estimateRecipeTimes({ prepTime: recipe.prepTime, cookTime: recipe.cookTime }, steps)
  return has(est.totalTime) ? est : null
}

export interface HouseholdRecipeTimesResult {
  /** Household recipes without a total time before the fill. */
  withoutTime: number
  filled: number
  /** Names left without time (no steps and no times). */
  missing: string[]
}

type Db = typeof import('../db/connection.js').db

export async function applyHouseholdRecipeTimes(
  db: Db,
  log: (line: string) => void = console.log,
): Promise<HouseholdRecipeTimesResult> {
  const noTotal = or(isNull(recipes.totalTime), lte(recipes.totalTime, 0))
  const rows = await db
    .select({ id: recipes.id, name: recipes.name, prepTime: recipes.prepTime, cookTime: recipes.cookTime, totalTime: recipes.totalTime })
    .from(recipes)
    .where(and(isNotNull(recipes.authorId), noTotal))
  const result: HouseholdRecipeTimesResult = { withoutTime: rows.length, filled: 0, missing: [] }
  if (rows.length === 0) return result

  const stepRows = await db
    .select({ recipeId: recipeSteps.recipeId, index: recipeSteps.index, text: recipeSteps.text, durationMin: recipeSteps.durationMin, technique: recipeSteps.technique })
    .from(recipeSteps)
    .where(inArray(recipeSteps.recipeId, rows.map((r) => r.id)))
  const stepsBy = new Map<string, StepForTime[]>()
  for (const s of [...stepRows].sort((a, b) => a.index - b.index)) {
    const list = stepsBy.get(s.recipeId) ?? []
    list.push(s)
    stepsBy.set(s.recipeId, list)
  }

  for (const r of rows) {
    const t = planHouseholdRecipeTimes(r, stepsBy.get(r.id) ?? [])
    if (!t) {
      result.missing.push(r.name)
      continue
    }
    // Only while the total is still empty; COALESCE never overwrites a value.
    const updated = await db
      .update(recipes)
      .set({
        totalTime: t.totalTime,
        ...(t.prepTime != null ? { prepTime: sql`COALESCE(NULLIF(${recipes.prepTime}, 0), ${t.prepTime})` } : {}),
        ...(t.cookTime != null ? { cookTime: sql`COALESCE(NULLIF(${recipes.cookTime}, 0), ${t.cookTime})` } : {}),
        ...(t.activeTime != null ? { activeTime: sql`COALESCE(NULLIF(${recipes.activeTime}, 0), ${t.activeTime})` } : {}),
        internalTags: sql`CASE WHEN ${TIMES_ESTIMATED_TAG}::text = ANY(COALESCE(${recipes.internalTags}, '{}'::text[])) THEN ${recipes.internalTags} ELSE array_append(COALESCE(${recipes.internalTags}, '{}'::text[]), ${TIMES_ESTIMATED_TAG}::text) END`,
      } as any)
      .where(and(eq(recipes.id, r.id), isNotNull(recipes.authorId), noTotal))
      .returning({ id: recipes.id })
    if (updated.length === 0) continue
    result.filled++
    log(`[household-recipe-times] «${r.name}» (${r.id}): total ${t.totalTime} · trabajo ${t.activeTime} min (estimado)`)
  }
  log(
    `[household-recipe-times] ${result.filled} de ${result.withoutTime} receta(s) de hogares sin tiempo completadas con el estimador` +
      (result.missing.length > 0 ? `; sin nada para estimar: ${result.missing.length}` : ''),
  )
  return result
}
