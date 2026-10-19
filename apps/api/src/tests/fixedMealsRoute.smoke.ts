/**
 * Smoke for «comidas fijas» (PRO-218) against a running API + Postgres: a
 * fixed breakfast saved in the plantilla is not generated, shows as
 * «Fijo: …» every day, and its week's amounts reach the shopping list.
 *
 *   API_URL=http://localhost:8717 pnpm --filter @ona/api exec vitest run src/tests/fixedMealsRoute.smoke.ts
 */
import { describe, expect, it } from 'vitest'
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

describe.skipIf(!reachable)('comidas fijas smoke', () => {
  it('fixed breakfast → «Fijo: …» every day and its items in the list', async () => {
    const tag = `fijo_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: tag, email: `${tag}@test.local`, password: 'e2epass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const auth = { Authorization: `Bearer ${reg.body.token}` }
    const userId = reg.body.user.id as string
    expect((await call('POST', `/user/${userId}/onboarding`, { adults: 1, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'varied' }, auth)).status).toBe(200)

    const fixedMeals = [
      {
        meal: 'breakfast',
        days: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
        label: 'Yogur con cereales',
        items: [
          { name: 'yogur bebible de prueba', quantity: 1, unit: 'u' },
          { name: 'copos de prueba', quantity: 40, unit: 'g' },
          { name: 'galletas de prueba', quantity: 2, unit: 'u' },
        ],
      },
      { meal: 'dinner', days: [], label: 'mal', items: [] }, // malformed: dropped by the API
    ]
    const put = await call('PUT', `/user/${userId}/settings`, { template: { fixedMeals } }, auth)
    expect(put.status).toBe(200)
    expect(put.body.template.fixedMeals).toHaveLength(1)

    const monday = nextMonday()
    const gen = await call('POST', '/menu/generate', { userId, weekStart: monday }, auth)
    expect([200, 201]).toContain(gen.status)
    for (const day of gen.body.days) {
      expect(day.breakfast.dishes).toHaveLength(1)
      expect(day.breakfast.dishes[0]).toMatchObject({ kind: 'note', text: 'Fijo: Yogur con cereales' })
      // Whatever the matcher filled is recipes; the breakfast never is.
      for (const meal of ['lunch', 'dinner']) for (const d of day[meal]?.dishes ?? []) expect(d.kind).toBe('recipe')
    }

    const list = await call('GET', `/shopping-list?from=${monday}&to=${plus(monday, 6)}`, undefined, auth)
    expect(list.status).toBe(200)
    const items: any[] = list.body.items ?? list.body
    const line = (name: string) => items.find((i) => i.name === name)
    expect(line('yogur bebible de prueba')).toMatchObject({ quantity: 7, unit: 'u' })
    expect(line('copos de prueba')).toMatchObject({ quantity: 280, unit: 'g' })
    expect(line('galletas de prueba')).toMatchObject({ quantity: 14, unit: 'u' })
  }, 120_000)
})
