/**
 * Subscriptions (specs/billing.md): the plan catalogue, the Checkout Session
 * we build (Managed Payments, trial until launch day during the beta), the
 * webhook → table mapping and the routes, on a real Express app with an
 * in-memory repo and a fake Stripe gateway.
 */
import express, { type RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type Stripe from 'stripe'
import { afterAll, describe, expect, it } from 'vitest'
import { FOUNDER_PLANS, PLANS, founderPriceIfSubscribing, PLAN_FEATURE_GROUPS, checkoutRequestSchema, stripeLookupKey, subscriptionSummary } from '@ona/shared'
import { createBillingRouter, createBillingWebhookRouter, type Payer } from '../routes/billing.js'
import {
  billingStateFor,
  buildCheckoutParams,
  cancelSubscriptionsPaidBy,
  firstChargeInstant,
  formatDayEs,
  launchInstant,
  parseLookupKey,
  rowFromStripeSubscription,
  type BillingGateway,
  type SubscriptionRepo,
  type SubscriptionRow,
} from '../services/billing.js'

const BETA_NOW = new Date('2026-10-20T10:00:00Z')
const AFTER_LAUNCH = new Date('2027-02-01T10:00:00Z')
const BETA_FIRST = new Date('2026-12-29T11:00:00Z')

describe('plans (2026-10-15: Esencial featured, monthly or yearly)', () => {
  it('Esencial first and featured; Plus second', () => {
    expect(PLANS.map((p) => [p.key, p.featured])).toEqual([['esencial', true], ['plus', false]])
  })

  it('prices, VAT included', () => {
    expect(PLANS.map((p) => [p.key, p.prices.mensual.cents, p.prices.anual.cents])).toEqual([
      ['esencial', 499, 4999],
      ['plus', 899, 5999],
    ])
    expect(PLANS.map((p) => [p.prices.mensual.label, p.prices.anual.label])).toEqual([
      ['4,99 €/mes', '49,99 €/año'],
      ['8,99 €/mes', '59,99 €/año'],
    ])
  })

  it('the comparison table: voice and proactive WhatsApp are Plus only; WhatsApp chat is in both', () => {
    const all = PLAN_FEATURE_GROUPS.flatMap((g) => g.features)
    const only = all.filter((f) => f.esencial === false).map((f) => f.label)
    expect(only).toEqual(['Hablar con Mimo por voz', 'Mimo te escribe por WhatsApp'])
    expect(all.find((f) => f.label === 'Chat con Mimo por WhatsApp')?.esencial).toBeTruthy()
    for (const f of all) expect(f.plus).toBeTruthy()
  })

  it('founder reservation: 4 plan × period ids, Esencial featured', () => {
    expect(FOUNDER_PLANS.map((p) => [p.id, p.featured])).toEqual([
      ['esencial-mensual', true],
      ['esencial-anual', true],
      ['plus-mensual', false],
      ['plus-anual', false],
    ])
  })

  it('lookup keys round-trip', () => {
    expect(stripeLookupKey('esencial', 'anual')).toBe('esencial_anual')
    expect(parseLookupKey('plus_mensual')).toEqual({ plan: 'plus', period: 'mensual' })
    expect(parseLookupKey('gratis_mensual')).toBeNull()
    expect(checkoutRequestSchema.safeParse({ plan: 'plus', period: 'semanal' }).success).toBe(false)
  })
})

describe('firstChargeInstant (D-055/D-056/D-057: launch 2026-12-15, 14-day trial, ≥ 15 days from the card)', () => {
  const iso = (d: Date) => d.toISOString()
  const at = (s: string) => new Date(s)

  it('a beta household: launch + 14 days → 29 December, at noon in Madrid', () => {
    expect(iso(firstChargeInstant({ userCreatedAt: at('2026-10-21T09:00:00Z'), now: BETA_NOW }))).toBe('2026-12-29T11:00:00.000Z')
    // Still the 29th paying on 13 December (29 Dec is 16 days later).
    expect(iso(firstChargeInstant({ userCreatedAt: at('2026-10-21T09:00:00Z'), now: at('2026-12-13T20:00:00Z') }))).toBe('2026-12-29T11:00:00.000Z')
  })

  it('a beta household paying after launch: 15 days from the card, not before', () => {
    expect(iso(firstChargeInstant({ userCreatedAt: at('2026-10-21T09:00:00Z'), now: at('2026-12-20T10:00:00Z') }))).toBe('2027-01-04T11:00:00.000Z')
  })

  it('someone new: sign-up + 14 days, or card + 15 days if later', () => {
    // Signs up 20 Dec, pays on day 2 → card + 15 = 6 Jan beats 3 Jan.
    expect(iso(firstChargeInstant({ userCreatedAt: at('2026-12-20T10:00:00Z'), now: at('2026-12-22T10:00:00Z') }))).toBe('2027-01-06T11:00:00.000Z')
    // A late evening card rounds up to the next noon: never less than 15 days.
    expect(iso(firstChargeInstant({ userCreatedAt: at('2026-12-20T10:00:00Z'), now: at('2026-12-22T19:00:00Z') }))).toBe('2027-01-07T11:00:00.000Z')
  })

  it('in summer time noon Madrid is still that day', () => {
    const d = firstChargeInstant({ userCreatedAt: at('2027-06-01T08:00:00Z'), now: at('2027-06-01T08:00:00Z') })
    expect(d.getTime()).toBeGreaterThanOrEqual(at('2027-06-16T08:00:00Z').getTime())
    expect(formatDayEs(d)).toBe('16 de junio de 2027')
  })
})

describe('buildCheckoutParams', () => {
  const firstCharge = new Date('2026-12-29T11:00:00Z')
  const base = {
    plan: 'esencial' as const,
    period: 'mensual' as const,
    priceId: 'price_123',
    email: 'ana@example.com',
    userId: 'u1',
    householdId: 'h1',
    webUrl: 'https://mimoia.com',
    firstCharge,
  }

  it('Managed Payments, card now, the Stripe trial ends on the first charge', () => {
    const p = buildCheckoutParams(base)
    expect(p.mode).toBe('subscription')
    expect(p.managed_payments).toEqual({ enabled: true })
    expect(p.line_items).toEqual([{ price: 'price_123', quantity: 1 }])
    expect(p.subscription_data?.trial_end).toBe(Math.floor(firstCharge.getTime() / 1000))
    expect(p.customer_email).toBe('ana@example.com')
    expect(p.subscription_data?.metadata).toEqual({ userId: 'u1', householdId: 'h1', plan: 'esencial', period: 'mensual' })
    expect(p.success_url).toBe('https://mimoia.com/profile/suscripcion?estado=ok')
    expect(p.locale).toBe('es')
  })

  it('never sends what Managed Payments refuses', () => {
    const p = buildCheckoutParams(base) as Record<string, unknown>
    for (const k of ['automatic_tax', 'tax_id_collection', 'payment_method_types', 'invoice_creation', 'adaptive_pricing', 'custom_text']) {
      expect(p[k]).toBeUndefined()
    }
  })

  it('reuses the household customer when there is one', () => {
    const p = buildCheckoutParams({ ...base, customerId: 'cus_9' })
    expect(p.customer).toBe('cus_9')
    expect(p.customer_email).toBeUndefined()
  })

  it('dates in Spanish, Madrid time', () => {
    expect(formatDayEs(launchInstant())).toBe('15 de diciembre de 2026')
    expect(formatDayEs(firstCharge)).toBe('29 de diciembre de 2026')
  })
})

function stripeSub(over: Partial<Stripe.Subscription> & { lookup?: string; periodEnd?: number } = {}): Stripe.Subscription {
  const { lookup = 'esencial_mensual', periodEnd = 1_800_000_000, ...rest } = over
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status: 'trialing',
    trial_end: Math.floor(launchInstant().getTime() / 1000),
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    metadata: { householdId: 'h1', userId: 'u1', plan: 'esencial', period: 'mensual' },
    items: { data: [{ price: { lookup_key: lookup }, current_period_end: periodEnd }] },
    ...rest,
  } as unknown as Stripe.Subscription
}

