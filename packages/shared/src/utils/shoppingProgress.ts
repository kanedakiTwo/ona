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

export function shoppingProgress(
  all: ReadonlyArray<{ checked?: boolean | null; inStock?: boolean | null; skipped?: boolean | null }>,
): ShoppingProgress {
  // «No lo compro esta semana» (PRO-175) is not part of the list.
  const items = all.filter((i) => !i.skipped)
  const total = items.length
  const atHome = items.filter((i) => !!i.inStock).length
  const bought = items.filter((i) => !!i.checked && !i.inStock).length
  const done = bought + atHome
  return { total, bought, atHome, done, ratio: total > 0 ? done / total : 0 }
}

/**
 * What the household typed as the amount of a line (PRO-175): a plain number
 * («2», «1,5») is a quantity in the chosen unit; anything with words («2
 * paquetes», «1 bote») is kept as they wrote it. Empty → no amount.
 */
export function parseShoppingAmount(raw: string): { quantity: number } | { amountText: string } | null {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (!text) return null
  if (/^\d+(?:[.,]\d+)?$/.test(text)) {
    const n = Number(text.replace(',', '.'))
    return n > 0 ? { quantity: n } : null
  }
  return { amountText: text.slice(0, 30) }
}
