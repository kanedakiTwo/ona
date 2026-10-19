/**
 * Smoke for «Menú del cole» (PRO-224) against a running API + Postgres:
 * the option shows only with children, days save and read back (a date
 * twice = replaced, `clear` removes), and a generated week's Monday dinner
 * is not a pulse when the kids had lentejas at school.
 *
 *   API_URL=http://localhost:8716 pnpm --filter @ona/api exec vitest run src/tests/schoolMenuRoute.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { dishFoodGroup } from '@ona/shared'
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

async function freshUser(kidsCount: number) {
  const tag = `cole_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call('POST', '/register', { username: tag, email: `${tag}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const auth = { Authorization: `Bearer ${reg.body.token}` }
  const userId = reg.body.user.id as string
  const onboarding = await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount, cookingFreq: 'daily', restrictions: [], priority: 'varied' }, auth)
  expect(onboarding.status).toBe(200)
  return { auth, userId }
}

/** Monday of next week, `YYYY-MM-DD`. */
function nextMonday(): string {
  const d = new Date()
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day + 7)
  return d.toISOString().slice(0, 10)
}
const plus = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

describe.skipIf(!reachable)('menú del cole smoke', () => {
  it('visible only with children', async () => {
    const without = await freshUser(0)
    const r0 = await call('GET', '/school-menu', undefined, without.auth)
    expect(r0.status).toBe(200)
    expect(r0.body).toMatchObject({ days: [], visible: false })
    const withKids = await freshUser(1)
    const r1 = await call('GET', '/school-menu', undefined, withKids.auth)
    expect(r1.body.visible).toBe(true)
    expect((await call('GET', '/school-menu')).status).toBe(401)
  })

  it('save, replace, clear, and the Monday dinner avoids the school group', async () => {
    const { auth, userId } = await freshUser(1)
    const monday = nextMonday()
    const bad = await call('PUT', '/school-menu', { days: [{ date: monday, dish: '', group: null }] }, auth)
    expect(bad.status).toBe(400)

    const put = await call('PUT', '/school-menu', {
      days: [
        { date: monday, dish: 'Lentejas estofadas', group: 'legumbre' },
        { date: plus(monday, 1), dish: 'Macarrones', group: 'pasta_arroz' },
      ],
    }, auth)
    expect(put.status).toBe(200)
    // Same date again = replaced; `clear` removes Tuesday.
    await call('PUT', '/school-menu', { days: [{ date: monday, dish: 'Lentejas con verduras', group: 'legumbre' }], clear: [plus(monday, 1)] }, auth)
    const got = await call('GET', `/school-menu?from=${monday}&to=${plus(monday, 6)}`, undefined, auth)
    expect(got.body.days).toEqual([{ date: monday, dish: 'Lentejas con verduras', group: 'legumbre' }])

    for (let attempt = 0; attempt < 3; attempt++) {
      const gen = await call('POST', '/menu/generate', { userId, weekStart: monday }, auth)
      expect([200, 201]).toContain(gen.status)
      const dinner = gen.body?.days?.[0]?.dinner?.dishes ?? []
      for (const d of dinner) {
        if (d.kind === 'recipe') expect(dishFoodGroup(d.recipeName)).not.toBe('legumbre')
      }
    }
  }, 120_000)
})
