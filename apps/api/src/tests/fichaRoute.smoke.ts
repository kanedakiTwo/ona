/**
 * Smoke (real API + Postgres) for «Tu ficha» (PRO-317, D-110): two adults in
 * one household read the ficha, each sees their own health only, ask
 * «¿Por qué lo sé?», confirm, correct, forget (the memory mirror follows),
 * undo what Mimo did, answer the pending question, pause the learning, add
 * and remove a person without an account, and download it.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/fichaRoute.smoke.ts
 *
 * Registers its own users (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdProfiles, profileChanges, profileFacts, profileQuestions, userMemories, users } from '../db/schema.js'

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: r.status, json, headers: r.headers }
}

async function register(tag: string) {
  const name = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const r = await call('POST', '/register', undefined, { username: name, email: `${name}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(r.status).toBeLessThan(300)
  return { token: r.json.token as string, id: r.json.user.id as string, name }
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

describe.skipIf(!reachable)('«Tu ficha» (PRO-317)', () => {
  it('two adults: read, health only to its owner, why, confirm, correct, forget, undo, answer, pause, people, export', async () => {
    const a = await register('ficha_a')
    const b = await register('ficha_b')
    const invite = await call('POST', '/households/me/invites', a.token, {})
    expect(invite.status).toBe(201)
    expect((await call('POST', `/invites/${invite.json.token}/accept`, b.token)).status).toBe(200)
    const [ua] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, a.id))
    const householdId = ua.householdId!

    // What each one said (lands in the ficha through the memory, PRO-316).
    expect((await call('POST', `/user/${a.id}/health-consent`, a.token, { consent: true })).status).toBe(200)
    expect((await call('PATCH', '/memory', a.token, { facts: [
      { key: 'dislikes', value: ['cilantro'] },
      { key: 'restrictions', value: ['sin lactosa'] },
      { key: 'equipment', value: ['horno', 'olla exprés'] },
    ] })).status).toBe(200)
    expect((await call('PATCH', '/memory', b.token, { key: 'dislikes', value: ['ajo'] })).status).toBe(200)

    // What Mimo deduced, the portrait and a pending question.
    const [pizza] = await db.insert(profileFacts).values({ householdId, type: 'fixed_dish', value: { dish: 'pizza', days: ['viernes'], meal: 'dinner' }, origin: 'ai_nightly', confidence: 0.9,
      evidence: [{ signal: 'menu', date: today(), summary: 'Pidió pizza tres viernes seguidos' }] }).returning()
    await db.insert(profileChanges).values({ householdId, factId: pizza.id, action: 'fact_added', factType: 'fixed_dish', before: null, after: { value: pizza.value, confidence: 0.9 }, reason: 'Señales', origin: 'ai_nightly' })
    const [cuchara] = await db.insert(profileFacts).values({ householdId, type: 'affinity', value: { kind: 'style', target: 'la cuchara', score: 2 }, origin: 'ai_nightly', confidence: 0.7,
      evidence: [{ signal: 'verdict', date: today(), summary: 'Le encantaron tres guisos' }] }).returning()
    const [cucharaAdded] = await db.insert(profileChanges).values({ householdId, factId: cuchara.id, action: 'fact_added', factType: 'affinity', before: null, after: { value: cuchara.value, confidence: 0.7 }, reason: 'Señales', origin: 'ai_nightly' }).returning()
    const [horno] = await db.insert(profileFacts).values({ householdId, type: 'temporary_situation', value: { description: 'Sin horno hasta nuevo aviso' }, origin: 'ai_nightly', confidence: 0.8,
      evidence: [{ signal: 'chat', date: today(), summary: 'Dijo que el horno se ha roto' }] }).returning()
    await db.insert(householdProfiles).values({ householdId, portrait: 'En tu casa se come de cuchara y rápido entre semana.', version: 1, model: 'test' })
    const [question] = await db.insert(profileQuestions).values({ householdId, question: '¿Seguís sin horno?', factType: 'temporary_situation', origin: 'ai_nightly' }).returning()

    // A reads it.
    const viewA = await call('GET', '/household/profile', a.token)
    expect(viewA.status).toBe(200)
    expect(viewA.json.people.map((p: any) => p.label)).toEqual(['La casa', 'Tú', b.name])
    const byText = (v: any, s: string) => v.facts.find((f: any) => f.sentence === s)
    expect(byText(viewA.json, 'No te gusta cilantro')).toMatchObject({ origin: 'tu', originLabel: 'Lo dijiste tú', canEdit: true, topic: 'gustos' })
    expect(byText(viewA.json, 'Sin lactosa')).toMatchObject({ health: true, topic: 'salud' })
    expect(byText(viewA.json, 'No le gusta ajo')).toMatchObject({ canEdit: false, subjectKey: `u:${b.id}` })
    expect(byText(viewA.json, 'Pizza los viernes en la cena')).toMatchObject({ origin: 'deducido', originLabel: 'Lo he deducido', subjectKey: 'casa' })
    expect(viewA.json.portrait.text).toMatch(/cuchara/)
    expect(viewA.json.question).toMatchObject({ id: question.id, question: '¿Seguís sin horno?', factId: horno.id })
    expect(viewA.json.recent.some((c: any) => c.verb === 'He apuntado' && c.canUndo)).toBe(true)

    // B never sees A's health.
    const viewB = await call('GET', '/household/profile', b.token)
    expect(viewB.status).toBe(200)
    expect(byText(viewB.json, 'Sin lactosa')).toBeUndefined()
    expect(byText(viewB.json, 'No te gusta ajo')).toBeTruthy()
    const restrictionsA = viewA.json.facts.find((f: any) => f.sentence === 'Sin lactosa').id
    expect((await call('GET', `/household/profile/facts/${restrictionsA}/why`, b.token)).status).toBe(404)

    // «¿Por qué lo sé?»
    const why = await call('GET', `/household/profile/facts/${pizza.id}/why`, a.token)
    expect(why.status).toBe(200)
    expect(why.json).toMatchObject({ confidence: 'Casi seguro', evidence: [{ text: 'Pidió pizza tres viernes seguidos' }] })
    expect(why.json.howIUse).toMatch(/Mimo/)

    // «Así es» on Mimo's pizza: it becomes A's. B's dislikes are B's: A can't touch them.
    expect((await call('POST', `/household/profile/facts/${pizza.id}/confirm`, a.token)).status).toBe(200)
    const [confirmed] = await db.select().from(profileFacts).where(eq(profileFacts.id, pizza.id))
    expect(confirmed).toMatchObject({ origin: 'user', confidence: 1 })
    const dislikesB = viewA.json.facts.find((f: any) => f.sentence === 'No le gusta ajo').id
    expect((await call('POST', `/household/profile/facts/${dislikesB}/confirm`, a.token)).status).toBe(403)

    // «Corregir» A's dislikes (a value, or a note when no model answers): it changes, as A's.
    const dislikesA = viewA.json.facts.find((f: any) => f.sentence === 'No te gusta cilantro').id
    const corrected = await call('POST', `/household/profile/facts/${dislikesA}/correct`, a.token, { text: 'El cilantro y también el hígado' })
    expect(corrected.status).toBe(200)
    expect(['value', 'note']).toContain(corrected.json.kind)

    // «Olvidar» the household's equipment: the memory mirror of both adults follows.
    const equipment = viewA.json.facts.find((f: any) => f.type === 'equipment').id
    expect((await call('DELETE', `/household/profile/facts/${equipment}`, a.token)).status).toBe(204)
    const mem = await db.select().from(userMemories).where(and(eq(userMemories.userId, a.id), eq(userMemories.key, 'equipment')))
    expect(mem).toHaveLength(0)

    // «Deshacer» what Mimo added.
    expect((await call('POST', `/household/profile/changes/${cucharaAdded.id}/undo`, a.token)).status).toBe(200)
    expect((await db.select({ status: profileFacts.status }).from(profileFacts).where(eq(profileFacts.id, cuchara.id)))[0].status).toBe('retired')
    expect((await call('POST', `/household/profile/changes/${cucharaAdded.id}/undo`, a.token)).status).toBe(409)

    // The pending question: «Sí» keeps «Sin horno» as theirs.
    expect((await call('POST', `/household/profile/questions/${question.id}`, a.token, { answer: 'yes' })).status).toBe(200)
    expect((await db.select().from(profileQuestions).where(eq(profileQuestions.id, question.id)))[0]).toMatchObject({ status: 'answered', answer: 'yes', answeredByUserId: a.id })
    expect((await db.select({ origin: profileFacts.origin }).from(profileFacts).where(eq(profileFacts.id, horno.id)))[0].origin).toBe('user')

    // «Aprender de lo que hago», per person.
    expect((await call('PUT', '/household/profile/learning', a.token, { paused: true })).json).toEqual({ paused: true })
    expect((await call('GET', '/household/profile', a.token)).json.learningPaused).toBe(true)
    expect((await call('GET', '/household/profile', b.token)).json.learningPaused).toBe(false)

    // People without an account: a minor only with a generic alias.
    expect((await call('POST', '/household/profile/persons', a.token, { alias: 'Lucía', ageBand: '3-5' })).status).toBe(422)
    const kid = await call('POST', '/household/profile/persons', a.token, { alias: 'el pequeño', ageBand: '6-12' })
    expect(kid.status).toBe(201)
    expect((await call('GET', '/household/profile', b.token)).json.people.map((p: any) => p.label)).toContain('El pequeño')
    expect((await call('PATCH', `/household/profile/persons/${kid.json.id}`, a.token, { alias: 'el mayor', ageBand: '6-12' })).status).toBe(200)
    expect((await call('DELETE', `/household/profile/persons/${kid.json.id}`, a.token)).status).toBe(204)

    // «Descargar mi ficha»: A's has A's health, B's doesn't.
    const exportA = await call('GET', '/household/profile/export', a.token)
    expect(exportA.status).toBe(200)
    expect(exportA.headers.get('content-disposition')).toMatch(/attachment; filename="mi-ficha-mimoia-/)
    expect(exportA.json.facts.some((f: any) => f.type === 'restrictions')).toBe(true)
    const exportB = await call('GET', '/household/profile/export', b.token)
    expect(exportB.json.facts.some((f: any) => f.type === 'restrictions')).toBe(false)
  }, 60_000)
})
