/**
 * PRO-386 (D-158, piece 7): why households leave and failed payments.
 *   - the cancellation reason and the portal's category are kept, never the comment;
 *   - `invoice.payment_failed` saves the subscription and hands the invoice on;
 *   - the notice goes once per invoice: WhatsApp if it gets through, else email;
 *   - after 7 days `past_due` the household loses the plan until it pays.
 * Events are trimmed copies of Stripe's examples (API 2025-03-31+).
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import type Stripe from 'stripe'
import { afterAll, describe, expect, it } from 'vitest'
import { PAST_DUE_GRACE_DAYS, hasPaidAccess, paymentDueBy } from '@ona/shared'
import { createBillingWebhookRouter } from '../routes/billing.js'
import { accessForUser, type AccessFacts } from '../services/accountAccess.js'
import {
  billingStateFor,
  handleBillingEvent,
  invoiceSubscriptionId,
  rowFromStripeSubscription,
  type BillingGateway,
  type PaymentFailure,
  type SubscriptionRepo,
  type SubscriptionRow,
} from '../services/billing.js'
import { noticePriority } from '../services/notifications/budget.js'
import {
  changeCardUrl,
  notifyPaymentFailed,
  paymentFailedEmail,
  paymentFailedWhatsApp,
  tallyBy,
  type PaymentFailureDeps,
  type PaymentFailureRepo,
} from '../services/paymentFailures.js'
import type { EmailMessage } from '../services/email.js'

const DAY = 24 * 60 * 60 * 1000
const AFTER_LAUNCH = new Date('2027-02-10T10:00:00Z')
const HOUSEHOLD_CREATED = new Date('2026-11-01T10:00:00Z')

/** Stripe's example `customer.subscription.*` object, trimmed to what we read. */
function stripeSub(over: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_1',
    object: 'subscription',
    customer: 'cus_1',
    status: 'active',
    trial_end: null,
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    cancellation_details: { comment: null, feedback: null, reason: null },
    metadata: { householdId: 'h1', userId: 'u1', plan: 'esencial', period: 'mensual' },
    items: { data: [{ price: { lookup_key: 'esencial_mensual' }, current_period_end: 1_800_000_000 }] },
    ...over,
  } as unknown as Stripe.Subscription
}

/** Stripe's example `invoice.payment_failed` event (invoice with `parent.subscription_details`). */
function paymentFailedEvent(invoiceId = 'in_1', subscription = 'sub_1'): Stripe.Event {
  return {
    id: `evt_${invoiceId}`,
    object: 'event',
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: invoiceId,
        object: 'invoice',
        customer: 'cus_1',
        status: 'open',
        attempt_count: 1,
        billing_reason: 'subscription_cycle',
        parent: { type: 'subscription_details', subscription_details: { subscription, metadata: {} } },
      },
    },
  } as unknown as Stripe.Event
}

function subEvent(type: string, sub: Stripe.Subscription): Stripe.Event {
  return { id: 'evt_s', object: 'event', type, data: { object: sub } } as unknown as Stripe.Event
}

function memoryRepo(): SubscriptionRepo & { rows: SubscriptionRow[] } {
  const rows: SubscriptionRow[] = []
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
    async livePaidBy() {
      return []
    },
  }
}

function gatewayReturning(sub: () => Stripe.Subscription): BillingGateway {
  return {
    async priceId() {
      return 'price_1'
    },
    async createCheckout() {
      return { url: 'https://checkout.stripe.com/x' }
    },
    async createPortal() {
      return { url: 'https://billing.stripe.com/x' }
    },
    parseWebhook(raw, sig) {
      if (sig !== 'good') throw new Error('bad signature')
      return JSON.parse(raw.toString('utf8'))
    },
    async retrieveSubscription() {
      return sub()
    },
    async cancelNow() {},
  }
}

function row(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    householdId: 'h1',
    userId: 'u1',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    plan: 'esencial',
    period: 'mensual',
    status: 'active',
    currentPeriodEnd: new Date('2027-03-10T10:00:00Z'),
    trialEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    founderPrice: false,
    ...over,
  }
}

