/**
 * Subscriptions with Stripe Checkout + Managed Payments (specs/billing.md).
 *
 * Stripe (through Link) is the merchant of record: it charges VAT included,
 * issues the receipts and handles disputes and refunds. We keep one row per
 * Stripe subscription, written only by the webhook, and read it to answer
 * `GET /billing`. A plan belongs to a household; only its owner subscribes.
 *
 * During the beta (until LAUNCH_DATE) a subscription starts as a trial that
 * ends on launch day: the card is saved now and the first charge happens
 * then. Nothing about the plan is enforced yet: the beta runs with Plus for
 * everyone (TODO(billing): plan limits and the paused account from launch day).
 */
import Stripe from 'stripe'
import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  LAUNCH_DATE,
  PLAN_KEYS,
  BILLING_PERIODS,
  stripeLookupKey,
  type BillingPeriod,
  type BillingState,
  type PlanKey,
  type SubscriptionStatus,
} from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { subscriptions } from '../db/schema.js'

/** Statuses that still give (or will give) the plan: no new checkout while one of these exists. */
export const LIVE_STATUSES: readonly SubscriptionStatus[] = ['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused']

/** Stripe needs a trial end at least 48 h ahead; we keep a margin. */
const MIN_TRIAL_MS = 49 * 60 * 60 * 1000

/** Launch day at 00:00 in Madrid, as a Date. CET in January: UTC+1. */
export function launchInstant(launchDate: string = LAUNCH_DATE): Date {
  return new Date(`${launchDate}T00:00:00+01:00`)
}

export function isBeta(now: Date, launchDate: string = LAUNCH_DATE): boolean {
  return now.getTime() < launchInstant(launchDate).getTime()
}

export interface SubscriptionRow {
  householdId: string
  userId: string | null
  stripeCustomerId: string
  stripeSubscriptionId: string
  plan: PlanKey
  period: BillingPeriod
  status: SubscriptionStatus
  currentPeriodEnd: Date | null
  trialEnd: Date | null
  cancelAtPeriodEnd: boolean
  canceledAt: Date | null
}

export interface CheckoutInput {
  plan: PlanKey
  period: BillingPeriod
  priceId: string
  email: string
  userId: string
  householdId: string
  now: Date
  webUrl: string
  /** Reuse the household's Stripe customer when it had a subscription before. */
  customerId?: string | null
}

/**
 * The Checkout Session for a new subscription. Before launch day the
 * subscription trials until then (card now, first charge on launch day).
 * Parameters Managed Payments refuses (automatic_tax, tax id collection,
 * payment_method_types, custom_text…) are never sent: Stripe answers 400.
 */
export function buildCheckoutParams(i: CheckoutInput): Stripe.Checkout.SessionCreateParams {
  const meta = { userId: i.userId, householdId: i.householdId, plan: i.plan, period: i.period }
  const launch = launchInstant()
  const trialUntilLaunch = launch.getTime() - i.now.getTime() >= MIN_TRIAL_MS
  return {
    mode: 'subscription',
    managed_payments: { enabled: true },
    line_items: [{ price: i.priceId, quantity: 1 }],
    ...(i.customerId ? { customer: i.customerId } : { customer_email: i.email }),
    client_reference_id: i.userId,
    locale: 'es',
    metadata: meta,
    subscription_data: {
      metadata: meta,
      ...(trialUntilLaunch ? { trial_end: Math.floor(launch.getTime() / 1000) } : {}),
    },
    success_url: `${i.webUrl}/profile/suscripcion?estado=ok`,
    cancel_url: `${i.webUrl}/profile/suscripcion?estado=cancelado`,
  }
}

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «12 de enero de 2027», in Madrid. */
export function formatDayEs(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  const [y, m, day] = parts.split('-').map(Number)
  return `${day} de ${MONTHS_ES.at(m - 1)} de ${y}`
}

const toDate = (s: number | null | undefined): Date | null => (typeof s === 'number' ? new Date(s * 1000) : null)

function isPlan(v: unknown): v is PlanKey {
  return typeof v === 'string' && (PLAN_KEYS as readonly string[]).includes(v)
}
function isPeriod(v: unknown): v is BillingPeriod {
  return typeof v === 'string' && (BILLING_PERIODS as readonly string[]).includes(v)
}

