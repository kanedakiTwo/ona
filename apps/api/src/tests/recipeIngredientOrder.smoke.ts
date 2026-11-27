/**
 * PRO-1344: guardar una receta no revuelve el orden de sus ingredientes.
 *
 * El formulario de «Editar receta» no manda `displayOrder`. El esquema de
 * escritura lo ponía a 0 por defecto, así que `persistRecipe` (que usa la
 * posición solo cuando falta) guardaba todas las filas en 0 y el GET las
 * devolvía en cualquier orden. Ahora, sin `displayOrder`, vale la posición en
 * la lista enviada.
 *
 * La parte del esquema corre siempre; la del PUT, contra la API de verdad
 * (smokeEnv.ts: se salta en local sin API, falla en CI si no está).
 *
 *   API_URL=… DATABASE_URL=… SMOKE_USER_TOKEN=… pnpm --filter @ona/api exec vitest run src/tests/recipeIngredientOrder.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { inArray } from 'drizzle-orm'
import { createRecipeSchema, updateRecipeSchema } from '@ona/shared'
import { API_URL, reachable, TOKEN } from './smokeEnv.js'

const sinOrden = (ingredientId: string) => ({ ingredientId, quantity: 100, unit: 'g' as const })

describe('el esquema de escritura no inventa el orden (PRO-1344)', () => {
  it('sin displayOrder, lo deja sin poner (no 0) para que cuente la posición', () => {
    const body = {
      name: 'Receta',
      servings: 2,
      meals: ['lunch'],
      ingredients: [sinOrden(crypto.randomUUID()), sinOrden(crypto.randomUUID()), { ...sinOrden(crypto.randomUUID()), displayOrder: 7 }],
    }
    for (const schema of [createRecipeSchema, updateRecipeSchema]) {
      const parsed = schema.parse(body)
      expect(parsed.ingredients!.map((i) => i.displayOrder)).toEqual([undefined, undefined, 7])
    }
  })
})

describe.skipIf(!reachable || !TOKEN)('PUT /recipes/:id sin displayOrder (PRO-1344)', () => {
  const tag = `orden${Date.now().toString(36)}`
  const createdRecipes: string[] = []
  const createdIngredients: string[] = []

  afterAll(async () => {
    const { db } = await import('../db/connection.js')
    const { ingredients, recipes } = await import('../db/schema.js')
    if (createdRecipes.length) await db.delete(recipes).where(inArray(recipes.id, createdRecipes))
    if (createdIngredients.length) await db.delete(ingredients).where(inArray(ingredients.id, createdIngredients))
  })

  it('devuelve los ingredientes en el orden enviado', async () => {
    const { db } = await import('../db/connection.js')
    const { ingredients } = await import('../db/schema.js')
    const names = ['zanahoria', 'ajo', 'puerro', 'cebolla', 'apio'].map((n) => `${n} ${tag}`)
    const rows = await db.insert(ingredients).values(names.map((name) => ({ name }))).returning({ id: ingredients.id, name: ingredients.name })
    createdIngredients.push(...rows.map((r) => r.id))
    const idOf = new Map(rows.map((r) => [r.name, r.id]))

    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }
    const recipe = (order: string[]) => ({
      name: `__smoke orden ingredientes ${tag}__`,
      servings: 2,
      meals: ['lunch'],
      seasons: [],
      ingredients: order.map((n) => sinOrden(idOf.get(n)!)),
      steps: [{ index: 0, text: 'Pica las verduras y rehógalas.' }],
    })

    const post = await fetch(`${API_URL}/recipes?force=1`, { method: 'POST', headers: auth, body: JSON.stringify(recipe(names)) })
    expect(post.status).toBe(201)
    const { id } = (await post.json()) as { id: string }
    createdRecipes.push(id)

    const reordered = [names[3], names[0], names[4], names[1], names[2]]
    const put = await fetch(`${API_URL}/recipes/${id}?force=1`, { method: 'PUT', headers: auth, body: JSON.stringify(recipe(reordered)) })
    expect(put.status).toBe(200)
    const saved = (await put.json()) as { ingredients: Array<{ ingredientId: string; displayOrder: number }> }
    expect(saved.ingredients.map((i) => i.ingredientId)).toEqual(reordered.map((n) => idOf.get(n)))
    expect(saved.ingredients.map((i) => i.displayOrder)).toEqual([0, 1, 2, 3, 4])

    const get = await fetch(`${API_URL}/recipes/${id}`, { headers: auth })
    expect(get.ok).toBe(true)
    const fetched = (await get.json()) as { ingredients: Array<{ ingredientId: string }> }
    expect(fetched.ingredients.map((i) => i.ingredientId)).toEqual(reordered.map((n) => idOf.get(n)))
  })
})
