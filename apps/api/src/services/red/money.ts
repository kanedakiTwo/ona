/**
 * Red de tiendas: the numbers of an order (ona-hq D-165, design §2–§3).
 * Pure. Discount and commission are computed on the products total at the
 * shop's prices, before the discount and without the delivery fee.
 */
import type { RedSettings, ShopOrderLine } from '@ona/shared'

const round2 = (n: number) => Math.round(n * 100) / 100
const live = (lines: ShopOrderLine[]) => lines.filter((l) => l.included !== false)

/** Margin over a line's estimate, in % points: by where its price comes from, plus wild fish. */
export function lineMarginPct(line: Pick<ShopOrderLine, 'estimateSource' | 'volatile'>, s: RedSettings): number {
  const base = line.estimateSource === 'referencia' ? s.marginReferencePct : s.marginKnownPct
  return base + (line.volatile ? s.marginWildFishExtraPct : 0)
}

/** Products estimate at the shop's prices; null when no included line has one. */
export function productsEstimate(lines: ShopOrderLine[]): number | null {
  const known = live(lines).filter((l) => l.estimateEur != null)
  if (!known.length) return null
  return round2(known.reduce((acc, l) => acc + (l.estimateEur as number), 0))
}

/** Techo de productos: Σ estimate × (1 + margin), line by line. null if an included line has no estimate. */
export function productsCeiling(lines: ShopOrderLine[], s: RedSettings): number | null {
  const ls = live(lines)
  if (!ls.length || ls.some((l) => l.estimateEur == null)) return null
  return round2(ls.reduce((acc, l) => acc + (l.estimateEur as number) * (1 + lineMarginPct(l, s) / 100), 0))
}

/** What the household pays for `shopEur` of products: the discount applied. */
export function householdAmount(shopEur: number, s: RedSettings): number {
  return round2(shopEur * (1 - s.discountPct / 100))
}

/** «Como mucho»: the ceiling with the discount, plus the fee, rounded up to the euro. */
export function householdMax(ceilingShopEur: number | null, feeEur: number | null, s: RedSettings): number | null {
  if (ceilingShopEur == null) return null
  return Math.ceil(round2(householdAmount(ceilingShopEur, s) + (feeEur ?? 0)))
}

/** What the shop may reach at its prices under that max, down to the cent (so the household never pays over it). */
export function shopCeiling(maxEur: number, feeEur: number | null, s: RedSettings): number {
  return Math.floor(round2(((maxEur - (feeEur ?? 0)) / (1 - s.discountPct / 100)) * 100)) / 100
}

/** How a charge splits (used at «Listo» from tramo 1b). */
export function splitCharge(productsShopEur: number, feeEur: number | null, s: RedSettings) {
  const discountEur = round2((productsShopEur * s.discountPct) / 100)
  const commissionEur = round2((productsShopEur * s.commissionPct) / 100)
  const householdPaysEur = round2(productsShopEur - discountEur + (feeEur ?? 0))
  return { discountEur, commissionEur, householdPaysEur, shopGetsEur: round2(householdPaysEur - commissionEur) }
}
