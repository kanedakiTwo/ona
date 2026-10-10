/**
 * Progress of a shopping list (`/shopping`): each row counts once.
 *
 * A row can be both `checked` (bought) and `inStock` (at home) — you tick it
 * at the shop and later mark it "en casa". It then counts as at home only, so
 * "comprados + en casa" never exceeds the rows and the bar never passes 100 %
 * (the old `(checked + inStock) / total` showed "72/56 · 129 %", 2026-10-10).
 */
export interface ShoppingProgress {
  total: number
  /** Bought and not (yet) marked at home. */
  bought: number
  atHome: number
  /** bought + atHome, always ≤ total. */
  done: number
  /** done / total, 0 for an empty list. */
  ratio: number
}

export function shoppingProgress(items: ReadonlyArray<{ checked?: boolean | null; inStock?: boolean | null }>): ShoppingProgress {
  const total = items.length
  const atHome = items.filter((i) => !!i.inStock).length
  const bought = items.filter((i) => !!i.checked && !i.inStock).length
  const done = bought + atHome
  return { total, bought, atHome, done, ratio: total > 0 ? done / total : 0 }
}
