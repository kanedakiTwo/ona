import { z } from 'zod'
import { SHOP_CHANNELS, type ShopChannel, type ShopKind } from './shopOrders.js'

/**
 * «Tiendas de Mimoia» (PRO-358, D-123): the Red of neighbourhood shops
 * Mimoia recommends to a household that lacks one of its kind. Miguel keeps
 * them in /admin; a household sees, at /compra/tiendas, the ones that cover
 * its postal code, ordered by its ficha (presupuesto, preferencias,
 * cercanía) and never by payment (constitución §7). See specs/shop-orders.md
 * → «Tiendas de Mimoia».
 */

export const NETWORK_SHOP_KINDS = ['fruteria', 'carniceria', 'pescaderia', 'otra'] as const satisfies readonly ShopKind[]
export type NetworkShopKind = (typeof NETWORK_SHOP_KINDS)[number]

/** Price band: €, €€, €€€. */
export const NETWORK_SHOP_TIERS = ['bajo', 'medio', 'alto'] as const
export type NetworkShopTier = (typeof NETWORK_SHOP_TIERS)[number]

export const NETWORK_SHOP_TIER_LABELS: Record<NetworkShopTier, string> = { bajo: '€', medio: '€€', alto: '€€€' }

/** How the shop hands the order over. A shop may do several. */
export const NETWORK_FULFILMENTS = ['recogida', 'reparto', 'envio'] as const
export type NetworkFulfilment = (typeof NETWORK_FULFILMENTS)[number]

export const NETWORK_FULFILMENT_LABELS: Record<NetworkFulfilment, string> = {
  recogida: 'Recogida en tienda',
  reparto: 'Reparto a domicilio',
  envio: 'Envío por paquetería',
}

/** `activa` · `sin_nuevos` («no acepta hogares nuevos»: the households it has keep it) · `baja`. */
export const NETWORK_SHOP_STATUSES = ['activa', 'sin_nuevos', 'baja'] as const
export type NetworkShopStatus = (typeof NETWORK_SHOP_STATUSES)[number]

export const NETWORK_SHOP_STATUS_LABELS: Record<NetworkShopStatus, string> = {
  activa: 'Activa',
  sin_nuevos: 'No acepta hogares nuevos',
  baja: 'De baja',
}

/** Where a household shop comes from: added by the household, or chosen from the Red (it counts). */
export const HOUSEHOLD_SHOP_ORIGINS = ['propia', 'red'] as const
export type HouseholdShopOrigin = (typeof HOUSEHOLD_SHOP_ORIGINS)[number]

/** The notice next to the section. The final text comes from Legal (LEG-39). */
export const SHOP_NETWORK_NOTICE =
  'Las elegimos por su producto y su trato. Pagan a Mimoia por cada hogar que les pide desde aquí; ninguna paga por salir antes.'

// ─── Postal code ────────────────────────────────────────────────

/** A Spanish postal code: 5 digits, province 01–52. */
export const POSTAL_CODE_RE = /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/

export const postalCodeSchema = z.string().trim().regex(POSTAL_CODE_RE, 'Escribe un código postal de 5 cifras')

export function isPostalCode(v: unknown): v is string {
  return typeof v === 'string' && POSTAL_CODE_RE.test(v)
}

/** The value of the household's `postal_code` fact in the ficha (D-064, D-065). */
export const postalCodeFactValueSchema = z.object({ code: postalCodeSchema }).strict()

export const POSTAL_CODE_PATH = '/household/postal-code'

/** `PUT /household/postal-code`. */
export const setPostalCodeSchema = z.object({ postalCode: postalCodeSchema }).strict()

// ─── Coverage ───────────────────────────────────────────────────

/**
 * A covered area: a municipality (or any label) with its postal codes, or
 * bare codes. A code is a full postal code (5 digits) or a prefix of 2–4
 * digits («28» = the province, «286» = its zone). Mimoia has no
 * postal-code → municipality table, so a municipality goes with its codes.
 */
export interface NetworkCoverageArea {
  label: string | null
  postalCodes: string[]
}

export interface NetworkCoverage {
  /** «Toda España»: ships by parcel anywhere. */
  nationwide: boolean
  areas: NetworkCoverageArea[]
}

const CODE_OR_PREFIX_RE = /^\d{2,5}$/

