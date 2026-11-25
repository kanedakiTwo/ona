/**
 * PRO-402 — the day-before waits are not cooking time.
 *
 * Cocina's audit (2026-11-05, `atajos-tiempo.md`): 18 of the 123 long
 * recipes counted a soak, a marinade, a rise or a night in the fridge as
 * cooking (the «Hummus kawarma» said 795 min; the dish is ~1 h 30). A wait
 * like that is not part of the recipe's time: it becomes a «preparativo con
 * antelación» (`advancePrep`, PRO-220), which the ficha shows as «La
 * víspera: …» and the menu turns into an alert.
 *
 * A step is such a wait (`isDayBeforeWait`) when it says so («la víspera»,
 * «la noche anterior», «toda la noche», «de un día para otro») or when it is
 * a soak, marinade, rise, fridge, rest… of 6 h or more — the same threshold
 * as `isDayBeforeStep` in recipeTimeTrim.ts, so the total rule never counts
 * these steps either. A short same-day wait (30 min of soaking, 1 h 30 of
 * rising) stays in the time: the household does wait for it that day.
 *
 * `splitDayBeforeWaits` (pure) takes those minutes out of the cook time (or
 * the prep time, where the source put them) and returns the preparativos.
 * The catalogue import applies it before saving a draft
 * (`persistCatalogDraft`), and `persistRecipe` leaves those steps out of the
 * total it sums from the steps.
 */
import { stepMinutes, type StepForTime } from './catalogRecipeTimes.js'
import { normalizeRecipeName } from './catalogSourceLinks.js'

/** A wait of this many minutes or more is done the day before (as `isDayBeforeStep`). */
export const DAY_BEFORE_MIN_MINUTES = 6 * 60

const SAYS_DAY_BEFORE = /\b(vispera|noche (anterior|antes)|dia anterior|toda la noche|de un dia para otro)\b/
const WAIT_WORD =
  /\b(remoj\w*|marin\w*|adob\w*|lev(ar|e|en|ado|ada|ando)|ferment\w*|nevera|frigorifico|frigo|frio|repos\w*|enfri\w*|hidrat\w*|macer\w*|purg\w*|escurr\w*|desal\w*)\b/

/** The step is a wait done the day before (and gives its minutes). */
export function isDayBeforeWait(step: StepForTime): boolean {
  const minutes = stepMinutes(step)
  if (minutes == null || minutes <= 0) return false
  const text = normalizeRecipeName(`${step.technique ?? ''} ${step.text}`)
  if (!WAIT_WORD.test(text)) return false
  return SAYS_DAY_BEFORE.test(text) || minutes >= DAY_BEFORE_MIN_MINUTES
}

export interface AdvancePrepItem {
  text: string
  hoursBefore: number
}

export interface WaitSplit {
  prepTime: number | null
  cookTime: number | null
  /** Minutes of day-before waits found in the steps. */
  waitMinutes: number
  /** One preparativo per wait step (at most 5, as `advancePrepSchema`). */
  advancePrep: AdvancePrepItem[]
}

const has = (n: number | null | undefined): n is number => typeof n === 'number' && n > 0

/** «Ponemos los garbanzos en remojo 12 horas. Al día siguiente…» → its first sentence, 3–140 chars. */
export function advancePrepText(stepText: string): string {
  const first = stepText.trim().split(/(?<=[.!?;])\s+/)[0].replace(/[.;:,\s]+$/, '')
  let text = first.length > 140 ? `${first.slice(0, 139).replace(/\s+\S*$/, '')}…` : first
  text = text.charAt(0).toUpperCase() + text.slice(1)
  return text.length >= 3 ? text : 'Prepara la víspera lo que dice la receta'
}

/**
 * Pure: the recipe's times without its day-before waits, and those waits as
 * preparativos. The minutes come out of the cook time when it holds them,
 * else out of the prep time; when neither does, the times were already
 * right and stay. `hoursBefore` = the wait plus the rest of the recipe,
 * rounded up, so it is done when cooking starts (never above 72 h).
 */
export function splitDayBeforeWaits(times: { prepTime: number | null | undefined; cookTime: number | null | undefined }, steps: readonly StepForTime[]): WaitSplit {
  const prep = has(times.prepTime) ? times.prepTime : null
  const cook = has(times.cookTime) ? times.cookTime : null
  const waits = steps.filter(isDayBeforeWait)
  const waitMinutes = waits.reduce((acc, s) => acc + (stepMinutes(s) ?? 0), 0)
  if (waitMinutes === 0) return { prepTime: prep, cookTime: cook, waitMinutes: 0, advancePrep: [] }

  let newPrep = prep
  let newCook = cook
  if (cook != null && cook >= waitMinutes) newCook = cook - waitMinutes || null
  else if (prep != null && prep >= waitMinutes) newPrep = prep - waitMinutes || null

  const restHours = ((newPrep ?? 0) + (newCook ?? 0)) / 60
  const advancePrep = waits.slice(0, 5).map((s) => ({
    text: advancePrepText(s.text),
    hoursBefore: Math.min(72, Math.ceil((stepMinutes(s) ?? 0) / 60 + restHours)),
  }))
  return { prepTime: newPrep, cookTime: newCook, waitMinutes, advancePrep }
}
