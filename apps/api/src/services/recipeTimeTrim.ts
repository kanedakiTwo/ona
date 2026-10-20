/**
 * PRO-284 — realistic total times for the catalogue recipes.
 *
 * Miguel (2026-10-20): the totals are too long; cooking the recipes at home
 * takes about 20 % less. Until now a total was prep + cook as is: it didn't
 * count that you prepare while something is in the oven, on a low heat, in
 * the pressure cooker or resting. The cook time is never touched.
 *
 * The rule (`planTimeTrim`):
 *  1. **Realistic prep** (once per recipe, `trimPrep`): prep × 0.8 for
 *     someone who cooks at home with ease (never below 5 min when it had
 *     more). Calibrated with Miguel's figure.
 *  2. **Overlap**: up to half the prep can be done during the steps that go
 *     by themselves (`isPassiveStep` from `catalogRecipeTimes.ts`: oven,
 *     simmering, pressure cooker, boiling with minutes, resting…), never more
 *     than those steps' minutes. Soaking the night before is not part of the
 *     time (it never was).
 *  3. **Total** = prep + cook time − overlap (a recipe without cook time
 *     uses its passive minutes). Never below the cook time nor the minutes
 *     of the steps that go by themselves, and never above the total it had.
 *  4. **Hands-on («de trabajo»)**: drops by what the prep dropped (not below
 *     the new prep unless it already was), never above the new total.
 *
 * Idempotent: steps 2–4 are a fixed point (a second run changes nothing),
 * and the prep cut of step 1 only happens to a system recipe without the
 * internal tag `tiempos-pro284`, which the fix adds. A recipe saved by the
 * batch import (`catalogImportDb.ts`) gets the total rule and the tag at
 * once — its prep comes from the rewriter, already realistic.
 *
 * `applyCatalogTimeTrim` runs after `db:migrate` (every API boot) and at the
 * end of `db:seed`, right after `applyCatalogRecipeTimes`. Only system
 * recipes (`author_id IS NULL`), never a user's. Every change is logged
 * («[catalog-time-trim] «…»: preparación A → B · total A → B · trabajo A → B
 * min») so Cocina can review it, plus how many recipes cross the 30-minute
 * limit of the menu (PRO-138).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { recipeSteps, recipes } from '../db/schema.js'
import { normalizeRecipeName } from './catalogSourceLinks.js'
import { isPassiveStep, stepMinutes, type StepForTime } from './catalogRecipeTimes.js'

/** Internal tag: the recipe's prep has been made realistic (PRO-284). */
export const TIME_TRIM_TAG = 'tiempos-pro284'
/** Realistic prep for someone who cooks at home with ease (Miguel: ~20 % less). */
export const PREP_REALISM = 0.8
/** Share of the prep that can be done while a step goes by itself. */
export const OVERLAP_SHARE = 0.5
/** The day limit whose crossings the log counts (the menu's «30 min»). */
export const LIMIT_MINUTES = 30

const DAY_BEFORE_STEP = /\b(remoj(o|ar|e|a)|noche (anterior|antes)|dia anterior|vispera)\b/

/** Soaking or anything the day before: not part of the recipe's time. */
export function isDayBeforeStep(step: StepForTime): boolean {
  if (DAY_BEFORE_STEP.test(normalizeRecipeName(`${step.technique ?? ''} ${step.text}`))) return true
  return (stepMinutes(step) ?? 0) >= 6 * 60
}

/**
 * Minutes of the steps that go by themselves (day-before steps excluded).
 * `unknown`: one of them gives no minutes — the cook time stands in.
 */
export function passiveMinutes(steps: readonly StepForTime[]): { minutes: number; unknown: boolean } {
  let minutes = 0
  let unknown = false
  for (const s of steps) {
    if (!isPassiveStep(s) || isDayBeforeStep(s)) continue
    const m = stepMinutes(s)
    if (m == null) unknown = true
    else minutes += m
  }
  return { minutes, unknown }
}