/** `esencial_anual` → { plan, period }. */
export function parseLookupKey(key: string | null | undefined): { plan: PlanKey; period: BillingPeriod } | null {
  const [plan, period] = (key ?? '').split('_')
  return isPlan(plan) && isPeriod(period) ? { plan, period } : null
}

/**
 * A Stripe subscription → our row. Plan and period come from the price's
 * lookup key (the source of truth if the customer changes plan in the
 * portal), falling back to the metadata we set at checkout. Returns null when
 * the subscription isn't one of ours (no household in its metadata).
 */
export function rowFromStripeSubscription(sub: Stripe.Subscription): SubscriptionRow | null {
  const meta = sub.metadata ?? {}
  if (!meta.householdId) return null
  const item = sub.items?.data?.[0]
  const fromPrice = parseLookupKey(item?.price?.lookup_key)
  const plan = fromPrice?.plan ?? (isPlan(meta.plan) ? meta.plan : null)
  const period = fromPrice?.period ?? (isPeriod(meta.period) ? meta.period : null)
  if (!plan || !period) return null
  // Since API 2025-03-31 the billing period lives on the item.
  const periodEnd = (item as { current_period_end?: number } | undefined)?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end
  return {
    householdId: meta.householdId,
    userId: meta.userId || null,
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    plan,
    period,
    status: sub.status as SubscriptionStatus,
    currentPeriodEnd: toDate(periodEnd),
    trialEnd: toDate(sub.trial_end),
    cancelAtPeriodEnd: !!sub.cancel_at_period_end || !!sub.cancel_at,
    canceledAt: toDate(sub.canceled_at),
  }
}

/** What `GET /billing` answers, from the household's latest subscription. */
export function billingStateFor(
  row: SubscriptionRow | null,
  opts: { enabled: boolean; canManage: boolean; now: Date },
): BillingState {
  const live = row && LIVE_STATUSES.includes(row.status) ? row : null
  const nextCharge = live && !live.cancelAtPeriodEnd ? (live.status === 'trialing' ? live.trialEnd : live.currentPeriodEnd) : null
  return {
    enabled: opts.enabled,
    beta: isBeta(opts.now),
    launchDate: LAUNCH_DATE,
    canManage: opts.canManage,
    subscription: live
      ? {
          plan: live.plan,
          period: live.period,
          status: live.status,
          nextChargeAt: nextCharge ? nextCharge.toISOString() : null,
          cancelAtPeriodEnd: live.cancelAtPeriodEnd,
          endsAt: live.cancelAtPeriodEnd
            ? (live.status === 'trialing' ? live.trialEnd : live.currentPeriodEnd)?.toISOString() ?? null
            : null,
        }
      : null,
  }
}

// ─── Persistence ─────────────────────────────────────────────

export interface SubscriptionRepo {
  /** The household's most recent subscription, live or not. */
  latestForHousehold(householdId: string): Promise<SubscriptionRow | null>
  upsert(row: SubscriptionRow): Promise<void>
  /** Live subscriptions this user pays (to cancel them when the account is deleted). */
  livePaidBy(userId: string): Promise<SubscriptionRow[]>
}

export function createDbSubscriptionRepo(db: typeof defaultDb = defaultDb): SubscriptionRepo {
  const toRow = (r: typeof subscriptions.$inferSelect): SubscriptionRow => ({
    householdId: r.householdId,
    userId: r.userId,
    stripeCustomerId: r.stripeCustomerId,
    stripeSubscriptionId: r.stripeSubscriptionId,
    plan: r.plan as PlanKey,
    period: r.period as BillingPeriod,
    status: r.status as SubscriptionStatus,
    currentPeriodEnd: r.currentPeriodEnd,
    trialEnd: r.trialEnd,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    canceledAt: r.canceledAt,
  })
  return {
    async latestForHousehold(householdId) {
      const [r] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.householdId, householdId))
        .orderBy(desc(subscriptions.updatedAt))
        .limit(1)
      return r ? toRow(r) : null
    },
    async upsert(row) {
      const now = new Date()
      await db
        .insert(subscriptions)
        .values({ ...row, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: subscriptions.stripeSubscriptionId,
          set: {
            plan: row.plan,
            period: row.period,
            status: row.status,
            currentPeriodEnd: row.currentPeriodEnd,
            trialEnd: row.trialEnd,
            cancelAtPeriodEnd: row.cancelAtPeriodEnd,
            canceledAt: row.canceledAt,
            stripeCustomerId: row.stripeCustomerId,
            updatedAt: now,
          },
        })
    },
    async livePaidBy(userId) {
      const rows = await db
        .select()
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, userId), inArray(subscriptions.status, [...LIVE_STATUSES])))
      return rows.map(toRow)
    },
  }
}

