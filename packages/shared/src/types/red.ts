import { z } from 'zod'

/**
 * Red de tiendas v2 (ona-hq D-165; specs/shop-orders.md → «Red de tiendas»):
 * the household orders through Mimoia and the shop cedes a share of every
 * order: half is a discount for the household, half Mimoia's commission.
 */

/** Kinds of shop in the Red. Supermarkets are never in it. */
export const RED_KINDS = ['fruteria', 'carniceria', 'pescaderia'] as const
export type RedKind = (typeof RED_KINDS)[number]
export const isRedKind = (k: string): k is RedKind => (RED_KINDS as readonly string[]).includes(k)

/** Order states that only Red orders have (draft, cancelled and closed are shared with the rest). */
export const RED_ORDER_STATUSES = ['ordered', 'accepted', 'preparing', 'ready', 'payment_pending', 'charged', 'delivered', 'rejected', 'incident'] as const
export type RedOrderStatus = (typeof RED_ORDER_STATUSES)[number]

export interface RedSettings {
  /** % of the products total the household gets off. */
  discountPct: number
  /** % of the products total that is Mimoia's commission. */
  commissionPct: number
  /** Whether that commission already includes VAT (pending Miguel's decision; a switch). */
  commissionVatIncluded: boolean
  /** Margin over a line's estimate when its price is the household's or this shop's. */
  marginKnownPct: number
  /** Margin when the price is the national reference. */
  marginReferencePct: number
  /** Extra points for wild fish (auction price). */
  marginWildFishExtraPct: number
  /** Version of the Red's conditions an order was made under. */
  termsVersion: string
}

/** Starting values (design §2–§3). The live ones are in `red_settings`. */
export const DEFAULT_RED_SETTINGS: RedSettings = {
  discountPct: 5,
  commissionPct: 5,
  commissionVatIncluded: true,
  marginKnownPct: 15,
  marginReferencePct: 30,
  marginWildFishExtraPct: 10,
  termsVersion: 'v2-prueba',
}

/** What a Red order adds to ShopOrder. Amounts in €, rounded to the cent. */
export interface RedOrderView {
  redShopId: string
  /** The terms frozen on the order (settings when it was drafted; checked again at «Pedir»). */
  terms: RedSettings
  /** Products estimate at the shop's prices. */
  estimateShopEur: number | null
  /** The same with the discount: what the household sees. */
  estimateEur: number | null
  /** Delivery fee when the order goes home (outside the discount); null on pickup. */
  feeEur: number | null
  /** Products ceiling at the shop's prices: Σ estimate × (1 + margin) per line; null if a line has no estimate. */
  ceilingShopEur: number | null
  /** «Como mucho»: what will be held on the card (discount applied, fee included, rounded up to the euro). */
  maxEur: number | null
  /** The household raised it above the computed one. */
  maxRaised: boolean
  /** What the shop may reach at its prices under that max: (max − fee) / (1 − discount). */
  shopCeilingEur: number | null
  /** The shop delivers to the household's postal code. */
  delivers: boolean
  /** It is the household's own shop, which joined the Red. */
  ownShopJoined: boolean
}

/** Spanish postal code: 5 digits, province 01–52. */
export function isPostalCode(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{5}$/.test(v)) return false
  const province = Number(v.slice(0, 2))
  return province >= 1 && province <= 52
}

/** Body of PUT /red/postal-code. */
export const postalCodeSchema = z.object({
  postalCode: z.string().trim().refine(isPostalCode, 'Código postal no válido'),
})

/** Body of POST /red/choice: the once-asked «¿la fruta, a la Red o al súper?», or picking another Red shop. */
export const redChoiceSchema = z
  .object({
    kind: z.enum(RED_KINDS),
    choice: z.enum(['red', 'super']),
    redShopId: z.string().uuid().optional(),
  })
  .refine((v) => v.choice === 'super' || !!v.redShopId, { message: 'Falta la tienda', path: ['redShopId'] })

/** Body of POST /shop-orders/:id/order («Pedir»): the max the household saw and accepted. */
export const placeRedOrderSchema = z.object({ maxEur: z.number().positive().max(5000) })

/**
 * «Como mucho» as the card's field has it ("20", "24,5 €", "") → the PATCH body.
 * Empty or not a positive amount = back to the computed max (null).
 * Contract-tested against patchShopOrderSchema.
 */
export function redMaxBody(raw: string): { maxEur: number | null } {
  const n = Number(raw.replace(/€/g, '').replace(',', '.').trim())
  return { maxEur: raw.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null }
}

export interface RedShopRef {
  id: string
  name: string
}

/** After «Preparar», what the Red tells the household. */
export interface RedPrepareInfo {
  enabled: boolean
  discountPct: number
  /** A fresh kind has no shop and the household hasn't given its postal code. */
  needsPostalCode: boolean
  /** Household with a súper and no shop of that kind: asked once. */
  questions: Array<{ kind: RedKind; redShop: RedShopRef; superName: string }>
  /** Assigned on its own («Tu frutería: Frutería del barrio»), with the others for «¿Prefieres otra?». */
  assigned: Array<{ kind: RedKind; shopId: string; name: string; alternatives: RedShopRef[] }>
  /** Not assigned on its own for halal or allergies (fase 1); the household may pick one. */
  heldBack: Array<{ kind: RedKind; reason: 'halal' | 'alergias'; candidates: RedShopRef[] }>
  /** Fresh kinds with no shop and no Red shop for this postal code. */
  uncovered: RedKind[]
}

/** GET /red/status. */
export interface RedStatus {
  enabled: boolean
  postalCode: string | null
}
