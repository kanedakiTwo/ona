/**
 * Smoke (real API + Postgres) for PRO-1024: the routes that record their
 * usage event themselves or through the middleware leave it with its props —
 * the weekly template, memory (never `restrictions`), favourites, recipe
 * notes, habituales, the list's range and a client event.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/usageEventsPro1024.smoke.ts
 *
 * Registers its own user (needs REGISTRATION_MODE=open, as CI's smoke job).
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { usageEvents } from '../db/schema.js'
import { madridToday } from '../services/usageEvents.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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

/** The events are fire-and-forget: wait until `n` rows of `name` are written (2 s at most). */
async function eventsOf(userId: string, name: string, n: number) {
  for (let i = 0; i < 20; i++) {
    const rows = await db.select({ name: usageEvents.name, props: usageEvents.props }).from(usageEvents).where(eq(usageEvents.userId, userId))
    const of = rows.filter((r) => r.name === name).map((r) => r.props)
    if (of.length >= n) return of
    await new Promise((r) => setTimeout(r, 100))
  }
  const rows = await db.select({ name: usageEvents.name, props: usageEvents.props }).from(usageEvents).where(eq(usageEvents.userId, userId))
  return rows.filter((r) => r.name === name).map((r) => r.props)
}

describe.skipIf(!reachable)('eventos de uso de los trucos (PRO-1024)', () => {
  it('the routes leave their events with closed props, and memory_set never names restrictions', async () => {
    const u = `uso1024_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const token = reg.body.token as string

    // «Semana tipo» (D-182): Tuesday's lunch becomes a táper; then Monday gets a fixed breakfast.
    expect((await call('PUT', '/households/me/week-type/1/lunch', { options: [{ kind: 'taper' }] }, token)).status).toBe(200)
    const fixed = { options: [{ kind: 'fixed', label: 'Tostada', items: [{ name: 'Tostada', quantity: 1, unit: 'u' }] }] }
    expect((await call('PUT', '/households/me/week-type/0/breakfast', fixed, token)).status).toBe(200)
    const changed = (await eventsOf(userId, 'template_changed', 3)).map((p: any) => p.what)
    expect(changed).toEqual(expect.arrayContaining(['taper_days', 'meals', 'fixed_meals']))
    expect(changed.filter((w) => w === 'taper_days')).toHaveLength(1)

    // Memory: a kitchen fact counts by key; a health key never does.
    expect((await call('PATCH', '/memory', { key: 'equipment', value: ['olla exprés'] }, token)).status).toBe(200)
    await call('PATCH', '/memory', { key: 'restrictions', value: ['celiaquia'] }, token)
    expect(await eventsOf(userId, 'memory_set', 1)).toEqual([{ key: 'equipment' }])

    // Habituales from Perfil.
    expect((await call('POST', '/staples', { name: 'Pan' }, token)).status).toBe(201)
    expect(await eventsOf(userId, 'staple_toggled', 1)).toEqual([{ on: true, via: 'perfil' }])

    // The list, today only.
    const today = madridToday()
    expect((await call('GET', `/shopping-list?from=${today}&to=${today}`, undefined, token)).status).toBe(200)
    expect(await eventsOf(userId, 'shopping_list_viewed', 1)).toEqual([{ range: 'hoy' }])

    // A client event.
    expect((await call('POST', '/usage/event', { name: 'content_shared', props: { what: 'semana', text: 'mi menú' } }, token)).body).toEqual({ counted: true })
    expect(await eventsOf(userId, 'content_shared', 1)).toEqual([{ what: 'semana' }])

    // A catalogue recipe: favourite on and off, then stars from «¿Qué tal?» and a note.
    const recipeId = ((await call('GET', '/recipes?perPage=1', undefined, token)).body as Array<{ id: string }>)[0]?.id
    expect(recipeId).toBeTruthy()
    expect((await call('POST', `/user/${userId}/recipes/${recipeId}/favorite`, undefined, token)).body).toEqual({ favorited: true })
    expect((await call('POST', `/user/${userId}/recipes/${recipeId}/favorite`, undefined, token)).body).toEqual({ favorited: false })
    expect(await eventsOf(userId, 'favorite_toggled', 2)).toEqual(expect.arrayContaining([{ on: true }, { on: false }]))

    expect((await call('PUT', `/recipes/${recipeId}/notes`, { rating: 4, from: 'que_tal' }, token)).status).toBe(200)
    expect((await call('PUT', `/recipes/${recipeId}/notes`, { rating: 4 }, token)).status).toBe(200)
    expect((await call('PUT', `/recipes/${recipeId}/notes`, { notes: 'con comino' }, token)).status).toBe(200)
    expect(await eventsOf(userId, 'recipe_rated', 1)).toEqual([{ rating: 4, via: 'que_tal' }])
    expect(await eventsOf(userId, 'recipe_note_saved', 1)).toEqual([{ what: 'notes' }])
  })
})
