/**
 * PRO-1078 — the recipe's time counts the waits.
 *
 * Hogares de prueba (2026-10-30 → 2026-11-24): the «Pizza casera de jamón y
 * queso» said 45 min (prep 30, cook 15) and its step 3 is «déjala reposar 1
 * hora»; a burger said 18 min and asks to chill it 30 min; croquettes said
 * 55 min with 2 hours in the fridge. And the reverse: a soak the night
 * before counted as minutes («COMIDA · 830 MIN»).
 *
 * The rule (`totalWithWaits`), for every recipe — the catalogue, the house's
 * and Mimo's:
 *  - **Waits** are the steps that go by themselves without heat, with their
 *    minutes: resting, rising, fermenting, marinating, the fridge, cooling,
 *    freezing, «templar». Minutes come from the step (`durationMin`) or its
 *    text («1 hora», «al menos 30 minutos», «una hora y media»). A wait
 *    without minutes isn't guessed.
 *  - **The day before** (soaking, «toda la noche», «la noche antes», 6 hours
 *    or more) is never part of the time: you do it the day before.
 *  - The cooking span is the cook time plus the waits — unless the cook time
 *    already holds them (it is at least the waits; then the span is the
 *    larger of the cook time and the waits plus the heat steps' minutes).
 *  - Up to half the prep is done during the waits (never more than the
 *    waits), as PRO-284 does for the oven.
 *  - **Total** = prep + span − that overlap, never below the total it had.
 *
 * Pizza: 30 + (15 + 60) − 15 = 90 min. Idempotent: the result is a floor.
 * Applied on save (`recipePersistence.ts`), in the PRO-284 trim of the
 * catalogue, and on every boot to every recipe (`applyRecipeWaitTimes`).
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { recipeSteps, recipes } from '../db/schema.js'
import { normalizeRecipeName } from './catalogSourceLinks.js'
import { isPassiveStep, stepMinutes, type StepForTime } from './catalogRecipeTimes.js'

/** Share of the prep that can be done during the waits (as PRO-284). */
export const WAIT_OVERLAP_SHARE = 0.5
/** A wait this long (or more) is done the day before. */
export const DAY_BEFORE_MINUTES = 6 * 60

const DAY_BEFORE_STEP = /\b(remoj(o|ar|e|a)|noche (anterior|antes)|toda la noche|de un dia para otro|dia anterior|vispera)\b/

/** Steps that wait without heat (the oven, the pot and the boiling are the cook time). */
const WAIT_STEP =
  /\b(repos(ar|e|a|o|ando)|marin(ar|e|a|ado|ada|ando)|lev(ar|e|en|ado|ada|ando)|ferment(ar|e|a|en|an|ado|ada|acion)|nevera|frigorifico|frigo|refriger(ar|e|a|en|an|ado|ada|ando)|enfri(ar|e|a|en|an|ado|ada|ando)|congel(ar|e|a|en|an|ado|ada|ador)|templ(ar|e|a|en|an|ado|ada))\b/

const text = (step: StepForTime) => normalizeRecipeName(`${step.technique ?? ''} ${step.text}`)

/** Soaking or anything the day before: not part of the recipe's time. */
export function isDayBeforeStep(step: StepForTime): boolean {
  if (DAY_BEFORE_STEP.test(text(step))) return true
  return (stepMinutes(step) ?? 0) >= DAY_BEFORE_MINUTES
}

/** A step that waits without heat (resting, rising, marinating, the fridge…), not the day before. */
export function isWaitStep(step: StepForTime): boolean {
  return WAIT_STEP.test(text(step)) && !isDayBeforeStep(step)
}

const WORD_HOURS: Array<[RegExp, number]> = [
  [/\b(una|1) hora y media\b/, 90],
  [/\bdos horas y media\b/, 150],
  [/\bun par de horas\b/, 120],
  [/\bmedia hora\b/, 30],
  [/\bcuarto de hora\b/, 15],
  [/\b(una|un) hora\b/, 60],
  [/\bdos horas\b/, 120],
  [/\btres horas\b/, 180],
  [/\bcuatro horas\b/, 240],
]

/** Minutes a step gives: `stepMinutes`, else the ones written in words («una hora», «media hora»). */
export function waitStepMinutes(step: StepForTime): number | null {
  const m = stepMinutes(step)
  if (m != null) return m
  const t = normalizeRecipeName(step.text)
  for (const [re, minutes] of WORD_HOURS) if (re.test(t)) return minutes
  return null
}

/** Minutes of the waits (without minutes: not counted) and of the other steps that go by themselves. */
export function waitMinutes(steps: readonly StepForTime[]): { waits: number; heat: number } {
  let waits = 0
  let heat = 0
  for (const s of steps) {
    if (isDayBeforeStep(s)) continue
    if (isWaitStep(s)) waits += waitStepMinutes(s) ?? 0
    else if (isPassiveStep(s)) heat += stepMinutes(s) ?? 0
  }
  return { waits, heat }
}

const has = (n: number | null | undefined): n is number => typeof n === 'number' && n > 0

