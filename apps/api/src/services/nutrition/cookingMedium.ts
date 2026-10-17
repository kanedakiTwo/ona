/**
 * Frying and confit fat: the cooking medium, not the food.
 *
 * A recipe lists the oil the cook needs in the pan («500 ml de aceite, para
 * freír; se recupera casi todo»), but most of it stays in the pan. A line is
 * a cooking medium when its note starts with «para freír» / «para la fritura»
 * or «para confitar» and the ingredient is a fat (aceite, manteca,
 * mantequilla… or ≥ 80 g fat per 100 g). Nutrition counts only the share the
 * food absorbs, and the lint checks that share against the per-serving range.
 *
 * Pure, no I/O. Spec: ../../../../../specs/nutrition.md ("Recipe Aggregation")
 */

/** Share of the frying oil that ends up in the food. */
export const FRYING_ABSORPTION = 0.15
/** Share of the confit fat that ends up in the food (lower heat, longer soak). */
export const CONFIT_ABSORPTION = 0.25

const FAT_NAME_RE = /^(aceite|manteca|mantequilla|grasa)\b/
const FRYING_NOTE_RE = /^para (freir|la fritura)/
const CONFIT_NOTE_RE = /^para confitar/

function fold(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').trim()
}

/**
 * 1 for an ordinary line; the absorbed share for a frying/confit fat.
 * A note like «40 ml para el pisto y el resto para freír» doesn't qualify:
 * split it into two lines so each amount is counted right.
 */
export function cookingMediumFactor(
  note: string | null | undefined,
  ingredient: { name?: string | null; fat?: number | null } | null | undefined,
): number {
  if (!note || !ingredient) return 1
  const isFat = FAT_NAME_RE.test(fold(ingredient.name ?? '')) || (ingredient.fat ?? 0) >= 80
  if (!isFat) return 1
  const n = fold(note)
  if (FRYING_NOTE_RE.test(n)) return FRYING_ABSORPTION
  if (CONFIT_NOTE_RE.test(n)) return CONFIT_ABSORPTION
  return 1
}
