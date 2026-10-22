/**
 * PRO-138 (4) — times of the catalogue recipes, so the menu can respect the
 * time to cook: with a day limit, a recipe without the time it is about no
 * longer passes (recipeMatcher.ts), so every system recipe needs a total
 * time and a hands-on («de trabajo») time.
 *
 * - The recipes that had no time at all get the times Cocina gave
 *   (preparación / cocción / total, in minutes).
 * - `totalTime` missing → `prepTime + cookTime` (or the sum of the steps'
 *   minutes when every step has them, like recipePersistence).
 * - `activeTime` missing → computed from the steps: the sum of the hands-on
 *   steps; simmering, oven, resting, marinating, soaking, cooling, fridge,
 *   freezing, «templar», rising, fermenting and boiling-with-minutes steps
 *   don't count (the last six since PRO-187). If a hands-on step has no
 *   minutes, `prepTime` is used instead.
 *
 * Only empty fields of system recipes (`author_id IS NULL`) are filled —
 * never a user's recipe, never a value someone already set: idempotent.
 * One exception (PRO-187): a hands-on time equal to what the rule before
 * PRO-187 computed is recomputed with the new rule (and logged); any other
 * value stays.
 * Runs after `db:migrate` (every API boot) and at the end of `db:seed`, like
 * PRO-57/PRO-78. Every recipe it fills is logged («[catalog-recipe-times] …»)
 * so Cocina can review the computed hands-on times.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { recipeSteps, recipes } from '../db/schema.js'
import { normalizeRecipeName } from './catalogSourceLinks.js'

export interface KnownRecipeTimes {
  name: string
  prepTime: number
  cookTime: number
  totalTime: number
  /** What the recipe needs the day before (not part of its time). */
  dayBefore?: string
}

/** Cocina's times for the catalogue recipes that had none (PRO-138, 2026-10-15). */
export const CATALOG_RECIPE_TIMES: readonly KnownRecipeTimes[] = [
  { name: 'Acelgas rehogadas', prepTime: 10, cookTime: 15, totalTime: 25 },
  { name: 'Albóndigas en salsa española', prepTime: 25, cookTime: 35, totalTime: 60 },
  { name: 'Cocido madrileño', prepTime: 20, cookTime: 180, totalTime: 200, dayBefore: 'garbanzos a remojo la noche antes' },
  { name: 'Costillas a la riojana', prepTime: 15, cookTime: 45, totalTime: 60 },
  { name: 'Crema de calabacín', prepTime: 10, cookTime: 25, totalTime: 35 },
  { name: 'Curry de berenjena', prepTime: 15, cookTime: 30, totalTime: 45 },
  { name: 'Falafel', prepTime: 35, cookTime: 15, totalTime: 50, dayBefore: 'remojo la noche antes' },
  { name: 'Guisantes lágrima', prepTime: 5, cookTime: 5, totalTime: 10 },
  { name: 'Judías verdes rehogadas', prepTime: 10, cookTime: 15, totalTime: 25 },
  { name: 'Lentejas guisadas', prepTime: 15, cookTime: 45, totalTime: 60 },
]

const KNOWN_BY_NAME = new Map(CATALOG_RECIPE_TIMES.map((t) => [normalizeRecipeName(t.name), t]))

export function knownTimesFor(name: string): KnownRecipeTimes | null {
  return KNOWN_BY_NAME.get(normalizeRecipeName(name)) ?? null
}

export interface StepForTime {
  text: string
  durationMin?: number | null
  technique?: string | null
}

/**
 * Steps that go on by themselves: simmering, oven, resting, marinating,
 * soaking (also «la noche anterior»); since PRO-187 also cooling, the fridge,
 * freezing, «templar», rising and fermenting (see `isPassiveStep` for boiling).
 * Matched on the text and the technique, accent-insensitive.
 */
const PASSIVE_STEP =
  /\b(fuego (lento|bajo|suave|minimo)|horn(o|ear|ea|eamos|eado)|gratin(ar|a)|repos(ar|e|a|o)|marin(ar|e|a|ado|ada)|remoj(o|ar|e|a)|noche (anterior|antes)|enfri(ar|e|a|en|an|ado|ada)|nevera|frigorifico|frigo|congel(ar|e|a|en|an|ado|ada|ador)|templ(ar|e|a|en|an|ado|ada)|lev(ar|e|en|ado|ada)|ferment(ar|e|a|en|an|ado|ada|acion))\b/

