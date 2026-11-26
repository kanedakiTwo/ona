import type { BuyableUnit, ShoppingItem } from '@ona/shared'
import { roundMissing, type ConvertQty } from './shoppingItemState.js'

/**
 * «Ya en casa» is what the pantry holds (PRO-1265, Dani y Sara 2026-11-17:
 * «Tortillas de maíz sin gluten 4 u» and «Calabacín 1 u» sat in «Ya en casa»
 * with no tortillas nor calabacín in the pantry — a mark remembered from an
 * older week). On every rebuild a line marked «en casa» (whole or in part)
 * keeps it only for what the pantry has of it now:
 *
 * - nothing in the pantry (no row, or 0) → back to «Por comprar»;
 * - less than the line asks → pending for the rest («Te faltan X · ya tienes Y»);
 * - as much or more → stays «en casa»;
 * - an amount that doesn't compare with the line's unit → stays as marked.
 *
 * A pantry row backs a line when it has one of the line's catalogue
 * ingredients or the same name (accents, case and a plural «s» / «es» aside).
 * It never marks a line «en casa» by itself: the pantry can be stale, and a
 * line hidden by mistake is a dish without its ingredient on Sunday.
 */
export interface PantryAmount {
  ingredientId: string | null
  name: string
  quantity: number
  unit: BuyableUnit | string
}

export function withPantryAtHome(items: ShoppingItem[], pantry: PantryAmount[], convert?: ConvertQty): ShoppingItem[] {
  return items.map((it) => {
    const partial = !it.inStock && it.haveSource === 'inStock' && (it.haveQuantity ?? 0) > 0
    if (!it.inStock && !partial) return it
    const rows = pantryRowsFor(it, pantry)
    let total = 0
    let compared = false
    let unknown = false
    for (const r of rows) {
      if (!(r.quantity > 0)) continue
      const q = amountIn(it, r, convert)
      if (q == null) unknown = true
      else {
        total += q
        compared = true
      }
    }
    if (unknown && !compared) return it // can't compare: stays as marked
    if (total <= 0) return notAtHome(it)
    const missing = roundMissing(it.quantity - total, it.unit)
    if (missing <= 0) return it
    const covered = it.quantity - missing
    if (partial && (it.haveQuantity ?? 0) <= covered) return it
    const out = notAtHome(it)
    return covered > 0 ? { ...out, haveQuantity: covered, haveSource: 'inStock' as const } : out
  })
}

/** The pantry rows that back a line: same catalogue ingredient, or the same name. */
export function pantryRowsFor<T extends PantryAmount>(it: Pick<ShoppingItem, 'ingredientId' | 'mergedIngredientIds' | 'name'>, pantry: T[]): T[] {
  const ids = new Set([it.ingredientId, ...(it.mergedIngredientIds ?? [])].filter(Boolean))
  return pantry.filter((r) => (r.ingredientId != null && ids.has(r.ingredientId)) || sameName(r.name, it.name))
}

function notAtHome(it: ShoppingItem): ShoppingItem {
  const { haveQuantity: _h, haveSource: _s, mark: _m, ...rest } = it
  const keepHave = it.haveSource === 'checked' ? { haveQuantity: it.haveQuantity, haveSource: it.haveSource } : {}
  return { ...rest, ...keepHave, inStock: false } as ShoppingItem
}

function amountIn(it: ShoppingItem, r: PantryAmount, convert?: ConvertQty): number | null {
  const unit = String(r.unit).toLowerCase()
  const from = unit === 'kg' ? 'g' : unit === 'l' ? 'ml' : unit
  const qty = unit === 'kg' || unit === 'l' ? r.quantity * 1000 : r.quantity
  if (from === it.unit) return qty
  const id = it.ingredientId ?? r.ingredientId
  if (!id || !convert) return null
  return convert(id, qty, from as BuyableUnit, it.unit)
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)

/** «Tortillas de maíz» = «tortilla de maiz»; «calabacines» = «calabacín». */
export function sameName(a: string, b: string): boolean {
  const x = norm(a)
  const y = norm(b)
  if (x.length === 0 || x.length !== y.length) return false
  return x.every((w, i) => w === y[i] || `${w}s` === y[i] || `${y[i]}s` === w || `${w}es` === y[i] || `${y[i]}es` === w)
}
