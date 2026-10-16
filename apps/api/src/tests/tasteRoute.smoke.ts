/**
 * Smoke test for «Afina tu menú» (PRO-146, specs/taste.md) against a running
 * API + Postgres with the seeded catalogue: the starter deck comes first,
 * verdicts are idempotent per recipe, `next` never repeats them, «No para mí»
 * with an ingredient lands in dislikes, the free text «no tengo horno» in the
 * equipment (rules: CI has no Anthropic key), the generated menu leaves the
 * «No para mí» recipe out, and the offers stamp once.
 *
 *   API_URL=http://localhost:8716 pnpm --filter @ona/api exec vitest run src/tests/tasteRoute.smoke.ts
 *
 * Needs REGISTRATION_MODE=open on that API (CI's smoke job sets it).
 */
import { describe, expect, it } from 'vitest'
import { TASTE_STARTER_DECK, type TasteNextResponse } from '@ona/shared'
import { API_URL, reachable } from './smokeEnv.js'

async function call(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: r.status, body }
}

async function freshUser() {
  const tag = `taste_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call('POST', '/register', { username: tag, email: `${tag}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const auth = { Authorization: `Bearer ${reg.body.token}` }
  const userId = reg.body.user.id as string
  // No favourite dishes any more: «Afina tu menú» replaced them.
  const onboarding = await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'varied' }, auth)
  expect(onboarding.status).toBe(200)
  return { auth, userId }
}

const deckNames = new Set(TASTE_STARTER_DECK.flatMap((r) => r.names).map((n) => n.normalize('NFD').replace(/\p{Diacritic}+/gu, '').toLowerCase()))
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}+/gu, '').toLowerCase()

describe.skipIf(!reachable)('«Afina tu menú» smoke', () => {
  it('deck, verdicts, memory and the menu', async () => {
    const { auth, userId } = await freshUser()

    const status0 = await call('GET', '/taste/status', undefined, auth)
    expect(status0.status).toBe(200)
    expect(status0.body).toMatchObject({ rated: 0, showIntro: true, showCard: false })
    expect(status0.body.total).toBeGreaterThanOrEqual(10)

    const first = await call('GET', '/taste/next?limit=10', undefined, auth)
    expect(first.status).toBe(200)
    const batch = first.body as TasteNextResponse
    expect(batch.source).toBe('starter')
    expect(batch.cards.length).toBe(10)
    // The starter deck leads (rows missing from this catalogue are filled by variety).
    expect(deckNames.has(norm(batch.cards[0].name))).toBe(true)
    expect(batch.cards[0].meta).toBeTruthy()

    const [a, b, c] = batch.cards
    const ingredient = a.mainIngredients[0]?.name ?? 'cilantro'
    const nope = await call('POST', '/taste', { recipeId: a.recipeId, verdict: 'nope', reason: { kind: 'ingredient', text: ingredient } }, auth)
    expect(nope.status).toBe(200)
    // Idempotent: the same recipe again replaces, never duplicates.
    expect((await call('POST', '/taste', { recipeId: a.recipeId, verdict: 'nope', reason: { kind: 'ingredient', text: ingredient } }, auth)).status).toBe(200)
    expect((await call('POST', '/taste', { recipeId: b.recipeId, verdict: 'love' }, auth)).status).toBe(200)
    const horno = await call('POST', '/taste', { recipeId: c.recipeId, verdict: 'nope', reason: { kind: 'other', text: 'no tengo horno' } }, auth)
    expect(horno.status).toBe(200)
    expect(horno.body.facts[0]).toMatchObject({ key: 'equipment', remove: ['horno'] })
    expect((await call('POST', '/taste', { recipeId: a.recipeId, verdict: 'bad' }, auth)).status).toBe(400)

    const verdicts = await call('GET', '/taste/verdicts', undefined, auth)
    expect(verdicts.body.verdicts).toHaveLength(3)

    const memory = await call('GET', '/memory', undefined, auth)
    expect(memory.body.dislikes.value).toContain(ingredient)
    expect(memory.body.equipment.value).not.toContain('horno')
    expect(memory.body.equipment.value.length).toBeGreaterThan(0)

    const next = await call('GET', `/taste/next?limit=10&exclude=${batch.cards.slice(3).map((x) => x.recipeId).join(',')}`, undefined, auth)
    const nextIds = (next.body as TasteNextResponse).cards.map((x) => x.recipeId)
    for (const x of batch.cards) expect(nextIds).not.toContain(x.recipeId)

    const status1 = await call('GET', '/taste/status', undefined, auth)
    expect(status1.body).toMatchObject({ rated: 3, showIntro: false })

    const now = new Date()
    const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)))
    const gen = await call('POST', '/menu/generate', { userId, weekStart: monday.toISOString().slice(0, 10) }, auth)
    expect([200, 201]).toContain(gen.status)
    expect(JSON.stringify(gen.body)).not.toContain(a.recipeId)

    expect((await call('DELETE', `/taste/${b.recipeId}`, undefined, auth)).status).toBe(204)
    expect((await call('GET', '/taste/verdicts', undefined, auth)).body.verdicts).toHaveLength(2)
  }, 60_000)

  it('offers: «Novedad» once, then the card until «Ahora no»', async () => {
    const { auth } = await freshUser()
    expect((await call('POST', '/taste/offers', { event: 'intro_later' }, auth)).status).toBe(200)
    expect((await call('GET', '/taste/status', undefined, auth)).body).toMatchObject({ showIntro: false, showCard: true })
    expect((await call('POST', '/taste/offers', { event: 'card_dismiss' }, auth)).status).toBe(200)
    expect((await call('GET', '/taste/status', undefined, auth)).body).toMatchObject({ showIntro: false, showCard: false })
    expect((await call('POST', '/taste/flags', { group: 'carne' }, auth)).body.flags).toEqual(['carne'])
    expect((await call('GET', '/taste/next', undefined)).status).toBe(401)
  }, 30_000)
})
