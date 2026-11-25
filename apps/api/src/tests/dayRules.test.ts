/**
 * PRO-1296 · Las normas por día de la semana tipo: a fixed recipe on Tuesday
 * dinner, legumes on Thursday dinner, no lunch Monday to Friday and nothing at
 * the weekend. 20 draws of the generator (as `generateMenu` does them, the
 * fridge dish included) never break one; what places dishes on its own (the
 * fridge dish, the sign-up's dishes) never takes what the week type asks for;
 * what couldn't be kept is said to Mimo with a way out. The same with the
 * real API and the changes («Cambiar», Mimo's swap_meal): `dayRules.smoke.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { fullWeekTypeDays, type DayMenu, type RecipeDish, type WeekTypeDays } from '@ona/shared'
import { buildRandomMenu } from '../services/menuGenerator.js'
import { ensureFridgeRecipe } from '../services/fridgeBoost.js'
import { placeSignupDishes } from '../services/signupFirstMenu.js'
import { applyWeekTypeTapers, asksWeekType, markWeekTypeConflicts, planWeekType, presetRecipeIds, presetSlots, unmetRulesLine } from '../services/weekTypePlan.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

const W = '2026-11-30' // a Monday

function recipe(id: string, name: string, dishTypes: string[] = [], over: Partial<RecipeWithCourse> = {}): RecipeWithCourse {
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
    dishTypes,
    ingredients: [{ ingredientId: `i-${id}`, ingredientName: 'cebolla', quantity: 100, unit: 'g', allergenTags: [] }],
    ...over,
  } as RecipeWithCourse
}

const FIXED = recipe('fijo', 'Merluza en salsa verde')
const LEGUMES = Array.from({ length: 4 }, (_, i) => recipe(`leg${i}`, `Lentejas ${i}`, ['legumbres']))
const POOL = [FIXED, ...LEGUMES, ...Array.from({ length: 30 }, (_, i) => recipe(`r${i}`, `Plato ${i}`))]

/** No lunch Monday to Friday, Tuesday dinner fixed, Thursday dinner legumes, nothing at the weekend. */
function household(): WeekTypeDays {
  const days = fullWeekTypeDays()
  for (let d = 0; d < 5; d++) days[d].lunch = { off: true }
  days[1].dinner = { options: [{ kind: 'recipe', recipeId: FIXED.id, name: FIXED.name }], since: W }
  days[3].dinner = { options: [{ kind: 'type', type: 'legumbres' }], since: W }
  for (const d of [5, 6]) {
    days[d].lunch = { off: true }
    days[d].dinner = { off: true }
  }
  return days
}

/** One week as `generateMenu` makes it (without the DB): plan, draw, fridge dish, conflicts, tápers. */
function generate(fridgeIds: Set<string>) {
  const plan = planWeekType(household(), W, { recipes: POOL, restrictions: [] })
  const fixed = presetRecipeIds(plan.specs)
  const drawPool = POOL.filter((r) => !fixed.has(r.id))
  const out = buildRandomMenu(plan.template, drawPool, 'autumn', [], new Set(), {}, undefined, undefined, undefined, undefined, undefined, undefined, plan.mealDiners, plan.dishCounts, undefined, undefined, undefined, undefined, plan.specs)
  const withFridge = ensureFridgeRecipe(out.days, fridgeIds, (_d, _m, used) => POOL.find((r) => fridgeIds.has(r.id) && !used.has(r.id)), presetSlots(plan.specs)).days
  return applyWeekTypeTapers(markWeekTypeConflicts(withFridge, plan.conflicts), plan.tapers, { template: plan.template })
}

function brokenRules(days: DayMenu[]): string[] {
  const out: string[] = []
  for (let d = 0; d < 7; d++) {
    for (const meal of ['breakfast', 'lunch', 'snack', 'dinner']) {
      const has = (days[d]?.[meal]?.dishes?.length ?? 0) > 0
      const cooked = d < 5 && meal === 'dinner'
      if (has !== cooked) out.push(`d${d} ${meal}: ${has ? 'no se cocina y tiene plato' : 'falta'}`)
    }
  }
  const tue = days[1]?.dinner?.dishes?.[0]
  if (tue?.kind !== 'recipe' || tue.recipeId !== FIXED.id) out.push('martes cena: no es su plato fijo')
  const thu = days[3]?.dinner?.dishes?.[0]
  if (thu?.kind !== 'recipe' || !thu.recipeId.startsWith('leg')) out.push('jueves cena: no son legumbres')
  days.forEach((day, d) => {
    for (const [meal, slot] of Object.entries(day ?? {})) {
      if (!(d === 1 && meal === 'dinner') && slot?.dishes?.some((x) => x.kind === 'recipe' && x.recipeId === FIXED.id)) out.push(`d${d} ${meal}: el plato fijo, repetido`)
    }
  })
  return out
}

