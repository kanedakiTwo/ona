/**
 * Red de tiendas: what the household sees of a Red order and why it can't be
 * ordered yet (ona-hq D-165, design §3 and §5). Pure: the terms are frozen on
 * the order, so presentOrder doesn't read the database.
 */
import type { DeliveryCheck, RedOrderView, RedSettings, ShopFulfilment, ShopOrder, ShopOrderLine, ShopSnapshot } from '@ona/shared'
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

export interface RedRefusal {
  code: string
  message: string
}

/** Why «Pedir» can't go ahead on this draft (empty, blocked, or the max isn't the one the household saw); null = it can. */
export function redOrderRefusal(order: ShopOrder, maxEur: number): RedRefusal | null {
  if (!order.lines.some((l) => l.included !== false)) return { code: 'EMPTY', message: 'El pedido está vacío.' }
  if (order.blockers.length) return { code: 'BLOCKED', message: order.blockers[0] }
  const max = order.red?.maxEur ?? null
  if (max == null || Math.abs(max - maxEur) > 0.004) return { code: 'MAX_CHANGED', message: 'El máximo ha cambiado: revísalo antes de pedir.' }
  return null
}

/** The parts of a draft edit that decide «como mucho» (PATCH /shop-orders/:id). */
export interface RedMaxPatch {
  lines?: Array<{ key: string; note?: string | null } & Record<string, unknown>>
  add?: unknown[]
  fulfilment?: ShopFulfilment
  maxEur?: number | null
}

/**
 * The edit changes what's ordered or how: any line change other than a note
 * (amount, unit, remove, move, choice, include), an added product, or a real
 * switch between pickup and delivery.
 */
export function redOrderChanged(patch: RedMaxPatch, currentFulfilment: ShopFulfilment): boolean {
  const lineChanged = (patch.lines ?? []).some((l) => Object.entries(l).some(([k, v]) => k !== 'key' && k !== 'note' && v !== undefined))
  const fulfilmentChanged = patch.fulfilment !== undefined && patch.fulfilment !== currentFulfilment
  return lineChanged || !!patch.add?.length || fulfilmentChanged
}

/**
 * patchOrder's rule for a Red draft's «como mucho». `view` is the edited
 * draft with no max set. A max asked for wins if it isn't below what's
 * expected (MAX_TOO_LOW); null brings back the computed one; otherwise a
 * change to what's ordered brings it back too. `maxEur: undefined` = keep it.
 */
export function nextRedMax(patch: RedMaxPatch, currentFulfilment: ShopFulfilment, view: RedOrderView): { maxEur: number | null | undefined } | { refusal: RedRefusal } {
  if (patch.maxEur !== undefined) {
    const min = minimumMax(view)
    if (patch.maxEur != null && min != null && patch.maxEur < min) {
      return { refusal: { code: 'MAX_TOO_LOW', message: `El máximo no puede bajar de ${min} €: es lo previsto.` } }
    }
    return { maxEur: patch.maxEur }
  }
  return { maxEur: redOrderChanged(patch, currentFulfilment) ? null : undefined }
}