/** Boiling («cuece», «hierve», «cocer», «hervir»…): goes by itself when the step gives its minutes (PRO-187). */
const BOILING_STEP = /\b(cocer|cocemos|cociendo|cuece|cuecen|cueza|cuezan|hervir|hervimos|hierve|hierven|hierva|hiervan|hirviendo)\b/

/** The rule before PRO-187 (only simmering, oven, resting, marinating, soaking). Kept to recognise what it computed. */
const LEGACY_PASSIVE_STEP =
  /\b(fuego (lento|bajo|suave|minimo)|horn(o|ear|ea|eamos|eado)|gratin(ar|a)|repos(ar|e|a|o)|marin(ar|e|a|ado|ada)|remoj(o|ar|e|a)|noche (anterior|antes))\b/

export function isPassiveStep(step: StepForTime): boolean {
  const text = normalizeRecipeName(`${step.technique ?? ''} ${step.text}`)
  if (PASSIVE_STEP.test(text)) return true
  return BOILING_STEP.test(text) && (stepMinutes(step) ?? 0) > 0
}

/** `isPassiveStep` as it was before PRO-187. */
export function isPassiveStepLegacy(step: StepForTime): boolean {
  return LEGACY_PASSIVE_STEP.test(normalizeRecipeName(`${step.technique ?? ''} ${step.text}`))
}

/** Minutes a step gives: `durationMin`, else the minutes/hours written in its text (summed; the upper end of a range). */
export function stepMinutes(step: StepForTime): number | null {
  if (typeof step.durationMin === 'number' && step.durationMin >= 0) return step.durationMin
  const text = normalizeRecipeName(step.text)
  const re = /(\d+(?:[.,]\d+)?)(?:\s*(?:-|a)\s*(\d+(?:[.,]\d+)?))?\s*(minutos|minuto|min|horas|hora|h)\b/g
  let total = 0
  let found = false
  for (const m of text.matchAll(re)) {
    const n = Number((m[2] ?? m[1]).replace(',', '.'))
    if (!Number.isFinite(n)) continue
    total += m[3].startsWith('h') ? n * 60 : n
    found = true
  }
  return found ? Math.round(total) : null
}

/**
 * Hands-on minutes from the steps: the sum of the steps that need you. If any
 * of those has no minutes, the recipe's `prepTime` stands in. Never more than
 * the total time. Null when there is nothing to go on.
 */
export function computeActiveTime(
  steps: readonly StepForTime[],
  prepTime: number | null | undefined,
  totalTime?: number | null,
): number | null {
  return activeTimeWith(isPassiveStep, steps, prepTime, totalTime)
}

/** `computeActiveTime` with the rule before PRO-187: what the fill wrote until then. */
export function computeActiveTimeLegacy(
  steps: readonly StepForTime[],
  prepTime: number | null | undefined,
  totalTime?: number | null,
): number | null {
  return activeTimeWith(isPassiveStepLegacy, steps, prepTime, totalTime)
}

function activeTimeWith(
  passive: (s: StepForTime) => boolean,
  steps: readonly StepForTime[],
  prepTime: number | null | undefined,
  totalTime?: number | null,
): number | null {
  const prep = typeof prepTime === 'number' && prepTime > 0 ? prepTime : null
  const active = steps.filter((s) => !passive(s))
  let minutes: number | null = null
  if (active.length > 0) {
    const each = active.map(stepMinutes)
    if (each.every((m): m is number => m != null)) {
      const sum = each.reduce((a, b) => a + b, 0)
      if (sum > 0) minutes = sum
    }
  }
  if (minutes == null) minutes = prep
  if (minutes == null) return null
  if (typeof totalTime === 'number' && totalTime > 0) minutes = Math.min(minutes, totalTime)
  return minutes
}

/** PRO-308: a hands-on step that says no minutes counts this much. */
export const DEFAULT_ACTIVE_STEP_MINUTES = 5
/** PRO-308: a step that goes by itself (oven, simmering, resting…) without minutes. */
export const DEFAULT_PASSIVE_STEP_MINUTES = 15

export interface EstimatedTimes {
  prepTime: number | null
  cookTime: number | null
  activeTime: number | null
  totalTime: number | null
}