describe('normas por día (PRO-1296)', () => {
  it('20 generations: never a meal on a day it isn\'t cooked, always the fixed Tuesday and Thursday\'s legumes', () => {
    let seed = 1296
    vi.spyOn(Math, 'random').mockImplementation(() => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed / 4294967296
    })
    try {
      // The fridge has what only a legume dish uses: the fridge dish never takes Thursday's place.
      for (let i = 0; i < 20; i++) expect(brokenRules(generate(new Set([LEGUMES[3].id]))), `generación ${i + 1}`).toEqual([])
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('the fridge dish never replaces what the week type asks for (its recipe, a dish of its type)', () => {
    const days: DayMenu[] = Array.from({ length: 7 }, () => ({}))
    days[0].dinner = { dishes: [{ kind: 'recipe', recipeId: 'leg0', recipeName: 'Lentejas 0', fromWeekType: { type: 'legumbres' } } as RecipeDish] }
    days[1].dinner = { dishes: [{ kind: 'recipe', recipeId: 'fijo', recipeName: FIXED.name, fixedDish: true } as RecipeDish] }
    days[2].dinner = { dishes: [{ kind: 'recipe', recipeId: 'r1', recipeName: 'Plato 1' } as RecipeDish] }
    const out = ensureFridgeRecipe(days, new Set(['nevera']), () => ({ id: 'nevera', name: 'Con lo de la nevera' }))
    expect(out.placed).toEqual({ dayIndex: 2, meal: 'dinner', recipeId: 'nevera' })
  })

  it('the sign-up\'s dishes never replace what the week type asks for', () => {
    const days: DayMenu[] = Array.from({ length: 2 }, () => ({}))
    days[0].dinner = { dishes: [{ kind: 'recipe', recipeId: 'leg0', recipeName: 'Lentejas 0', fromWeekType: { type: 'legumbres' } } as RecipeDish] }
    days[1].dinner = { dishes: [{ kind: 'recipe', recipeId: 'r1', recipeName: 'Plato 1', fromWeekType: { type: 'pizza', missing: true } } as RecipeDish] }
    const out = placeSignupDishes(days, [{ dish: 'pollo asado', recipe: { id: 'pollo', name: 'Pollo asado' } }])
    expect(out.placed).toEqual([{ dish: 'pollo asado', dayIndex: 1, meal: 'dinner', recipeName: 'Pollo asado' }])
    expect(out.days[0].dinner?.dishes[0]).toMatchObject({ recipeId: 'leg0' })
  })

  it('asksWeekType: its recipe and a dish of its type, not the stand-in when none fitted', () => {
    expect(asksWeekType({ kind: 'recipe', recipeId: 'a', fixedDish: true } as RecipeDish)).toBe(true)
    expect(asksWeekType({ kind: 'note', text: 'Pizza', fixedDish: true })).toBe(true)
    expect(asksWeekType({ kind: 'recipe', recipeId: 'a', fromWeekType: { type: 'legumbres' } } as RecipeDish)).toBe(true)
    expect(asksWeekType({ kind: 'recipe', recipeId: 'a', fromWeekType: { type: 'carne', missing: true } } as RecipeDish)).toBe(false)
    expect(asksWeekType({ kind: 'recipe', recipeId: 'a' } as RecipeDish)).toBe(false)
  })
})

describe('lo que no se ha podido cumplir, dicho a Mimo (PRO-1296)', () => {
  it('each rule not kept, by day and meal, with the instruction to say it and propose a way out', () => {
    const line = unmetRulesLine([
      'dish_type_missing_pizza_dinner_d4',
      'dish_type_missing_carne_lunch_d5',
      'week_type_recipe_restricted_dinner_d1',
      'light_short_dinner_d2',
      'no_main_available_dinner_d3',
    ])
    expect(line).toMatch(/no le preguntes si quiere que lo arregle/)
    expect(line).toMatch(/propón una salida/)
    expect(line).toContain('- viernes, cena: ninguna receta de «Pizza» encaja con la casa; lo he dejado escrito («Pizza», sin receta).')
    expect(line).toContain('- sábado, comida: ninguna receta de «Carne» encaja con la casa; he puesto otra receta.')
    expect(line).toContain('- martes, cena: el plato de su semana tipo no encaja con las alergias o la dieta de casa; he puesto otro.')
    expect(line).toContain('- miércoles, cena: ningún plato ligero encajaba; he puesto el que más se acerca.')
    expect(line).toContain('- jueves, cena: ninguna receta encaja con todo lo que han dicho; se ha quedado sin plato.')
  })

  it('nothing to say when every rule was kept (other warnings aside)', () => {
    expect(unmetRulesLine([])).toBe('')
    expect(unmetRulesLine(['something_else'])).toBe('')
  })
})
