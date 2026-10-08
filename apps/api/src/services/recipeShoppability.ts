/**
 * "¿Se puede comprar esta receta?" — lint warnings (never errors) for the
 * ingredient rows the shopping list or a shop order can't handle well
 * (specs/recipe-quality.md → Shoppability). Pure; reuses the buy rules the
 * shop orders use (@ona/shared buy/).
 *
 *   BUY_NO_QUANTITY   "cilantro al gusto" never reaches the list (only pantry
 *                     basics may go al gusto / pizca)
 *   BUY_GENERIC       "hierbas aromáticas (romero, tomillo)", "pescado entero
 *                     (dorada, lubina…)": a family, not a product
 *   BUY_NEEDS_CHOICE  "ternera" with no cut: the order waits for "¿para qué?"
 *   BUY_NEEDS_WEIGHT  "2 u de panceta": the butcher weighs, say grams
 */

import { resolveBuyRule, splitCompound, toOrderQty, type BuyableUnit, type RecipeShoppingIssue, type Unit } from '@ona/shared'
import { isPantryBasic } from './shopOrders/draft.js'

export interface ShoppableRow {
  name: string
  quantity: number
  unit: Unit
  note?: string | null
  optional?: boolean
}

export interface ShoppabilityIssue {
  code: RecipeShoppingIssue['code']
  message: string
  /** Index into the rows passed in. */
  index: number
}

const BUYABLE = new Set<Unit>(['g', 'ml', 'u', 'cda', 'cdita'])
const orList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} o ${xs[xs.length - 1]}` : xs[0] ?? '')

/** "¿Qué pan? (de molde, de hogaza o en barra)"; no list when the question already names them. */
function askWithOptions(question: string, options: string[]): string {
  const q = question.toLowerCase()
  return options.every((o) => q.includes(o.toLowerCase())) ? question : `${question} (${orList(options)}).`
}

/** Pantry basic or a despensa rule: fine "al gusto" (assumed at home). */
function atHome(name: string): boolean {
  if (resolveBuyRule(name)?.rule.shop === 'despensa') return true
  return isPantryBasic({ name, unit: 'g', quantity: 1, kind: 'menu' })
}

export function shoppabilityIssues(rows: ShoppableRow[]): ShoppabilityIssue[] {
  const out: ShoppabilityIssue[] = []
  rows.forEach((row, index) => {
    const name = row.name.trim()
    if (!name || row.optional) return

    const family = splitCompound(name)
    const resolved = resolveBuyRule(name)
    if (family || (resolved?.options && resolved.options.length > 1)) {
      out.push({
        code: 'BUY_GENERIC',
        index,
        message: family
          ? `«${name}» es una familia de productos: pon cada uno por separado (${orList(family)}) con su cantidad, para que salgan en la lista de la compra.`
          : `«${name}» deja la elección abierta: pon uno concreto (${orList(resolved!.options!)}) y menciona los otros en los pasos, para que el pedido a la tienda sea claro.`,
      })
      return
    }

    if (!BUYABLE.has(row.unit) || !(row.quantity > 0)) {
      if (atHome(name)) return
      const hint = resolved
        ? toOrderQty({ name, quantity: 1, unit: 'u', quantitySource: 'default' }).text.replace(/ — .*$/, '')
        : null
      out.push({
        code: 'BUY_NO_QUANTITY',
        index,
        message: `«${name}» no tiene cantidad y no saldrá en la lista de la compra: pon cuánto hace falta${hint ? ` (p. ej. ${hint.toLowerCase()})` : ''}.`,
      })
      return
    }

    if (!resolved) return
    const conv = toOrderQty({ name, quantity: row.quantity, unit: row.unit as BuyableUnit, notes: row.note ? [row.note] : [], quantitySource: 'recipe' })
    if (conv.needsQuantity) {
      out.push({
        code: 'BUY_NEEDS_WEIGHT',
        index,
        message: `«${name}» va en unidades, pero en la tienda se pide al peso: pon los gramos (p. ej. ${conv.needsQuantity.suggestion}).`,
      })
    }
    if (conv.needsChoice) {
      out.push({
        code: 'BUY_NEEDS_CHOICE',
        index,
        message: `«${name}»: ${askWithOptions(conv.needsChoice.question, conv.needsChoice.options)} Ponlo en el nombre o en la nota del ingrediente, para que el pedido no se quede esperando la respuesta.`,
      })
    }
  })
  return out
}

/** Detail-page shape: issues keyed by recipe_ingredients row id. */
export function recipeShoppingIssues(rows: Array<ShoppableRow & { id: string }>): RecipeShoppingIssue[] {
  return shoppabilityIssues(rows).map((i) => ({ code: i.code, message: i.message, rowId: rows[i.index].id }))
}
