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

/**
 * Launch day (D-057, 2026-10-15; was 2027-01-12): the beta ends and paying
 * starts. Europe/Madrid. Everyone gets `TRIAL_DAYS` with everything from
 * sign-up, and beta households from launch day (D-055), so a beta household
 * is first charged on `BETA_FIRST_CHARGE_DATE`. And never earlier than
 * `MIN_DAYS_CARD_TO_CHARGE` after leaving the card (D-056: room for the
 * legal notice 15 days before the first charge).
 */
export const LAUNCH_DATE = '2026-12-15'
export const LAUNCH_DATE_LABEL = '15 de diciembre'
export const TRIAL_DAYS = 14
export const BETA_FIRST_CHARGE_DATE = '2026-12-29'
export const BETA_FIRST_CHARGE_LABEL = '29 de diciembre'
export const MIN_DAYS_CARD_TO_CHARGE = 15

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

/**
 * The 14-day trial and the paused account (PRO-135, D-056/D-057). Only from
 * launch day: before it, everybody is in the beta (`beta`) and nobody is
 * paused. From launch day a household has `TRIAL_DAYS` with everything from
 * when it was created (beta households: from launch day); after that, without
 * a plan, it is **paused**: it still sees its menu, recipes and list, but it
 * can't generate new menus or use Mimo. Nothing is ever deleted.
 */
export type AccessState = 'beta' | 'trial' | 'paused' | 'subscribed'

export interface AccountAccess {
  state: AccessState
  /** When the household's trial ends (ISO): midnight in Madrid after its last day, whatever the state. */
  trialEndsAt: string
  /** Last day of the trial, `YYYY-MM-DD` in Madrid (included). */
  trialLastDay: string
  /**
   * While `trial`: whole days left after today (Madrid calendar), 0 on the
   * last day. Day 12 of 14 → 2. Otherwise null.
   */
  daysLeft: number | null
  /** While `trial`: days since its first day (Madrid calendar), 0 on the first day. Otherwise null. */
  trialDay: number | null
}

/** Day of the trial when the founder-price offer goes out (PRO-136, D-056). */
export const FOUNDER_OFFER_DAY = 7

/** «Te quedan 2 días»: the in-app notice and the email go from this many days before the last day (day 12). */
export const TRIAL_ENDING_NOTICE_DAYS = 2

/** Stripe statuses that give the plan (and so keep the account out of the pause). */
export const PAID_ACCESS_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active', 'past_due']

const ACCESS_DAY_MS = 24 * 60 * 60 * 1000

function launchStart(launchDate: string): number {
  return Date.parse(`${launchDate}T00:00:00+01:00`)
}

/** `YYYY-MM-DD` of an instant in Madrid. */
function madridIsoDate(t: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t))
}

/** 00:00 in Madrid of a `YYYY-MM-DD` (CET or CEST). */
function madridMidnight(day: string): number {
  const cet = Date.parse(`${day}T00:00:00+01:00`)
  // In summer time that instant is 01:00 in Madrid: midnight is an hour earlier.
  return madridIsoDate(cet - 60 * 60 * 1000) === day ? cet - 60 * 60 * 1000 : cet
}

function nextDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / ACCESS_DAY_MS)
}

/**
 * The household's trial: from max(created, launch day), 14 days, to the end
 * of that day in Madrid. A beta household: 15 → 28 December, both included.
 */
export function trialEndsAt(
  householdCreatedAt: Date | string | null,
  launchDate: string = LAUNCH_DATE,
): { endsAt: Date; lastDay: string; firstDay: string } {
  const created = householdCreatedAt == null ? NaN : typeof householdCreatedAt === 'string' ? Date.parse(householdCreatedAt) : householdCreatedAt.getTime()
  const start = Math.max(Number.isFinite(created) ? created : 0, launchStart(launchDate))
  // The last instant of the 14 days, then the end of that Madrid day.
  const lastDay = madridIsoDate(start + TRIAL_DAYS * ACCESS_DAY_MS - 1)
  return { endsAt: new Date(madridMidnight(nextDay(lastDay))), lastDay, firstDay: madridIsoDate(start) }
}

