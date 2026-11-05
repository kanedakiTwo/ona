/**
 * Red de tiendas: the numbers of an order (ona-hq D-165, design §2–§3).
 * Pure. Discount and commission are computed on the products total at the
 * shop's prices, before the discount and without the delivery fee, each
 * rounded to the cent; the household pays products − discount (+ fee).
 * Everything is done in whole cents, so the amount shown and the one charged
 * come from the same rule.
 */
import type { RedSettings, ShopOrderLine } from '@ona/shared'

/** € → cents. Inputs are cent-precision; rounding absorbs float noise (20.7 × 100 = 2069.99…). */
const toCents = (eur: number) => Math.round(eur * 100)
const toEur = (cents: number) => cents / 100
/** `pct` % of `cents`, to the cent, half up (integer numerator: 2070 × 5 / 100 = 103.5 → 104). */
const pctOfCents = (cents: number, pct: number) => Math.round((cents * pct) / 100)
/** The one discount rule: the shop-price total and the charge both use it. */
const discountCents = (shopCents: number, s: RedSettings) => pctOfCents(shopCents, s.discountPct)
const live = (lines: ShopOrderLine[]) => lines.filter((l) => l.included !== false)

/**
 * Margin over a line's estimate, in % points, plus wild fish. Only the
 * household's own price (`manual`) or this shop's (`historial`) get the known
 * margin; anything else, unknown included, gets the wider reference one.
 */
export function lineMarginPct(line: Pick<ShopOrderLine, 'estimateSource' | 'volatile'>, s: RedSettings): number {
  const known = line.estimateSource === 'manual' || line.estimateSource === 'historial'
  const base = known ? s.marginKnownPct : s.marginReferencePct
  return base + (line.volatile ? s.marginWildFishExtraPct : 0)
}

/** Products estimate at the shop's prices; null when no included line has one. */
export function productsEstimate(lines: ShopOrderLine[]): number | null {
  const known = live(lines).filter((l) => l.estimateEur != null)
  if (!known.length) return null
  return toEur(known.reduce((acc, l) => acc + toCents(l.estimateEur as number), 0))
}

/** Techo de productos: Σ estimate × (1 + margin) over the lines, summed exactly and rounded to the cent once. null if an included line has no estimate. */
export function productsCeiling(lines: ShopOrderLine[], s: RedSettings): number | null {
  const ls = live(lines)
  if (!ls.length || ls.some((l) => l.estimateEur == null)) return null
  const hundredths = ls.reduce((acc, l) => acc + toCents(l.estimateEur as number) * (100 + lineMarginPct(l, s)), 0)
  return toEur(Math.round(hundredths / 100))
}

/** What the household pays for `shopEur` of products: the total minus the discount (design §2). */
export function householdAmount(shopEur: number, s: RedSettings): number {
  const shopCents = toCents(shopEur)
  return toEur(shopCents - discountCents(shopCents, s))
}

/** «Como mucho»: the ceiling with the discount, plus the fee, rounded up to the euro. */
export function householdMax(ceilingShopEur: number | null, feeEur: number | null, s: RedSettings): number | null {
  if (ceilingShopEur == null) return null
  return Math.ceil((toCents(householdAmount(ceilingShopEur, s)) + toCents(feeEur ?? 0)) / 100)
}

/** What the shop may reach at its prices under that max, down to the cent (so the household never pays over it). */
export function shopCeiling(maxEur: number, feeEur: number | null, s: RedSettings): number {
  return toEur(Math.floor(((toCents(maxEur) - toCents(feeEur ?? 0)) * 100) / (100 - s.discountPct)))
}

export interface ChargeSplit {
  discountEur: number
  commissionEur: number
  householdPaysEur: number
  shopGetsEur: number
}

/** How a charge splits (used at «Listo» from tramo 1b). Same discount rule as `householdAmount`. */
export function splitCharge(productsShopEur: number, feeEur: number | null, s: RedSettings): ChargeSplit {
  const shopCents = toCents(productsShopEur)
  const discount = discountCents(shopCents, s)
  const commission = pctOfCents(shopCents, s.commissionPct)
  const householdPays = shopCents - discount + toCents(feeEur ?? 0)
  return {
    discountEur: toEur(discount),
    commissionEur: toEur(commission),
    householdPaysEur: toEur(householdPays),
    shopGetsEur: toEur(householdPays - commission),
  }
}
