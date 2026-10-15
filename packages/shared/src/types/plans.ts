/**
 * Mimoia's plans (specs/billing.md). One source of truth for the pricing
 * page (`/precios`), the subscription page (`/suscripcion`), the founder
 * reservation on the waitlist and the Stripe checkout on the API.
 *
 * Decisions (ona-hq decision_log): D-021 set the prices; on 2026-10-15
 * Miguel made **Esencial the featured plan**, gave both plans a monthly /
 * yearly choice (Esencial anual 49,99 €), and set the closed beta to run
 * with everything (Plus) until launch day. Prices include VAT and are per
 * household. No struck-through prices, no fake quotas (constitution §8.3).
 */
import { z } from 'zod'

export const PLAN_KEYS = ['esencial', 'plus'] as const
export type PlanKey = (typeof PLAN_KEYS)[number]

export const BILLING_PERIODS = ['mensual', 'anual'] as const
export type BillingPeriod = (typeof BILLING_PERIODS)[number]

/** Launch day: the beta ends, and a subscription paid during the beta is first charged. Europe/Madrid. */
export const LAUNCH_DATE = '2027-01-12'
export const LAUNCH_DATE_LABEL = '12 de enero'

export interface PlanPrice {
  /** Amount charged, VAT included, in euro cents. */
  cents: number
  /** «4,99 €/mes», «49,99 €/año». */
  label: string
  /** Yearly only: what it comes to per month («4,17 €/mes»). */
  perMonth?: string
}

export interface Plan {
  key: PlanKey
  name: string
  /** The plan we recommend and show first. */
  featured: boolean
  /** One line under the name. */
  tagline: string
  prices: Record<BillingPeriod, PlanPrice>
  /** The 3–4 lines on the plan card. */
  highlights: string[]
}

export const PLANS: readonly Plan[] = [
  {
    key: 'esencial',
    name: 'Esencial',
    featured: true,
    tagline: 'Todo lo que necesita tu hogar para comer bien cada semana.',
    prices: {
      mensual: { cents: 499, label: '4,99 €/mes' },
      anual: { cents: 4999, label: '49,99 €/año', perMonth: '4,17 €/mes' },
    },
    highlights: [
      'Menú de la semana y lista de la compra',
      'Pedidos a tus tiendas de barrio',
      'Mimo por chat, en la app y por WhatsApp',
      'Importar recetas de fotos, webs y vídeos',
    ],
  },
  {
    key: 'plus',
    name: 'Plus',
    featured: false,
    tagline: 'Para quien quiere cocinar hablando y que Mimo se adelante.',
    prices: {
      mensual: { cents: 899, label: '8,99 €/mes' },
      anual: { cents: 5999, label: '59,99 €/año', perMonth: '5 €/mes' },
    },
    highlights: [
      'Todo lo de Esencial',
      'Habla con Mimo por voz, con las manos ocupadas',
      'Mimo te escribe por WhatsApp: el menú de hoy, qué descongelar',
      'Más uso de Mimo cada mes',
    ],
  },
]

export const PLAN_HOUSEHOLD = 'para todo tu hogar'
/** Shared fine print about usage caps (figures land with PRO-15, 2026-11-24). */
export const PLAN_CAPS_NOTE =
  'Mimo, la voz y las importaciones de recetas tienen un tope de uso al mes; en Plus es más alto.'

export type FeatureValue = boolean | string

export interface PlanFeature {
  label: string
  /** Optional one-line explanation under the label. */
  detail?: string
  esencial: FeatureValue
  plus: FeatureValue
}

export interface PlanFeatureGroup {
  title: string
  features: PlanFeature[]
}

