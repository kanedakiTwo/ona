/**
 * Smoke (real API + Postgres) for PRO-386 (D-158, piece 7):
 *   - `subscriptions.past_due_since` starts on the first `past_due`, stays on
 *     the next ones and clears on any other status;
 *   - the account check reads it: 8 days `past_due` → no paid access;
 *   - `payment_failures` claims the notice once per invoice;
 *   - `churnCounts` counts cancellations by category and failed payments.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/paymentFailures.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { paymentFailures, subscriptions, users } from '../db/schema.js'
import { loadAccessFacts } from '../services/accountAccess.js'
import { createDbSubscriptionRepo, type SubscriptionRow } from '../services/billing.js'
import { churnCounts, createDbPaymentFailureRepo } from '../services/paymentFailures.js'
import { hasPaidAccess } from '@ona/shared'

const tag = `pf${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const DAY = 24 * 60 * 60 * 1000

async function register() {
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: tag, email: `${tag}@test.local`, password: 'e2epass123', ageConfirmed: true }),
  })
  const body = await r.json()
  expect(r.status, JSON.stringify(body)).toBe(201)
  const [u] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, body.user.id))
  return { userId: body.user.id as string, householdId: u.householdId! }
}

describe.skipIf(!reachable)('payment failures and cancellation reasons (PRO-386)', () => {
  it('past_due_since, the access check, one notice per invoice and the counts', async () => {
    const start = new Date(Date.now() - 1000)
    const { userId, householdId } = await register()
    const repo = createDbSubscriptionRepo()
    const subId = `sub_${tag}`
    const base: SubscriptionRow = {
      householdId,
      userId,
      stripeCustomerId: `cus_${tag}`,
      stripeSubscriptionId: subId,
      plan: 'esencial',
      period: 'mensual',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * DAY),
      trialEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      founderPrice: false,
    }
    const since = async () => (await db.select({ s: subscriptions.pastDueSince }).from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId)))[0].s

    await repo.upsert(base)
    expect(await since()).toBeNull()

    const firstFail = new Date(Date.now() - 8 * DAY)
    await repo.upsert({ ...base, status: 'past_due', pastDueSince: firstFail })
    expect((await since())?.toISOString()).toBe(firstFail.toISOString())
    // A later `past_due` (another webhook) keeps the first date.
    await repo.upsert({ ...base, status: 'past_due' })
    expect((await since())?.toISOString()).toBe(firstFail.toISOString())

    const facts = await loadAccessFacts(userId)
    expect(facts).toMatchObject({ latestStatus: 'past_due' })
    expect(hasPaidAccess(facts!.latestStatus, facts!.pastDueSince, new Date())).toBe(false)

    // Paid again: cleared.
    await repo.upsert({ ...base, status: 'active' })
    expect(await since()).toBeNull()

    const failures = createDbPaymentFailureRepo()
    const f = { invoiceId: `in_${tag}`, subscriptionId: subId, householdId }
    expect(await failures.claim(f, new Date())).toBe(true)
    expect(await failures.claim(f, new Date())).toBe(false)
    await failures.unclaim(f.invoiceId)
    expect(await failures.claim(f, new Date())).toBe(true)
    await failures.mark(f.invoiceId, 'email')
    const rows = await db.select().from(paymentFailures).where(eq(paymentFailures.stripeInvoiceId, f.invoiceId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ noticeChannel: 'email', householdId })
    expect(await failures.emailOf(userId)).toBe(`${tag}@test.local`)

    // Cancelled from the portal with a category.
    await repo.upsert({ ...base, status: 'canceled', canceledAt: new Date(), cancelReason: 'cancellation_requested', cancelFeedback: 'too_expensive' })
    const [saved] = await db.select().from(subscriptions).where(eq(subscriptions.stripeSubscriptionId, subId))
    expect(saved).toMatchObject({ cancelReason: 'cancellation_requested', cancelFeedback: 'too_expensive' })

    const counts = await churnCounts({ from: start, to: new Date(Date.now() + 60_000) })
    expect(counts.cancellations.byFeedback.too_expensive).toBeGreaterThanOrEqual(1)
    expect(counts.cancellations.byReason.cancellation_requested).toBeGreaterThanOrEqual(1)
    expect(counts.paymentFailures.invoices).toBeGreaterThanOrEqual(1)
    expect(counts.paymentFailures.households).toBeGreaterThanOrEqual(1)
  })
})