describe('cancellation reason (PRO-386)', () => {
  it('keeps the reason and the portal category, never the free comment (D-094)', () => {
    const r = rowFromStripeSubscription(
      stripeSub({
        cancel_at_period_end: true,
        canceled_at: 1_799_000_000,
        cancellation_details: { comment: 'Mi hija ya no vive en casa', feedback: 'too_expensive', reason: 'cancellation_requested' },
      }),
    )!
    expect(r).toMatchObject({ cancelReason: 'cancellation_requested', cancelFeedback: 'too_expensive', cancelAtPeriodEnd: true })
    expect(JSON.stringify(r)).not.toContain('Mi hija')
  })

  it('a subscription without cancellation_details (older payloads) has no reason', () => {
    const r = rowFromStripeSubscription(stripeSub({ cancellation_details: undefined }))!
    expect(r.cancelReason).toBeNull()
    expect(r.cancelFeedback).toBeNull()
  })

  it.each(['customer.subscription.updated', 'customer.subscription.deleted'])('%s saves it', async (type) => {
    const repo = memoryRepo()
    const sub = stripeSub({
      status: type.endsWith('deleted') ? 'canceled' : 'active',
      cancellation_details: { comment: 'secreto', feedback: 'unused', reason: 'cancellation_requested' },
    })
    expect(await handleBillingEvent(subEvent(type, sub), { repo, gateway: gatewayReturning(() => sub) })).toBe('saved')
    expect(repo.rows[0]).toMatchObject({ cancelReason: 'cancellation_requested', cancelFeedback: 'unused' })
  })
})

describe('invoice.payment_failed (PRO-386)', () => {
  it('reads the subscription off the invoice (new parent field and the old one)', () => {
    expect(invoiceSubscriptionId((paymentFailedEvent().data.object as Stripe.Invoice))).toBe('sub_1')
    expect(invoiceSubscriptionId({ id: 'in_old', subscription: 'sub_old' } as unknown as Stripe.Invoice)).toBe('sub_old')
    expect(invoiceSubscriptionId({ id: 'in_x', parent: null } as unknown as Stripe.Invoice)).toBeNull()
  })

  it('saves the subscription (now past_due) and hands the invoice to the notifier', async () => {
    const repo = memoryRepo()
    const seen: PaymentFailure[] = []
    const out = await handleBillingEvent(paymentFailedEvent('in_7'), {
      repo,
      gateway: gatewayReturning(() => stripeSub({ status: 'past_due' })),
      onPaymentFailed: async (f) => {
        seen.push(f)
      },
    })
    expect(out).toBe('saved')
    expect(repo.rows[0].status).toBe('past_due')
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ invoiceId: 'in_7', row: { stripeSubscriptionId: 'sub_1', householdId: 'h1', userId: 'u1' } })
  })

  it('an invoice that is not a subscription one is ignored', async () => {
    const seen: PaymentFailure[] = []
    const ev = { ...paymentFailedEvent(), data: { object: { id: 'in_2', object: 'invoice', parent: null } } } as unknown as Stripe.Event
    const out = await handleBillingEvent(ev, { repo: memoryRepo(), gateway: gatewayReturning(() => stripeSub()), onPaymentFailed: async (f) => void seen.push(f) })
    expect(out).toBe('ignored')
    expect(seen).toHaveLength(0)
  })

  it('a subscription that is not ours: no notice', async () => {
    const seen: PaymentFailure[] = []
    const out = await handleBillingEvent(paymentFailedEvent(), {
      repo: memoryRepo(),
      gateway: gatewayReturning(() => stripeSub({ metadata: {} })),
      onPaymentFailed: async (f) => void seen.push(f),
    })
    expect(out).toBe('ignored')
    expect(seen).toHaveLength(0)
  })
})

function memoryFailures(emails: Record<string, string> = { u1: 'ana@example.com' }): PaymentFailureRepo & {
  notices: Map<string, { at: Date | null; channel: string | null }>
} {
  const notices = new Map<string, { at: Date | null; channel: string | null }>()
  return {
    notices,
    async claim(f, at) {
      const n = notices.get(f.invoiceId) ?? { at: null, channel: null }
      notices.set(f.invoiceId, n)
      if (n.at) return false
      n.at = at
      return true
    },
    async mark(id, channel) {
      notices.get(id)!.channel = channel
    },
    async unclaim(id) {
      notices.set(id, { at: null, channel: null })
    },
    async emailOf(userId) {
      return emails[userId] ?? null
    },
  }
}

