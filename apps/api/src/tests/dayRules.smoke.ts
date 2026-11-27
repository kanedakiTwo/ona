/**
 * PRO-1296 · Las normas por día de la semana tipo nunca se rompen, against a
 * running API + Postgres. A household with a fixed recipe on Tuesday dinner,
 * no lunch Monday to Friday and nothing at the weekend: 20 generations (the
 * route of «Llenar con mi semana tipo» and the path of the Thursday autoplan,
 * `generateAndSaveMenu`) and 20 changes at random («Cambiar» / «Que elija
 * Mimoia», regenerating a dish, Mimo's `swap_meal` without a dish, and the
 * same aimed at a meal the week type doesn't have), never one rule broken.
 *
 *   API_URL=http://localhost:8765 DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/dayRules.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu } from '@ona/shared'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { skills } from '../services/assistant/skills.js'
import { generateAndSaveMenu } from '../services/menuGenerate.js'

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

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** A small seeded generator: the same «random» changes every run. */
function rng(seed: number) {
  let s = seed >>> 0
  return (n: number) => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s % n
  }
}

const MEALS = ['breakfast', 'lunch', 'snack', 'dinner'] as const
const hasDishes = (days: DayMenu[], d: number, meal: string) => (days[d]?.[meal]?.dishes?.length ?? 0) > 0

/** Every rule of the week type broken by `days` (empty = none). `fixedOnTuesday`: the Tuesday dinner must still be that recipe. */
function brokenRules(days: DayMenu[], fixedId: string, fixedOnTuesday = true): string[] {
  const out: string[] = []
  for (let d = 0; d < 7; d++) {
    for (const meal of MEALS) {
      const allowed = d < 5 && meal === 'dinner'
      if (!allowed && hasDishes(days, d, meal)) out.push(`d${d} ${meal}: no se cocina y tiene plato`)
    }
  }
  if (fixedOnTuesday) {
    const first = days[1]?.dinner?.dishes?.[0]
    if (!first || first.kind !== 'recipe' || first.recipeId !== fixedId) out.push('martes cena: no es su plato fijo')
  }
  days.forEach((day, d) => {
    for (const [meal, slot] of Object.entries(day ?? {})) {
      if (d === 1 && meal === 'dinner') continue
      if (slot?.dishes?.some((x) => x.kind === 'recipe' && x.recipeId === fixedId)) out.push(`d${d} ${meal}: el plato fijo del martes, repetido`)
    }
  })
  return out
}

async function freshHousehold() {
  const u = `normas_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const auth = { Authorization: `Bearer ${reg.body.token}` }
  const userId = reg.body.user.id as string
  expect((await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'varied' }, auth)).status).toBe(200)
  return { auth, userId }
}

describe.skipIf(!reachable)('normas por día (PRO-1296)', () => {
  it('20 generations and 20 random changes never break a rule of the week type', { timeout: 600_000 }, async () => {
    const { auth, userId } = await freshHousehold()

    // The fixed dish: a dinner recipe of the catalogue.
    const list = await call('GET', '/recipes?fitsMe=1', undefined, auth)
    expect(list.status).toBe(200)
    const recipes: any[] = Array.isArray(list.body) ? list.body : list.body.recipes ?? list.body.items ?? []
    const fixed = recipes.find((r) => (r.meals ?? []).includes('dinner') && r.course !== 'dessert') ?? recipes[0]
    expect(fixed?.id).toBeTruthy()

    // The week type: no lunch Monday to Friday, Tuesday dinner fixed, nothing at the weekend.
    for (let d = 0; d < 5; d++) expect((await call('PUT', `/households/me/week-type/${d}/lunch`, { off: true }, auth)).status).toBe(200)
    expect((await call('PUT', '/households/me/week-type/1/dinner', { options: [{ kind: 'recipe', recipeId: fixed.id, name: fixed.name }] }, auth)).status).toBe(200)
    for (const d of [5, 6]) for (const meal of ['lunch', 'dinner']) expect((await call('PUT', `/households/me/week-type/${d}/${meal}`, { off: true }, auth)).status).toBe(200)

    // 20 generations: the app's route and the Thursday autoplan's path, over four weeks.
    const menusByWeek = new Map<string, { id: string; days: DayMenu[] }>()
    for (let i = 0; i < 20; i++) {
      const weekStart = monday(1 + (i % 4))
      let id: string
      let days: DayMenu[]
      if (i % 3 === 2) {
        const out = await generateAndSaveMenu({ userId, weekStart })
        id = out.menu.id
        days = out.days
      } else {
        const gen = await call('POST', '/menu/generate', { userId, weekStart }, auth)
        expect(gen.status).toBe(201)
        id = gen.body.id
        days = gen.body.days
      }
      expect(brokenRules(days, fixed.id), `generación ${i + 1} (${weekStart})`).toEqual([])
      // Monday to Friday dinner is there.
      for (let d = 0; d < 5; d++) expect(hasDishes(days, d, 'dinner'), `generación ${i + 1}: cena d${d}`).toBe(true)
      menusByWeek.set(weekStart, { id, days })
    }

    // 20 changes at random on next week's menu.
    const weekStart = monday(1)
    const menuId = menusByWeek.get(weekStart)!.id
    const swapMeal = skills.find((s) => s.name === 'swap_meal')!
    const next = rng(1296)
    const cooked = [0, 2, 3, 4] // the dinners that aren't the fixed one
    const off: Array<[number, string]> = [[0, 'lunch'], [1, 'lunch'], [4, 'lunch'], [5, 'lunch'], [5, 'dinner'], [6, 'dinner']]
    for (let i = 0; i < 20; i++) {
      const op = next(5)
      let label: string
      if (op === 0 || op === 1 || op === 2) {
        const day = cooked[next(cooked.length)]
        if (op === 0) {
          label = `Cambiar d${day} cena`
          const r = await call('PUT', `/menu/${menuId}/day/${day}/meal/dinner`, {}, auth)
          expect([200, 404], label).toContain(r.status)
        } else if (op === 1) {
          label = `Regenerar plato d${day} cena`
          const r = await call('POST', `/menu/${menuId}/day/${day}/meal/dinner/dish/0/regenerate`, {}, auth)
          expect([200, 409], label).toContain(r.status)
        } else {
          label = `swap_meal d${day} cena`
          await swapMeal.handler({ day: addDays(weekStart, day), meal: 'dinner' }, { userId, db, channel: 'text' })
        }
      } else {
        const [day, meal] = off[next(off.length)]
        if (op === 3) {
          label = `Cambiar d${day} ${meal} (no se cocina)`
          const r = await call('PUT', `/menu/${menuId}/day/${day}/meal/${meal}`, {}, auth)
          expect(r.status, label).toBe(404)
        } else {
          label = `swap_meal d${day} ${meal} (no se cocina)`
          const r = await swapMeal.handler({ day: addDays(weekStart, day), meal }, { userId, db, channel: 'text' })
          expect(r.summary, label).toMatch(/no he cambiado nada/i)
        }
      }
      const now = await call('GET', `/menu/${userId}/${weekStart}`, undefined, auth)
      expect(now.status).toBe(200)
      expect(now.body.id).toBe(menuId)
      expect(brokenRules(now.body.days, fixed.id), `cambio ${i + 1}: ${label}`).toEqual([])
    }
  })
})
