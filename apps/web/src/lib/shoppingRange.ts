/**
 * /shopping date-range helpers (PRO-33, PRO-269): one-tap shortcuts «Hoy»,
 * «Mañana», «Esta semana», «La que viene» and «Dos semanas» beside the
 * range chip, and the week each line is for. Pure, so the API
 * vitest suite can pin them (shoppingQuickRange.test.ts).
 */

/** Shift a `YYYY-MM-DD` date by `days` (calendar arithmetic in UTC, no DST drift). */
export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export type QuickRangeKey = 'hoy' | 'manana' | 'semana' | 'siguiente' | 'dos'

export interface QuickRange {
  key: QuickRangeKey
  label: string
  from: string
  to: string
}

/** Monday (`YYYY-MM-DD`) of the week of an ISO date. */
export function mondayOfIso(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return shiftIso(iso, -dow)
}

/**
 * The shortcuts (PRO-33, PRO-269): what the chip says is what the list
 * shows. «Esta semana» is today → this Sunday, «La que viene» next Monday →
 * Sunday, and «Dos semanas» both (today → end of next week), the page's
 * default range, so it doubles as "reset". Before PRO-269 «Esta semana» was
 * the two weeks («19 oct – 1 nov»).
 */
export function quickRanges(today: string): QuickRange[] {
  const tomorrow = shiftIso(today, 1)
  const monday = mondayOfIso(today)
  const sunday = shiftIso(monday, 6)
  const nextMonday = shiftIso(monday, 7)
  const nextSunday = shiftIso(monday, 13)
  return [
    { key: 'hoy', label: 'Hoy', from: today, to: today },
    { key: 'manana', label: 'Mañana', from: tomorrow, to: tomorrow },
    { key: 'semana', label: 'Esta semana', from: today, to: sunday },
    { key: 'siguiente', label: 'La que viene', from: nextMonday, to: nextSunday },
    { key: 'dos', label: 'Dos semanas', from: today, to: nextSunday },
  ]
}

/**
 * Which shortcut matches the current range exactly, if any. On a Sunday
 * «Hoy» and «Esta semana» are the same day: `preferred` (the chip last
 * tapped) wins when it matches.
 */
export function activeQuickRange(
  ranges: readonly QuickRange[],
  from: string,
  to: string,
  preferred?: QuickRangeKey | null,
): QuickRangeKey | null {
  const matching = ranges.filter((r) => r.from === from && r.to === to)
  if (preferred && matching.some((r) => r.key === preferred)) return preferred
  return matching[0]?.key ?? null
}

/**
 * Title of the € total card (PRO-69): it follows the shortcut, so with «Hoy»
 * it doesn't keep saying «semanal». Any other range keeps the usual title.
 */
export function totalTitle(key: QuickRangeKey | null): string {
  if (key === 'hoy') return 'Total de hoy estimado'
  if (key === 'manana') return 'Total de mañana estimado'
  if (key === 'semana') return 'Total de esta semana estimado'
  if (key === 'siguiente') return 'Total de la semana que viene estimado'
  if (key === 'dos') return 'Total de las dos semanas estimado'
  return 'Total semanal estimado'
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * Which week a line of the list is for (PRO-269), from its `weeks` (how
 * much each week's dishes ask, PRO-270): «Esta semana», «La que viene»,
 * «Semana del 2 nov», or «Las dos semanas» when it's for more than one.
 * `null` when the line doesn't say.
 */
export function lineWeekLabel(weeks: Record<string, number> | undefined | null, today: string): string | null {
  const ws = Object.entries(weeks ?? {})
    .filter(([, q]) => q > 0)
    .map(([w]) => w)
    .sort()
  if (ws.length === 0) return null
  if (ws.length > 1) return ws.length === 2 ? 'Las dos semanas' : `${ws.length} semanas`
  const monday = mondayOfIso(today)
  if (ws[0] === monday) return 'Esta semana'
  if (ws[0] === shiftIso(monday, 7)) return 'La que viene'
  const [, m, d] = ws[0].split('-').map(Number)
  return `Semana del ${d} ${MONTHS[m - 1]}`
}

/** True when the range covers days of more than one week: then each line says its week. */
export function spansWeeks(from: string, to: string): boolean {
  return mondayOfIso(from) !== mondayOfIso(to)
}
