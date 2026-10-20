import { addDays, madridParts } from '../madridTime.js'
import { dateLabel } from '../assistant/menuDay.js'
import type { HistoryRow } from './history.js'

/**
 * PRO-250 (reviewer, 2026-10-17): a household answered «¿hiciste la cena?»
 * (Friday, hummus casero) after midnight; Mimo talked about «la cena de hoy»,
 * mixed in Saturday's menu and had to say it got the day wrong. A reply that
 * comes in between 00:00 and 06:00 (Madrid) after the evening's dinner
 * check-in, with nothing answered since, is an answer to THAT check-in: Mimo
 * gets this note with the turn (never stored in history) and records it on
 * the check-in's day. Pure.
 */
export const LATE_CHECKIN_UNTIL_HOUR = 6

export function lateDinnerCheckinNote(rows: readonly HistoryRow[], now: Date): string | null {
  const p = madridParts(now)
  if (p.hour >= LATE_CHECKIN_UNTIL_HOUR) return null
  let at = -1
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].direction === 'out' && rows[i].kind === 'dinner_checkin') {
      at = i
      break
    }
  }
  if (at < 0) return null
  const sent = rows[at].createdAt
  const sentParts = madridParts(sent)
  if (sentParts.isoDate !== addDays(p.isoDate, -1)) return null
  // Already answered (a turn of the user processed after the check-in): this is something else.
  if (rows.slice(at + 1).some((r) => r.direction === 'in' && r.status === 'processed')) return null
  const day = dateLabel(sentParts.isoDate)
  const hh = `${String(sentParts.hour).padStart(2, '0')}:${String(sentParts.minute).padStart(2, '0')}`
  return (
    `[Nota del sistema, no la menciones] Este mensaje contesta al aviso de la cena del ${day} (enviado ese dia a las ${hh}). ` +
    `Aunque ya sea pasada la medianoche, "hoy" y "la cena" en su respuesta son la cena del ${day}: si dice que la hizo, apuntala en ese dia (day "${sentParts.isoDate}"), no en el de hoy, y no hables del menu de hoy salvo que lo pida.`
  )
}
