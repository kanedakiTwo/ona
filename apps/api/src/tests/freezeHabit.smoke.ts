/**
 * Smoke (real API + Postgres) for PRO-221: the sign-up's «¿Congeláis la
 * carne o el pescado?» decides the thaw alert of a menu with merluza.
 * «Sí» → «Acuérdate: merluza…» is scheduled; «No» → nothing; «A veces» →
 * scheduled with «Si lo tienes congelado, sácalo hoy.». And Perfil
 * («Lo que recuerdo de ti») changes it.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/freezeHabit.smoke.ts
 *
 * Registers its own users (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { afterAll, describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { FREEZE_HABIT_ALWAYS, THAW_CONDITIONAL_TEXT, applyFreezeAnswer, type FreezeAnswer } from '@ona/shared'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { ingredients, menus, notificationSchedule, recipeIngredients, recipes } from '../db/schema.js'
import { enqueuePrepAlertsForMenu } from '../services/notificationScheduler.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

/** Monday two weeks from now, so every alert is in the future. */
function futureMonday(): string {
  const d = new Date(Date.now() + 14 * 86_400_000)
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

const tag = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
let recipeId = ''
let ingredientId = ''

async function merlucaRecipe() {
  if (recipeId) return recipeId
  const [ing] = await db.insert(ingredients).values({ name: `merluza congelada ${tag}`, prepRequirements: { method: 'thaw_24h' } } as any).returning({ id: ingredients.id })
  ingredientId = ing.id
  const [rec] = await db.insert(recipes).values({ name: `Merluza en salsa verde ${tag}`, servings: 2 } as any).returning({ id: recipes.id })
  recipeId = rec.id
  await db.insert(recipeIngredients).values({ recipeId, ingredientId, quantity: 400, unit: 'g' } as any)
  return recipeId
}

let seq = 0
async function signUp(answer: FreezeAnswer | undefined) {
  seq += 1
  const u = `cg${seq}_${tag}`
  const reg = await call('POST', '/register', { username: u.slice(0, 30), email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
  expect(reg.status).toBe(201)
  const userId = reg.body.user.id as string
  const token = reg.body.token as string
  const onboarding = { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'varied', ...(answer ? { freezesMeatFish: answer } : {}) }
  expect((await call('POST', `/user/${userId}/onboarding`, onboarding, token)).status).toBe(200)
  return { userId, token }
}

/** A menu with merluza for Wednesday's dinner, and the alerts it schedules. */
async function alertsFor(userId: string) {
  const rid = await merlucaRecipe()
  const days = Array.from({ length: 7 }, (_, i) => (i === 2 ? { dinner: { dishes: [{ kind: 'recipe', recipeId: rid }] } } : {}))
  const [menu] = await db.insert(menus).values({ userId, weekStart: futureMonday(), days } as any).returning({ id: menus.id })
  await enqueuePrepAlertsForMenu(menu.id)
  return db.select().from(notificationSchedule).where(eq(notificationSchedule.userId, userId))
}

describe.skipIf(!reachable)('«¿Congeláis la carne o el pescado?» → aviso de descongelar (PRO-221)', () => {
  const users: string[] = []
  afterAll(async () => {
    if (recipeId) await db.delete(recipes).where(eq(recipes.id, recipeId))
    if (ingredientId) await db.delete(ingredients).where(eq(ingredients.id, ingredientId))
    if (users.length) await db.delete(menus).where(inArray(menus.userId, users))
  })

  it('«Sí»: a menu with merluza schedules the thaw alert', async () => {
    const { userId, token } = await signUp('yes')
    users.push(userId)
    const memory = (await call('GET', '/memory', undefined, token)).body
    expect(memory.prep_habits.value).toEqual([FREEZE_HABIT_ALWAYS])
    const rows = await alertsFor(userId)
    expect(rows).toHaveLength(1)
    expect((rows[0].payload as { title: string; body: string }).title).toContain('merluza')
    expect((rows[0].payload as { body: string }).body).not.toBe(THAW_CONDITIONAL_TEXT)
  })

  it('«No»: nothing is saved and nothing is scheduled', async () => {
    const { userId, token } = await signUp('no')
    users.push(userId)
    const memory = (await call('GET', '/memory', undefined, token)).body
    expect(memory.prep_habits?.value ?? []).toEqual([])
    expect(await alertsFor(userId)).toHaveLength(0)
  })

  it('«A veces»: scheduled, with «Si lo tienes congelado, sácalo hoy.»', async () => {
    const { userId } = await signUp('sometimes')
    users.push(userId)
    const rows = await alertsFor(userId)
    expect(rows).toHaveLength(1)
    expect((rows[0].payload as { body: string }).body).toBe(THAW_CONDITIONAL_TEXT)
  })

  it('Perfil («Lo que recuerdo de ti») changes it with the same sentences', async () => {
    const { userId, token } = await signUp('yes')
    users.push(userId)
    const patch = await call('PATCH', '/memory', { key: 'prep_habits', value: applyFreezeAnswer([FREEZE_HABIT_ALWAYS], 'no') }, token)
    expect(patch.status).toBe(200)
    expect(await alertsFor(userId)).toHaveLength(0)
  })
})
