/**
 * Smoke (PRO-1259): saving a recipe (PUT /recipes/:id) doesn't wipe what the
 * body leaves out, against the real API + DB.
 *   - the detail for its author carries notes / tips / substitutions /
 *     storage / course; for anyone else, none of them;
 *   - a PUT without them keeps them;
 *   - a PUT with the rows' ids keeps the ids and the steps' `ingredientRefs`.
 * Registers its own users; only needs a reachable API.
 */
import { randomUUID } from 'crypto'
import { describe, it, expect } from 'vitest'
import { API_URL, reachable } from './smokeEnv.js'

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: r.status, json }
}

async function register(tag: string) {
  const name = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const r = await call('POST', '/register', undefined, { username: name, email: `${name}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(r.status).toBeLessThan(300)
  return r.json.token as string
}

async function ingredient(name: string) {
  const found = await call('GET', `/ingredients?search=${encodeURIComponent(name)}&perPage=20`)
  const hit = (found.json as Array<{ id: string; name: string }>).find((i) => i.name === name) ?? found.json[0]
  expect(hit, `seed has «${name}»`).toBeTruthy()
  return hit.id as string
}

// New each run: a row id another recipe already has is not taken.
const A = randomUUID()
const B = randomUUID()

describe('PUT /recipes/:id keeps what the body leaves out (smoke)', () => {
  it.skipIf(!reachable)('tips, notes, course and the step → ingredient links survive a save', async () => {
    const token = await register('pro1259')
    const [ajo, cebolla] = [await ingredient('ajo'), await ingredient('cebolla')]
    const created = await call('POST', '/recipes', token, {
      name: `Sofrito que no pierde nada ${Date.now()}`,
      servings: 2,
      meals: ['lunch'],
      seasons: ['winter'],
      course: 'main',
      notes: 'Mejor en sartén de hierro.',
      tips: 'Sala la cebolla al principio para que sude.',
      substitutions: 'Sin cebolla: puerro.',
      storage: 'Tres días en nevera.',
      ingredients: [
        { id: A, ingredientId: ajo, quantity: 10, unit: 'g' },
        { id: B, ingredientId: cebolla, quantity: 150, unit: 'g' },
      ],
      steps: [
        { index: 0, text: 'Pica el ajo y la cebolla.', ingredientRefs: [A, B] },
        { index: 1, text: 'Sofríe la cebolla a fuego lento.', durationMin: 15, ingredientRefs: [B] },
      ],
      force: true,
    })
    expect(created.status).toBe(201)
    const id = created.json.id as string

    // The author sees the texts and the course; a stranger doesn't.
    const mine = (await call('GET', `/recipes/${id}`, token)).json
    expect(mine).toMatchObject({ course: 'main', tips: 'Sala la cebolla al principio para que sude.', notes: 'Mejor en sartén de hierro.', storage: 'Tres días en nevera.' })
    expect(mine.ingredients.map((i: { id: string }) => i.id).sort()).toEqual([A, B].sort())
    const stranger = (await call('GET', `/recipes/${id}`, await register('pro1259b'))).json
    expect(stranger.tips).toBeUndefined()

    // What «Editar receta» does: the GET back, with the step text changed
    // and without tips / notes / substitutions / storage / course.
    const put = await call('PUT', `/recipes/${id}?force=1`, token, {
      name: mine.name,
      servings: mine.servings,
      meals: mine.meals,
      ingredients: mine.ingredients.map((i: any) => ({ id: i.id, ingredientId: i.ingredientId, quantity: i.quantity, unit: i.unit })),
      steps: mine.steps.map((s: any, i: number) => ({ ...s, text: i === 0 ? 'Pica muy fino el ajo y la cebolla.' : s.text })),
    })
    expect(put.status).toBe(200)

    const after = (await call('GET', `/recipes/${id}`, token)).json
    expect(after).toMatchObject({ course: 'main', tips: 'Sala la cebolla al principio para que sude.', notes: 'Mejor en sartén de hierro.', substitutions: 'Sin cebolla: puerro.', storage: 'Tres días en nevera.' })
    expect(after.steps[0].text).toBe('Pica muy fino el ajo y la cebolla.')
    expect(after.steps[0].ingredientRefs).toEqual([A, B])
    expect(after.steps[1]).toMatchObject({ durationMin: 15, ingredientRefs: [B] })

    // A body that sends them clears them.
    const cleared = await call('PUT', `/recipes/${id}?force=1`, token, {
      name: mine.name,
      servings: mine.servings,
      meals: mine.meals,
      ingredients: mine.ingredients.map((i: any) => ({ id: i.id, ingredientId: i.ingredientId, quantity: i.quantity, unit: i.unit })),
      steps: [],
      tips: '',
      course: null,
    })
    expect(cleared.status).toBe(200)
    const last = (await call('GET', `/recipes/${id}`, token)).json
    expect(last.tips).toBeUndefined()
    expect(last.course).toBeNull()
    expect(last.notes).toBe('Mejor en sartén de hierro.')
  })

  it.skipIf(!reachable)("another recipe's row id isn't taken: the save still goes through", async () => {
    const token = await register('pro1259c')
    const ajo = await ingredient('ajo')
    const base = { servings: 2, meals: ['lunch'], seasons: ['winter'], force: true }
    const first = await call('POST', '/recipes', token, {
      ...base,
      name: `Ajo uno ${Date.now()}`,
      ingredients: [{ ingredientId: ajo, quantity: 10, unit: 'g' }],
      steps: [{ index: 0, text: 'Pela el ajo.' }],
    })
    expect(first.status, JSON.stringify(first.json)).toBe(201)
    const foreignRow = first.json.ingredients[0].id as string
    const second = await call('POST', '/recipes', token, {
      ...base,
      name: `Ajo dos ${Date.now()}`,
      ingredients: [{ id: foreignRow, ingredientId: ajo, quantity: 10, unit: 'g' }],
      steps: [{ index: 0, text: 'Pela el ajo.', ingredientRefs: [foreignRow] }],
    })
    expect(second.status, JSON.stringify(second.json)).toBe(201)
    const row = second.json.ingredients[0].id as string
    expect(row).not.toBe(foreignRow)
    expect(second.json.steps[0].ingredientRefs).toEqual([row])
  })
})
