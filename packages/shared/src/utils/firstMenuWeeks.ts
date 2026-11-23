import type { Meal } from '../constants/enums.js'

/**
 * Which weeks the first menu is generated for when onboarding ends (PRO-65).
 *
 * Monday to Thursday (Europe/Madrid wall clock) → the current week only.
 * Friday to Sunday the current week is nearly over, so the next one is
 * generated too and `/menu` opens on it (`open`). Weeks are Mondays as
 * YYYY-MM-DD, oldest first.
 *
 * PRO-244: the first menu starts on the sign-up day (`today`): the days of
 * the current week that already went by are not generated
 * (`pastDayIndexes`). Web and WhatsApp sign-ups use the same rule.
 *
 * 19-nov (Miguel), with `fromNextMeal` (the first menu, not the calendar
 * week): it starts with the next meal that hasn't gone by. From 21:00
 * (Madrid) today's dinner is gone and the first menu starts tomorrow; before
 * that, today's meals already gone (`pastMeals`, by `MEAL_CUTOFFS`) are left
 * empty: a 15:00 sign-up starts with tonight's dinner.
 */
export interface FirstMenuWeeks {
  weeks: string[]
  open: string
  /** The first day of the first menu, Europe/Madrid, YYYY-MM-DD (tomorrow from 21:00). */
  today: string
  /** Meals of `today` that already went by (left without dishes). */
  pastMeals: Meal[]
}

/**
 * Minutes after midnight (Madrid) from which a meal of today is too late to
 * plan: a 15:00 sign-up starts with dinner, a 22:00 one tomorrow.
 */
export const MEAL_CUTOFFS: Record<Meal, number> = { breakfast: 10 * 60, lunch: 15 * 60, snack: 18 * 60, dinner: 21 * 60 }

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function mondayPlus(isoDate: string, weekday: number, offsetWeeks: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - weekday + offsetWeeks * 7)
  return d.toISOString().slice(0, 10)
}

export function firstMenuWeeks(now: Date = new Date(), opts: { fromNextMeal?: boolean } = {}): FirstMenuWeeks {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  let isoDate = `${get('year')}-${get('month')}-${get('day')}`
  let weekday = WEEKDAYS.indexOf(get('weekday')) // 0 = Monday … 6 = Sunday
  const minutes = Number(get('hour')) * 60 + Number(get('minute'))
  let pastMeals = opts.fromNextMeal ? (Object.keys(MEAL_CUTOFFS) as Meal[]).filter((m) => minutes >= MEAL_CUTOFFS[m]) : []
  if (opts.fromNextMeal && minutes >= MEAL_CUTOFFS.dinner) {
    // Tonight's dinner is gone: the first menu starts tomorrow.
    isoDate = mondayPlus(isoDate, -1, 0) // the day after
    weekday = (weekday + 1) % 7
    pastMeals = []
  }
  const current = mondayPlus(isoDate, weekday, 0)
  if (weekday < 4) return { weeks: [current], open: current, today: isoDate, pastMeals }
  const next = mondayPlus(isoDate, weekday, 1)
  return { weeks: [current, next], open: next, today: isoDate, pastMeals }
}

/**
 * The meals of `fromDate` that already went by, when `fromDate` is the first
 * menu's day right now (what the web sends as `fromDate`); [] otherwise.
 */
export function pastMealsOn(fromDate: string | null | undefined, now: Date = new Date()): Meal[] {
  if (!fromDate) return []
  const first = firstMenuWeeks(now, { fromNextMeal: true })
  return first.today === fromDate.slice(0, 10) ? first.pastMeals : []
}

/**
 * PRO-244: indexes (0 = Monday … 6 = Sunday) of the days of the week starting
 * `weekStart` that come before `fromDate` (both YYYY-MM-DD). A week wholly
 * after `fromDate` → []; wholly before → all seven.
 */
export function pastDayIndexes(weekStart: string, fromDate: string): number[] {
  const start = new Date(`${weekStart.slice(0, 10)}T12:00:00Z`)
  const out: number[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    if (d.toISOString().slice(0, 10) < fromDate.slice(0, 10)) out.push(i)
  }
  return out
}