function notifyDeps(over: { whatsapp?: 'ok' | 'skipped'; email?: 'sent' | 'skipped' } = {}) {
  const repo = memoryFailures()
  const whatsapps: string[] = []
  const emails: EmailMessage[] = []
  const deps: PaymentFailureDeps = {
    repo,
    async sendWhatsApp(_u, text) {
      if ((over.whatsapp ?? 'ok') !== 'ok') return { status: 'skipped', error: 'outside-24h-window' }
      whatsapps.push(text)
      return { status: 'ok' }
    },
    async sendEmail(m) {
      if ((over.email ?? 'sent') !== 'sent') return { status: 'skipped' }
      emails.push(m)
      return { status: 'sent' }
    },
    publicUrl: 'https://mimoia.com/',
    now: () => AFTER_LAUNCH,
  }
  return { deps, repo, whatsapps, emails }
}

const failure = (invoiceId = 'in_1'): PaymentFailure => ({ invoiceId, row: row({ status: 'past_due' }) })

describe('the failed-payment notice (PRO-386)', () => {
  it('is its own kind, priority 1', () => {
    expect(noticePriority('payment_failed')).toBe(1)
  })

  it('goes by WhatsApp with the steps and the link to change the card, and only once per invoice', async () => {
    const { deps, repo, whatsapps, emails } = notifyDeps()
    expect(await notifyPaymentFailed(failure(), deps)).toBe('whatsapp')
    // Stripe retries the same invoice: another `invoice.payment_failed`, no second notice.
    expect(await notifyPaymentFailed(failure(), deps)).toBe('already')
    expect(await notifyPaymentFailed(failure(), deps)).toBe('already')
    expect(whatsapps).toHaveLength(1)
    expect(emails).toHaveLength(0)
    expect(repo.notices.get('in_1')).toMatchObject({ channel: 'whatsapp' })
    expect(whatsapps[0]).toContain('no ha pasado')
    expect(whatsapps[0]).toContain('https://mimoia.com/profile/suscripcion?tarjeta=1')
    expect(whatsapps[0]).toContain('«Cambiar la tarjeta»')
    expect(whatsapps[0]).toContain(`${PAST_DUE_GRACE_DAYS} días`)
  })

  it('a new invoice that fails gets its own notice', async () => {
    const { deps, whatsapps } = notifyDeps()
    await notifyPaymentFailed(failure('in_1'), deps)
    expect(await notifyPaymentFailed(failure('in_2'), deps)).toBe('whatsapp')
    expect(whatsapps).toHaveLength(2)
  })

  it('outside the WhatsApp window: by email, never both', async () => {
    const { deps, emails, whatsapps, repo } = notifyDeps({ whatsapp: 'skipped' })
    expect(await notifyPaymentFailed(failure(), deps)).toBe('email')
    expect(whatsapps).toHaveLength(0)
    expect(emails).toHaveLength(1)
    expect(emails[0].to).toBe('ana@example.com')
    expect(emails[0].subject).toBe('El pago de Mimoia no ha pasado')
    expect(emails[0].html).toContain('https://mimoia.com/profile/suscripcion?tarjeta=1')
    expect(repo.notices.get('in_1')).toMatchObject({ channel: 'email' })
  })

  it('neither channel got it out: the next retry of the invoice tries again', async () => {
    const first = notifyDeps({ whatsapp: 'skipped', email: 'skipped' })
    expect(await notifyPaymentFailed(failure(), first.deps)).toBe('not-sent')
    expect(first.repo.notices.get('in_1')?.at).toBeNull()
    const retry: PaymentFailureDeps = { ...first.deps, sendWhatsApp: async () => ({ status: 'ok' }) }
    expect(await notifyPaymentFailed(failure(), retry)).toBe('whatsapp')
  })

  it('a payer who deleted their account: kept as a failure, no message', async () => {
    const { deps, whatsapps, emails } = notifyDeps()
    expect(await notifyPaymentFailed({ invoiceId: 'in_9', row: row({ status: 'past_due', userId: null }) }, deps)).toBe('no-payer')
    expect(whatsapps.length + emails.length).toBe(0)
  })

  it('the copy says the plan and the 7 days', () => {
    expect(paymentFailedWhatsApp({ plan: 'plus', publicUrl: 'https://mimoia.com' })).toContain('Mimoia Plus')
    expect(paymentFailedEmail({ email: 'a@b.c', plan: 'esencial', publicUrl: 'https://mimoia.com' }).text).toContain('7 días')
    expect(changeCardUrl('https://mimoia.com///')).toBe('https://mimoia.com/profile/suscripcion?tarjeta=1')
  })

  it('end to end through the signed webhook: saved and noticed once', async () => {
    const repo = memoryRepo()
    const seen: string[] = []
    const app = express()
    app.use(
      createBillingWebhookRouter({
        repo,
        gateway: gatewayReturning(() => stripeSub({ status: 'past_due' })),
        enabled: () => true,
        onPaymentFailed: async (f) => void seen.push(f.invoiceId),
      }),
    )
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })
    servers.push(server)
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/billing/webhook`
    const r = await fetch(url, { method: 'POST', headers: { 'stripe-signature': 'good' }, body: JSON.stringify(paymentFailedEvent('in_42')) })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ received: true, outcome: 'saved' })
    expect(repo.rows[0].status).toBe('past_due')
    expect(seen).toEqual(['in_42'])
  })
})

const servers: Server[] = []
afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

describe('7 days past_due → the plan stops counting (PRO-386)', () => {
  const since = new Date(AFTER_LAUNCH.getTime() - 3 * DAY)

  it('hasPaidAccess: past_due keeps the plan for 7 days', () => {
    expect(hasPaidAccess('past_due', since, AFTER_LAUNCH)).toBe(true)
    expect(hasPaidAccess('past_due', since, new Date(since.getTime() + 7 * DAY - 1))).toBe(true)
    expect(hasPaidAccess('past_due', since, new Date(since.getTime() + 7 * DAY))).toBe(false)
    // A row from before `past_due_since` existed still counts.
    expect(hasPaidAccess('past_due', null, AFTER_LAUNCH)).toBe(true)
    expect(hasPaidAccess('active', since, AFTER_LAUNCH)).toBe(true)
    expect(hasPaidAccess('unpaid', null, AFTER_LAUNCH)).toBe(false)
    expect(hasPaidAccess(null, null, AFTER_LAUNCH)).toBe(false)
    expect(paymentDueBy('past_due', since)?.toISOString()).toBe(new Date(since.getTime() + 7 * DAY).toISOString())
    expect(paymentDueBy('active', since)).toBeNull()
  })

  it('GET /billing: subscribed with the due date during the 7 days, not subscribed after', () => {
    const opts = { enabled: true, canManage: true, householdCreatedAt: HOUSEHOLD_CREATED }
    const r = row({ status: 'past_due', pastDueSince: since })
    const during = billingStateFor(r, { ...opts, now: AFTER_LAUNCH })
    expect(during.access.state).toBe('subscribed')
    expect(during.subscription).toMatchObject({ status: 'past_due', paymentDueBy: new Date(since.getTime() + 7 * DAY).toISOString() })
    const after = billingStateFor(r, { ...opts, now: new Date(since.getTime() + 8 * DAY) })
    // Until PRO-385 (plan Gratis) lands, «no plan» after the trial is the pause.
    expect(after.access.state).toBe('paused')
    // The subscription is still there (live), so the card can lead to the portal.
    expect(after.subscription?.status).toBe('past_due')
    expect(billingStateFor(row({ status: 'active' }), { ...opts, now: AFTER_LAUNCH }).subscription?.paymentDueBy).toBeNull()
  })

  it('paying again (active) gives it back at once', () => {
    const opts = { enabled: true, canManage: true, householdCreatedAt: HOUSEHOLD_CREATED, now: new Date(since.getTime() + 9 * DAY) }
    expect(billingStateFor(row({ status: 'active', pastDueSince: null }), opts).access.state).toBe('subscribed')
  })

  it('the account guard reads it too (accessForUser)', async () => {
    const facts = (f: Partial<AccessFacts>) => async () => ({ householdCreatedAt: HOUSEHOLD_CREATED, latestStatus: null, ...f })
    expect((await accessForUser('u1', AFTER_LAUNCH, facts({ latestStatus: 'past_due', pastDueSince: since }))).state).toBe('subscribed')
    expect((await accessForUser('u1', new Date(since.getTime() + 8 * DAY), facts({ latestStatus: 'past_due', pastDueSince: since }))).state).toBe('paused')
  })
})

describe('counts for the growth report (PRO-379)', () => {
  it('tallies by category, null as «sin_motivo»', () => {
    expect(tallyBy([
      { key: 'too_expensive', n: 2 },
      { key: null, n: 1 },
      { key: 'too_expensive', n: 1 },
      { key: 'unused', n: 4 },
    ])).toEqual({ too_expensive: 3, sin_motivo: 1, unused: 4 })
  })
})