export const networkCoverageSchema = z.object({
  nationwide: z.boolean(),
  areas: z.array(z.object({
    label: z.string().trim().min(1).max(80).nullable(),
    postalCodes: z.array(z.string().regex(CODE_OR_PREFIX_RE)).min(1).max(200),
  }).strict()).max(100),
}).strict().refine((c) => c.nationwide || c.areas.length > 0, { message: 'Falta la cobertura: códigos postales, municipios o toda España' })

/**
 * Pure: the admin's coverage text → areas. One area per line: «28660»,
 * «28660, 28669», «286» (prefix) or «Boadilla del Monte: 28660, 28669».
 * `errors` lists the lines it couldn't read.
 */
export function parseCoverageText(text: string): { areas: NetworkCoverageArea[]; errors: string[] } {
  const areas: NetworkCoverageArea[] = []
  const errors: string[] = []
  for (const raw of text.split(/\n/)) {
    const line = raw.trim()
    if (!line) continue
    const colon = line.indexOf(':')
    const label = colon >= 0 ? line.slice(0, colon).trim() || null : null
    const rest = colon >= 0 ? line.slice(colon + 1) : line
    const codes = rest.split(/[,;\s]+/).map((c) => c.trim()).filter(Boolean)
    if (!codes.length || codes.some((c) => !CODE_OR_PREFIX_RE.test(c))) {
      errors.push(line)
      continue
    }
    areas.push({ label, postalCodes: [...new Set(codes)] })
  }
  return { areas, errors }
}

/** Pure: areas → the admin's text (inverse of `parseCoverageText`). */
export function coverageText(areas: NetworkCoverageArea[]): string {
  return areas.map((a) => (a.label ? `${a.label}: ${a.postalCodes.join(', ')}` : a.postalCodes.join(', '))).join('\n')
}

/**
 * Pure: how close a shop's coverage is to a postal code, or null when it
 * doesn't cover it. 0 = that exact code, 1–3 = a prefix (the longer, the
 * closer), 9 = only because it ships to all Spain. Without a postal code,
 * only nationwide shops cover.
 */
export function coverageCloseness(coverage: NetworkCoverage, postalCode: string | null): number | null {
  let best: number | null = null
  if (postalCode) {
    for (const area of coverage.areas) {
      for (const code of area.postalCodes) {
        if (!postalCode.startsWith(code)) continue
        const d = 5 - code.length
        if (best === null || d < best) best = d
      }
    }
  }
  if (best === null && coverage.nationwide) return 9
  return best
}

/** Pure: a short description of the coverage («Boadilla del Monte, 28223» · «Toda España»). */
export function coverageSummary(coverage: NetworkCoverage): string {
  const parts = coverage.areas.map((a) => a.label ?? a.postalCodes.join(', '))
  if (coverage.nationwide) parts.push('Toda España')
  return parts.join(' · ')
}

// ─── Ordering: presupuesto, preferencias, cercanía ──────────────

/**
 * What the ficha says that orders the Red, in this order of priority:
 * - `tier`: the household's price band, from its weekly budget per adult;
 * - `fulfilment`: how it likes to get its shopping (from how it gets it from its own shops);
 * - cercanía: how close the coverage is to its postal code.
 * Nothing else: no field of a shop says what it pays (constitución §7).
 */
export interface NetworkRankContext {
  postalCode: string | null
  tier: NetworkShopTier | null
  fulfilment: NetworkFulfilment | null
}

/**
 * Pure: the price band of a weekly budget per adult. Thresholds are an
 * estimate (a week of fresh food for one adult: under 30 € tight, 30–55 €
 * middle, more is roomy); null without a budget.
 */
export function tierForBudget(weeklyBudgetEur: number | null | undefined, adults: number | null | undefined): NetworkShopTier | null {
  if (weeklyBudgetEur == null || !(weeklyBudgetEur > 0)) return null
  const perAdult = weeklyBudgetEur / Math.max(1, adults ?? 1)
  if (perAdult < 30) return 'bajo'
  if (perAdult < 55) return 'medio'
  return 'alto'
}

/**
 * Pure: how the household likes to get its shopping, from its own shops:
 * any shop that brings it home → `reparto`; shops but all to pick up →
 * `recogida`; no shops → null (no preference).
 */
export function preferredFulfilment(ownShops: Array<{ fulfilment: string }>): NetworkFulfilment | null {
  if (!ownShops.length) return null
  return ownShops.some((s) => s.fulfilment === 'domicilio') ? 'reparto' : 'recogida'
}

