import type { ShoppingItem } from '@ona/shared'
import type { ConvertQty } from './shoppingItemState.js'

/**
 * How much of each line of the rolling list each week's dishes ask for
 * (PRO-270): `weeks = { <Monday>: amount }` in the line's unit. The rolling
 * route aggregates the whole range once (the line the household sees) and
 * each week of it apart; each week keeps the amount its own list asks
 * (rounded up on its own, so the weeks can add up to a bit more than the
 * line: 37,5 g of oil a week is «50 g» on «Esta semana»). A tick then says
 * which weeks it was bought for, and the merluza bought for Saturday 17
 * doesn't tick Monday 26's; ticking the two weeks and looking at «Esta
 * semana» finds this week's whole amount bought.
 *
 * Week lines match a range line by ingredient (its own or a joined one,
 * PRO-177) and are converted to its unit; what can't be converted doesn't
 * count. A line no week explains (shouldn't happen) is left without
 * `weeks` and keeps the old, week-blind behaviour. Pure.
 */
export function withWeekShares(
  items: ShoppingItem[],
  perWeek: ReadonlyArray<{ week: string; items: ShoppingItem[] }>,
  convert?: ConvertQty,
): ShoppingItem[] {
  if (perWeek.length === 0) return items
  if (perWeek.length === 1) {
    const [{ week }] = perWeek
    return items.map((it) => (it.ingredientId && it.quantity > 0 ? { ...it, weeks: { [week]: it.quantity } } : it))
  }
  return items.map((it) => {
    if (!it.ingredientId || !(it.quantity > 0)) return it
    const ids = new Set([it.ingredientId, ...(it.mergedIngredientIds ?? [])])
    const raw: Record<string, number> = {}
    for (const { week, items: weekItems } of perWeek) {
      let total = 0
      for (const w of weekItems) {
        if (!w.ingredientId) continue
        if (!ids.has(w.ingredientId) && !(w.mergedIngredientIds ?? []).some((id) => ids.has(id))) continue
        const q = w.unit === it.unit ? w.quantity : (convert?.(w.ingredientId, w.quantity, w.unit, it.unit) ?? null)
        if (q != null && q > 0) total += q
      }
      if (total > 0) raw[week] = total
    }
    if (Object.keys(raw).length === 0) return it
    const weeks = Object.fromEntries(Object.entries(raw).map(([w, q]) => [w, Math.round(q * 1000) / 1000]))
    return { ...it, weeks }
  })
}
