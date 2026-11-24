import { formatQty, sameListProduct, type ShoppingItem } from '@ona/shared'
import { roundUpForUnit, type ConvertQty } from './shoppingItemState.js'

/**
 * A line typed by hand (or by Mimo) that is the same product as a line of the
 * menu joins that line (PRO-1092, hogares de prueba 2026-11-01 → 11-24:
 * «Espinacas · LA QUE VIENE» and «Espinacas · MANUAL», «Jamón de york» and
 * «Jamón cocido · MANUAL», «Tofu · 300 g» and «Tofu · MANUAL · 1 unid.»;
 * Carmen: «si se lo leo así a la pescadera, le pido dos veces»). PRO-177
 * joined the menu's lines among themselves; manual lines stayed apart.
 *
 * The amount typed is added to the line when it can be (same unit or a known
 * conversion: `manualAmount`); with no amount typed it adds nothing (the
 * household meant «that, too»); in their own words («1 sobre») or in a unit
 * that doesn't convert it goes on top, said apart (`manualExtra`).
 * The hand lines travel inside the menu line (`manualParts`, with its
 * bought / «en casa» state) and come back on their own when the menu no
 * longer asks for the product.
 *
 * A hand line joins only a menu line that isn't left out («No lo compro esta
 * semana») and is in its same state: «leche» typed after the menu's milk was
 * ticked is more milk to buy, so it keeps its own line. Once joined, it
 * follows the line. Pure.
 */
export function foldManualIntoMenu(
  menuItems: ShoppingItem[],
  manual: ReadonlyArray<{ item: ShoppingItem; joined: boolean }>,
  convert?: ConvertQty,
): { items: ShoppingItem[]; manual: ShoppingItem[] } {
  const items = menuItems.map((it) => ({ ...it }))
  const alone: ShoppingItem[] = []
  for (const { item: m, joined } of manual) {
    const sameState = (it: ShoppingItem) => !!it.checked === !!m.checked && !!it.inStock === !!m.inStock
    const candidates = items.filter(
      (it) =>
        it.kind !== 'manual' &&
        it.kind !== 'staple' &&
        !!it.ingredientId &&
        (joined || (!it.skipped && sameState(it))) &&
        sameListProduct(m.name, it.name),
    )
    if (candidates.length === 0) {
      alone.push(m)
      continue
    }
    const added = amountOf(m)
    const fits = (it: ShoppingItem) => added && (it.unit === added.unit || convert?.(it.ingredientId!, 1, added.unit, it.unit) != null)
    const line = candidates.find((it) => added && it.unit === added.unit) ?? candidates.find(fits) ?? candidates[0]!
    let summed = false
    if (added) {
      // The household's own amount (PRO-175) stays theirs; the menu's grows.
      const unit = line.menuQuantity != null ? (line.menuUnit ?? line.unit) : line.unit
      const q = unit === added.unit ? added.quantity : convert?.(line.ingredientId!, added.quantity, added.unit, unit)
      if (q != null && q > 0) {
        const sum = (base: number) => (unit === added.unit ? base + q : roundUpForUnit(base + q, unit))
        if (line.menuQuantity != null) line.menuQuantity = sum(line.menuQuantity)
        else line.quantity = sum(line.quantity)
        summed = true
      }
    }
    line.manualParts = [...(line.manualParts ?? []), { ...m, checked: !!line.checked, inStock: !!line.inStock }]
    const words = m.amountText ?? (added ? formatQty(added.quantity, added.unit) : '')
    if (summed) line.manualAmount = [line.manualAmount, words].filter(Boolean).join(' + ')
    else if (words) line.manualExtra = [line.manualExtra, words].filter(Boolean).join(' + ')
  }
  return { items, manual: alone }
}

/** The amount a hand line asks for, when there is one to add up (not «2 paquetes», not «no amount»). */
function amountOf(m: ShoppingItem): { quantity: number; unit: ShoppingItem['unit'] } | null {
  if (m.amountText) return null
  if (m.quantitySource === 'default') return null
  // Before quantitySource (PR 10), «no amount» was stored as 1 u.
  if (m.quantitySource == null && m.quantity === 1 && m.unit === 'u') return null
  if (!(m.quantity > 0)) return null
  return { quantity: m.quantity, unit: m.unit }
}

/**
 * The hand lines of a saved list: on their own, and those joined into a menu
 * line (`joined`), which keep joining it on the next rebuild whatever their
 * state.
 */
export function manualLinesOf(items: readonly ShoppingItem[]): Array<{ item: ShoppingItem; joined: boolean }> {
  const out: Array<{ item: ShoppingItem; joined: boolean }> = []
  for (const it of items) {
    if (it.kind === 'manual') out.push({ item: it, joined: false })
    for (const part of it.manualParts ?? []) out.push({ item: part, joined: true })
  }
  return out
}