export interface RankableNetworkShop {
  name: string
  kind: NetworkShopKind
  tier: NetworkShopTier
  coverage: NetworkCoverage
  fulfilment: NetworkFulfilment[]
}

function fulfilmentMiss(shop: RankableNetworkShop, wanted: NetworkFulfilment | null): number {
  if (!wanted) return 0
  if (shop.fulfilment.includes(wanted)) return 0
  // Home delivery wanted: parcel delivery also brings it home.
  if (wanted === 'reparto' && shop.fulfilment.includes('envio')) return 0
  return 1
}

/**
 * Pure: the shops that cover the household, in the order the ficha says —
 * price band nearest to its own first, then the way it likes to get its
 * shopping, then the closest coverage, then by name. Ties never depend on
 * when a shop joined or on anything it pays.
 */
export function rankNetworkShops<T extends RankableNetworkShop>(shops: T[], ctx: NetworkRankContext): Array<T & { closeness: number }> {
  const tierIdx = (t: NetworkShopTier) => NETWORK_SHOP_TIERS.indexOf(t)
  return shops
    .flatMap((s) => {
      const closeness = coverageCloseness(s.coverage, ctx.postalCode)
      return closeness === null ? [] : [{ ...s, closeness }]
    })
    .map((s) => ({
      s,
      key: [
        ctx.tier ? Math.abs(tierIdx(s.tier) - tierIdx(ctx.tier)) : 0,
        fulfilmentMiss(s, ctx.fulfilment),
        s.closeness,
      ],
    }))
    .sort((a, b) => {
      for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i]
      return a.s.name.localeCompare(b.s.name, 'es')
    })
    .map((x) => x.s)
}

// ─── Shapes ─────────────────────────────────────────────────────

/** A shop of the Red as the admin sees it. */
export interface NetworkShop {
  id: string
  name: string
  kind: NetworkShopKind
  tier: NetworkShopTier
  coverage: NetworkCoverage
  channel: ShopChannel
  whatsapp: string | null
  email: string | null
  webUrl: string | null
  phone: string | null
  fulfilment: NetworkFulfilment[]
  deliveryMinEur: number | null
  deliveryFeeEur: number | null
  freeDeliveryFromEur: number | null
  notes: string | null
  status: NetworkShopStatus
  createdAt: string
  updatedAt: string
}

/** Admin row: plus how many households chose it from the Red (the ones that count). */
export interface AdminNetworkShop extends NetworkShop {
  households: number
}

/** What a household sees of a shop of the Red. */
export type HouseholdNetworkShop = Omit<NetworkShop, 'status' | 'createdAt' | 'updatedAt'>

/** `GET /shop-network`. */
export interface HouseholdNetworkView {
  /** The household's postal code from the ficha; null = ask «¿En qué código postal vivís?». */
  postalCode: string | null
  /** A `child` member reads only. */
  canEdit: boolean
  /** The shops covering the household that it doesn't have yet, already in order. */
  shops: HouseholdNetworkShop[]
}

/** `POST /shop-network/:id/adopt` — the answer to «¿Ya le comprabas?». */
export const adoptNetworkShopSchema = z.object({ alreadyCustomer: z.boolean() }).strict()

const phoneSchema = z.string().regex(/^\d{9,15}$/, 'Teléfono no válido')
const eur = z.number().nonnegative().max(1000).nullable().optional()

/** Admin form ↔ `POST/PATCH /admin/shop-network`. */
export const networkShopInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(NETWORK_SHOP_KINDS),
    tier: z.enum(NETWORK_SHOP_TIERS),
    coverage: networkCoverageSchema,
    channel: z.enum(SHOP_CHANNELS),
    whatsapp: phoneSchema.nullable().optional(),
    email: z.string().trim().email().max(120).nullable().optional(),
    webUrl: z.string().trim().url().max(300).nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    fulfilment: z.array(z.enum(NETWORK_FULFILMENTS)).min(1, 'Elige recogida, reparto o envío'),
    deliveryMinEur: eur,
    deliveryFeeEur: eur,
    freeDeliveryFromEur: eur,
    notes: z.string().trim().max(300).nullable().optional(),
    status: z.enum(NETWORK_SHOP_STATUSES).default('activa'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.channel === 'whatsapp' && !v.whatsapp) ctx.addIssue({ code: 'custom', path: ['whatsapp'], message: 'Falta el WhatsApp de la tienda' })
    if (v.channel === 'email' && !v.email) ctx.addIssue({ code: 'custom', path: ['email'], message: 'Falta el email de la tienda' })
    if (v.channel === 'web' && !v.webUrl) ctx.addIssue({ code: 'custom', path: ['webUrl'], message: 'Falta la web de la tienda' })
    if (v.channel === 'telefono' && !v.phone) ctx.addIssue({ code: 'custom', path: ['phone'], message: 'Falta el teléfono de la tienda' })
  })