export interface TimeRow {
  prepTime: number | null
  cookTime: number | null
  activeTime: number | null
  totalTime: number | null
}

export interface TimeTrim {
  prepTime: number | null
  totalTime: number | null
  activeTime: number | null
  /** Minutes of prep done during the passive steps. */
  overlap: number
}

const has = (n: number | null | undefined): n is number => typeof n === 'number' && n > 0

/** Pure: prep × 0.8, rounded; never below 5 min when it had more. */
export function realisticPrep(prep: number): number {
  return Math.max(Math.min(prep, 5), Math.round(prep * PREP_REALISM))
}

/**
 * Pure: the PRO-284 times of one recipe. `trimPrep` = also make the prep
 * realistic (once). `cookTime` is never changed. Returns the new values
 * (equal to the old ones when nothing changes).
 */
export function planTimeTrim(row: TimeRow, steps: readonly StepForTime[], opts: { trimPrep: boolean }): TimeTrim {
  const prep = has(row.prepTime) ? row.prepTime : null
  const cook = has(row.cookTime) ? row.cookTime : 0
  const oldTotal = has(row.totalTime) ? row.totalTime : prep != null || cook > 0 ? (prep ?? 0) + cook : null
  const newPrep = prep != null && opts.trimPrep ? realisticPrep(prep) : prep

  let total = oldTotal
  let overlap = 0
  if (oldTotal != null && newPrep != null) {
    const passive = passiveMinutes(steps)
    const passiveMin = passive.unknown ? Math.max(passive.minutes, cook) : passive.minutes
    // The cooking span is the cook time (it is the authority); a recipe
    // without one (a marinade, a cold dish) uses its passive minutes.
    const span = cook > 0 ? cook : passiveMin
    overlap = Math.min(passiveMin, Math.round(newPrep * OVERLAP_SHARE))
    // Never below the cook time nor the minutes of the steps that go by
    // themselves, never above the total it had.
    total = Math.max(cook, Math.min(oldTotal, Math.max(passive.minutes, newPrep + span - overlap)))
  } else if (oldTotal != null) {
    total = Math.max(cook, oldTotal)
  }

  let active = has(row.activeTime) ? row.activeTime : null
  if (active != null) {
    if (prep != null && newPrep != null && newPrep < prep) {
      active = Math.min(active, Math.max(newPrep, active - (prep - newPrep)))
    }
    if (total != null) active = Math.min(active, total)
  }
  return {
    prepTime: newPrep ?? row.prepTime,
    totalTime: total ?? row.totalTime,
    activeTime: active ?? row.activeTime,
    overlap,
  }
}

/** Pure: which side of the limit a time is on (`null` = no time). */
export function withinLimit(minutes: number | null | undefined, limit = LIMIT_MINUTES): boolean | null {
  return has(minutes) ? minutes <= limit : null
}

export interface TimeTrimResult {
  systemRecipes: number
  changed: number
  /** Recipes whose total is now ≤ 30 min and wasn't before (and the reverse, always 0). */
  totalCrossed: number
  /** The same for the hands-on time. */
  activeCrossed: number
  /** Mean total of the recipes of up to 45 min, before and after (null = none). */
  shortMeanBefore: number | null
  shortMeanAfter: number | null
}

type Db = typeof import('../db/connection.js').db

const fmt = (label: string, from: number | null, to: number | null) => (from !== to ? `${label} ${from ?? '—'} → ${to ?? '—'}` : null)

/** One recipe's line for the log Cocina reviews, or null when nothing changes. */
export function trimLogLine(name: string, before: TimeRow, after: TimeTrim): string | null {
  const parts = [
    fmt('preparación', before.prepTime, after.prepTime),
    fmt('total', before.totalTime, after.totalTime),
    fmt('trabajo', before.activeTime, after.activeTime),
  ].filter(Boolean)
  if (parts.length === 0) return null
  return `[catalog-time-trim] «${name}»: ${parts.join(' · ')} min (cocción ${before.cookTime ?? '—'}, sin cambios${after.overlap > 0 ? `; ${after.overlap} min de preparación mientras va solo` : ''})`
}

