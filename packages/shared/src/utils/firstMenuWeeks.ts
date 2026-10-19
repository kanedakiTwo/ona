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
 */
export interface FirstMenuWeeks {
  weeks: string[]
  open: string
  /** The sign-up day, Europe/Madrid, YYYY-MM-DD: the first menu starts here. */
  today: string
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function mondayPlus(isoDate: string, weekday: number, offsetWeeks: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - weekday + offsetWeeks * 7)
  return d.toISOString().slice(0, 10)
}

export function firstMenuWeeks(now: Date = new Date()): FirstMenuWeeks {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const isoDate = `${get('year')}-${get('month')}-${get('day')}`
  const weekday = WEEKDAYS.indexOf(get('weekday')) // 0 = Monday … 6 = Sunday
  const current = mondayPlus(isoDate, weekday, 0)
  if (weekday < 4) return { weeks: [current], open: current, today: isoDate }
  const next = mondayPlus(isoDate, weekday, 1)
  return { weeks: [current, next], open: next, today: isoDate }
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
