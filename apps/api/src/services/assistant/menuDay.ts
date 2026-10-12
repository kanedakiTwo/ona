import { addDays, madridParts, mondayOf } from '../madridTime.js'

/**
 * Which menu day a chat request means, on the Europe/Madrid calendar
 * (PRO-63). Until 2026-10-12 the menu tools only took `dayIndex` (+ an
 * optional `nextWeek`) and changed "the latest menu": once next week's row
 * existed (the web creates an empty one just by opening that week), "el
 * sábado" landed on the 24th instead of the 17th. Now every menu tool takes
 * `day` with the user's own words or a date, and this module turns it into
 * a real date — the tool then edits THAT week's menu and repeats the date.
 */

export const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const DAY_KEYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export interface MenuDay {
  /** Monday of the menu week (YYYY-MM-DD) — the `menus.week_start` to edit. */
  weekStart: string
  /** 0 = lunes … 6 = domingo. */
  dayIndex: number
  /** The calendar date (YYYY-MM-DD). */
  isoDate: string
  /** "sábado 17 de octubre", for the summary the model repeats. */
  label: string
}

export interface MenuDayInput {
  /** The user's words ("hoy", "mañana", "el sábado", "martes de la semana que viene") or YYYY-MM-DD. */
  day?: unknown
  /** Legacy: 0 = lunes … 6 = domingo of the current week (next week with `nextWeek`). */
  dayIndex?: unknown
  nextWeek?: unknown
}

/** "sábado 17 de octubre" for an ISO date. */
export function dateLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  const weekday = (d.getUTCDay() + 6) % 7
  return `${DAY_NAMES[weekday]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`
}

function toMenuDay(isoDate: string): MenuDay {
  const d = new Date(`${isoDate}T12:00:00Z`)
  const dayIndex = (d.getUTCDay() + 6) % 7
  return { weekStart: mondayOf(isoDate, dayIndex), dayIndex, isoDate, label: dateLabel(isoDate) }
}

/** The day `dayIndex` of the week starting `weekStart`. */
export function menuDayOf(weekStart: string, dayIndex: number): MenuDay {
  return toMenuDay(addDays(weekStart, dayIndex))
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9-]+/g, ' ').trim()
}

const NEXT_WEEK_RE = /\b(semana que viene|proxima semana|semana proxima|siguiente semana|semana siguiente)\b/

/**
 * Resolve the day a request means, from `now` in Madrid. A weekday name on
 * its own is the next one from today (today included): on Sunday "el martes"
 * is the day after tomorrow, not five days ago. Returns `{ error }` (in
 * Spanish, for the model) when the words don't name a day.
 */
export function resolveMenuDay(input: MenuDayInput, now: Date = new Date()): MenuDay | { error: string } {
  const today = madridParts(now)
  const thisMonday = mondayOf(today.isoDate, today.weekday)
  const raw = typeof input.day === 'string' ? input.day.trim() : ''

  if (raw) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T12:00:00Z`))) return toMenuDay(raw)
    const t = ` ${norm(raw)} `
    const words = t.trim().split(/\s+/)
    const wd = DAY_KEYS.findIndex((k) => words.includes(k))
    const nextWeek = NEXT_WEEK_RE.test(t) || input.nextWeek === true
    const dom = words.map((w) => Number(w)).find((n) => Number.isInteger(n) && n >= 1 && n <= 31)

    // "el sábado 17", "el 17": the nearest date with that day of the month
    // (and weekday, if said), looking two weeks back and four ahead.
    if (dom !== undefined) {
      const candidates: string[] = []
      for (let i = -14; i <= 28; i++) {
        const iso = addDays(today.isoDate, i)
        const md = toMenuDay(iso)
        if (Number(iso.slice(8, 10)) === dom && (wd < 0 || md.dayIndex === wd)) candidates.push(iso)
      }
      const future = candidates.find((c) => c >= today.isoDate)
      const pick = future ?? candidates[candidates.length - 1]
      if (pick) return toMenuDay(pick)
    }

    if (wd >= 0) {
      if (nextWeek) return menuDayOf(mondayOf(today.isoDate, today.weekday, 1), wd)
      if (/\b(esta|este)\b/.test(t) && !/\bque viene\b/.test(t)) return menuDayOf(thisMonday, wd)
      if (/\bpasad[oa]\b/.test(t)) {
        const back = ((today.weekday - wd + 7) % 7) || 7
        return toMenuDay(addDays(today.isoDate, -back))
      }
      // "el próximo martes", "el martes que viene": strictly after today.
      const strict = /\b(proximo|proxima|que viene)\b/.test(t)
      let ahead = (wd - today.weekday + 7) % 7
      if (ahead === 0 && strict) ahead = 7
      return toMenuDay(addDays(today.isoDate, ahead))
    }
    if (/\bpasado manana\b/.test(t)) return toMenuDay(addDays(today.isoDate, 2))
    if (/\bmanana\b/.test(t)) return toMenuDay(addDays(today.isoDate, 1))
    if (/\banteayer\b/.test(t)) return toMenuDay(addDays(today.isoDate, -2))
    if (/\bayer\b/.test(t)) return toMenuDay(addDays(today.isoDate, -1))
    if (/\b(hoy|esta noche|esta manana|esta tarde)\b/.test(t)) return toMenuDay(today.isoDate)
    if (nextWeek && typeof input.dayIndex === 'number') return resolveMenuDay({ dayIndex: input.dayIndex, nextWeek: true }, now)
    return {
      error: `No sé qué día es "${raw.slice(0, 40)}"; no he cambiado nada. Pasa day con el día ("el sábado", "mañana") o la fecha AAAA-MM-DD.`,
    }
  }

  const i = input.dayIndex
  if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i > 6) {
    return { error: 'Falta el día: pasa day ("hoy", "el sábado", AAAA-MM-DD) o dayIndex 0 (lunes) a 6 (domingo). No he cambiado nada.' }
  }
  return menuDayOf(mondayOf(today.isoDate, today.weekday, input.nextWeek === true ? 1 : 0), i)
}

export const isMenuDayError = (r: MenuDay | { error: string }): r is { error: string } => 'error' in r

/** JSON-schema property for `day`, shared by every menu tool. */
export const DAY_PROP = {
  type: 'string',
  description:
    'El día con las palabras del usuario ("hoy", "mañana", "el sábado", "el martes de la semana que viene") o la fecha AAAA-MM-DD. Preferido sobre dayIndex: la herramienta calcula la fecha en hora de Madrid (un día de la semana suelto es el próximo, hoy incluido).',
}
