/**
 * Recipe-form units that the shopping list can use (PRO-90). A row "al
 * gusto" or "una pizca" never reaches the list, so typing an amount on it
 * moves it to a buyable unit, and the "Para hacer la compra" hint only
 * proposes units the recipe form's selector has (g / ml / u — shown "ud").
 */

import type { Unit } from '../constants/enums.js'
import { resolveBuyRule } from './convert.js'

const SYMBOLIC = new Set<string>(['pizca', 'al_gusto'])

/** "u" when the shop sells it by the piece (jengibre, cilantro, aguacate), "g" otherwise. */
export function buyableUnitFor(name: string): 'u' | 'g' {
  return resolveBuyRule(name)?.rule.by === 'pieza' ? 'u' : 'g'
}

/**
 * The unit a recipe row should have once the user types `quantity` on it:
 * a symbolic unit (al gusto / pizca) with an amount becomes buyable; any
 * other unit stays as the user chose it.
 */
export function unitAfterQuantity(name: string, unit: string, quantity: number | ''): string {
  if (!SYMBOLIC.has(unit) || !(typeof quantity === 'number' && quantity > 0)) return unit
  return buyableUnitFor(name)
}

/**
 * What to write on a row with no amount, in the form's own units:
 * "1 ud de jengibre", "1 ud (manojo) de cilantro", "250 g de espinacas".
 * null when there's no useful example (no rule, or sold in packs).
 */
export function quantityHintFor(name: string): string | null {
  const resolved = resolveBuyRule(name)
  if (!resolved) return null
  const { rule } = resolved
  const pretty = name.trim().toLowerCase()
  if (rule.by === 'pieza') {
    // A recipe "u" of a bunch is the bunch: say so. Not when a "u" means
    // something smaller than the sale unit (ajo: a clove, not a head).
    const sale = rule.unit && rule.ug == null ? ` (${rule.unit[0]})` : ''
    return `1 ud${sale} de ${pretty}`
  }
  if (rule.by === 'peso') return `${rule.min ?? 250} g de ${pretty}`
  return null
}

/** Units the recipe form offers, with the label the selector shows. */
export const RECIPE_UNIT_LABELS: Record<Unit, string> = {
  g: 'g',
  ml: 'ml',
  u: 'ud',
  cda: 'cda',
  cdita: 'cdita',
  pizca: 'pizca',
  al_gusto: 'al gusto',
}
