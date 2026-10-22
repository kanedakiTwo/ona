/**
 * Smoke (real API + Postgres) for Mimo's ficha routes (PRO-319): «apunta
 * que…» as the user on the web and on WhatsApp (the `x-mimoia-channel` header
 * Mimo's loopback calls carry), «proteína en cada plato» on the person who
 * says it, nothing about health from WhatsApp, lists that add up, and the
 * pending question at most once a week per person and on WhatsApp only inside
 * the 24 h window.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/fichaMimo.smoke.ts
 *
 * Registers its own users (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { profileChanges, profileFacts, profileQuestions, userMemories, users } from '../db/schema.js'

async function call(method: string, path: string, token?: string, body?: unknown, channel?: 'whatsapp' | 'web') {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(channel ? { 'x-mimoia-channel': channel } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: r.status, json }
}

async function register(tag: string) {
  const name = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const r = await call('POST', '/register', undefined, { username: name, email: `${name}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(r.status).toBeLessThan(300)
  return { token: r.json.token as string, id: r.json.user.id as string, name }
}

describe.skipIf(!reachable)('Mimo and the ficha (PRO-319)', () => {
  it('apunta que, protein in every dish, no health from WhatsApp, the weekly question', async () => {
    const a = await register('fmimo_a')
    const b = await register('fmimo_b')
    const invite = await call('POST', '/households/me/invites', a.token, {})
    expect(invite.status).toBe(201)
    expect((await call('POST', `/invites/${invite.json.token}/accept`, b.token)).status).toBe(200)
    const [ua] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, a.id))
    const householdId = ua.householdId!

    // «Quiero proteína en cada plato», said «for the house»: it lands on A.
    const protein = await call('POST', '/household/profile/facts', a.token, { type: 'protein_minimum', value: { scope: 'every_dish' }, about: 'household' }, 'whatsapp')
    expect(protein.status).toBe(201)
    const [pf] = await db.select().from(profileFacts).where(eq(profileFacts.id, protein.json.factId))
    expect(pf).toMatchObject({ householdId, subjectUserId: a.id, type: 'protein_minimum', origin: 'user', confidence: 1 })
    expect((pf.evidence as any[])[0].signal).toBe('whatsapp')
    const [added] = await db.select().from(profileChanges).where(and(eq(profileChanges.factId, pf.id), eq(profileChanges.action, 'fact_added')))
    expect(added).toMatchObject({ origin: 'user', actorUserId: a.id })

    // A fixed dish of the household, from the web.
    const pizza = await call('POST', '/household/profile/facts', a.token, { type: 'fixed_dish', value: { dish: 'pizza', days: ['viernes'], meal: 'dinner' }, about: 'household' }, 'web')
    expect(pizza.status).toBe(201)
    expect(pizza.json.sentence).toMatch(/pizza/i)
    const view = await call('GET', '/household/profile', b.token)
    expect(view.json.facts.some((f: any) => f.id === pizza.json.factId)).toBe(true)

    // Lists add up, and the memory mirror follows.
    expect((await call('POST', '/household/profile/facts', a.token, { type: 'dislikes', value: ['cilantro'], about: 'me' }, 'web')).status).toBe(201)
    expect((await call('POST', '/household/profile/facts', a.token, { type: 'dislikes', value: ['apio'], about: 'me' }, 'whatsapp')).status).toBe(200)
    const [mem] = await db.select().from(userMemories).where(and(eq(userMemories.userId, a.id), eq(userMemories.key, 'dislikes')))
    expect(mem.value).toEqual(['cilantro', 'apio'])

    // Nothing about health from WhatsApp, even with the consent.
    expect((await call('POST', `/user/${a.id}/health-consent`, a.token, { consent: true })).status).toBe(200)
    const health = await call('POST', '/household/profile/facts', a.token, { type: 'restrictions', value: ['sin gluten'], about: 'me' }, 'whatsapp')
    expect(health.status).toBe(403)
    expect(health.json.code).toBe('HEALTH_FROM_WHATSAPP')
    const note = await call('POST', '/household/profile/facts', a.token, { type: 'notes', value: ['Soy celíaca'], about: 'me' }, 'whatsapp')
    expect(note.status).toBe(403)
    const restrictions = await db.select().from(profileFacts).where(and(eq(profileFacts.householdId, householdId), eq(profileFacts.type, 'restrictions')))
    expect(restrictions).toHaveLength(0)
    // On the web, with the consent, it goes in.
    expect((await call('POST', '/household/profile/facts', a.token, { type: 'restrictions', value: ['sin gluten'], about: 'me' }, 'web')).status).toBe(201)
    // A bad value is refused with the reason.
    expect((await call('POST', '/household/profile/facts', a.token, { type: 'novelty', value: { score: 7 }, about: 'household' })).status).toBe(422)

    // The pending question: one a week per person; WhatsApp only in its window.
    await db.insert(profileQuestions).values({ householdId, question: '¿Seguís pidiendo pizza los viernes?', factType: 'fixed_dish', origin: 'ai_nightly' })
    const first = await call('POST', '/household/profile/question/ask', a.token, undefined, 'web')
    expect(first.status).toBe(200)
    expect(first.json).toMatchObject({ reason: 'asked', question: { question: '¿Seguís pidiendo pizza los viernes?' } })
    expect((await call('POST', '/household/profile/question/ask', a.token, undefined, 'whatsapp')).json).toEqual({ question: null, reason: 'outside_window' })
    expect((await call('POST', '/household/profile/question/ask', a.token, undefined, 'web')).json).toEqual({ question: null, reason: 'weekly_cap' })
    // B has no WhatsApp: outside the window; on the web, B's own week.
    expect((await call('POST', '/household/profile/question/ask', b.token, undefined, 'whatsapp')).json.reason).toBe('outside_window')
    expect((await call('POST', '/household/profile/question/ask', b.token, undefined, 'web')).json.reason).toBe('asked')
    const asked = await db.select().from(profileChanges).where(and(eq(profileChanges.householdId, householdId), eq(profileChanges.action, 'question_asked')))
    expect(asked.map((r) => r.actorUserId).sort()).toEqual([a.id, b.id].sort())
    // «Sí» through the screen's route confirms the fixed dish.
    expect((await call('POST', `/household/profile/questions/${first.json.question.id}`, a.token, { answer: 'yes' })).status).toBe(200)

    // B can't forget A's protein (it's A's).
    expect((await call('DELETE', `/household/profile/facts/${pf.id}`, b.token)).status).toBe(403)
  })
})
