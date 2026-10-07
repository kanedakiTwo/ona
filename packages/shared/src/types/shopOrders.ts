import { z } from 'zod'
import type { BuyableUnit } from './shopping.js'

/**
 * "Compra en mis tiendas" — the household's own shops (frutería,
 * carnicería, pescadería, súper) and the per-shop orders ONA drafts from
 * the shopping list. See specs/shop-orders.md.
 */

export const SHOP_KINDS = ['fruteria', 'carniceria', 'pescaderia', 'supermercado', 'otra'] as const
export type ShopKind = (typeof SHOP_KINDS)[number]

export const SHOP_KIND_LABELS: Record<ShopKind, string> = {
  fruteria: 'Frutería',
  carniceria: 'Carnicería',
  pescaderia: 'Pescadería',
  supermercado: 'Supermercado',
  otra: 'Otra tienda',
}

/** How the order reaches the shop. ONA never sends it itself in v1: it hands
 * the user a ready-to-send message (wa.me / mailto) or a checklist (web/phone). */
export const SHOP_CHANNELS = ['whatsapp', 'email', 'web', 'telefono'] as const
export type ShopChannel = (typeof SHOP_CHANNELS)[number]

export const SHOP_CHANNEL_LABELS: Record<ShopChannel, string> = {
  whatsapp: 'WhatsApp',
  email: 'Email',
  web: 'Web',
  telefono: 'Teléfono',
}

export const SHOP_FULFILMENTS = ['recoger', 'domicilio'] as const
export type ShopFulfilment = (typeof SHOP_FULFILMENTS)[number]

export const SHOP_ORDER_STATUSES = ['draft', 'sent', 'quoted', 'approved', 'closed', 'cancelled'] as const
export type ShopOrderStatus = (typeof SHOP_ORDER_STATUSES)[number]

export const SHOP_ORDER_STATUS_LABELS: Record<ShopOrderStatus, string> = {
  draft: 'Borrador',
  sent: 'Enviado',
  quoted: 'Ha contestado',
  approved: 'Confirmado',
  closed: 'Cerrado',
  cancelled: 'Cancelado',
}

/** Where a line's € estimate comes from. Only `manual` and `historial` are
 * precise enough to flag a quote as out of band; `referencia` (national
 * averages) only feeds the basket cap. */
export type EstimateSource = 'manual' | 'historial' | 'referencia'

export type LineQuoteStatus = 'ok' | 'no_hay' | 'sustituto' | 'parcial'

/** What the shop said about one line (parsed from its free-text reply). */
export interface LineQuote {
  status: LineQuoteStatus
  quantityText: string | null
  pricePerKg: number | null
  lineTotal: number | null
  substitute: string | null
  comment: string | null
}

export type LineVerdict = 'ok' | 'revisar' | 'no_hay'
export type LineDecision = 'keep' | 'remove'

export interface ShopOrderLine {
  /** Stable key inside the order (`l1`, `l2`…) — what quotes and decisions reference. */
  key: string
  /** Shopping-list item id this line came from (`menu:<ingredientId>:<unit>`, `manual:…`). */
  sourceItemId: string | null
  ingredientId: string | null
  name: string
  quantity: number
  unit: BuyableUnit
  /** Cut / preparation / variant the shop needs ("picada", "limpio, sin cabeza"). */
  note: string | null
  estimateEur: number | null
  estimateSource: EstimateSource | null
  /** Wild fish priced by the daily auction: always goes to the user for approval. */
  volatile: boolean
  quote: LineQuote | null
  verdict: LineVerdict | null
  reasons: string[]
  decision: LineDecision | null
}

export interface QuoteSummary {
  totalEur: number | null
  pickupText: string | null
  paymentText: string | null
  notes: string | null
  overCap: boolean
  /** Lines the user must decide on (verdict `revisar`) or the basket is over the cap. */
  needsDecision: boolean
}

export interface ShopSnapshot {
  name: string
  kind: ShopKind
  channel: ShopChannel
  whatsapp: string | null
  email: string | null
  webUrl: string | null
  phone: string | null
}

export interface ShopOrderLinks {
  /** Ready-to-send order (wa.me / mailto) or the shop's web/phone. */
  order: string | null
  /** Ready-to-send confirmation after the user approved the quote. */
  confirmation: string | null
  /** Short ONA link that redirects to `order` (for WhatsApp replies). */
  shortOrder: string | null
  shortConfirmation: string | null
  /** True when the order text is too long to prefill safely — copy it instead. */
  tooLong: boolean
}

