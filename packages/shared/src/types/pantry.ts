/**
 * PRO-228 · where each thing of the despensa is. Every row is in one place;
 * rows from before PRO-228 (and anything added without saying) are «despensa».
 */
export const PANTRY_LOCATIONS = ['nevera', 'congelador', 'despensa'] as const
export type PantryLocation = (typeof PANTRY_LOCATIONS)[number]

export const PANTRY_LOCATION_LABELS: Record<PantryLocation, string> = {
  nevera: 'Nevera',
  congelador: 'Congelador',
  despensa: 'Despensa',
}

export function isPantryLocation(v: unknown): v is PantryLocation {
  return typeof v === 'string' && (PANTRY_LOCATIONS as readonly string[]).includes(v)
}

/** Rows grouped by place, in the order nevera → congelador → despensa; empty groups left out. */
export function groupPantryByLocation<T extends { location?: string | null }>(rows: readonly T[]): Array<{ location: PantryLocation; items: T[] }> {
  return PANTRY_LOCATIONS.map((location) => ({
    location,
    items: rows.filter((r) => (isPantryLocation(r.location) ? r.location : 'despensa') === location),
  })).filter((g) => g.items.length > 0)
}

/** The monthly freezer review looks at what has been in the freezer this long. */
export const FREEZER_REVIEW_MIN_DAYS = 28

/** Freezer rows that went in at least `minDays` ago (and are not used up). */
export function freezerItemsDue<T extends { location?: string | null; storedAt?: string | null; createdAt: string; quantity: number }>(
  rows: readonly T[],
  now: Date,
  minDays: number = FREEZER_REVIEW_MIN_DAYS,
): T[] {
  const limit = now.getTime() - minDays * 24 * 60 * 60 * 1000
  return rows.filter((r) => {
    if (r.location !== 'congelador' || !(r.quantity > 0)) return false
    const at = Date.parse(r.storedAt ?? r.createdAt)
    return Number.isFinite(at) && at <= limit
  })
}