describe('rowFromStripeSubscription', () => {
  it('maps a trial subscription', () => {
    expect(rowFromStripeSubscription(stripeSub())).toMatchObject({
      householdId: 'h1',
      userId: 'u1',
      stripeCustomerId: 'cus_1',
      stripeSubscriptionId: 'sub_1',
      plan: 'esencial',
      period: 'mensual',
      status: 'trialing',
      trialEnd: launchInstant(),
      currentPeriodEnd: new Date(1_800_000_000_000),
      cancelAtPeriodEnd: false,
    })
  })

  it('the price decides the plan (a change in the portal wins over the checkout metadata)', () => {
    expect(rowFromStripeSubscription(stripeSub({ lookup: 'plus_anual' }))).toMatchObject({ plan: 'plus', period: 'anual' })
  })

  it('ignores subscriptions that are not ours', () => {
    expect(rowFromStripeSubscription(stripeSub({ metadata: {} }))).toBeNull()
  })
})

function row(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    householdId: 'h1',
    userId: 'u1',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    plan: 'esencial',
    period: 'mensual',
    status: 'trialing',
    currentPeriodEnd: BETA_FIRST,
    trialEnd: BETA_FIRST,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    founderPrice: false,
    ...over,
  }
}

describe('billingStateFor', () => {
  it('beta, nothing paid', () => {
    expect(billingStateFor(null, { enabled: true, canManage: true, now: BETA_NOW, userCreatedAt: new Date('2026-10-21T09:00:00Z') })).toEqual({
      enabled: true, beta: true, launchDate: '2026-12-15', canManage: true, firstChargeAt: '2026-12-29T11:00:00.000Z', subscription: null,
      // PRO-135: before launch day nobody is in a trial or paused.
      access: { state: 'beta', trialEndsAt: '2026-12-28T23:00:00.000Z', trialLastDay: '2026-12-28', daysLeft: null, trialDay: null },
      // PRO-136: a beta household is a founding one.
      founder: { household: true, priceIfSubscribing: true, offer: false },
    })
  })

  it('paid during the beta: first charge on 29 December', () => {
    const s = billingStateFor(row(), { enabled: true, canManage: true, now: BETA_NOW }).subscription
    expect(s).toMatchObject({ plan: 'esencial', period: 'mensual', status: 'trialing', nextChargeAt: '2026-12-29T11:00:00.000Z', cancelAtPeriodEnd: false, endsAt: null })
  })

  it('cancelled but still running: no next charge, an end date', () => {
    const s = billingStateFor(row({ status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: new Date('2027-03-01T00:00:00Z') }), { enabled: true, canManage: true, now: AFTER_LAUNCH }).subscription
    expect(s).toMatchObject({ nextChargeAt: null, endsAt: '2027-03-01T00:00:00.000Z' })
  })

  it('a finished subscription is no subscription', () => {
    expect(billingStateFor(row({ status: 'canceled' }), { enabled: true, canManage: true, now: AFTER_LAUNCH }).subscription).toBeNull()
  })
})