export interface ShopOrder {
  id: string
  shopId: string | null
  shop: ShopSnapshot
  status: ShopOrderStatus
  lines: ShopOrderLine[]
  estimateEur: number | null
  capEur: number | null
  messageText: string
  shopReplyText: string | null
  quoteSummary: QuoteSummary | null
  confirmationText: string | null
  finalTotalEur: number | null
  links: ShopOrderLinks
  /** Per-line product search on the shop's web (El Corte Inglés today). */
  searchLinks: Record<string, string>
  createdAt: string
  sentAt: string | null
  quotedAt: string | null
  approvedAt: string | null
  closedAt: string | null
}

export interface Shop {
  id: string
  householdId: string
  name: string
  kind: ShopKind
  channel: ShopChannel
  whatsapp: string | null
  email: string | null
  webUrl: string | null
  phone: string | null
  customerName: string | null
  fulfilment: ShopFulfilment
  address: string | null
  notes: string | null
  position: number
  createdAt: string
}

// ─── Shop form ↔ API contract ──────────────────────────────────

/** Digits only, Spanish numbers without prefix get +34. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '').replace(/^00/, '')
  if (!digits) return null
  if (digits.length === 9 && /^[6789]/.test(digits)) return `34${digits}`
  return digits
}

const phoneSchema = z.string().regex(/^\d{9,15}$/, 'Teléfono no válido')

export const shopInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(SHOP_KINDS),
    channel: z.enum(SHOP_CHANNELS),
    whatsapp: phoneSchema.nullable().optional(),
    email: z.string().trim().email().max(120).nullable().optional(),
    webUrl: z.string().trim().url().max(300).nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    customerName: z.string().trim().max(80).nullable().optional(),
    fulfilment: z.enum(SHOP_FULFILMENTS).default('recoger'),
    address: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(300).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.channel === 'whatsapp' && !v.whatsapp) ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Falta el WhatsApp de la tienda' })
    if (v.channel === 'email' && !v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Falta el email de la tienda' })
    if (v.channel === 'web' && !v.webUrl) ctx.addIssue({ code: 'custom', path: ['webUrl'], message: 'Falta la web de la tienda' })
    if (v.channel === 'telefono' && !v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Falta el teléfono de la tienda' })
    if (v.fulfilment === 'domicilio' && !v.address) ctx.addIssue({ code: 'custom', path: ['address'], message: 'Falta la dirección de entrega' })
  })

export type ShopInput = z.infer<typeof shopInputSchema>

export interface ShopFormState {
  name: string
  kind: ShopKind
  channel: ShopChannel
  whatsapp: string
  email: string
  webUrl: string
  phone: string
  customerName: string
  fulfilment: ShopFulfilment
  address: string
  notes: string
}

export const EMPTY_SHOP_FORM: ShopFormState = {
  name: '',
  kind: 'fruteria',
  channel: 'whatsapp',
  whatsapp: '',
  email: '',
  webUrl: '',
  phone: '',
  customerName: '',
  fulfilment: 'recoger',
  address: '',
  notes: '',
}

function blankToNull(s: string): string | null {
  const t = s.trim()
  return t ? t : null
}

function normalizeUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  return /^https?:\/\//i.test(t) ? t : `https://${t}`
}

/** The exact body the shop form POSTs/PATCHes — contract-tested against `shopInputSchema`. */
export function buildShopPayload(form: ShopFormState): ShopInput {
  return {
    name: form.name.trim(),
    kind: form.kind,
    channel: form.channel,
    whatsapp: normalizePhone(form.whatsapp),
    email: blankToNull(form.email),
    webUrl: normalizeUrl(form.webUrl),
    phone: normalizePhone(form.phone),
    customerName: blankToNull(form.customerName),
    fulfilment: form.fulfilment,
    address: blankToNull(form.address),
    notes: blankToNull(form.notes),
  }
}

/** Body of POST /shop-orders/:id/approve. */
export const approveShopOrderSchema = z.object({
  decisions: z.record(z.string().max(10), z.enum(['keep', 'remove'])).default({}),
  capEur: z.number().positive().max(5000).nullable().optional(),
})

/** Body of PATCH /shop-orders/:id (drafts only). */
export const patchShopOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        key: z.string().max(10),
        remove: z.boolean().optional(),
        note: z.string().trim().max(120).nullable().optional(),
        quantity: z.number().positive().max(100_000).optional(),
        moveToShopId: z.string().uuid().optional(),
      }),
    )
    .max(200)
    .optional(),
  capEur: z.number().positive().max(5000).nullable().optional(),
})