// ─── Stripe ──────────────────────────────────────────────────

/** The few Stripe calls we make, behind an interface so routes are testable without Stripe. */
export interface BillingGateway {
  priceId(plan: PlanKey, period: BillingPeriod): Promise<string>
  createCheckout(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string }>
  createPortal(customerId: string, returnUrl: string): Promise<{ url: string }>
  /** Verifies the signature; throws when it doesn't match. */
  parseWebhook(raw: Buffer, signature: string | undefined): Stripe.Event
  retrieveSubscription(id: string): Promise<Stripe.Subscription>
  cancelNow(subscriptionId: string): Promise<void>
}

export function isBillingConfigured(): boolean {
  return !!env.STRIPE_SECRET_KEY && !!env.STRIPE_WEBHOOK_SECRET
}

let client: Stripe | null = null
function stripe(): Stripe {
  if (!client) client = new Stripe(env.STRIPE_SECRET_KEY)
  return client
}

const priceCache = new Map<string, string>()

export function createStripeGateway(): BillingGateway {
  return {
    async priceId(plan, period) {
      const key = stripeLookupKey(plan, period)
      const cached = priceCache.get(key)
      if (cached) return cached
      const { data } = await stripe().prices.list({ lookup_keys: [key], active: true, limit: 1 })
      if (!data[0]) throw new Error(`No Stripe price with lookup key ${key}: run scripts/stripeSetup.ts`)
      priceCache.set(key, data[0].id)
      return data[0].id
    },
    async createCheckout(params) {
      const s = await stripe().checkout.sessions.create(params)
      if (!s.url) throw new Error('Stripe returned a Checkout Session without url')
      return { url: s.url }
    },
    async createPortal(customerId, returnUrl) {
      const s = await stripe().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl, locale: 'es' })
      return { url: s.url }
    },
    parseWebhook(raw, signature) {
      return stripe().webhooks.constructEvent(raw, signature ?? '', env.STRIPE_WEBHOOK_SECRET)
    },
    retrieveSubscription(id) {
      return stripe().subscriptions.retrieve(id)
    },
    async cancelNow(subscriptionId) {
      await stripe().subscriptions.cancel(subscriptionId)
    },
  }
}

/**
 * Webhook → our table. Events can arrive late or out of order, so we never
 * trust the payload's copy: we take the subscription id and read the current
 * subscription from Stripe. Anything else is acknowledged and ignored.
 */
export async function handleBillingEvent(event: Stripe.Event, deps: { repo: SubscriptionRepo; gateway: BillingGateway }): Promise<'saved' | 'ignored'> {
  let id: string | null = null
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      id = (event.data.object as Stripe.Subscription).id
      break
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session
      const sub = session.subscription
      if (session.mode === 'subscription' && sub) id = typeof sub === 'string' ? sub : sub.id
      break
    }
    default:
      return 'ignored'
  }
  if (!id) return 'ignored'
  const row = rowFromStripeSubscription(await deps.gateway.retrieveSubscription(id))
  if (!row) return 'ignored'
  await deps.repo.upsert(row)
  return 'saved'
}

/**
 * «Borrar mi cuenta»: the payer's live subscriptions are cancelled at once,
 * before the account goes, so nobody keeps being charged for a household
 * they left (privacy.md). Throws if Stripe can't be reached: the deletion
 * then stops and the user is asked to retry.
 */
export async function cancelSubscriptionsPaidBy(
  userId: string,
  deps: { repo?: SubscriptionRepo; gateway?: BillingGateway; enabled?: () => boolean } = {},
): Promise<number> {
  const repo = deps.repo ?? createDbSubscriptionRepo()
  const live = await repo.livePaidBy(userId)
  if (live.length === 0) return 0
  if (!(deps.enabled ?? isBillingConfigured)()) throw new Error('Billing not configured, cannot cancel subscriptions')
  const gateway = deps.gateway ?? createStripeGateway()
  for (const s of live) {
    await gateway.cancelNow(s.stripeSubscriptionId)
    await repo.upsert({ ...s, status: 'canceled', canceledAt: new Date(), cancelAtPeriodEnd: false })
  }
  return live.length
}