/**
 * PRO-308 · a recipe Mimo writes (create_recipe, a dish it makes up for the
 * menu) always gets its minutes. The times it gave win; what's missing comes
 * from the steps with the catalogue's rule: each step's minutes (or the ones
 * in its text); a step without them counts `DEFAULT_ACTIVE_STEP_MINUTES` if
 * it needs you, `DEFAULT_PASSIVE_STEP_MINUTES` if it goes by itself. The
 * hands-on time is the sum of the hands-on steps (`computeActiveTime`),
 * never more than the total. With no times given, preparación = hands-on
 * and cocción = the rest. All null only with no times and no steps.
 */
export function estimateRecipeTimes(
  given: { prepTime?: number | null; cookTime?: number | null },
  stepTexts: readonly string[],
): EstimatedTimes {
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0
  const prep = ok(given.prepTime) ? Math.round(given.prepTime) : null
  const cook = ok(given.cookTime) ? Math.round(given.cookTime) : null
  const steps: StepForTime[] = stepTexts.filter((t) => t.trim()).map((text) => ({ text }))
  const estimated = steps.map((s) => ({
    ...s,
    durationMin: stepMinutes(s) ?? (isPassiveStep(s) ? DEFAULT_PASSIVE_STEP_MINUTES : DEFAULT_ACTIVE_STEP_MINUTES),
  }))
  const fromSteps = estimated.reduce((a, s) => a + s.durationMin, 0)
  const total = prep != null || cook != null ? (prep ?? 0) + (cook ?? 0) : fromSteps > 0 ? fromSteps : null
  if (total == null) return { prepTime: null, cookTime: null, activeTime: null, totalTime: null }
  let active = computeActiveTime(estimated, prep, total)
  if (active == null) active = Math.min(DEFAULT_ACTIVE_STEP_MINUTES, total)
  if (prep == null && cook == null) return { prepTime: active, cookTime: total - active, activeTime: active, totalTime: total }
  return { prepTime: prep, cookTime: cook, activeTime: active, totalTime: total }
}

export interface RecipeTimeRow {
  name: string
  prepTime: number | null
  cookTime: number | null
  activeTime: number | null
  totalTime: number | null
}

export type RecipeTimePatch = Partial<Pick<RecipeTimeRow, 'prepTime' | 'cookTime' | 'activeTime' | 'totalTime'>> & {
  /** Where the hands-on time came from, for the log Cocina reviews. */
  activeFrom?: 'pasos' | 'preparación'
}

const has = (n: number | null | undefined): n is number => typeof n === 'number' && n > 0

/** Pure: which empty fields to fill for one recipe. `{}` = nothing to do. */
export function planRecipeTimes(recipe: RecipeTimeRow, steps: readonly StepForTime[]): RecipeTimePatch {
  const patch: RecipeTimePatch = {}
  const known = knownTimesFor(recipe.name)
  let prep = has(recipe.prepTime) ? recipe.prepTime : null
  let cook = has(recipe.cookTime) ? recipe.cookTime : null
  let total = has(recipe.totalTime) ? recipe.totalTime : null
  if (known) {
    if (prep == null) prep = patch.prepTime = known.prepTime
    if (cook == null) cook = patch.cookTime = known.cookTime
    if (total == null) total = patch.totalTime = known.totalTime
  }
  if (total == null) {
    if (prep != null || cook != null) total = patch.totalTime = (prep ?? 0) + (cook ?? 0)
    else if (steps.length > 0 && steps.every((s) => typeof s.durationMin === 'number')) {
      const sum = steps.reduce((a, s) => a + (s.durationMin ?? 0), 0)
      if (sum > 0) total = patch.totalTime = sum
    }
  }
  if (!has(recipe.activeTime)) {
    const active = computeActiveTime(steps, prep, total)
    if (active != null) {
      patch.activeTime = active
      patch.activeFrom = fromSteps(steps) ? 'pasos' : 'preparación'
    }
  }
  return patch
}

/**
 * PRO-187: a hands-on time that the old rule computed (the stored value is
 * exactly what `computeActiveTimeLegacy` gives) is recomputed with the new
 * one. Any other value — set by hand or by Cocina — is left alone. Null =
 * nothing to change.
 */