// ─── Routes ─────────────────────────────────────────────────

function memoryRepo(initial: SubscriptionRow[] = []): SubscriptionRepo & { rows: SubscriptionRow[] } {
  const rows = [...initial]
  return {
    rows,
    async latestForHousehold(h) {
      return [...rows].reverse().find((r) => r.householdId === h) ?? null
    },
    async upsert(r) {
      const i = rows.findIndex((x) => x.stripeSubscriptionId === r.stripeSubscriptionId)
      if (i >= 0) rows.splice(i, 1)
      rows.push(r)
    },
    async livePaidBy(u) {
      return rows.filter((r) => r.userId === u && !['canceled', 'incomplete_expired'].includes(r.status))
    },
  }
}

function fakeGateway(
  over: Partial<BillingGateway> = {},
): BillingGateway & { checkouts: Stripe.Checkout.SessionCreateParams[]; cancelled: string[]; portals: Array<{ cancelSubscriptionId?: string } | undefined> } {
  const checkouts: Stripe.Checkout.SessionCreateParams[] = []
  const cancelled: string[] = []
  const portals: Array<{ cancelSubscriptionId?: string } | undefined> = []
  return {
    checkouts,
    cancelled,
    portals,
    async priceId(plan, period) {
      return `price_${plan}_${period}`
    },
    async createCheckout(p) {
      checkouts.push(p)
      return { url: 'https://checkout.stripe.com/c/pay/cs_test_1' }
    },
    async createPortal(customer, _returnUrl, opts) {
      portals.push(opts)
      return { url: `https://billing.stripe.com/p/session/${customer}` }
    },
    parseWebhook(raw, sig) {
      if (sig !== 'good') throw new Error('bad signature')
      return JSON.parse(raw.toString('utf8'))
    },
    async retrieveSubscription() {
      return stripeSub({ lookup: 'plus_anual', status: 'trialing' })
    },
    async cancelNow(id) {
      cancelled.push(id)
    },
    ...over,
  }
}

