/**
 * Mimoia's users are in Spain; the server (Railway) runs in UTC. Anything that
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

/**
 * The UTC instant of `hour:minute` Europe/Madrid wall time on `isoDate`
 * (DST-aware). A time that doesn't exist (the spring-forward gap) resolves
 * one hour later, like a phone alarm.
 */
export function madridWallTimeUtc(isoDate: string, hour: number, minute = 0): Date {
  const base = Date.parse(`${isoDate}T00:00:00Z`) + (hour * 60 + minute) * 60_000
  for (const offsetHours of [1, 2, 0, 3]) {
    const t = new Date(base - offsetHours * 3_600_000)
    const p = madridParts(t)
    if (p.isoDate === isoDate && p.hour === hour && p.minute === minute) return t
  }
  return new Date(base - 1 * 3_600_000)
}

/** The UTC instant of 00:00 Europe/Madrid on `isoDate` (DST-aware). */
export function madridMidnightUtc(isoDate: string): Date {
  return madridWallTimeUtc(isoDate, 0, 0)
}

/** YYYY-MM-DD shifted by `days` (calendar arithmetic, no TZ involved). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