export function planActiveTimeRecalc(
  recipe: RecipeTimeRow,
  steps: readonly StepForTime[],
): { from: number; to: number; activeFrom: 'pasos' | 'preparación' } | null {
  if (!has(recipe.activeTime) || steps.length === 0) return null
  const prep = has(recipe.prepTime) ? recipe.prepTime : null
  const total = has(recipe.totalTime) ? recipe.totalTime : null
  if (computeActiveTimeLegacy(steps, prep, total) !== recipe.activeTime) return null
  const to = computeActiveTime(steps, prep, total)
  if (to == null || to === recipe.activeTime) return null
  return { from: recipe.activeTime, to, activeFrom: fromSteps(steps) ? 'pasos' : 'preparación' }
}

function fromSteps(steps: readonly StepForTime[]): boolean {
  const active = steps.filter((s) => !isPassiveStep(s))
  return active.length > 0 && active.every((s) => stepMinutes(s) != null) && active.some((s) => (stepMinutes(s) ?? 0) > 0)
}

export interface CatalogRecipeTimesResult {
  systemRecipes: number
  filled: number
  /** Hands-on times the old rule computed, recomputed with the new one (PRO-187). */
  recomputed: number
  /** System recipes with both a total and a hands-on time after the fix. */
  complete: number
  missing: string[]
}

type Db = typeof import('../db/connection.js').db

export async function applyCatalogRecipeTimes(
  db: Db,
  log: (line: string) => void = console.log,
): Promise<CatalogRecipeTimesResult> {
  const rows = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      prepTime: recipes.prepTime,
      cookTime: recipes.cookTime,
      activeTime: recipes.activeTime,
      totalTime: recipes.totalTime,
    })
    .from(recipes)
    .where(isNull(recipes.authorId))
  const result: CatalogRecipeTimesResult = { systemRecipes: rows.length, filled: 0, recomputed: 0, complete: 0, missing: [] }
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
    // PRO-187: a hands-on time the old rule computed is recomputed (only if
    // it still holds that value when written).
    const recalc = planActiveTimeRecalc(r, stepsBy.get(r.id) ?? [])
    if (recalc) {
      const updated = await db
        .update(recipes)
        .set({ activeTime: recalc.to })
        .where(and(eq(recipes.id, r.id), isNull(recipes.authorId), eq(recipes.activeTime, recalc.from)))
        .returning({ id: recipes.id })
      if (updated.length > 0) {
        r.activeTime = recalc.to
        result.recomputed++
        log(`[catalog-recipe-times] «${r.name}»: trabajo ${recalc.from} → ${recalc.to} min (recalculado con la regla nueva, de ${recalc.activeFrom})`)
      }
    }
    const patch = planRecipeTimes(r, stepsBy.get(r.id) ?? [])
    const { activeFrom, ...fields } = patch
    const after = { ...r, ...fields }
    if (has(after.totalTime) && has(after.activeTime)) result.complete++
    else result.missing.push(r.name)
    if (Object.keys(fields).length === 0) continue
    // COALESCE: a value set since the read is never overwritten.
    await db
      .update(recipes)
      .set({
        ...(fields.prepTime != null ? { prepTime: sql`COALESCE(${recipes.prepTime}, ${fields.prepTime})` } : {}),
        ...(fields.cookTime != null ? { cookTime: sql`COALESCE(${recipes.cookTime}, ${fields.cookTime})` } : {}),
        ...(fields.totalTime != null ? { totalTime: sql`COALESCE(${recipes.totalTime}, ${fields.totalTime})` } : {}),
        ...(fields.activeTime != null ? { activeTime: sql`COALESCE(${recipes.activeTime}, ${fields.activeTime})` } : {}),
      } as any)
      .where(and(eq(recipes.id, r.id), isNull(recipes.authorId)))
    result.filled++
    log(
      `[catalog-recipe-times] «${r.name}»: ` +
        [
          fields.prepTime != null ? `preparación ${fields.prepTime}` : null,
          fields.cookTime != null ? `cocción ${fields.cookTime}` : null,
          fields.totalTime != null ? `total ${fields.totalTime}` : null,
          fields.activeTime != null ? `trabajo ${fields.activeTime} (de ${activeFrom})` : null,
        ]
          .filter(Boolean)
          .join(' · ') +
        ' min',
    )
  }
  log(
    `[catalog-recipe-times] ${result.filled} receta(s) completadas; ${result.recomputed} con el tiempo de trabajo recalculado; ${result.complete} de ${result.systemRecipes} recetas del sistema con tiempo total y de trabajo` +
      (result.missing.length > 0 ? `; sin tiempo: ${result.missing.join(', ')}` : ''),
  )
  return result
}
