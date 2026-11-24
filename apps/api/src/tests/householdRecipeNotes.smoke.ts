/**
 * Smoke (Postgres de verdad) de PRO-1071: la nota que el hogar guarda en una
 * receta (`PUT /recipes/:id/notes`, la de la app) es la que lee Mimo con
 * get_recipe_details, tal cual; otro hogar no la ve.
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { recipes, users } from '../db/schema.js'
import { skills } from '../services/assistant/skills.js'
import { loadHouseholdRecipeNotes } from '../services/assistant/householdRecipeNotes.js'

async function register(username: string) {
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@test.local`, password: 'smokepass123', ageConfirmed: true }),
  })
  expect(r.status).toBe(201)
  const body = (await r.json()) as any
  const [me] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, body.user.id))
  return { id: body.user.id as string, token: body.token as string, householdId: me.householdId! }
}

const run = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`

describe.skipIf(!reachable)('Mimo lee la nota del hogar (PRO-1071)', () => {
  it('get_recipe_details cita la nota guardada desde la app, y solo para ese hogar', async () => {
    const carmen = await register(`rn_carmen_${run}`)
    const otro = await register(`rn_otro_${run}`)
    const name = `Lentejas guisadas smoke ${run}`
    const [lentejas] = await db.insert(recipes).values({ name, servings: 4, authorId: carmen.id, tips: 'Cocer 40-45 minutos.' }).returning({ id: recipes.id })

    const put = await fetch(`${API_URL}/recipes/${lentejas.id}/notes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${carmen.token}` },
      body: JSON.stringify({ notes: 'Una pizca de comino al final.\nUna pizca de comino al final.', substitutions: 'Vale la pescadilla.' }),
    })
    expect(put.status).toBe(200)

    const notes = await loadHouseholdRecipeNotes(carmen.id, [lentejas.id], db)
    expect(notes.get(lentejas.id)).toEqual({ notes: 'Una pizca de comino al final.', substitutions: 'Vale la pescadilla.' })
    expect((await loadHouseholdRecipeNotes(otro.id, [lentejas.id], db)).size).toBe(0)

    const details = skills.find((s) => s.name === 'get_recipe_details')!
    const r = await details.handler({ recipeName: name }, { userId: carmen.id, db } as any)
    expect(r.summary).toContain('«Una pizca de comino al final.»')
    expect(r.summary).toContain('«Vale la pescadilla.»')
    expect(r.summary).toContain('Es una receta del hogar')
  })
})
