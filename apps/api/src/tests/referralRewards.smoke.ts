/**
 * Smoke (real API + Postgres) for PRO-165: a household invited with
 * «Invitar a otro hogar» that resolves a week in its 3rd week leaves ONE
 * pending reward, and GET /admin/usage counts it (specs/metrics.md).
 *
 *   API_URL=… DATABASE_URL=… METRICS_READ_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/referralRewards.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { referralRewards, users } from '../db/schema.js'
import { recordPendingReferralRewards } from '../services/referralRewards.js'

const METRICS_TOKEN = process.env.METRICS_READ_TOKEN ?? ''
const tag = `rw${Date.now()}${Math.random().toString(36).slice(2, 6)}`
let inviteeId = ''

async function call(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function register(i: number, extra: Record<string, unknown> = {}) {
  const u = `${tag}${i}`
  const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true, ...extra })
  expect(reg.status, JSON.stringify(reg.body)).toBe(201)
  return { id: reg.body.user.id as string, token: reg.body.token as string }
}

afterAll(async () => {
  if (reachable && inviteeId) await db.delete(referralRewards).where(eq(referralRewards.inviteeUserId, inviteeId))
})

describe.skipIf(!reachable || !METRICS_TOKEN)('referral rewards (PRO-165)', () => {
  it('week 3 resolved → one pending reward per pair, counted in /admin/usage', async () => {
    const ana = await register(1)
    const code = (await call('GET', '/referrals/me', undefined, { Authorization: `Bearer ${ana.token}` })).body.code
    const bea = await register(2, { invitedBy: code })
    inviteeId = bea.id

    // Bea signed up 16 days ago and, two days ago, generated a menu and opened the list.
    await db.execute(sql`UPDATE users SET created_at = now() - interval '16 days' WHERE id = ${bea.id}::uuid`)
    const [row] = await db.select({ household: users.primaryHouseholdId }).from(users).where(eq(users.id, bea.id))
    for (const name of ['menu_generated', 'shopping_list_viewed']) {
      await db.execute(sql`
        INSERT INTO usage_events (user_id, household_id, name, channel, created_at)
        VALUES (${bea.id}::uuid, ${row.household}::uuid, ${name}, 'web', now() - interval '1 day')
      `)
    }

    await recordPendingReferralRewards(db)
    await recordPendingReferralRewards(db)
    const rewards = await db
      .select({ status: referralRewards.status, inviterUserId: referralRewards.inviterUserId })
      .from(referralRewards)
      .where(and(eq(referralRewards.inviteeUserId, bea.id), eq(referralRewards.inviterCode, code)))
    expect(rewards).toEqual([{ status: 'pendiente', inviterUserId: ana.id }])

    const usage = await call('GET', '/admin/usage?days=28', undefined, { 'x-metrics-token': METRICS_TOKEN })
    expect(usage.status).toBe(200)
    const total = (usage.body.referrals as any[]).reduce((n, w) => n + w.week3Resolved, 0)
    expect(total).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(usage.body.referrals)).not.toContain(code)
  }, 30_000)
})
