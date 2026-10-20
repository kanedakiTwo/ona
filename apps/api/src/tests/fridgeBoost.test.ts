/**
 * PRO-229 · «¿Qué te queda en la nevera?» before planning. With «medio
 * calabacín y nata» in the fridge and catalogue recipes that use them and fit
 * the household, the next menu includes at least one; what was said stays in
 * the despensa (nevera); a recipe that breaks the household's rules never
 * comes in through the fridge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import catalog from './fixtures/catalog-2026-10-12.json'
import { splitFridgeAnswer, fridgeTerm, weekPlanSchema, type DayMenu } from '@ona/shared'

const pantry: any[] = []
vi.mock('../services/pantryStore.js', () => ({
  NoHouseholdError: class NoHouseholdError extends Error {},
  listPantryForUser: vi.fn(async (_u: string, _db: unknown, opts?: { location?: string }) =>
    pantry.filter((r) => !opts?.location || r.location === opts.location),
  ),
  addPantryForUser: vi.fn(async (_u: string, input: any) => {
    const row = { id: `p-${pantry.length + 1}`, quantity: 1, unit: 'u', storedAt: new Date().toISOString(), ...input }
    pantry.push(row)
    return row
  }),
}))

import { ensureFridgeRecipe, fridgeTermsOf, loadFridgeTerms, recipesUsingFridge, rememberFridge } from '../services/fridgeBoost.js'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import { findForCourse } from '../services/courseAwareMatcher.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import { askedForFridge } from '../services/whatsapp/inbound.js'
import { FRIDGE_QUESTION, WEEKLY_NUDGE_GUIDE, WEEKLY_NUDGE_TEXT } from '../services/whatsapp/proactive.js'
import { weekPlanFromParams } from '../services/assistant/skills.js'

const pool: RecipeWithCourse[] = (catalog as any[]).map((r, i) => ({
  id: `r${i}`,
  name: r.name,
  meals: r.meals,
  seasons: r.seasons,
  mealFit: r.mealFit ?? undefined,
  seasonFit: r.seasonFit ?? undefined,
  frequency: null,
  tags: [],
  allergens: r.allergens,
  course: null,
  ingredients: r.ingredients.map((n: string, j: number) => ({ ingredientId: `i${i}-${j}`, ingredientName: n, quantity: 100, unit: 'g', allergenTags: [] })),
}))
const ANSWER = 'medio calabacín y nata'

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
afterEach(() => vi.restoreAllMocks())

/** The generator's last step (menuGenerator.generateMenu → withFridge) over the catalogue fixture. */
function weekWith(fridgeIds: Set<string>, restrictions: string[] = [], favourites = new Set<string>()) {
  const { days } = buildRandomMenu(defaultTemplate(), pool, 'autumn', restrictions, favourites, {})
  return ensureFridgeRecipe(days, fridgeIds, (dayIndex, meal, used) =>
    findForCourse(pool.filter((r) => fridgeIds.has(r.id)), null, { meal: meal as any, season: 'autumn', usedRecipeIds: used, restrictions, favoriteRecipeIds: favourites, dayIndex }),
  )
}
const recipeIds = (days: DayMenu[]) => days.flatMap((d) => Object.values(d).flatMap((s) => (s?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeId] : []))))

describe('what was said', () => {
  it('splits the answer and keeps the food word', () => {
    expect(splitFridgeAnswer(ANSWER)).toEqual(['medio calabacín', 'nata'])
    expect(splitFridgeAnswer('nada')).toEqual([])
    expect(fridgeTerm('medio calabacín')).toBe('calabacin')
    expect(fridgeTerm('un poco de nata')).toBe('nata')
    expect(weekPlanSchema.safeParse({ fridge: splitFridgeAnswer(ANSWER) }).success).toBe(true)
  })

  it('goes into the despensa as «nevera», once', async () => {
    pantry.length = 0
    await rememberFridge('u-1', splitFridgeAnswer(ANSWER))
    await rememberFridge('u-1', ['Nata'])
    expect(pantry.map((r) => [r.name, r.location])).toEqual([
      ['medio calabacín', 'nevera'],
      ['nata', 'nevera'],
    ])
    expect(await loadFridgeTerms('u-1')).toEqual(['calabacin', 'nata'])
  })

  it('only fresh fridge rows count (last week), not the freezer or the cupboard', () => {
    const now = new Date('2026-10-19T10:00:00Z')
    const at = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
    expect(
      fridgeTermsOf(
        [
          { name: 'medio calabacín', location: 'nevera', quantity: 1, storedAt: at(1) },
          { name: 'nata', location: 'nevera', quantity: 1, storedAt: at(9) },
          { name: 'merluza', location: 'congelador', quantity: 1, storedAt: at(1) },
          { name: 'aceite', location: 'nevera', quantity: 1, storedAt: at(1) },
        ],
        now,
      ),
    ).toEqual(['calabacin'])
  })
})

