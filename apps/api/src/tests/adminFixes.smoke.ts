/**
 * Smoke (real API + Postgres) for the office's admin routes (PRO-1290,
 * specs/admin-dashboard.md, specs/admin-audit-log.md):
 *   - both routes refuse an anonymous call (401) and a non-admin JWT (403);
 *   - a catalogue recipe fix: ingredients, steps, times and tags saved
 *     through `persistRecipe` (allergens recomputed), `catalog_recipe.edit`
 *     with the before and after in the same transaction; the allergen audit
 *     holds a fix that drops an allergen unconfirmed or whose steps name an
 *     allergen the ingredients lack (nothing written); a user's recipe is
 *     not the catalogue's;
 *   - a household's Mimo cap: set, audited (`household.mimo_cap`), read by
 *     its members' budgets, refused over 3× the plan, back to the plan's
 *     with null.
 *
 *   API_URL=… DATABASE_URL=… SMOKE_USER_TOKEN=… SMOKE_USER_ID=… pnpm --filter @ona/api exec vitest run src/tests/adminFixes.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { asc, eq, inArray } from 'drizzle-orm'
import { API_URL, reachable, TOKEN, USER_ID } from './smokeEnv.js'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { adminAuditLog, households, ingredients, recipeIngredients, recipes, recipeSteps, users } from '../db/schema.js'
import { budgetMicrosFor } from '../services/advisorBudget.js'
import { editCatalogRecipe } from '../services/catalogRecipeEdit.js'
import { householdMimoCapEur, maxMimoCapEur, setHouseholdMimoCap } from '../services/householdMimoCap.js'
import { persistRecipe } from '../services/recipePersistence.js'

const tag = `arreglo${Date.now().toString(36)}`
const createdRecipes: string[] = []
const createdIngredients: string[] = []
const createdHouseholds: string[] = []

async function ingredient(name: string, allergenTags: string[]): Promise<string> {
  const [row] = await db.insert(ingredients).values({ name: `${name} ${tag}`, allergenTags }).returning({ id: ingredients.id })
  createdIngredients.push(row.id)
  return row.id
}

const auditFor = (id: string) => db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, id)).orderBy(asc(adminAuditLog.createdAt))

afterAll(async () => {
  if (!reachable) return
  const targets = [...createdRecipes, ...createdHouseholds]
  if (targets.length) await db.delete(adminAuditLog).where(inArray(adminAuditLog.targetId, targets))
  if (createdRecipes.length) await db.delete(recipes).where(inArray(recipes.id, createdRecipes))
  if (createdIngredients.length) await db.delete(ingredients).where(inArray(ingredients.id, createdIngredients))
  if (createdHouseholds.length) await db.delete(households).where(inArray(households.id, createdHouseholds))
})

describe.skipIf(!reachable)('the office’s admin routes against Postgres (PRO-1290)', () => {
  it('both routes are for admins only', async () => {
    const id = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f70'
    const calls: Array<[string, string, unknown]> = [
      ['PATCH', `/admin/catalog-recipes/${id}`, { tags: ['x'] }],
      ['PUT', `/admin/households/${id}/mimo-cap`, { capEur: 10 }],
    ]
    for (const [method, p, body] of calls) {
      const json = { 'content-type': 'application/json' }
      expect((await fetch(`${API_URL}${p}`, { method, headers: json, body: JSON.stringify(body) })).status, p).toBe(401)
      const r = await fetch(`${API_URL}${p}`, { method, headers: { ...json, Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
      expect(r.status, p).toBe(403)
    }
  })

  it('a catalogue recipe fixed, audited with before and after; the allergen audit holds what it must', async () => {
    const flour = await ingredient('Harina de prueba', ['gluten'])
    const egg = await ingredient('Huevo de prueba', ['huevo'])
    const sugar = await ingredient('Azúcar de prueba', [])
    const saved = await persistRecipe(
      {
        name: `Bizcocho de prueba ${tag}`,
        servings: 4,
        meals: ['snack'],
        prepTime: 10,
        cookTime: 30,
        tags: ['horno'],
        ingredients: [
          { ingredientId: flour, quantity: 200, unit: 'g' },
          { ingredientId: egg, quantity: 150, unit: 'g' },
          { ingredientId: sugar, quantity: 100, unit: 'g' },
        ],
        steps: [{ index: 0, text: 'Bate todo y hornea 30 minutos.', durationMin: 30, ingredientRefs: ['ing_0', 'ing_1', 'ing_2'] }],
      },
      { authorId: null, softLint: true },
    )
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    const id = saved.recipeId
    createdRecipes.push(id)
    const [flourRow, eggRow] = saved.ingredientRowIds
    expect(saved.allergens).toEqual(['gluten', 'huevo'])

    // Dropping the egg without confirming it: held, nothing written.
    const lost = await editCatalogRecipe(id, { ingredients: [{ id: flourRow, ingredientId: flour, quantity: 200, unit: 'g' }, { ingredientId: sugar, quantity: 100, unit: 'g' }] }, USER_ID)
    expect(lost).toMatchObject({ ok: false, code: 'ALLERGEN_AUDIT', issues: [{ code: 'ALLERGEN_LOST', lost: ['huevo'] }] })
    // A step naming butter the ingredients lack: held.
    const butter = await editCatalogRecipe(id, { steps: [{ text: 'Funde la mantequilla y mézclala con todo.' }] }, USER_ID)
    expect(butter).toMatchObject({ ok: false, code: 'ALLERGEN_AUDIT', issues: [{ code: 'STEP_MENTIONS' }] })
    expect(await auditFor(id)).toHaveLength(0)
    const [still] = await db.select({ allergens: recipes.allergens, cookTime: recipes.cookTime }).from(recipes).where(eq(recipes.id, id))
    expect(still).toEqual({ allergens: ['gluten', 'huevo'], cookTime: 30 })

    // The fix, confirmed: egg out, times and tags in.
    const fixed = await editCatalogRecipe(
      id,
      {
        ingredients: [{ id: flourRow, ingredientId: flour, quantity: 250, unit: 'g' }, { ingredientId: sugar, quantity: 100, unit: 'g' }],
        steps: [{ text: 'Mezcla la harina con el azúcar y hornea 25 minutos.', durationMin: 25, ingredientRefs: [flourRow, 'ing_1'] }],
        allergens: ['gluten'],
        cookTime: 25,
        tags: ['horno', 'sin huevo'],
        reason: 'prueba',
      },
      USER_ID,
    )
    expect(fixed, JSON.stringify(fixed)).toMatchObject({ ok: true, id, allergens: ['gluten'] })
    if (!fixed.ok) return
    expect(fixed.changed.sort()).toEqual(['allergens', 'cookTime', 'ingredients', 'steps', 'tags'])
    const [row] = await db.select({ allergens: recipes.allergens, cookTime: recipes.cookTime, tags: recipes.tags, authorId: recipes.authorId, status: recipes.status }).from(recipes).where(eq(recipes.id, id))
    expect(row).toEqual({ allergens: ['gluten'], cookTime: 25, tags: ['horno', 'sin huevo'], authorId: null, status: 'published' })
    const ings = await db.select({ id: recipeIngredients.id, quantity: recipeIngredients.quantity }).from(recipeIngredients).where(eq(recipeIngredients.recipeId, id)).orderBy(asc(recipeIngredients.displayOrder))
    expect(ings[0]).toEqual({ id: flourRow, quantity: 250 })
    expect(ings.map((i) => i.id)).not.toContain(eggRow)
    const [step] = await db.select({ refs: recipeSteps.ingredientRefs }).from(recipeSteps).where(eq(recipeSteps.recipeId, id))
    expect(step.refs).toEqual(ings.map((i) => i.id))

    const audit = await auditFor(id)
    expect(audit.map((a) => [a.action, a.adminId, a.targetType])).toEqual([['catalog_recipe.edit', USER_ID, 'recipe']])
    expect(audit[0].payload).toMatchObject({
      name: `Bizcocho de prueba ${tag}`,
      reason: 'prueba',
      before: { allergens: ['gluten', 'huevo'], cookTime: 30, tags: ['horno'] },
      after: { allergens: ['gluten'], cookTime: 25, tags: ['horno', 'sin huevo'] },
    })

    // The same patch again changes nothing: no second row.
    expect(await editCatalogRecipe(id, { cookTime: 25 }, USER_ID)).toMatchObject({ ok: true, changed: [] })
    expect(await auditFor(id)).toHaveLength(1)

    // A user's recipe is not the catalogue's.
    const [own] = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.authorId, USER_ID)).limit(1)
    if (own) expect(await editCatalogRecipe(own.id, { cookTime: 5 }, USER_ID)).toEqual({ ok: false, code: 'NOT_FOUND' })
  }, 30_000)

  it('a household’s Mimo cap: set and audited, read by its members, refused over 3× the plan, back with null', async () => {
    const [house] = await db.insert(households).values({ name: `Casa ${tag}`, ownerId: USER_ID }).returning({ id: households.id })
    createdHouseholds.push(house.id)
    const [me] = await db.select({ primary: users.primaryHouseholdId }).from(users).where(eq(users.id, USER_ID))
    await db.update(users).set({ primaryHouseholdId: house.id }).where(eq(users.id, USER_ID))
    try {
      const plan = env.ADVISOR_MONTHLY_BUDGET_EUR
      const cap = Math.min(plan * 2, maxMimoCapEur())
      const r = await setHouseholdMimoCap(house.id, cap, USER_ID)
      expect(r).toMatchObject({ ok: true, capEur: cap, previousEur: null, planCapEur: plan, maxEur: maxMimoCapEur(), changed: true })
      expect(await householdMimoCapEur(USER_ID)).toBe(cap)
      if (!env.USER_CAP_OVERRIDES_EUR.includes(USER_ID)) expect(await budgetMicrosFor(USER_ID)).toBe(Math.round(cap * 1_000_000))

      expect(await setHouseholdMimoCap(house.id, maxMimoCapEur() + 1, USER_ID)).toMatchObject({ ok: false, code: 'TOO_HIGH' })
      expect(await setHouseholdMimoCap(house.id, cap, USER_ID)).toMatchObject({ ok: true, changed: false })
      expect(await setHouseholdMimoCap(house.id, null, USER_ID)).toMatchObject({ ok: true, capEur: null, previousEur: cap, changed: true })
      expect(await householdMimoCapEur(USER_ID)).toBeUndefined()

      const audit = await auditFor(house.id)
      expect(audit.map((a) => [a.action, a.targetType])).toEqual([['household.mimo_cap', 'household'], ['household.mimo_cap', 'household']])
      expect(audit[0].payload).toMatchObject({ before: { capEur: null }, after: { capEur: cap }, planCapEur: plan })
      expect(audit[1].payload).toMatchObject({ before: { capEur: cap }, after: { capEur: null } })

      expect(await setHouseholdMimoCap('33333333-3333-4333-8333-333333333333', 5, USER_ID)).toEqual({ ok: false, code: 'NOT_FOUND' })
    } finally {
      await db.update(users).set({ primaryHouseholdId: me?.primary ?? null }).where(eq(users.id, USER_ID))
    }
  }, 30_000)
})
