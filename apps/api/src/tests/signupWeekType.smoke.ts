/**
 * Smoke (real API + Postgres) for PRO-1049: the week type a sign-up leaves is
 * what the profile shows and what the menu follows. The hogares de prueba saw
 * «21 comidas a la semana» (breakfast and snack included) in Perfil for houses
 * that only cook lunch and dinner, while the menu came out right; since the
 * «semana tipo» (D-182) both read the same row, and this checks it from the
 * sign-up on:
 *
 *   - web sign-up (2 adults): lunch and dinner every day, no breakfast nor
 *     snack, no diners of its own (the household's 2); «Vuestra semana»
 *     (`summarizeWeekType`) says those meals; the generated week has only
 *     those meals, for 2;
 *   - chat / WhatsApp sign-up (`complete_onboarding`) with «2 comidas y 6
 *     cenas»: the week type has those 8 and the menus it makes, only those.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/signupWeekType.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { MEALS, summarizeWeekType, weekTypeSlotAt, type Meal, type WeekTypeDays } from '@ona/shared'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { menus } from '../db/schema.js'
import { skills } from '../services/assistant/skills.js'
import { currentWeekStart } from '../services/weekType.js'

const completeOnboarding = skills.find((s) => s.name === 'complete_onboarding')!

async function call(method: string, path: string, payload?: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function register(tag: string) {
  const u = `${tag}_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status, JSON.stringify(reg.body)).toBe(201)
  return { userId: reg.body.user.id as string, auth: { Authorization: `Bearer ${reg.body.token}` } }
}

function mondayAfter(weekStart: string, weeks: number): string {
  const d = new Date(`${weekStart}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 7 * weeks)
  return d.toISOString().slice(0, 10)
}

/** «lunes:comida» for every slot the week type plans. */
function plannedSlots(days: WeekTypeDays): string[] {
  const out: string[] = []
  for (let d = 0; d < 7; d++) for (const m of MEALS) if (!weekTypeSlotAt(days, d, m).off) out.push(`${d}:${m}`)
  return out
}

/** …and every slot a menu has dishes in (the seed's 16 recipes may not fill a whole week). */
function menuSlots(days: any[]): string[] {
  const out: string[] = []
  days.forEach((day, d) => {
    for (const m of MEALS) if (day?.[m]?.dishes?.length) out.push(`${d}:${m}`)
  })
  return out
}

describe.skipIf(!reachable)('sign-up → semana tipo → perfil y menú (PRO-1049)', () => {
  it('web sign-up for 2: lunch and dinner every day, for the household; Perfil and the menu say the same', async () => {
    const { userId, auth } = await register('alta_web')
    const onb = await call('POST', `/user/${userId}/onboarding`, { adults: 2, kidsCount: 0, cookingStyle: 'daily', restrictions: [] }, auth)
    expect(onb.status, JSON.stringify(onb.body)).toBe(200)

    const wt = await call('GET', '/households/me/week-type', undefined, auth)
    expect(wt.status).toBe(200)
    const days = wt.body.days as WeekTypeDays
    const planned = plannedSlots(days)
    expect(planned).toHaveLength(14)
    for (let d = 0; d < 7; d++) {
      expect(days[d].breakfast).toEqual({ off: true })
      expect(days[d].snack).toEqual({ off: true })
      // No diners of its own: the household's (2 adults).
      expect(days[d].lunch?.diners).toBeUndefined()
      expect(days[d].dinner?.diners).toBeUndefined()
    }
    // «Vuestra semana» shows lunch and dinner only.
    expect(summarizeWeekType(days, currentWeekStart()).meals).toEqual(['lunch', 'dinner'])

    const gen = await call('POST', '/menu/generate', { userId, weekStart: mondayAfter(currentWeekStart(), 1) }, auth)
    expect([200, 201], JSON.stringify(gen.body)).toContain(gen.status)
    const served = menuSlots(gen.body.days)
    expect(served.length).toBeGreaterThan(0)
    for (const slot of served) expect(planned).toContain(slot)
    expect(served.some((s) => s.endsWith(':lunch')) && served.some((s) => s.endsWith(':dinner'))).toBe(true)
    for (const day of gen.body.days) for (const m of ['lunch', 'dinner']) if (day[m]) expect([undefined, null, 2]).toContain(day[m].servings)
  }, 120_000)

  it('chat / WhatsApp sign-up «2 comidas y 6 cenas»: those 8 in the week type, and only those in its menus', async () => {
    const { userId, auth } = await register('alta_chat')
    const r = await completeOnboarding.handler(
      { adults: 1, kidsCount: 0, cookingStyle: 'daily', lunches: 2, dinners: 6 },
      { userId, db, channel: 'whatsapp' },
    )
    expect(r.summary).not.toMatch(/No he guardado nada/)

    const days = (await call('GET', '/households/me/week-type', undefined, auth)).body.days as WeekTypeDays
    // Lunch at the weekend; dinner every day but Saturday (the night out).
    const planned = plannedSlots(days)
    expect(planned).toEqual(['0:dinner', '1:dinner', '2:dinner', '3:dinner', '4:dinner', '5:lunch', '6:lunch', '6:dinner'])
    expect(summarizeWeekType(days, currentWeekStart()).meals).toEqual(['lunch', 'dinner'])

    // The sign-up's menus (from the next meal on): never a slot the week type hasn't.
    const made = await db.select({ weekStart: menus.weekStart, days: menus.days }).from(menus).where(eq(menus.userId, userId))
    expect(made.length).toBeGreaterThan(0)
    for (const m of made) for (const slot of menuSlots(m.days as any[])) expect(planned).toContain(slot)

    // A whole week generated later: those, weekday lunches and Saturday dinner never.
    const gen = await call('POST', '/menu/generate', { userId, weekStart: mondayAfter(currentWeekStart(), 3) }, auth)
    expect([200, 201], JSON.stringify(gen.body)).toContain(gen.status)
    const served = menuSlots(gen.body.days)
    for (const slot of served) expect(planned).toContain(slot)
    expect(served.some((s) => s.endsWith(':lunch')) && served.some((s) => s.endsWith(':dinner'))).toBe(true)
    for (const day of gen.body.days) for (const m of ['lunch', 'dinner'] as Meal[]) if (day[m]) expect([undefined, null, 1]).toContain(day[m].servings)
  }, 120_000)
})
