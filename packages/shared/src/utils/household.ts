/**
 * Household sizing helpers.
 *
 * Households are described by two integers:
 *   - `adults`     — adults and children > 10 years (≥ 1)
 *   - `kidsCount`  — children aged 2 to 10           (≥ 0)
 *
 * Children under 2 don't count for portion sizing — they don't eat full
 * meals yet. Children > 10 are treated as adults.
 *
 * The shopping-list multiplier is `adults + 0.5 × kidsCount`, capturing
 * "kids eat about half what an adult does." Mass quantities scale linearly
 * with this multiplier; counted units (`u`) round to the nearest whole.
 */

export const KID_PORTION_FRACTION = 0.5

export interface HouseholdSnapshot {
  adults: number
  kidsCount: number
}

/** Returns the diner-equivalent multiplier (adults + 0.5 × kidsCount). */
export function householdMultiplier(adults: number, kidsCount: number): number {
  const a = Number.isFinite(adults) && adults > 0 ? Math.floor(adults) : 1
  const k = Number.isFinite(kidsCount) && kidsCount > 0 ? Math.floor(kidsCount) : 0
  return a + KID_PORTION_FRACTION * k
}

/**
 * Round the multiplier to a whole number of diners for views that take an
 * integer servings count (the recipe scaler accepts only integers >= 1).
 * 1.5 rounds up to 2 so a couple-with-one-kid household over-buys slightly
 * rather than under-buys.
 */
export function householdToDiners(adults: number, kidsCount: number): number {
  const m = householdMultiplier(adults, kidsCount)
  return Math.max(1, Math.round(m + 0.0001))
}

/**
 * Backfill a legacy `HouseholdSize` enum value into `{ adults, kidsCount }`.
 * Used by the 0005 migration and by any orphan code path still reading the
 * deprecated column.
 */
export function householdSizeToCounts(
  size: 'solo' | 'couple' | 'family_with_kids' | 'family_no_kids' | null | undefined,
): HouseholdSnapshot {
  switch (size) {
    case 'solo':
      return { adults: 1, kidsCount: 0 }
    case 'couple':
      return { adults: 2, kidsCount: 0 }
    case 'family_no_kids':
      return { adults: 3, kidsCount: 0 }
    case 'family_with_kids':
      return { adults: 2, kidsCount: 2 }
    default:
      return { adults: 2, kidsCount: 0 }
  }
}
