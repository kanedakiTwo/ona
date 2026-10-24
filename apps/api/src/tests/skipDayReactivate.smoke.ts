/**
 * Smoke (PRO-349): a dish put on a «sin cocinar» day reactivates it. Mimo
 * put «arroz de limpieza» on a skipped Saturday through these same routes:
 * the list counted it and the day still said «Día marcado sin cocinar».
 * Requires SMOKE_USER_ID + SMOKE_USER_TOKEN (smoke orchestrator provides them).
 */
import { describe, it, expect } from 'vitest'
import { API_URL, TOKEN, USER_ID, authHeaders as auth, reachable } from './smokeEnv.js'

const ready = reachable && !!TOKEN && !!USER_ID

describe('«sin cocinar» day reactivated by a dish (smoke)', () => {
  it.skipIf(!ready)('a note, a recipe or a random dish on a skipped day takes it out of skippedDays', async () => {
    // Fifteen weeks back: a week no other smoke file uses.
    const monday = new Date()
    monday.setDate(monday.getDate() - 105 - ((monday.getDay() + 6) % 7))
    const weekStart = monday.toISOString().slice(0, 10)
    const gen = await fetch(`${API_URL}/menu/generate`, { method: 'POST', headers: auth(), body: JSON.stringify({ userId: USER_ID, weekStart }) })
    expect(gen.status).toBe(201)
    const menu = await gen.json()
    const recipeId = menu.days[0].lunch.dishes.find((d: any) => d.kind === 'recipe').recipeId
    const skipped = async () => (await (await fetch(`${API_URL}/menu/${USER_ID}/${weekStart}`, { headers: auth() })).json()).skippedDays as number[]

    // Saturday: «Saltar día», then a note (set_meal_note / add_dish as a note).
    expect((await fetch(`${API_URL}/menu/${menu.id}/day/5/skip`, { method: 'POST', headers: auth() })).status).toBe(200)
    expect(await skipped()).toContain(5)
    const note = await fetch(`${API_URL}/menu/${menu.id}/day/5/meal/lunch/dish`, { method: 'POST', headers: auth(), body: JSON.stringify({ kind: 'note', text: 'Arroz de limpieza' }) })
    expect(note.status).toBe(200)
    expect(await skipped()).not.toContain(5)

    // Sunday: skipped, then a recipe in a new meal (POST slot).
    await fetch(`${API_URL}/menu/${menu.id}/day/6/skip`, { method: 'POST', headers: auth() })
    expect(await skipped()).toContain(6)
    const slot = await fetch(`${API_URL}/menu/${menu.id}/day/6/meal/dinner`, { method: 'POST', headers: auth(), body: JSON.stringify({ recipeId }) })
    expect(slot.status).toBe(201)
    expect((await slot.json()).skippedDays).not.toContain(6)

    // Friday: skipped, then «Aleatorio»; another skipped day stays skipped.
    await fetch(`${API_URL}/menu/${menu.id}/day/4/skip`, { method: 'POST', headers: auth() })
    await fetch(`${API_URL}/menu/${menu.id}/day/3/skip`, { method: 'POST', headers: auth() })
    const random = await fetch(`${API_URL}/menu/${menu.id}/day/4/meal/lunch/dish/random`, { method: 'POST', headers: auth() })
    expect(random.status).toBe(200)
    const after = await skipped()
    expect(after).not.toContain(4)
    expect(after).toContain(3)
  }, 60_000)
})