const servers: Server[] = []
afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

async function serve(app: express.Express): Promise<string> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** `x-user: <id>` stands in for the JWT. */
const fakeAuth: RequestHandler = (req, res, next) => {
  const id = req.get('x-user')
  if (!id) {
    res.status(401).json({ error: 'No token provided' })
    return
  }
  ;(req as unknown as { userId: string }).userId = id
  next()
}

const PAYERS: Record<string, Payer> = {
  owner: { householdId: 'h1', email: 'ana@example.com', isOwner: true, createdAt: new Date('2026-10-21T09:00:00Z') },
  member: { householdId: 'h1', email: 'leo@example.com', isOwner: false, createdAt: new Date('2026-10-22T09:00:00Z') },
  // PRO-136: a household created after launch, at 15:00 Madrid on 10 January 2027.
  newOwner: { householdId: 'h2', email: 'eva@example.com', isOwner: true, createdAt: new Date('2027-01-10T14:00:00Z'), householdCreatedAt: new Date('2027-01-10T14:00:00Z') },
}

async function app(opts: { enabled?: boolean; repo?: ReturnType<typeof memoryRepo>; gateway?: ReturnType<typeof fakeGateway>; now?: Date } = {}) {
  const repo = opts.repo ?? memoryRepo()
  const gateway = opts.gateway ?? fakeGateway()
  const enabled = () => opts.enabled ?? true
  const a = express()
  a.use(createBillingWebhookRouter({ repo, gateway, enabled }))
  a.use(express.json())
  a.use(
    createBillingRouter({
      repo,
      gateway,
      enabled,
      payer: async (id) => PAYERS[id] ?? null,
      now: () => opts.now ?? BETA_NOW,
      webUrl: 'https://mimoia.com',
      auth: fakeAuth,
    }),
  )
  const base = await serve(a)
  const call = (method: string, path: string, user?: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { repo, gateway, call }
}

describe('routes', () => {
  it('GET /billing needs a session and tells the owner they can manage', async () => {
    const { call } = await app()
    expect((await call('GET', '/billing')).status).toBe(401)
    expect(await (await call('GET', '/billing', 'owner')).json()).toMatchObject({ enabled: true, beta: true, canManage: true, subscription: null })
    expect(await (await call('GET', '/billing', 'member')).json()).toMatchObject({ canManage: false })
  })

  it('POST /billing/checkout: the owner gets a Stripe URL for the chosen plan', async () => {
    const { call, gateway } = await app()
    const r = await call('POST', '/billing/checkout', 'owner', { plan: 'esencial', period: 'anual' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
    expect(gateway.checkouts[0].line_items).toEqual([{ price: 'price_esencial_anual', quantity: 1 }])
    // A beta owner: first charge 29 December at noon in Madrid (D-055).
    expect(gateway.checkouts[0].subscription_data?.trial_end).toBe(Math.floor(BETA_FIRST.getTime() / 1000))
  })

  it('refuses a member, a bad plan, payments off and a household that already pays', async () => {
    expect((await (await app()).call('POST', '/billing/checkout', 'member', { plan: 'plus', period: 'mensual' })).status).toBe(403)
    expect((await (await app()).call('POST', '/billing/checkout', 'owner', { plan: 'gratis', period: 'mensual' })).status).toBe(400)
    expect((await (await app({ enabled: false })).call('POST', '/billing/checkout', 'owner', { plan: 'plus', period: 'mensual' })).status).toBe(503)
    const paying = await app({ repo: memoryRepo([row()]) })
    const r = await paying.call('POST', '/billing/checkout', 'owner', { plan: 'plus', period: 'mensual' })
    expect(r.status).toBe(409)
    expect((await r.json()).code).toBe('ALREADY_SUBSCRIBED')
  })

  it('a cancelled household can subscribe again, as the same Stripe customer', async () => {
    const { call, gateway } = await app({ repo: memoryRepo([row({ status: 'canceled' })]) })
    expect((await call('POST', '/billing/checkout', 'owner', { plan: 'plus', period: 'mensual' })).status).toBe(200)
    expect(gateway.checkouts[0].customer).toBe('cus_1')
  })

  it('POST /billing/portal opens the customer portal for the household customer', async () => {
    expect((await (await app()).call('POST', '/billing/portal', 'owner')).status).toBe(404)
    const { call } = await app({ repo: memoryRepo([row()]) })
    expect(await (await call('POST', '/billing/portal', 'owner')).json()).toEqual({ url: 'https://billing.stripe.com/p/session/cus_1' })
    expect((await call('POST', '/billing/portal', 'member')).status).toBe(403)
  })

  it('a Stripe outage is a clear 502, not a crash', async () => {
    const gateway = fakeGateway({ createCheckout: async () => { throw new Error('ECONNRESET') } })
    const r = await (await app({ gateway })).call('POST', '/billing/checkout', 'owner', { plan: 'plus', period: 'mensual' })
    expect(r.status).toBe(502)
  })

  it('webhook: bad signature 400; a subscription event saves the fresh subscription from Stripe', async () => {
    const { call, repo } = await app()
    const event = { type: 'customer.subscription.created', data: { object: { id: 'sub_1' } } }
    expect((await call('POST', '/billing/webhook', undefined, event, { 'stripe-signature': 'bad' })).status).toBe(400)
    const r = await call('POST', '/billing/webhook', undefined, event, { 'stripe-signature': 'good' })
    expect(await r.json()).toEqual({ received: true, outcome: 'saved' })
    expect(repo.rows).toHaveLength(1)
    expect(repo.rows[0]).toMatchObject({ householdId: 'h1', plan: 'plus', period: 'anual', status: 'trialing' })
  })

  it('PRO-135: after the trial the household is paused; paying (the webhook) takes it out of the pause', async () => {
    // The owner's household (created 2026-10-21, beta) after its trial: 2027-02-01.
    const { call } = await app({ now: AFTER_LAUNCH })
    expect((await (await call('GET', '/billing', 'owner')).json()).access).toMatchObject({ state: 'paused', trialLastDay: '2026-12-28' })
    const event = { type: 'customer.subscription.created', data: { object: { id: 'sub_1' } } }
    expect((await call('POST', '/billing/webhook', undefined, event, { 'stripe-signature': 'good' })).status).toBe(200)
    expect((await (await call('GET', '/billing', 'owner')).json()).access).toMatchObject({ state: 'subscribed' })
    // The whole household: the member too.
    expect((await (await call('GET', '/billing', 'member')).json()).access).toMatchObject({ state: 'subscribed' })
  })

  it('PRO-135: during the beta GET /billing says beta, never paused', async () => {
    const { call } = await app()
    expect((await (await call('GET', '/billing', 'owner')).json()).access).toMatchObject({ state: 'beta', daysLeft: null })
  })

  it('webhook: checkout.session.completed links the subscription; other events are ignored', async () => {
    const { call, repo } = await app()
    const done = { type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1' } } }
    expect(await (await call('POST', '/billing/webhook', undefined, done, { 'stripe-signature': 'good' })).json()).toMatchObject({ outcome: 'saved' })
    const other = { type: 'invoice.paid', data: { object: {} } }
    expect(await (await call('POST', '/billing/webhook', undefined, other, { 'stripe-signature': 'good' })).json()).toMatchObject({ outcome: 'ignored' })
    expect(repo.rows).toHaveLength(1)
  })
})

describe('PRO-136: founder price, the Stripe trial and the cancel link', () => {
  const NEW = new Date('2027-01-10T14:00:00Z')
  const day = (n: number) => new Date(NEW.getTime() + n * 86_400_000)

  it('buildCheckoutParams marks the founder price in both metadata; rowFromStripeSubscription reads it back', () => {
    const p = buildCheckoutParams({
      plan: 'plus', period: 'anual', priceId: 'p', email: 'a@example.com', userId: 'u1', householdId: 'h1',
      webUrl: 'https://mimoia.com', firstCharge: BETA_FIRST, founderPrice: true,
    })
    expect(p.metadata?.founder_price).toBe('true')
    expect(p.subscription_data?.metadata?.founder_price).toBe('true')
    const plain = buildCheckoutParams({
      plan: 'plus', period: 'anual', priceId: 'p', email: 'a@example.com', userId: 'u1', householdId: 'h1',
      webUrl: 'https://mimoia.com', firstCharge: BETA_FIRST,
    })
    expect(plain.subscription_data?.metadata).not.toHaveProperty('founder_price')
    const meta = { householdId: 'h1', userId: 'u1', plan: 'plus', period: 'anual' }
    expect(rowFromStripeSubscription(stripeSub({ metadata: { ...meta, founder_price: 'true' } }))?.founderPrice).toBe(true)
    expect(rowFromStripeSubscription(stripeSub({ metadata: meta }))?.founderPrice).toBe(false)
  })

  it('who keeps the founder price: a beta household always; a new one while in trial; not once paused', () => {
    expect(founderPriceIfSubscribing(new Date('2026-10-21T09:00:00Z'), new Date('2027-06-01T10:00:00Z'))).toBe(true)
    expect(founderPriceIfSubscribing(NEW, day(3))).toBe(true)
    expect(founderPriceIfSubscribing(NEW, day(13))).toBe(true)
    expect(founderPriceIfSubscribing(NEW, day(15))).toBe(false)
  })

  it('checkout: trial_end = max(end of the trial, today + 15 days), at noon Madrid; founder in the metadata', async () => {
    // Day 7 (17 January, 15:00): today + 15 days (1 February, 15:00) is later than the end of the trial → noon on 2 February.
    const a = await app({ now: day(7) })
    expect((await a.call('POST', '/billing/checkout', 'newOwner', { plan: 'esencial', period: 'mensual' })).status).toBe(200)
    expect(a.gateway.checkouts[0].subscription_data?.trial_end).toBe(Math.floor(new Date('2027-02-02T11:00:00Z').getTime() / 1000))
    expect(a.gateway.checkouts[0].subscription_data?.metadata?.founder_price).toBe('true')
    // Paused (day 20): 15 days from the card, no founder price.
    const b = await app({ now: day(20) })
    await b.call('POST', '/billing/checkout', 'newOwner', { plan: 'esencial', period: 'mensual' })
    expect(b.gateway.checkouts[0].subscription_data?.trial_end).toBe(Math.floor(new Date('2027-02-15T11:00:00Z').getTime() / 1000))
    expect(b.gateway.checkouts[0].subscription_data?.metadata).not.toHaveProperty('founder_price')
    // A beta household (the owner): founder, first charge 29 December.
    const c = await app()
    await c.call('POST', '/billing/checkout', 'owner', { plan: 'plus', period: 'mensual' })
    expect(c.gateway.checkouts[0].subscription_data?.metadata?.founder_price).toBe('true')
  })

  it('GET /billing: the day-7 offer from day 7 and not before; not with a plan', async () => {
    const at = async (n: number, repo = memoryRepo()) => (await (await (await app({ now: day(n), repo })).call('GET', '/billing', 'newOwner')).json()).founder
    expect((await at(6)).offer).toBe(false)
    expect((await at(7)).offer).toBe(true)
    expect((await at(13)).offer).toBe(true)
    expect((await at(15)).offer).toBe(false)
    expect((await at(8, memoryRepo([row({ householdId: 'h2' })]))).offer).toBe(false)
  })

  it('billingStateFor: the legal notice in the app from 15 days before the first charge, with the amount', () => {
    const sub = row({ householdId: 'h2', founderPrice: true, trialEnd: new Date('2027-02-01T11:00:00Z'), currentPeriodEnd: new Date('2027-02-01T11:00:00Z') })
    const at = (iso: string) => billingStateFor(sub, { enabled: true, canManage: true, now: new Date(iso), householdCreatedAt: NEW }).subscription
    expect(at('2027-01-16T22:00:00Z')?.upcomingCharge).toBeNull() // 16 Jan 23:00 Madrid: 16 days before
    expect(at('2027-01-17T09:00:00Z')).toMatchObject({ founderPrice: true, upcomingCharge: { at: '2027-02-01T11:00:00.000Z', amount: '4,99 €' } })
    expect(billingStateFor({ ...sub, cancelAtPeriodEnd: true }, { enabled: true, canManage: true, now: new Date('2027-01-20T09:00:00Z') }).subscription?.upcomingCharge).toBeNull()
  })

  it('POST /billing/portal { cancel: true } opens the cancel flow of the live subscription', async () => {
    const { call, gateway } = await app({ repo: memoryRepo([row()]) })
    expect((await call('POST', '/billing/portal', 'owner', { cancel: true })).status).toBe(200)
    expect(gateway.portals.at(-1)).toEqual({ cancelSubscriptionId: 'sub_1' })
    await call('POST', '/billing/portal', 'owner', {})
    expect(gateway.portals.at(-1)).toBeUndefined()
  })
})

describe('account deletion cancels what the user pays', () => {
  it('cancels live subscriptions at once and marks them', async () => {
    const repo = memoryRepo([row(), row({ stripeSubscriptionId: 'sub_old', status: 'canceled' })])
    const gateway = fakeGateway()
    expect(await cancelSubscriptionsPaidBy('u1', { repo, gateway, enabled: () => true })).toBe(1)
    expect(gateway.cancelled).toEqual(['sub_1'])
    expect(repo.rows.find((r) => r.stripeSubscriptionId === 'sub_1')?.status).toBe('canceled')
  })

  it('nothing to cancel → no Stripe call, even with payments off', async () => {
    const gateway = fakeGateway()
    expect(await cancelSubscriptionsPaidBy('u2', { repo: memoryRepo([row()]), gateway, enabled: () => false })).toBe(0)
    expect(gateway.cancelled).toEqual([])
  })

  it('Stripe failing stops the deletion (throws)', async () => {
    const gateway = fakeGateway({ cancelNow: async () => { throw new Error('down') } })
    await expect(cancelSubscriptionsPaidBy('u1', { repo: memoryRepo([row()]), gateway, enabled: () => true })).rejects.toThrow()
  })
})

describe('subscriptionSummary (2026-10-15: the trial, its end and a cancellation at a glance)', () => {
  const base = { plan: 'esencial' as const, period: 'mensual' as const, status: 'trialing' as const, nextChargeAt: '2026-12-29T11:00:00.000Z', cancelAtPeriodEnd: false, endsAt: null }

  it('paid during the beta: in trial until 29 December', () => {
    const s = subscriptionSummary(base)
    expect(s.badge).toBe('En prueba hasta el 29 de diciembre')
    expect(s.line).toBe('Lo has dejado pagado: no se cobra nada hasta el 29 de diciembre de 2026. Puedes cancelar antes sin pagar nada.')
    expect(s.hub).toBe('Esencial · en prueba')
  })

  it("cancelled during the trial (Miguel's case): cancelled, never charged, trial until 29 December", () => {
    const s = subscriptionSummary({ ...base, nextChargeAt: null, cancelAtPeriodEnd: true, endsAt: '2026-12-29T11:00:00.000Z' })
    expect(s.badge).toBe('Cancelada')
    expect(s.line).toBe('Has cancelado: no se te cobrará nada. Sigues con tu prueba hasta el 29 de diciembre de 2026.')
    expect(s.hub).toBe('Esencial · cancelada')
  })

  it('active, cancelled, and a failed payment', () => {
    expect(subscriptionSummary({ ...base, status: 'active', nextChargeAt: '2027-02-01T11:00:00.000Z' })).toMatchObject({ badge: 'Activa', line: 'Próximo cobro: 1 de febrero de 2027.', hub: 'Esencial · 4,99 €/mes' })
    expect(subscriptionSummary({ ...base, status: 'active', nextChargeAt: null, cancelAtPeriodEnd: true, endsAt: '2027-02-01T11:00:00.000Z' }).line).toBe('Has cancelado: sigues con Esencial hasta el 1 de febrero de 2027 y no se renueva.')
    expect(subscriptionSummary({ ...base, status: 'past_due' })).toMatchObject({ badge: 'Pago pendiente', tone: 'warn' })
  })
})
