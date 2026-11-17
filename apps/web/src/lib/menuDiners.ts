/** Household diners as the menu counts them (a child is one person): the fallback when a meal has no people count of its own. */
export function menuDiners(p: { adults?: number | null; kidsCount?: number | null }): number {
  return Math.max(1, (p.adults ?? 0) + (p.kidsCount ?? 0) || 2)
}
