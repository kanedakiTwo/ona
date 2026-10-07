/**
 * Fish specifics for orders to a pescadería (specs/shop-orders.md).
 *
 * Recipes use clean (edible) weight, but fishmongers weigh and charge the
 * whole fish before cleaning. Yields: FAO Fisheries Technical Paper 309
 * (edible part as % of whole weight). Species bought as loins/fillets
 * (salmón, bacalao) or by weight as-is (mejillón, gamba) have no
 * conversion.
 *
 * "Volatile" = wild species priced by the daily lonja (Mercamadrid, Sept–Oct
 * 2026: merluza −42 % in 7 sessions, sardina +117 % overnight). Farmed fish
 * (dorada, lubina, salmón, trucha, mejillón) barely moves.
 */

import { normalizeName } from './classify.js'

const YIELDS: Array<[RegExp, number]> = [
  [/\b(merluza|pescadilla)\b/, 0.53],
  [/\bdorada\b/, 0.54],
  [/\blubina\b/, 0.54],
  [/\b(sardinas?|boquerone?s?)\b/, 0.62],
  [/\b(caballa|jurel)\b/, 0.61],
  [/\b(lenguado|gallo|rodaballo)\b/, 0.49],
  [/\b(calamar(es)?|chipirones?|sepia)\b/, 0.67],
  [/\bpulpo\b/, 0.79],
]

const VOLATILE = /\b(merluza|pescadilla|sardinas?|boquerone?s?|besugo|rape|gallo|lenguado|rodaballo|bonito|atun (fresco|rojo)|lomos? de atun|caballa|jurel|cabracho|mero|corvina|calamar(es)?|chipirones?|sepia|pulpo|gambas?|langostinos?|cigalas?|carabineros?|almejas?|berberechos?|navajas?|vieiras?|zamburinas?|percebes?|bogavante|centollo|necoras?)\b/

export function fishYield(name: string): number | null {
  const n = normalizeName(name)
  for (const [re, y] of YIELDS) if (re.test(n)) return y
  return null
}

/** Whole weight (g, rounded to 50 g) for a clean weight; null when there's no conversion. */
export function wholeWeightGrams(name: string, cleanGrams: number): number | null {
  const y = fishYield(name)
  if (!y || cleanGrams <= 0) return null
  return Math.round(cleanGrams / y / 50) * 50
}

export function isVolatileFish(name: string): boolean {
  return VOLATILE.test(normalizeName(name))
}
