/**
 * PRO-1141: los platos fijos de la ficha («pizza el viernes por la noche»)
 * entran en el menú su día, pasan por las alergias y la dieta, y
 * «Cambiar al azar» no los pisa.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { isFixedDish, type DayMenu, type RecipeDish } from '@ona/shared'
import { fichaMenuConstraints, fixedDishOf, type HouseholdFicha, type ReadableFact } from '../services/profile/reader.js'
import {
  lockedWithFixedDishes,
  markFixedDishConflicts,
  recipesForFixedDish,
  resolveFichaFixedDishes,
  templateWithoutFixedDishes,
  withFichaFixedDishes,
} from '../services/fichaFixedDishes.js'
import { buildRandomMenu, countOutsideFavorites, defaultTemplate } from '../services/menuGenerator.js'
import { applyTemplateTapers } from '../services/taper.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

const FRIDAY = 4
const SUNDAY = 6

let n = 0
function fact(type: string, value: unknown): ReadableFact {
  n += 1
  return { id: `f${n}`, subjectUserId: null, subjectPersonId: null, type, value, origin: 'user', confidence: 1, validUntil: null, sourceMemoryId: null, status: 'active' }
}
const ficha = (facts: ReadableFact[]): HouseholdFicha => ({ householdId: 'h1', portrait: null, persons: [], facts })

const PIZZA_FRIDAY = fact('fixed_dish', { dish: 'pizza', days: ['viernes'], meal: 'dinner' })
const SANDWICH_SUNDAY = fact('fixed_dish', { dish: 'sándwich mixto', days: ['domingo'], meal: 'dinner' })

function recipe(id: string, name: string, over: Partial<RecipeWithCourse> = {}): RecipeWithCourse {
  return {
    id,
    name,
    authorId: null,
    meals: ['lunch', 'dinner'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    frequency: null,
    tags: [],
    allergens: [],
    course: null,
    ingredients: [{ ingredientId: `i-${id}`, ingredientName: 'cebolla', quantity: 100, unit: 'g', allergenTags: [] }],
    ...over,
  }
}

const WHEAT = { ingredientId: 'harina', ingredientName: 'harina de trigo', quantity: 200, unit: 'g', allergenTags: ['gluten'] }
const PIZZA = recipe('pizza', 'Pizza margarita', { ingredients: [WHEAT, { ingredientId: 'tomate', ingredientName: 'tomate', quantity: 100, unit: 'g', allergenTags: [] }] })
const POOL: RecipeWithCourse[] = [PIZZA, ...Array.from({ length: 30 }, (_, i) => recipe(`r${i}`, `Guiso ${i}`))]

/** The generator's steps for one week (menuGenerator.generateMenu), with the ficha's fixed dishes. */
function generateWeek(f: HouseholdFicha, pool: RecipeWithCourse[], restrictions: string[] = [], rawTemplate: unknown = undefined) {
  const base = defaultTemplate()
  const fixed = resolveFichaFixedDishes(fichaMenuConstraints(f).fixedDishes, pool, restrictions, { template: base })
  const template = templateWithoutFixedDishes(base, fixed.slots)
  const ids = new Set(fixed.slots.flatMap((s) => (s.dish.kind === 'recipe' ? [s.dish.recipeId] : [])))
  const drawn = buildRandomMenu(template, pool.filter((r) => !ids.has(r.id)), 'autumn', restrictions, new Set(), {})
  const days = withFichaFixedDishes(markFixedDishConflicts(drawn.days, fixed.conflicts), fixed.slots)
  return { days: applyTemplateTapers(days, rawTemplate, lockedWithFixedDishes({}, fixed.slots), []), fixed }
}

const dishesOf = (days: DayMenu[], day: number, meal: string) => days[day]?.[meal]?.dishes ?? []

