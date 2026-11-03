/**
 * Smoke (real API + Postgres) for PRO-1041 (Seguridad): «soy celíaca» told
 * to Mimo without the health consent.
 *
 *   - WhatsApp sign-up: the first message says it, Mimo calls
 *     complete_onboarding without passing it (the model forgot): the first
 *     menu still has no gluten, read from the person's own message; nothing
 *     is stored (`restrictions: []`, `healthConsentAt: null`, no memory) and
 *     the tool hands Mimo the link with «sin gluten» marked.
 *   - Web chat: generate_weekly_menu with `restrictions_said` applies it the
 *     same way, and stores nothing either.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/saidAllergies.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { menus, userMemories, users, whatsappLinks, whatsappMessages } from '../db/schema.js'
import { skills } from '../services/assistant/skills.js'
import { compileRestrictions, violatesRestrictions } from '../services/dietaryRestrictions.js'
import { loadMatchableRecipes } from '../services/matchableRecipes.js'

const tag = `alerg${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const completeOnboarding = skills.find((s) => s.name === 'complete_onboarding')!
const generateWeeklyMenu = skills.find((s) => s.name === 'generate_weekly_menu')!

async function register(i: number) {
  const u = `${tag}${i}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true }),
  })
  const body = await r.json()
  expect(r.status, JSON.stringify(body)).toBe(201)
  return body.user.id as string
}

/** The recipes of the user's menus, and those that break «sin gluten» by the generator's own rule. */
async function menuAllergens(userId: string): Promise<{ count: number; withGluten: string[] }> {
  const rows = await db.select({ days: menus.days }).from(menus).where(eq(menus.userId, userId))
  const ids = new Set<string>()
  for (const r of rows) {
    for (const day of (r.days as any[]) ?? []) {
      for (const slot of Object.values(day ?? {}) as any[]) {
        for (const dish of slot?.dishes ?? []) if (dish?.recipeId) ids.add(dish.recipeId)
      }
    }
  }
  const rules = compileRestrictions(['sin gluten'])
  const inMenu = (await loadMatchableRecipes(userId, db)).filter((r: any) => ids.has(r.id))
  return { count: ids.size, withGluten: inMenu.filter((r: any) => violatesRestrictions(r, rules)).map((r: any) => r.name) }
}

async function nothingStored(userId: string) {
  const [u] = await db.select({ restrictions: users.restrictions, consentAt: users.healthConsentAt }).from(users).where(eq(users.id, userId))
  expect(u.restrictions ?? []).toEqual([])
  expect(u.consentAt).toBeNull()
  const memory = await db.select().from(userMemories).where(and(eq(userMemories.userId, userId), eq(userMemories.key, 'restrictions')))
  expect(memory).toEqual([])
}

describe.skipIf(!reachable)('allergies said without the consent (PRO-1041)', () => {
  it('WhatsApp sign-up: «soy celíaca» in the first message → first menu without gluten, nothing stored, link marked', async () => {
    const userId = await register(1)
    const phone = `34600000${String(Date.now()).slice(-3)}`
    await db.insert(whatsappLinks).values({ userId, phone })
    await db.insert(whatsappMessages).values({ phone, direction: 'in', kind: 'text', body: 'Hola! Soy celíaca. Somos dos en casa y cocinamos cada día', status: 'processed' })

    const r = await completeOnboarding.handler({ adults: 2, kidsCount: 0, cookingStyle: 'daily' }, { userId, db, channel: 'whatsapp' })

    expect(r.summary).toMatch(/Aplicado solo a este menu \(no esta guardado\): sin gluten/)
    expect(r.summary).toContain('/profile/casa/alergias?next=%2Fmenu#marcar=sin%20gluten')
    const { count, withGluten } = await menuAllergens(userId)
    expect(count).toBeGreaterThan(0)
    expect(withGluten).toEqual([])
    await nothingStored(userId)
  })

  it('web chat: restrictions_said applies it to that menu only', async () => {
    const userId = await register(2)
    const r = await generateWeeklyMenu.handler({ restrictions_said: ['celiaca'] }, { userId, db, channel: 'text' })
    expect(r.summary).toMatch(/Aplicado solo a este menu \(no esta guardado\): sin gluten/)
    expect(r.summary).toMatch(/Sin su consentimiento no se guardan/)
    const { count, withGluten } = await menuAllergens(userId)
    expect(count).toBeGreaterThan(0)
    expect(withGluten).toEqual([])
    await nothingStored(userId)
  })
})
