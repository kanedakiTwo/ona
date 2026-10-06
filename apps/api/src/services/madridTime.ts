/**
 * ONA's users are in Spain; the server (Railway) runs in UTC. Anything that
 * means "today" or "this week" for the user — the assistant's
 * `get_todays_menu` default day, the week a new menu lands in, the WhatsApp
 * morning brief — reads the Europe/Madrid wall clock from here.
 */

export const MADRID_TZ = 'Europe/Madrid'

export interface MadridParts {
  /** YYYY-MM-DD in Madrid. */
  isoDate: string
  /** 0 = Monday … 6 = Sunday (the menu's dayIndex convention). */
  weekday: number
  hour: number
  minute: number
}

export function madridParts(now: Date): MadridParts {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: MADRID_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return {
    isoDate: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: weekdays.indexOf(get('weekday')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

/** Monday (YYYY-MM-DD) of the week containing `isoDate`, shifted by `offsetWeeks`. */
export function mondayOf(isoDate: string, weekday: number, offsetWeeks = 0): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - weekday + offsetWeeks * 7)
  return d.toISOString().slice(0, 10)
}

/** Monday of the current Madrid week (+ `offsetWeeks`). */
export function madridWeekStart(now: Date = new Date(), offsetWeeks = 0): string {
  const p = madridParts(now)
  return mondayOf(p.isoDate, p.weekday, offsetWeeks)
}