export function accountAccess(i: {
  householdCreatedAt: Date | string | null
  /** The household has a subscription in `PAID_ACCESS_STATUSES`. */
  paid: boolean
  now: Date
  launchDate?: string
}): AccountAccess {
  const launchDate = i.launchDate ?? LAUNCH_DATE
  const { endsAt, lastDay, firstDay } = trialEndsAt(i.householdCreatedAt, launchDate)
  const base = { trialEndsAt: endsAt.toISOString(), trialLastDay: lastDay, daysLeft: null, trialDay: null }
  const now = i.now.getTime()
  if (now < launchStart(launchDate)) return { state: 'beta', ...base }
  if (i.paid) return { state: 'subscribed', ...base }
  if (now < endsAt.getTime()) {
    const today = madridIsoDate(now)
    return { state: 'trial', ...base, daysLeft: daysBetween(today, lastDay), trialDay: daysBetween(firstDay, today) }
  }
  return { state: 'paused', ...base }
}

/** «el 28 de diciembre» → the last day of the trial, for copy. */
export function trialLastDayLabel(access: Pick<AccountAccess, 'trialLastDay'>): string {
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${access.trialLastDay}T12:00:00Z`))
}

/** «Te quedan 2 días» / «Te queda 1 día» / «Hoy es tu último día». */
export function trialDaysLeftLabel(daysLeft: number): string {
  if (daysLeft <= 0) return 'Hoy es el último día de tu prueba'
  return daysLeft === 1 ? 'Te queda 1 día de prueba' : `Te quedan ${daysLeft} días de prueba`
}

/** What a paused account is told when it tries to generate a menu or talk to Mimo (API 402 `ACCOUNT_PAUSED`). */
export const ACCOUNT_PAUSED_MESSAGE =
  'Tu prueba ha terminado y tu cuenta está en pausa. Elige un plan en Perfil → Suscripción para volver a generar menús y hablar con Mimo. No se ha borrado nada.'

/** What `GET /billing` answers (specs/billing.md). */
export interface BillingState {
  /** Payments are switched on (the API has Stripe keys). */
  enabled: boolean
  /** Until launch day the whole beta runs with Plus, free. */
  beta: boolean
  launchDate: string
  /** Only the household owner can subscribe or manage the subscription. */
  canManage: boolean
  /** If the owner subscribed now, the first charge would be on this day (ISO). */
  firstChargeAt: string
  /** Trial / paused / subscribed, from launch day (PRO-135). */
  access: AccountAccess
  /** Founder price (PRO-136, D-056/D-066). */
  founder: {
    /** «Hogar fundador» (a beta household): the founder price for good, whenever it subscribes. */
    household: boolean
    /** Subscribing now keeps the founder price (a founding household, or still in its trial). */
    priceIfSubscribing: boolean
    /** The day-7 offer stands: in trial from day 7, no plan. */
    offer: boolean
  }
  subscription: {
    plan: PlanKey
    period: BillingPeriod
    status: SubscriptionStatus
    /** ISO date of the next (or first) charge, when there is one. */
    nextChargeAt: string | null
    /** Cancelled: it stays until this date and then ends. */
    cancelAtPeriodEnd: boolean
    endsAt: string | null
    /** Founder price: it doesn't go up while the subscription lasts (PRO-136). */
    founderPrice?: boolean
    /** First charge within 15 days (the legal notice, PRO-136): when and how much. */
    upcomingCharge?: { at: string; amount: string } | null
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

/**
 * Does a subscription started now keep the founder price? (D-056, D-066):
 * a founding household always; from launch day, anyone who leaves the card
 * before their trial ends. A paused household subscribing doesn't.
 */
export function founderPriceIfSubscribing(householdCreatedAt: Date | string | null, now: Date, launchDate: string = LAUNCH_DATE): boolean {
  if (householdCreatedAt != null && isFoundingHousehold(householdCreatedAt, launchDate)) return true
  const s = accountAccess({ householdCreatedAt, paid: false, now, launchDate }).state
  return s === 'beta' || s === 'trial'
}

/** The day-7 offer stands (PRO-136): in trial, from day 7, no plan. */
export function founderOfferStands(access: AccountAccess): boolean {
  return access.state === 'trial' && access.trialDay !== null && access.trialDay >= FOUNDER_OFFER_DAY
}

/**
 * The day-7 offer, short (PRO-136, D-056): Mimo on WhatsApp and in the web
 * panel, and the offer card. Text for Legal to review.
 */
export function founderOfferText(i: { trialLastDay: string; firstChargeAt: string }): string {
  const last = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${i.trialLastDay}T12:00:00Z`))
  return (
    `Llevas una semana con Mimoia. Si ya sabes que te quedas, deja la tarjeta antes de que acabe tu prueba ` +
    `(dura hasta el ${last}) y te quedas el precio de fundador para siempre: no te sube mientras sigas suscrito. ` +
    `No se cobra nada hasta el ${dayEs(i.firstChargeAt, true)} y puedes cancelar antes sin pagar nada.`
  )
}