/**
 * Boot-time data fix: applies the PRO-284 rule to system recipes. `ids`
 * limits it to some recipes (the batch import, right after saving one).
 */
export async function applyCatalogTimeTrim(
  db: Db,
  log: (line: string) => void = console.log,
  opts: { ids?: readonly string[]; trimPrep?: boolean } = {},
): Promise<TimeTrimResult> {
  const where = opts.ids ? and(isNull(recipes.authorId), inArray(recipes.id, [...opts.ids])) : isNull(recipes.authorId)
  const rows = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      prepTime: recipes.prepTime,
      cookTime: recipes.cookTime,
      activeTime: recipes.activeTime,
      totalTime: recipes.totalTime,
      internalTags: recipes.internalTags,
    })
    .from(recipes)
    .where(where)
  const result: TimeTrimResult = { systemRecipes: rows.length, changed: 0, totalCrossed: 0, activeCrossed: 0, shortMeanBefore: null, shortMeanAfter: null }
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

  const shortBefore: number[] = []
  const shortAfter: number[] = []
  for (const r of rows) {
    const tagged = (r.internalTags ?? []).includes(TIME_TRIM_TAG)
    const trimPrep = opts.trimPrep !== false && !tagged
    const after = planTimeTrim(r, stepsBy.get(r.id) ?? [], { trimPrep })
    if (has(r.totalTime) && r.totalTime <= 45) {
      shortBefore.push(r.totalTime)
      shortAfter.push(after.totalTime ?? r.totalTime)
    }
    const timesChange = after.prepTime !== r.prepTime || after.totalTime !== r.totalTime || after.activeTime !== r.activeTime
    if (!timesChange && tagged) continue
    // Only while the times are still the ones read (a value set since then
    // is never overwritten) and only a system recipe.
    const updated = await db
      .update(recipes)
      .set({
        prepTime: after.prepTime,
        totalTime: after.totalTime,
        activeTime: after.activeTime,
        ...(tagged ? {} : { internalTags: sql`array_append(coalesce(${recipes.internalTags}, ARRAY[]::text[]), ${TIME_TRIM_TAG})` }),
      } as any)
      .where(
        and(
          eq(recipes.id, r.id),
          isNull(recipes.authorId),
          sql`${recipes.prepTime} IS NOT DISTINCT FROM ${r.prepTime}`,
          sql`${recipes.totalTime} IS NOT DISTINCT FROM ${r.totalTime}`,
          sql`${recipes.activeTime} IS NOT DISTINCT FROM ${r.activeTime}`,
          tagged ? sql`true` : sql`NOT (${TIME_TRIM_TAG} = ANY(coalesce(${recipes.internalTags}, ARRAY[]::text[])))`,
        ),
      )
      .returning({ id: recipes.id })
    if (updated.length === 0 || !timesChange) continue
    result.changed++
    if (withinLimit(r.totalTime) === false && withinLimit(after.totalTime) === true) result.totalCrossed++
    if (withinLimit(r.activeTime) === false && withinLimit(after.activeTime) === true) result.activeCrossed++
    const line = trimLogLine(r.name, r, after)
    if (line) log(line)
  }
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)
  result.shortMeanBefore = mean(shortBefore)
  result.shortMeanAfter = mean(shortAfter)
  if (!opts.ids) {
    log(
      `[catalog-time-trim] ${result.changed} de ${result.systemRecipes} recetas del sistema con tiempos nuevos; ` +
        `con el límite de ${LIMIT_MINUTES} min pasan a caber ${result.totalCrossed} por tiempo total y ${result.activeCrossed} por tiempo de trabajo` +
        (result.shortMeanBefore != null ? `; total medio de las de hasta 45 min: ${result.shortMeanBefore} → ${result.shortMeanAfter} min` : ''),
    )
  }
  return result
}