export type NetworkShopInput = z.infer<typeof networkShopInputSchema>

/** `PATCH /admin/shop-network/:id { status }` alone: «no acepta hogares nuevos», baja or back to activa. */
export const networkShopStatusSchema = z.object({ status: z.enum(NETWORK_SHOP_STATUSES) }).strict()

// ─── Admin form ─────────────────────────────────────────────────

export interface NetworkShopFormState {
  name: string
  kind: NetworkShopKind
  tier: NetworkShopTier
  /** One area per line («Boadilla del Monte: 28660, 28669», «28223», «286»). */
  coverageText: string
  nationwide: boolean
  channel: ShopChannel
  whatsapp: string
  email: string
  webUrl: string
  phone: string
  fulfilment: NetworkFulfilment[]
  /** Euros as typed ("20", "4,95"); empty = none. */
  deliveryMin: string
  deliveryFee: string
  freeDeliveryFrom: string
  notes: string
  status: NetworkShopStatus
}

export const EMPTY_NETWORK_SHOP_FORM: NetworkShopFormState = {
  name: '',
  kind: 'carniceria',
  tier: 'medio',
  coverageText: '',
  nationwide: false,
  channel: 'whatsapp',
  whatsapp: '',
  email: '',
  webUrl: '',
  phone: '',
  fulfilment: ['recogida'],
  deliveryMin: '',
  deliveryFee: '',
  freeDeliveryFrom: '',
  notes: '',
  status: 'activa',
}

function blankToNull(s: string): string | null {
  const t = s.trim()
  return t ? t : null
}

function euros(raw: string): number | null {
  const t = raw.replace(/€/g, '').replace(',', '.').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

function phoneDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '').replace(/^00/, '')
  if (!digits) return null
  return digits.length === 9 && /^[6789]/.test(digits) ? `34${digits}` : digits
}

/** The exact body the admin form POSTs/PATCHes — contract-tested against `networkShopInputSchema`. */
export function buildNetworkShopPayload(form: NetworkShopFormState): NetworkShopInput {
  const web = form.webUrl.trim()
  return {
    name: form.name.trim(),
    kind: form.kind,
    tier: form.tier,
    coverage: { nationwide: form.nationwide, areas: parseCoverageText(form.coverageText).areas },
    channel: form.channel,
    whatsapp: phoneDigits(form.whatsapp),
    email: blankToNull(form.email),
    webUrl: web ? (/^https?:\/\//i.test(web) ? web : `https://${web}`) : null,
    phone: phoneDigits(form.phone),
    fulfilment: form.fulfilment,
    deliveryMinEur: euros(form.deliveryMin),
    deliveryFeeEur: euros(form.deliveryFee),
    freeDeliveryFromEur: euros(form.freeDeliveryFrom),
    notes: blankToNull(form.notes),
    status: form.status,
  }
}

/** Pure: a shop → the admin form, to edit it. */
export function networkShopForm(s: NetworkShop): NetworkShopFormState {
  const n = (v: number | null) => (v == null ? '' : String(v).replace('.', ','))
  return {
    name: s.name,
    kind: s.kind,
    tier: s.tier,
    coverageText: coverageText(s.coverage.areas),
    nationwide: s.coverage.nationwide,
    channel: s.channel,
    whatsapp: s.whatsapp ?? '',
    email: s.email ?? '',
    webUrl: s.webUrl ?? '',
    phone: s.phone ?? '',
    fulfilment: s.fulfilment,
    deliveryMin: n(s.deliveryMinEur),
    deliveryFee: n(s.deliveryFeeEur),
    freeDeliveryFrom: n(s.freeDeliveryFromEur),
    notes: s.notes ?? '',
    status: s.status,
  }
}