/** «4,99 €» from cents. */
export function euros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace('.', ',').replace(/,00$/, '')} €`
}

/** «29 de diciembre de 2026» (long) / «29 de diciembre» (short), in Madrid. */
function dayEs(iso: string, withYear: boolean): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'Europe/Madrid',
  }).format(new Date(iso))
}

export interface SubscriptionSummary {
  /** Short pill: «En prueba hasta el 29 de diciembre», «Cancelada». */
  badge: string
  tone: 'good' | 'muted' | 'warn'
  /** The sentence under the plan. */
  line: string
  /** Profile hub tile: «Esencial · en prueba». */
  hub: string
}

/**
 * How a subscription reads on Perfil → Suscripción and the profile hub
 * (2026-10-15: after cancelling, Miguel still saw only «Esencial · 4,99 €/mes»;
 * the trial, its end and the cancellation have to show at a glance).
 */
export function subscriptionSummary(sub: NonNullable<BillingState['subscription']>): SubscriptionSummary {
  const name = planByKey(sub.plan).name
  const until = sub.endsAt ?? sub.nextChargeAt
  if (sub.cancelAtPeriodEnd) {
    return sub.status === 'trialing'
      ? {
          badge: 'Cancelada',
          tone: 'muted',
          line: until
            ? `Has cancelado: no se te cobrará nada. Sigues con tu prueba hasta el ${dayEs(until, true)}.`
            : 'Has cancelado: no se te cobrará nada.',
          hub: `${name} · cancelada`,
        }
      : {
          badge: 'Cancelada',
          tone: 'muted',
          line: until ? `Has cancelado: sigues con ${name} hasta el ${dayEs(until, true)} y no se renueva.` : 'Has cancelado: no se renueva.',
          hub: `${name} · cancelada`,
        }
  }
  if (sub.status === 'trialing') {
    return {
      badge: sub.nextChargeAt ? `En prueba hasta el ${dayEs(sub.nextChargeAt, false)}` : 'En prueba',
      tone: 'good',
      line: sub.nextChargeAt
        ? `Lo has dejado pagado: no se cobra nada hasta el ${dayEs(sub.nextChargeAt, true)}. Puedes cancelar antes sin pagar nada.`
        : 'Lo has dejado pagado. Puedes cancelar antes del primer cobro sin pagar nada.',
      hub: `${name} · en prueba`,
    }
  }
  if (sub.status === 'past_due' || sub.status === 'unpaid') {
    return {
      badge: 'Pago pendiente',
      tone: 'warn',
      line: 'No hemos podido cobrar el último pago. Revisa tu tarjeta en «Gestionar mi suscripción».',
      hub: `${name} · pago pendiente`,
    }
  }
  return {
    badge: 'Activa',
    tone: 'good',
    line: sub.nextChargeAt ? `Próximo cobro: ${dayEs(sub.nextChargeAt, true)}.` : 'Activa.',
    hub: `${name} · ${planByKey(sub.plan).prices[sub.period].label}`,
  }
}
