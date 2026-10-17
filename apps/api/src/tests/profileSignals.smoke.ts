/**
 * Smoke (real API + Postgres) for PRO-151 (specs/household-profile.md): the
 * daily signals of a household read every source from the database — the
 * sign-up answers (with the free text, saved since 0063), the shopping list
 * with product names (also removals), web chat with what Mimo did, WhatsApp
 * without health, menu changes, cooking, recipes and feedback.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/profileSignals.smoke.ts
 *
 * Registers its own user (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { activityEvents, chatMessages, cookLogs, menuEdits, menus, recipes, userFeedback, users, whatsappMessages } from '../db/schema.js'
import { collectHouseholdDaySignals } from '../services/profile/signals.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

const madridDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)

describe.skipIf(!reachable)('señales del día de un hogar (PRO-151)', () => {
  it('reads every source of the day, in order, without health from WhatsApp', async () => {
    const day = madridDay(new Date())
    const u = `senales_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const token = reg.body.token as string

    // Sign-up: the free text and the date are kept (0063).
    const onb = await call('POST', `/user/${userId}/onboarding`, {
      adults: 2, kidsCount: 1, cookingFreq: '3_4_times', favoriteDishes: ['lentejas'], priority: 'quick', restrictions: [],
      weekdayCooking: 'rapido', cookingNote: 'Teletrabajamos los dos y el viernes cenamos pizza',
    }, token)
    expect(onb.status).toBe(200)
    const [user] = await db.select().from(users).where(eq(users.id, userId))
    expect(user.onboardingNote).toBe('Teletrabajamos los dos y el viernes cenamos pizza')
    expect(user.onboardingCompletedAt).toBeTruthy()
    const householdId = user.primaryHouseholdId!
    expect(householdId).toBeTruthy()

    // Shopping list: add and remove a product by hand → rows with its name.
    const list = await call('GET', '/shopping-list', undefined, token)
    expect(list.status).toBe(200)
    const listId = list.body.id as string
    const added = await call('POST', `/shopping-list/${listId}/items`, { name: 'Galletas Daniela' }, token)
    expect(added.status).toBe(201)
    const item = (added.body.items as any[]).find((i) => i.name === 'Galletas Daniela')
    expect((await call('DELETE', `/shopping-list/${listId}/item/${item.id}`, undefined, token)).status).toBe(200)
    // The activity insert is fire-and-forget: wait for both rows.
    for (let i = 0; i < 40; i++) {
      const rows = await db.select().from(activityEvents).where(eq(activityEvents.userId, userId))
      if (rows.length >= 2) break
      await new Promise((r) => setTimeout(r, 100))
    }
    const acts = await db.select().from(activityEvents).where(eq(activityEvents.userId, userId))
    expect(acts.map((a) => [a.kind, a.item]).sort()).toEqual([['shopping_add', 'Galletas Daniela'], ['shopping_remove', 'Galletas Daniela']])

    // The rest, written as the app writes it.
    const [recipe] = await db.insert(recipes).values({ name: 'Bizcocho de yogur', authorId: userId, servings: 4, sourceType: 'youtube' }).returning()
    const [menu] = await db.insert(menus).values({ userId, householdId, weekStart: '2026-10-12', days: [] }).returning()
    // Seconds apart, within the last minute (so they stay in today's Madrid day).
    const t = (n: number) => new Date(Date.now() - (60 - n) * 1000)
    await db.insert(chatMessages).values([
      { userId, householdId, role: 'user', body: '¿Qué cenamos hoy?', createdAt: t(1) },
      { userId, householdId, role: 'assistant', body: 'Tortilla.', meta: { tools: ['swap_meal'], toolTrace: [{ name: 'swap_meal', input: '{}', summary: 'Hecho: tortilla el jueves' }] }, createdAt: t(2) },
    ])
    await db.insert(menuEdits).values([
      { householdId, menuId: menu.id, userId, day: 3, meal: 'dinner', action: 'swap', beforeRecipeName: 'Ceviche', afterRecipeName: 'Tortilla de patatas', actor: 'mimo', channel: 'web', createdAt: t(3) },
      { householdId, menuId: menu.id, userId, day: 4, meal: 'lunch', action: 'remove', beforeRecipeName: 'Lasaña', actor: 'user', channel: 'web', createdAt: t(4) },
    ])
    await db.insert(whatsappMessages).values({
      phone: '34600000000', userId, direction: 'in', kind: 'text', status: 'processed',
      body: 'Mi hija es celíaca. Esta semana sin horno.', meta: { tools: [] }, createdAt: t(5),
    })
    await db.insert(cookLogs).values({ userId, householdId, recipeId: recipe.id, meal: 'dinner', dayIndex: 3, notes: 'le faltó sal', cookedAt: t(6) })
    await db.insert(userFeedback).values({ userId, channel: 'app', text: 'Me gusta mucho el menú', createdAt: t(7) })

    const out = await collectHouseholdDaySignals(householdId, day)
    expect(out.members).toEqual([{ label: 'P1', userId, role: 'owner' }])
    const text = out.text
    const order = [
      'Respuestas del alta: Hogar: 2 adulto(s) y 1 niño(s)',
      '«Teletrabajamos los dos y el viernes cenamos pizza»',
      '¿Qué cenamos hoy?',
      'Mimo hizo → swap_meal: Hecho: tortilla el jueves',
      'Cambia cena del jueves: «Ceviche» → «Tortilla de patatas» (lo hace Mimo)',
      'Quita de comida del viernes: «Lasaña»',
      'Escribe: «[omitido] Esta semana sin horno.»',
      'Cocina «Bizcocho de yogur» para cena del jueves. Nota: «le faltó sal»',
      'Sobre Mimoia (botón «Opinión»): «Me gusta mucho el menú»',
    ]
    const positions = order.map((s) => text.indexOf(s))
    expect(positions.every((p) => p >= 0), `missing: ${order.filter((_, i) => positions[i] < 0).join(' | ')}\n${text}`).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(text).toContain('Importa la receta «Bizcocho de yogur» de YouTube')
    expect(text).toMatch(/añade a la lista: «Galletas Daniela»/)
    expect(text).toMatch(/quita de la lista: «Galletas Daniela»/)
    expect(text).not.toMatch(/celíac/i)

    await db.delete(users).where(eq(users.id, userId))
  }, 30_000)
})
