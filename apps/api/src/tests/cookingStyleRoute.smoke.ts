/**
 * Smoke (real API + Postgres) for PRO-217: the sign-up, Perfil and Mimo's
 * `set_cooking_style` all land on the same `cooking_style` fact of the
 * household's ficha, each change with its history row.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/cookingStyleRoute.smoke.ts
 *
 * Registers its own user (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { COOKING_STYLE_PATH } from '@ona/shared'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { profileChanges, profileFacts, users } from '../db/schema.js'
import { setCookingStyleSkill } from '../services/assistant/householdHabitsSkills.js'
import { CHANNEL_HEADER } from '../services/menuEdits.js'
import { INTERNAL_CALL_HEADER } from '../services/usageEvents.js'

async function call(method: string, path: string, payload?: unknown, token?: string, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

describe.skipIf(!reachable)('cómo cocina el hogar en la ficha (PRO-217)', () => {
  it('sign-up, Perfil and Mimo write the same fact', async () => {
    const u = `cocina_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const token = reg.body.token as string

    expect((await call('GET', COOKING_STYLE_PATH, undefined, token)).body).toMatchObject({ style: null, canEdit: true })

    // Sign-up.
    const onboarding = { adults: 2, kidsCount: 0, cookingFreq: '3_4_times', restrictions: [], priority: 'varied', cookingStyle: 'cook_and_reuse' }
    expect((await call('POST', `/user/${userId}/onboarding`, onboarding, token)).status).toBe(200)
    expect((await call('GET', COOKING_STYLE_PATH, undefined, token)).body.style).toBe('cook_and_reuse')

    // Perfil.
    const perfil = await call('PUT', COOKING_STYLE_PATH, { style: 'daily' }, token)
    expect(perfil.status).toBe(200)
    expect(perfil.body).toEqual({ style: 'daily', changed: true })
    expect((await call('PUT', COOKING_STYLE_PATH, { style: 'daily' }, token)).body.changed).toBe(false)
    expect((await call('PUT', COOKING_STYLE_PATH, { style: 'a veces' }, token)).status).toBe(400)

    // Mimo on WhatsApp («ahora hacemos batch los domingos»): the tool, through the route.
    const api = async (method: string, path: string, body?: unknown) => {
      const r = await call(method, path, body, token, { [INTERNAL_CALL_HEADER]: '1', [CHANNEL_HEADER]: 'whatsapp' })
      expect(r.status).toBe(200)
      return r.body
    }
    const said = await setCookingStyleSkill.handler({ style: 'batch' }, { userId, channel: 'whatsapp', api } as any)
    expect(said.summary).toContain('Batch cooking')
    expect((await call('GET', COOKING_STYLE_PATH, undefined, token)).body.style).toBe('batch')

    // One fact, about the household, with where each answer came from.
    const [me] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId))
    const facts = await db.select().from(profileFacts)
      .where(and(eq(profileFacts.householdId, me.householdId!), eq(profileFacts.type, 'cooking_style')))
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ value: { style: 'batch' }, origin: 'user', status: 'active', subjectUserId: null, subjectPersonId: null })
    expect((facts[0].evidence as Array<{ signal: string }>).map((e) => e.signal)).toEqual(['onboarding', 'profile', 'whatsapp'])
    const changes = await db.select().from(profileChanges)
      .where(and(eq(profileChanges.householdId, me.householdId!), eq(profileChanges.factType, 'cooking_style')))
    expect(changes.map((c) => c.action).sort()).toEqual(['fact_added', 'fact_updated', 'fact_updated'])
    expect(changes.find((c) => c.action === 'fact_added')?.origin).toBe('onboarding')
  })
})