/**
 * Pure: the least total a recipe can have with its waits, or null when it
 * has no wait with minutes (nothing to add).
 */
export function waitFloor(prepTime: number | null | undefined, cookTime: number | null | undefined, steps: readonly StepForTime[]): number | null {
  const { waits, heat } = waitMinutes(steps)
  if (waits <= 0) return null
  const prep = has(prepTime) ? prepTime : 0
  const cook = has(cookTime) ? cookTime : 0
  const span = cook < waits ? cook + waits : Math.max(cook, waits + heat)
  const overlap = Math.min(waits, Math.round(prep * WAIT_OVERLAP_SHARE))
  return prep + span - overlap
}

/** Pure: the total with the waits — never below the one it had. */
export function totalWithWaits(
  row: { prepTime?: number | null; cookTime?: number | null; totalTime?: number | null },
  steps: readonly StepForTime[],
): number | null {
  const total = has(row.totalTime) ? row.totalTime : null
  const floor = waitFloor(row.prepTime, row.cookTime, steps)
  if (floor == null) return total
  return total == null ? floor : Math.max(total, floor)
}

/**
 * Pure: a total that is the sum of every step's minutes, a soak or a night
 * in the fridge included, without those day-before steps. Null when it isn't
 * that case.
 */
export function totalWithoutDayBefore(totalTime: number | null | undefined, steps: readonly StepForTime[]): number | null {
  if (!has(totalTime) || steps.length === 0) return null
  if (!steps.every((s) => typeof s.durationMin === 'number')) return null
  const sum = steps.reduce((a, s) => a + (s.durationMin ?? 0), 0)
  if (sum !== totalTime) return null
  const without = steps.filter((s) => !isDayBeforeStep(s)).reduce((a, s) => a + (s.durationMin ?? 0), 0)
  return without < sum && without > 0 ? without : null
}

/** Pure: the total one recipe should have (`totalTime` unchanged = nothing to do). */
export function planWaitTime(
  row: { prepTime: number | null; cookTime: number | null; totalTime: number | null },
  steps: readonly StepForTime[],
): number | null {
  const base = totalWithoutDayBefore(row.totalTime, steps) ?? row.totalTime
  return totalWithWaits({ ...row, totalTime: base }, steps)
}

type Db = typeof import('../db/connection.js').db

/**
 * Boot-time data fix (after the PRO-284 trim): every recipe — system and
 * the households' — gets the total with its waits, and a total that summed a
 * soak the night before loses it. Only `totalTime` changes, only while it is
 * still the one read. Logs «[recipe-wait-time] «…»: total A → B min».
 */
export async function applyRecipeWaitTimes(
  db: Db,
  log: (line: string) => void = console.log,
  opts: { ids?: readonly string[] } = {},
): Promise<{ recipes: number; changed: number }> {
  // Only recipes with a step that waits or is the day before can change.
  const candidates = await db
    .selectDistinct({ id: recipeSteps.recipeId })
    .from(recipeSteps)
    .where(
      and(
        sql`${recipeSteps.text} ~* ${'(repos|marin|lev[aeá]|ferment|nevera|frigo|refriger|enfri|congel|templ|remoj|noche|vispera|víspera|dia anterior|día anterior|hora)'}`,
        opts.ids ? inArray(recipeSteps.recipeId, [...opts.ids]) : sql`true`,
      ),
    )
  const ids = candidates.map((c) => c.id)
  const result = { recipes: ids.length, changed: 0 }
  if (ids.length === 0) return result

  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    const rows = await db
      .select({ id: recipes.id, name: recipes.name, prepTime: recipes.prepTime, cookTime: recipes.cookTime, totalTime: recipes.totalTime })
      .from(recipes)
      .where(inArray(recipes.id, chunk))
    const stepRows = await db
      .select({ recipeId: recipeSteps.recipeId, index: recipeSteps.index, text: recipeSteps.text, durationMin: recipeSteps.durationMin, technique: recipeSteps.technique })
      .from(recipeSteps)
      .where(inArray(recipeSteps.recipeId, chunk))
    const stepsBy = new Map<string, StepForTime[]>()
    for (const s of [...stepRows].sort((a, b) => a.index - b.index)) {
      const list = stepsBy.get(s.recipeId) ?? []
      list.push(s)
      stepsBy.set(s.recipeId, list)
    }
    for (const r of rows) {
      const to = planWaitTime(r, stepsBy.get(r.id) ?? [])
      if (to == null || to === r.totalTime) continue
      const updated = await db
        .update(recipes)
        .set({ totalTime: to } as any)
        .where(and(eq(recipes.id, r.id), sql`${recipes.totalTime} IS NOT DISTINCT FROM ${r.totalTime}`))
        .returning({ id: recipes.id })
      if (updated.length === 0) continue
      result.changed++
      log(`[recipe-wait-time] «${r.name}»: total ${r.totalTime ?? '—'} → ${to} min`)
    }
  }
  if (!opts.ids) log(`[recipe-wait-time] ${result.changed} de ${result.recipes} recetas con reposo o remojo, con el total nuevo`)
  return result
}