describe('the ficha reader returns the fixed dishes', () => {
  it('with their day (0 = Monday) and meal, in the ficha’s order', () => {
    expect(fichaMenuConstraints(ficha([PIZZA_FRIDAY, SANDWICH_SUNDAY])).fixedDishes).toEqual([
      { dish: 'pizza', days: [FRIDAY], meal: 'dinner' },
      { dish: 'sándwich mixto', days: [SUNDAY], meal: 'dinner' },
    ])
  })

  it('leaves out one without days or without a meal, and anything malformed', () => {
    const c = fichaMenuConstraints(ficha([
      fact('fixed_dish', { dish: 'paella' }),
      fact('fixed_dish', { dish: 'paella', days: ['domingo'] }),
      fact('fixed_dish', { dish: 'lentejas', meal: 'lunch' }),
      fact('fixed_dish', { dish: '', days: ['lunes'], meal: 'lunch' }),
      fact('fixed_dish', 'pizza'),
    ]))
    expect(c.fixedDishes).toEqual([])
    expect(fichaMenuConstraints(null).fixedDishes).toEqual([])
  })

  it('folds repeated days and sorts them', () => {
    expect(fixedDishOf({ dish: 'tortilla', days: ['sabado', 'lunes', 'sabado'], meal: 'lunch' })).toEqual({ dish: 'tortilla', days: [0, 5], meal: 'lunch' })
  })
})

