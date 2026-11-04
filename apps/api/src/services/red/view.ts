/**
 * Red de tiendas: what the household sees of a Red order and why it can't be
 * ordered yet (ona-hq D-165, design §3 and §5). Pure: the terms are frozen on
 * the order, so presentOrder doesn't read the database.
 */
import type { DeliveryCheck, RedOrderView, RedSettings, ShopFulfilment, ShopOrderLine, ShopSnapshot } from '@ona/shared'
import { householdAmount, householdMax, productsCeiling, productsEstimate, shopCeiling } from './money.js'

const eurText = (n: number) => `${String(Math.round(n * 100) / 100).replace('.', ',')} €`

/** Whether a Red order may go home: a Mimoia copy only if it carries a fee; the household's own shop, always. */
export function redDelivers(snapshot: ShopSnapshot): boolean {
  return snapshot.red?.origin === 'propia' || snapshot.deliveryFeeEur != null
}

export function redView(input: {
  redShopId: string
  terms: RedSettings
  lines: ShopOrderLine[]
  fulfilment: ShopFulfilment
  snapshot: ShopSnapshot
  maxEur: number | null
}): RedOrderView {
  const { terms } = input
  // A Red copy delivers to the household's postal code iff it has a fee (0 = free delivery); see assignRedShop.
  // The household's own shop that joined keeps working as the household set it up: it may always deliver.
  const delivers = redDelivers(input.snapshot)
  const feeEur = input.fulfilment === 'domicilio' && delivers ? input.snapshot.deliveryFeeEur ?? 0 : null
  const estimateShopEur = productsEstimate(input.lines)
  const ceilingShopEur = productsCeiling(input.lines, terms)
  const computedMax = householdMax(ceilingShopEur, feeEur, terms)
  const maxEur = input.maxEur ?? computedMax
  return {
    redShopId: input.redShopId,
    terms,
    estimateShopEur,
    estimateEur: estimateShopEur == null ? null : householdAmount(estimateShopEur, terms),
    feeEur,
    ceilingShopEur,
    maxEur,
    maxRaised: input.maxEur != null && (computedMax == null || input.maxEur > computedMax),
    shopCeilingEur: maxEur == null ? null : shopCeiling(maxEur, feeEur, terms),
    delivers,
    ownShopJoined: input.snapshot.red?.origin === 'propia',
  }
}

/** The lowest max the household may set: what is expected plus the fee, up to the euro. */
export function minimumMax(view: RedOrderView): number | null {
  return view.estimateEur == null ? null : Math.ceil(view.estimateEur + (view.feeEur ?? 0))
}

/** Why a Red draft can't be ordered yet, on top of the usual blockers (choice, amount, address). */
export function redBlockers(view: RedOrderView, delivery: DeliveryCheck | null, fulfilment: ShopFulfilment): string[] {
  const out: string[] = []
  if (view.maxEur == null) out.push('Hay productos sin precio estimado: pon un máximo')
  if (fulfilment === 'domicilio' && !view.delivers) out.push('Esta tienda no reparte en tu código postal: recógelo en la tienda')
  if (delivery?.minEur != null && delivery.confident && delivery.shortByEur) {
    out.push(`No llegas al mínimo a domicilio (${eurText(delivery.minEur)}): añade algo o recógelo en la tienda`)
  }
  return out
}
