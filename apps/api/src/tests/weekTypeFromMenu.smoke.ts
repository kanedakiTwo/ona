/**
 * Smoke de «Guardar en mi semana tipo» desde el menú (PRO-1186) contra la API
 * y Postgres: `POST /menu/:menuId/day/:day/meal/:meal/week-type` escribe ese
 * hueco de la semana tipo del hogar y aplica la semana que se ve solo si la
 * comida no está fijada ni comida; y lo que rechaza.
 *
 *   API_URL=http://localhost:8717 DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/weekTypeFromMenu.smoke.ts
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

function monday(offsetWeeks: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 * offsetWeeks)
  return d.toISOString().slice(0, 10)
}

const SATURDAY = 5

describe.skipIf(!reachable)('guardar en la semana tipo desde el menú', () => {
  it('escribe el hueco y aplica la semana que se ve solo si la comida no está fijada ni comida', async () => {
    const u = `st_menu_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const auth = { Authorization: `Bearer ${reg.body.token}` }
    const userId = reg.body.user.id as string
    expect((await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'varied' }, auth)).status).toBe(200)

    const weekStart = monday(1)
    const gen = await call('POST', '/menu/generate', { userId, weekStart, empty: true, force: true }, auth)
    expect(gen.status).toBeLessThan(300)
    const menuId = gen.body.id as string
    const legumes: Array<{ id: string }> = (await call('GET', '/recipes?perPage=100&fitsMe=1&dishType=legumbres', undefined, auth)).body
    const all: Array<{ id: string }> = (await call('GET', '/recipes?perPage=100&fitsMe=1', undefined, auth)).body
    expect(legumes.length).toBeGreaterThan(0)
    const other = all.find((r) => !legumes.some((l) => l.id === r.id))!
    const base = `/menu/${menuId}/day/${SATURDAY}/meal/dinner`
    const dinner = gen.body.days?.[SATURDAY]?.dinner
    expect((await call(dinner ? 'PUT' : 'POST', base, { recipeId: other.id }, auth)).status).toBeLessThan(300)

    // Elegida a mano = fijada (PRO-1175): se guarda, pero esta semana se queda como está.
    const kept = await call('POST', `${base}/week-type`, { option: { kind: 'type', type: 'legumbres' } }, auth)
    expect(kept.status).toBe(200)
    expect(kept.body.weekTypeApplied).toBe('kept')
    expect(kept.body.days[SATURDAY].dinner.dishes[0].recipeId).toBe(other.id)
    const wt = (await call('GET', '/households/me/week-type', undefined, auth)).body.days
    expect(wt[SATURDAY].dinner.options).toEqual([{ kind: 'type', type: 'legumbres' }])
    expect(wt[SATURDAY].lunch.options).toBeUndefined()

    // Suelta: ahora sí, una receta de legumbres con su chip.
    expect((await call('PUT', `${base}/lock`, { locked: false }, auth)).status).toBe(200)
    const changed = await call('POST', `${base}/week-type`, { option: { kind: 'type', type: 'legumbres' } }, auth)
    expect(changed.status).toBe(200)
    expect(changed.body.weekTypeApplied).toBe('changed')
    const dish = changed.body.days[SATURDAY].dinner.dishes[0]
    expect(legumes.some((l) => l.id === dish.recipeId)).toBe(true)
    expect(dish.fromWeekType).toEqual({ type: 'legumbres' })
    expect(dish.dishTypes).toContain('legumbres')

    // Otra vez lo mismo: ya lo es, solo la marca.
    expect((await call('POST', `${base}/week-type`, { option: { kind: 'type', type: 'legumbres' } }, auth)).body.weekTypeApplied).toBe('mark')

    // Comida: «Siempre esta receta» con otra se guarda, la cena no cambia.
    expect((await call('PATCH', base, { eaten: true }, auth)).status).toBe(200)
    const eaten = await call('POST', `${base}/week-type`, { option: { kind: 'recipe', recipeId: other.id, name: 'x' } }, auth)
    expect(eaten.body.weekTypeApplied).toBe('kept')
    expect(eaten.body.days[SATURDAY].dinner.dishes[0].recipeId).toBe(dish.recipeId)
    const wt2 = (await call('GET', '/households/me/week-type', undefined, auth)).body.days
    expect(wt2[SATURDAY].dinner.options[0]).toMatchObject({ kind: 'recipe', recipeId: other.id })
    expect(wt2[SATURDAY].dinner.options[0].name).not.toBe('x') // el nombre sale de la receta

    // Lo que rechaza.
    expect((await call('POST', `${base}/week-type`, { option: { kind: 'taper' } }, auth)).status).toBe(400)
    expect((await call('POST', `${base}/week-type`, { option: { kind: 'type', type: 'no-existe' } }, auth)).status).toBe(400)
    expect((await call('POST', `${base}/week-type`, { option: { kind: 'recipe', recipeId: '00000000-0000-0000-0000-000000000000', name: 'x' } }, auth)).status).toBe(404)
    expect((await call('POST', `/menu/${menuId}/day/${SATURDAY}/meal/snack/week-type`, { option: { kind: 'type', type: 'pizza' } }, auth)).status).toBe(404)
  })
})