/** The comparison table on `/precios`: everything each plan includes. */
export const PLAN_FEATURE_GROUPS: readonly PlanFeatureGroup[] = [
  {
    title: 'Planificar',
    features: [
      { label: 'Menú semanal a tu medida', detail: 'Según cuántos sois, vuestros gustos, alergias y el tiempo que tenéis.', esencial: true, plus: true },
      { label: 'Cambiar, fijar y mover platos', esencial: true, plus: true },
      { label: 'Catálogo de recetas de Mimoia', esencial: true, plus: true },
      { label: 'Tus recetas y tus libros de recetas', esencial: true, plus: true },
      { label: 'Importar recetas', detail: 'De una foto, una web, YouTube, Instagram o TikTok.', esencial: 'Con tope mensual', plus: 'Tope más alto' },
    ],
  },
  {
    title: 'Comprar',
    features: [
      { label: 'Lista de la compra automática', detail: 'Sale del menú, ordenada y descontando lo que ya tienes.', esencial: true, plus: true },
      { label: 'Despensa', esencial: true, plus: true },
      { label: 'Pedidos a tus tiendas de barrio', detail: 'Mimo escribe el pedido para tu frutería, carnicería o súper.', esencial: true, plus: true },
    ],
  },
  {
    title: 'Cocinar',
    features: [
      { label: 'Modo cocina paso a paso', esencial: true, plus: true },
      { label: 'Recordatorios en el móvil', detail: 'Notificaciones de la app: qué toca hoy y qué sacar del congelador.', esencial: true, plus: true },
    ],
  },
  {
    title: 'Mimo, tu asistente',
    features: [
      { label: 'Chat con Mimo en la app', esencial: 'Con tope mensual', plus: 'Tope más alto' },
      { label: 'Chat con Mimo por WhatsApp', esencial: 'Con tope mensual', plus: 'Tope más alto' },
      { label: 'Hablar con Mimo por voz', detail: 'Le hablas y te contesta en voz alta.', esencial: false, plus: true },
      { label: 'Mimo te escribe por WhatsApp', detail: 'El menú de hoy, qué descongelar, la lista antes de comprar.', esencial: false, plus: true },
    ],
  },
  {
    title: 'Tu hogar',
    features: [
      { label: 'Para todo el hogar', detail: 'Un solo pago; cada uno con su cuenta, hasta 6 personas.', esencial: true, plus: true },
    ],
  },
]

export function planByKey(key: PlanKey): Plan {
  return PLANS.find((p) => p.key === key)!
}

/** «Esencial · 4,99 €/mes». */
export function planLabel(key: PlanKey, period: BillingPeriod): string {
  const p = planByKey(key)
  return `${p.name} · ${p.prices[period].label}`
}

/** Stripe price lookup key for a plan and period: `esencial_mensual`. Created by `scripts/stripeSetup.ts`. */
export function stripeLookupKey(key: PlanKey, period: BillingPeriod): string {
  return `${key}_${period}`
}

export const checkoutRequestSchema = z.object({
  plan: z.enum(PLAN_KEYS),
  period: z.enum(BILLING_PERIODS),
})
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>

/** Stripe subscription statuses we store as they come. */
export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused'

/** What `GET /billing` answers (specs/billing.md). */
export interface BillingState {
  /** Payments are switched on (the API has Stripe keys). */
  enabled: boolean
  /** Until launch day the whole beta runs with Plus, free. */
  beta: boolean
  launchDate: string
  /** Only the household owner can subscribe or manage the subscription. */
  canManage: boolean
  subscription: {
    plan: PlanKey
    period: BillingPeriod
    status: SubscriptionStatus
    /** ISO date of the next (or first) charge, when there is one. */
    nextChargeAt: string | null
    /** Cancelled: it stays until this date and then ends. */
    cancelAtPeriodEnd: boolean
    endsAt: string | null
  } | null
}

/**
 * «Hogar fundador» (2026-10-15): every household created before launch day,
 * i.e. the beta. Promised on the waitlist and shown on the profile and on
 * Casa, for good. Launch day starts at 00:00 Madrid (CET, UTC+1 in January).
 */
export const FOUNDING_HOUSEHOLD_LABEL = 'Hogar fundador'

export function isFoundingHousehold(createdAt: Date | string, launchDate: string = LAUNCH_DATE): boolean {
  const t = typeof createdAt === 'string' ? Date.parse(createdAt) : createdAt.getTime()
  return Number.isFinite(t) && t < Date.parse(`${launchDate}T00:00:00+01:00`)
}
