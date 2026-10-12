/**
 * /shopping date-range helpers (PRO-33): one-tap shortcuts «Hoy»,
 * «Mañana» and «Esta semana» beside the range chip. Pure, so the API
 * vitest suite can pin them (shoppingQuickRange.test.ts).
 */

/** Shift a `YYYY-MM-DD` date by `days` (calendar arithmetic in UTC, no DST drift). */
export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export type QuickRangeKey = 'hoy' | 'manana' | 'semana'

export interface QuickRange {
  key: QuickRangeKey
  label: string
  from: string
  to: string
}

/**
 * The three shortcuts. «Esta semana» is the page's default range
 * (today → `defaultTo`, the end of next week), so it doubles as "reset".
 */
export function quickRanges(today: string, defaultTo: string): QuickRange[] {
  const tomorrow = shiftIso(today, 1)
  return [
    { key: 'hoy', label: 'Hoy', from: today, to: today },
    { key: 'manana', label: 'Mañana', from: tomorrow, to: tomorrow },
    { key: 'semana', label: 'Esta semana', from: today, to: defaultTo },
  ]
}

/** Which shortcut matches the current range exactly, if any. */
export function activeQuickRange(
  ranges: readonly QuickRange[],
  from: string,
  to: string,
): QuickRangeKey | null {
  return ranges.find((r) => r.from === from && r.to === to)?.key ?? null
}

/**
 * Title of the € total card (PRO-69): it follows the shortcut, so with «Hoy»
 * it doesn't keep saying «semanal». Any other range keeps the usual title.
 */
export function totalTitle(key: QuickRangeKey | null): string {
  if (key === 'hoy') return 'Total de hoy estimado'
  if (key === 'manana') return 'Total de mañana estimado'
  return 'Total semanal estimado'
}
