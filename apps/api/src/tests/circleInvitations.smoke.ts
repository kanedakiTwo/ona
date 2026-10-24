/**
 * Smoke (real API + Postgres) for PRO-1017 (D-129, D-132 point 2): a
 * household that entered by Miguel's circle invites another one with its
 * personal link; the guest comes out as «desconocido por invitación» in
 * GET /admin/metrics (`campaigns`) and GET /admin/waitlist (`invitations`),
 * and someone invited by a household outside the circle as `invita`.
 *
 *   API_URL=… DATABASE_URL=… METRICS_READ_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/circleInvitations.smoke.ts
 *
 * Needs REGISTRATION_MODE=open and METRICS_READ_TOKEN on the API (CI's smoke
 * job sets both); skips when the API isn't reachable.
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { inviteCampaigns, users } from '../db/schema.js'
import { loadCircleCodes } from '../services/circleInvitations.js'

/** The read-only header of the metrics routes, from CI's smoke job (empty → the test does nothing). */
function readHeaders(): Record<string, string> | null {
  const value = process.env.METRICS_READ_TOKEN
  return value ? { 'x-metrics-token': value } : null
}
const tag = `circ${Date.now()}${Math.random().toString(36).slice(2, 6)}`

async function call(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

let n = 0
async function register(extra: Record<string, unknown> = {}) {
  const u = `${tag}${++n}`
  const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true, ...extra })
  expect(reg.status, JSON.stringify(reg.body)).toBe(201)
  const id = reg.body.user.id as string
  const me = await call('GET', '/referrals/me', undefined, { Authorization: `Bearer ${reg.body.token}` })
  expect(me.status).toBe(200)
  return { id, code: me.body.code as string }
}

function waitlist(referredByCode: string) {
  return call('POST', '/waitlist', {
    email: `${tag}${++n}@test.local`,
    firstName: 'Smoke',
    householdSize: '2',
    plannerRole: 'yo',
    currentMethod: 'lista',
    platform: 'ios',
    supermarket: null,
    wantsWhatsapp: false,
    newsletterOptIn: false,
    consent: true,
    website: '',
    source: 'invita',
    referredByCode,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
  })
}

async function counts(headers: Record<string, string>) {
  const m = await call('GET', '/admin/metrics?weeks=2', undefined, headers)
  expect(m.status).toBe(200)
  const w = await call('GET', '/admin/waitlist', undefined, headers)
  expect(w.status).toBe(200)
  const signups = (origin: string) =>
    (m.body.campaigns as Array<{ origin: string; signups: number }>).filter((c) => c.origin === origin).reduce((s, c) => s + c.signups, 0)
  return {
    metrics: { desconocido: signups('desconocido-por-invitacion'), invita: signups('invita'), circulo: signups('circulo') },
    waitlist: { desconocido: w.body.invitations.desconocidoPorInvitacion.count as number, invita: w.body.invitations.invita.count as number },
    text: JSON.stringify([m.body.campaigns, w.body]),
  }
}

describe.skipIf(!reachable)('«desconocido por invitación» (PRO-1017)', () => {
  it('the guest of a circle household counts apart in both routes; the guest of another household is `invita`', async () => {
    const headers = readHeaders()
    if (!headers) return
    const before = await counts(headers)

    // A household that entered by the circle («colegio estudio», D-129) and one that didn't.
    const [campaign] = await db
      .insert(inviteCampaigns)
      .values({ name: 'colegio estudio', code: tag.slice(0, 24) })
      .returning({ id: inviteCampaigns.id })
    const circle = await register()
    await db.update(users).set({ inviteCampaignId: campaign.id }).where(eq(users.id, circle.id))
    const outsider = await register()

    const circleCodes = await loadCircleCodes(db)
    expect(circleCodes.has(circle.code)).toBe(true)
    expect(circleCodes.has(outsider.code)).toBe(false)

    // Each one invites a household to sign up and a person to the waitlist.
    await register({ invitedBy: circle.code })
    await register({ invitedBy: outsider.code })
    expect((await waitlist(circle.code)).status).toBe(200)
    expect((await waitlist(outsider.code)).status).toBe(200)

    const after = await counts(headers)
    expect(after.metrics.desconocido - before.metrics.desconocido).toBe(1)
    expect(after.metrics.invita - before.metrics.invita).toBe(1)
    expect(after.metrics.circulo - before.metrics.circulo).toBe(1)
    expect(after.waitlist.desconocido - before.waitlist.desconocido).toBe(1)
    expect(after.waitlist.invita - before.waitlist.invita).toBe(1)
    // Counts only: no codes or emails behind the token.
    for (const leak of [circle.code, outsider.code, tag]) expect(after.text).not.toContain(leak)
  }, 60_000)
})