describe('the next menu uses the fridge', () => {
  const fridgeIds = recipesUsingFridge(pool, ['calabacin', 'nata'])

  it('finds the catalogue recipes with calabacín or nata', () => {
    const names = pool.filter((r) => fridgeIds.has(r.id)).map((r) => r.name)
    expect(names).toContain('Crema de calabacin')
    expect(names).toContain('Espinacas a la crema')
  })

  it('«medio calabacín y nata» → the week always includes at least one recipe that uses them', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(7))
    for (let i = 0; i < 40; i++) {
      const { days } = weekWith(fridgeIds)
      expect(recipeIds(days).some((id) => fridgeIds.has(id))).toBe(true)
    }
  })

  it('puts it as early in the week as it fits, keeping the slot’s diners', () => {
    const noFridge = new Set<string>()
    vi.spyOn(Math, 'random').mockImplementation(seeded(3))
    const base = buildRandomMenu(defaultTemplate(), pool.filter((r) => !fridgeIds.has(r.id)), 'autumn', [], noFridge, {}).days
    base[0].lunch = { servings: 5, dishes: base[0].lunch!.dishes }
    const r = ensureFridgeRecipe(base, fridgeIds, (dayIndex, meal, used) =>
      findForCourse(pool.filter((x) => fridgeIds.has(x.id)), null, { meal: meal as any, season: 'autumn', usedRecipeIds: used, restrictions: [], favoriteRecipeIds: noFridge, dayIndex }),
    )
    expect(r.placed?.dayIndex).toBe(0)
    expect(fridgeIds.has(r.placed!.recipeId)).toBe(true)
    if (r.placed!.meal === 'lunch') expect(r.days[0].lunch?.servings).toBe(5)
  })

  it('never brings in a recipe that breaks the household’s rules (or a locked meal)', () => {
    // Only the «Vegan butter chicken» path: nata recipes that are vegetarian-safe stay possible,
    // but with «vegano» none of the nata recipes (dairy) fits.
    const nataOnly = recipesUsingFridge(pool, ['nata'])
    vi.spyOn(Math, 'random').mockImplementation(seeded(11))
    const { days, placed } = weekWith(nataOnly, ['vegano'])
    expect(placed).toBeNull()
    expect(recipeIds(days).some((id) => nataOnly.has(id))).toBe(false)

    const all = Array.from({ length: 7 }, (_, i) => ({ lunch: { dishes: [{ kind: 'recipe' as const, recipeId: `x${i}` }] } }))
    const locked = Object.fromEntries(all.map((_, i) => [String(i), { lunch: true }]))
    expect(ensureFridgeRecipe(all, fridgeIds, () => ({ id: 'r0', name: 'x' }), locked).placed).toBeNull()
  })
})

describe('asked once a week, in the Sunday message (WhatsApp)', () => {
  it('the Sunday planning message carries the question', () => {
    expect(WEEKLY_NUDGE_TEXT).toContain(FRIDGE_QUESTION)
    expect(WEEKLY_NUDGE_GUIDE.required).toContain(FRIDGE_QUESTION)
  })

  it('a bare photo right after it is the fridge (Mimo reads it), otherwise not', () => {
    expect(askedForFridge([{ direction: 'out', kind: 'weekly_nudge', status: 'sent' }, { direction: 'in', kind: 'image', status: 'received' }])).toBe(true)
    expect(askedForFridge([{ direction: 'out', kind: 'weekly_nudge', status: 'sent' }, { direction: 'out', kind: 'reply', status: 'sent' }])).toBe(false)
    expect(askedForFridge([])).toBe(false)
  })

  it('Mimo passes what is left as `fridge` to generate_weekly_menu', () => {
    expect(weekPlanFromParams({ fridge: ['medio calabacín', 'nata'] })).toEqual({ fridge: ['medio calabacín', 'nata'] })
    expect(weekPlanFromParams({ fridge: ['nata'], answer: 'el jueves cenamos fuera' })).toEqual({ mealsOut: [{ day: 3, meal: 'dinner' }], fridge: ['nata'] })
  })
})