describe('the generator puts the fixed dish first', () => {
  it('«pizza el viernes por la noche»: Friday’s dinner is a pizza two weeks running', () => {
    for (let week = 0; week < 2; week++) {
      const { days } = generateWeek(ficha([PIZZA_FRIDAY]), POOL)
      const dinner = dishesOf(days, FRIDAY, 'dinner')
      expect(dinner).toHaveLength(1)
      expect(dinner[0]).toMatchObject({ kind: 'recipe', recipeId: 'pizza', recipeName: 'Pizza margarita', fixedDish: true })
      // The pizza doesn't come out again in the week.
      const others = days.flatMap((d, i) => Object.entries(d).flatMap(([m, s]) => (i === FRIDAY && m === 'dinner' ? [] : s?.dishes ?? [])))
      expect(others.some((d) => d.kind === 'recipe' && d.recipeId === 'pizza')).toBe(false)
    }
  })

  it('looks in the household’s own recipes before the catalogue', () => {
    const mine = recipe('mi-pizza', 'Pizza de la abuela', { authorId: 'u1' })
    expect(recipesForFixedDish('pizza', [PIZZA, mine])).toEqual({ household: [mine], catalogue: [PIZZA] })
    const { days } = generateWeek(ficha([PIZZA_FRIDAY]), [...POOL, mine])
    expect(dishesOf(days, FRIDAY, 'dinner')[0]).toMatchObject({ recipeId: 'mi-pizza' })
  })

  it('matches by whole words, accents and plurals aside', () => {
    const sandwich = recipe('sm', 'Sándwiches mixtos con huevo')
    expect(recipesForFixedDish('sandwich mixto', [sandwich, recipe('x', 'Sandwichera de verano')]).catalogue).toEqual([sandwich])
  })

  it('no recipe matches → the dish’s name, nothing on the list', () => {
    const { days } = generateWeek(ficha([SANDWICH_SUNDAY]), POOL)
    expect(dishesOf(days, SUNDAY, 'dinner')).toEqual([{ kind: 'note', text: 'Sándwich mixto', fixedDish: true }])
  })

  it('a «sin cocinar» day, a meal the week has off and a locked slot keep winning', () => {
    const fixed = [{ dish: 'pizza', days: [FRIDAY], meal: 'dinner' as const }]
    expect(resolveFichaFixedDishes(fixed, POOL, [], { template: defaultTemplate(), skippedDays: new Set([FRIDAY]) }).slots).toEqual([])
    const noDinner = defaultTemplate().map((d, i) => (i === FRIDAY ? { lunch: true } : d))
    expect(resolveFichaFixedDishes(fixed, POOL, [], { template: noDinner }).slots).toEqual([])
    const existing: DayMenu[] = Array.from({ length: 7 }, () => ({}))
    existing[FRIDAY] = { dinner: { dishes: [{ kind: 'recipe', recipeId: 'r1' }] } }
    expect(resolveFichaFixedDishes(fixed, POOL, [], { template: defaultTemplate(), lockedSlots: { [FRIDAY]: { dinner: true } }, existingDays: existing }).slots).toEqual([])
  })

  it('a táper day doesn’t overwrite a fixed lunch, and the next day’s táper can be of the fixed dinner', () => {
    const lunchFixed = fact('fixed_dish', { dish: 'pizza', days: ['sabado'], meal: 'lunch' })
    const { days } = generateWeek(ficha([lunchFixed]), POOL, [], { taperDays: ['sabado'] })
    expect(dishesOf(days, 5, 'lunch')[0]).toMatchObject({ recipeId: 'pizza', fixedDish: true })
  })

  it('«Rehacer con mis favoritas» doesn’t count the fixed dish as outside them', () => {
    const { days } = generateWeek(ficha([PIZZA_FRIDAY]), POOL)
    const favs = new Set(days.flatMap((d) => Object.values(d).flatMap((s) => (s?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' && x.recipeId !== 'pizza' ? [x.recipeId] : [])))))
    expect(countOutsideFavorites(days, favs)).toBe(0)
  })
})

describe('the same allergy and diet check as any dish', () => {
  it('a pizza with gluten doesn’t go into a celiac household: the dish says why', () => {
    const { days, fixed } = generateWeek(ficha([PIZZA_FRIDAY]), POOL, ['sin gluten'])
    expect(fixed.slots).toEqual([])
    expect(fixed.warnings).toEqual([`fixed_dish_restricted_dinner_d${FRIDAY}`])
    const dinner = dishesOf(days, FRIDAY, 'dinner')
    expect(dinner.some((d) => d.kind === 'recipe' && d.recipeId === 'pizza')).toBe(false)
    expect((dinner[0] as RecipeDish).replaced).toEqual({ recipeName: 'Pizza', reason: 'restrictions' })
    expect(isFixedDish(dinner[0])).toBe(false)
  })

  it('a gluten-free pizza does go in', () => {
    const gf = recipe('pizza-sg', 'Pizza sin gluten de verduras')
    const { days } = generateWeek(ficha([PIZZA_FRIDAY]), [...POOL, gf], ['sin gluten'])
    expect(dishesOf(days, FRIDAY, 'dinner')[0]).toMatchObject({ recipeId: 'pizza-sg', fixedDish: true })
  })

  it('with no recipe, a name that breaks the diet is not written either', () => {
    const fixed = [{ dish: 'jamón con melón', days: [FRIDAY], meal: 'dinner' as const }]
    const out = resolveFichaFixedDishes(fixed, POOL, ['vegetariano'], { template: defaultTemplate() })
    expect(out.slots).toEqual([])
    expect(out.conflicts).toEqual([{ dayIndex: FRIDAY, meal: 'dinner', dish: 'jamón con melón' }])
  })

  it('a recipe vetoed this week is not put; with every match vetoed the slot is generated as usual', () => {
    const fixed = [{ dish: 'pizza', days: [FRIDAY], meal: 'dinner' as const }]
    const out = resolveFichaFixedDishes(fixed, POOL, [], { template: defaultTemplate(), bannedRecipeIds: new Set(['pizza']) })
    expect(out).toEqual({ slots: [], conflicts: [], warnings: [] })
  })
})

describe('isFixedDish', () => {
  it('a táper copied from the fixed dinner is not itself fixed', () => {
    expect(isFixedDish({ kind: 'recipe', recipeId: 'pizza', fixedDish: true })).toBe(true)
    expect(isFixedDish({ kind: 'recipe', recipeId: 'pizza', fixedDish: true, variant: 'leftover', leftoverOf: { day: 4, meal: 'dinner', dishPosition: 0 } })).toBe(false)
    expect(isFixedDish({ kind: 'note', text: 'Pizza', fixedDish: true })).toBe(true)
    expect(isFixedDish({ kind: 'note', text: 'Pizza' })).toBe(false)
  })
})
