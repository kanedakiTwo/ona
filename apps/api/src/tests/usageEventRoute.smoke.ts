/**
 * Smoke (real API + Postgres) for PRO-120: POST /usage/event stores only
 * closed-list props and caps screens and sign-up steps at once per person
 * and Madrid day on the server (Legal: nothing kept in the browser).
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/usageEventRoute.smoke.ts
 *
 * Registers its own user (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { usageEvents } from '../db/schema.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

describe.skipIf(!reachable)('eventos de uso de la web (PRO-120)', () => {
  it('caps screens and steps per day, counts every recipe, drops free text', async () => {
    const u = `uso_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const token = reg.body.token as string
    const ev = (name: string, props: unknown) => call('POST', '/usage/event', { name, props }, token)

    expect((await call('POST', '/usage/event', { name: 'screen_viewed', props: { screen: 'menu' } })).status).toBe(401)

    expect((await ev('screen_viewed', { screen: 'menu' })).body).toEqual({ counted: true })
    expect((await ev('screen_viewed', { screen: 'menu' })).body).toEqual({ counted: false })
    expect((await ev('screen_viewed', { screen: 'lista' })).body).toEqual({ counted: true })
    expect((await ev('screen_viewed', { screen: 'no-existe' })).body).toEqual({ counted: false })
    expect((await ev('menu_generated', {})).body).toEqual({ counted: false })

    expect((await ev('onboarding_step', { step: 'hogar', action: 'visto', note: 'texto libre' })).body).toEqual({ counted: true })
    expect((await ev('onboarding_step', { step: 'hogar', action: 'visto' })).body).toEqual({ counted: false })
    expect((await ev('onboarding_step', { step: 'hogar', action: 'hecho' })).body).toEqual({ counted: true })

    expect((await ev('recipe_viewed', { from: 'menu' })).body).toEqual({ counted: true })
    expect((await ev('recipe_viewed', { from: 'menu' })).body).toEqual({ counted: true })

    const rows = await db
      .select({ name: usageEvents.name, props: usageEvents.props, channel: usageEvents.channel })
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, userId)))
    const of = (name: string) => rows.filter((r) => r.name === name).map((r) => r.props)
    expect(of('screen_viewed')).toHaveLength(2)
    expect(of('onboarding_step')).toEqual(
      expect.arrayContaining([
        { step: 'hogar', action: 'visto' },
        { step: 'hogar', action: 'hecho' },
      ]),
    )
    expect(of('onboarding_step')).toHaveLength(2)
    expect(of('recipe_viewed')).toHaveLength(2)
    expect(JSON.stringify(rows)).not.toContain('texto libre')
    expect(rows.every((r) => r.channel === 'web' || r.name === 'signup_completed')).toBe(true)
  })
})
