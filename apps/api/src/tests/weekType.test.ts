/**
 * «Semana tipo» (D-182), phase 1: the turns and «cada 2», «juntos», the
 * table of what wins (§5), a type with no recipes, a concrete recipe that
 * breaks an allergy, the migration from the old pieces, and — above all —
 * that a household that touched nothing gets the very same menu.
 * Design: docs/superpowers/specs/2026-11-11-semana-tipo-design.md.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fullWeekTypeDays,
  plantillaEdits,
  plantillaFromWeekType,
  slotWithoutOptions,
  weekTypeDishLines,
  weekTypeOptionsFor,
  weeksBetween,
  type DayMenu,
  type DayTemplate,
  type WeekTypeDays,
  type WeekTypeSlot,
} from '@ona/shared'
import { buildRandomMenu, defaultTemplate, extractMealDiners, extractMealDishCounts, normalizeMealTemplate } from '../services/menuGenerator.js'
import { applyWeekPlan } from '../services/weekPlan.js'
import { dishTypeForName, legacyWeekType, optionForDishName, parseWeekTypeDays, pickPlantillaOwner, poolOfDishType, recipesForDishName, weekTypeDishTypeIn } from '../services/weekType.js'
import { applyWeekTypeTapers, markWeekTypeConflicts, missingDishTypes, planWeekType, presetRecipeIds, writtenDishBreaks } from '../services/weekTypePlan.js'
import { compileRestrictions } from '../services/dietaryRestrictions.js'
import { dishTypesOf } from '../services/dishTypes.js'
import { seedRecipes } from '../seed/recipes.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

const W1 = '2026-11-09' // a Monday
const W2 = '2026-11-16'
const FRIDAY = 4

function recipe(id: string, name: string, dishTypes: string[] = [], over: Partial<RecipeWithCourse> = {}): RecipeWithCourse {
  return {
    id,
    name,
    authorId: null,
    meals: ['breakfast', 'lunch', 'dinner'],
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

const WHEAT = { ingredientId: 'harina', ingredientName: 'harina de trigo', quantity: 200, unit: 'g', allergenTags: ['gluten'] }
const PIZZA = recipe('pizza', 'Pizza margarita', ['pizza', 'italiano'], { ingredients: [WHEAT] })
const CEVICHE = recipe('ceviche', 'Ceviche', ['ceviche', 'pescado'])
const CARPACCIO = recipe('carpaccio', 'Carpaccio de ternera', ['carpaccio-tartar', 'carne'])
const FILLER = Array.from({ length: 30 }, (_, i) => recipe(`r${i}`, `Guiso ${i}`, ['guisos'], { course: i < 10 ? 'starter' : i < 20 ? 'main' : null }))
const POOL = [PIZZA, CEVICHE, CARPACCIO, ...FILLER]

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
afterEach(() => vi.restoreAllMocks())

/** A week type with some slots set (the rest as by default: lunch and dinner). */
function weekType(slots: Array<[number, 'breakfast' | 'lunch' | 'snack' | 'dinner', WeekTypeSlot]>): WeekTypeDays {
  const days = fullWeekTypeDays()
  for (const [d, m, s] of slots) days[d][m] = s
  return days
}

/** What generateMenu does with a week type, without the DB (one draw). */
function generate(
  days: WeekTypeDays,
  weekStart: string,
  opts: { pool?: RecipeWithCourse[]; restrictions?: string[]; locked?: Record<string, Record<string, boolean>>; existing?: DayMenu[]; skipped?: Set<number>; weekPlan?: Parameters<typeof applyWeekPlan>[2] } = {},
) {
  const pool = opts.pool ?? POOL
  const restrictions = opts.restrictions ?? []
  const plan = planWeekType(days, weekStart, { recipes: pool, restrictions })
  const { template, mealDiners } = applyWeekPlan(plan.template, plan.mealDiners, opts.weekPlan, (d, m) => !!(opts.existing?.[d]?.[m] && opts.locked?.[String(d)]?.[m]))
  const fixed = presetRecipeIds(plan.specs)
  const drawPool = pool.filter((r) => !fixed.has(r.id))
  const out = buildRandomMenu(template, drawPool, 'autumn', restrictions, new Set(), opts.locked ?? {}, opts.existing, undefined, opts.skipped, undefined, undefined, undefined, mealDiners, plan.dishCounts, undefined, undefined, undefined, undefined, plan.specs)
  const final = applyWeekTypeTapers(markWeekTypeConflicts(out.days, plan.conflicts), plan.tapers, { locked: opts.locked, skippedDays: opts.skipped, template })
  return { days: final, warnings: [...plan.warnings, ...out.warnings] }
}

const ids = (slot: DayMenu[string] | undefined) => (slot?.dishes ?? []).map((d) => (d.kind === 'recipe' ? d.recipeId : `note:${d.text}`))

describe('quien no ha tocado nada ve el mismo menú', () => {
  const blobs: unknown[] = [
    undefined,
    { mealTemplate: { lunes: { almuerzo: 2, cena: 2 }, martes: { cena: 3 }, sabado: { desayuno: 1, almuerzo: 4 } }, mealDishCounts: { lunch: 2 } },
    { mealTemplate: { lunes: ['desayuno', 'cena'], viernes: ['almuerzo'] } },
    [{ lunch: true }, {}, { dinner: true }, {}, {}, {}, { breakfast: true, lunch: true }],
  ]
  for (const [i, blob] of blobs.entries()) {
    it(`the migrated week type draws exactly the old plantilla's week (case ${i})`, () => {
      const days = legacyWeekType({ template: blob, facts: [], since: W1 })
      const plan = planWeekType(days, W1, { recipes: POOL, restrictions: [] })
      expect(plan.specs).toEqual({})
      const oldTemplate = normalizeMealTemplate(blob) ?? defaultTemplate()
      // Same slots on (the old template has only `true`s; the new one says false for the rest).
      for (let d = 0; d < 7; d++) for (const m of ['breakfast', 'lunch', 'snack', 'dinner']) expect(!!plan.template[d][m]).toBe(!!oldTemplate[d]?.[m])
      vi.spyOn(Math, 'random').mockImplementation(seeded(11 + i))
      const before = buildRandomMenu(oldTemplate, POOL, 'autumn', [], new Set(), {}, undefined, undefined, undefined, undefined, undefined, undefined, extractMealDiners(blob), extractMealDishCounts(blob))
      vi.spyOn(Math, 'random').mockImplementation(seeded(11 + i))
      const after = buildRandomMenu(plan.template, POOL, 'autumn', [], new Set(), {}, undefined, undefined, undefined, undefined, undefined, undefined, plan.mealDiners, plan.dishCounts, undefined, undefined, undefined, undefined, plan.specs)
      expect(after).toEqual(before)
    })
  }
})

describe('turns and «cada 2»', () => {
  it('a slot by turns takes one option a week from the week it was saved, whether or not the weeks between were cooked', () => {
    const slot: WeekTypeSlot = { options: [{ kind: 'type', type: 'ceviche' }, { kind: 'type', type: 'carpaccio-tartar' }], since: W1 }
    expect(weekTypeOptionsFor(slot, W1)).toEqual([{ kind: 'type', type: 'ceviche' }])
    expect(weekTypeOptionsFor(slot, W2)).toEqual([{ kind: 'type', type: 'carpaccio-tartar' }])
    expect(weekTypeOptionsFor(slot, '2026-11-23')).toEqual([{ kind: 'type', type: 'ceviche' }])
    // A week before it was saved still counts its turn (never a negative index).
    expect(weekTypeOptionsFor(slot, '2026-11-02')).toEqual([{ kind: 'type', type: 'carpaccio-tartar' }])
    expect(weeksBetween(W1, W2)).toBe(1)
  })

  it('«pizza, cada 2» is [Pizza, Cualquier receta]: Friday dinner is a pizza one week and anything the next', () => {
    const days = weekType([[FRIDAY, 'dinner', { options: [{ kind: 'type', type: 'pizza' }, { kind: 'any' }], since: W1 }]])
    expect(ids(generate(days, W1).days[FRIDAY].dinner)).toEqual(['pizza'])
    // The second week asks nothing of that dinner: it draws as any other.
    expect(planWeekType(days, W2, { recipes: POOL, restrictions: [] }).specs).toEqual({})
    expect(generate(days, W2).days[FRIDAY].dinner!.dishes[0].kind).toBe('recipe')
    expect(ids(generate(days, '2026-11-23').days[FRIDAY].dinner)).toEqual(['pizza'])
  })

  it('the turns hold two weeks running', () => {
    const days = weekType([[3, 'dinner', { options: [{ kind: 'type', type: 'ceviche' }, { kind: 'type', type: 'carpaccio-tartar' }], since: W1 }]])
    expect(ids(generate(days, W1).days[3].dinner)).toEqual(['ceviche'])
    expect(ids(generate(days, W2).days[3].dinner)).toEqual(['carpaccio'])
  })
})

describe('«juntos»', () => {
  it('every option in the same meal, one dish each, whatever the meal’s usual number of dishes', () => {
    const days = weekType([[3, 'dinner', { together: true, options: [{ kind: 'type', type: 'ceviche' }, { kind: 'type', type: 'carpaccio-tartar' }, { kind: 'any' }], since: W1 }]])
    const dinner = generate(days, W1).days[3].dinner!
    expect(dinner.dishes).toHaveLength(3)
    expect(ids(dinner).slice(0, 2)).toEqual(['ceviche', 'carpaccio'])
  })

  it('one option in a meal of 2 dishes takes the first; the other is free', () => {
    const days = weekType([[FRIDAY, 'dinner', { dishes: 2, options: [{ kind: 'type', type: 'pizza' }], since: W1 }]])
    const dinner = generate(days, W1).days[FRIDAY].dinner!
    expect(dinner.dishes).toHaveLength(2)
    expect(ids(dinner)[0]).toBe('pizza')
  })
})

describe('what wins (§5)', () => {
  const pizzaFriday = weekType([[FRIDAY, 'dinner', { options: [{ kind: 'type', type: 'pizza' }], since: W1 }]])

  it('1 · a «sin cocinar» day has no slot', () => {
    expect(generate(pizzaFriday, W1, { skipped: new Set([FRIDAY]) }).days[FRIDAY]).toEqual({})
  })

  it('2 · a meal out this week has no slot, even if the week type asks for something', () => {
    expect(generate(pizzaFriday, W1, { weekPlan: { mealsOut: [{ day: FRIDAY, meal: 'dinner' }] } }).days[FRIDAY].dinner).toBeUndefined()
  })

  it('3 · a locked slot stays as it is', () => {
    const existing: DayMenu[] = Array.from({ length: 7 }, () => ({}))
    existing[FRIDAY] = { dinner: { dishes: [{ kind: 'recipe', recipeId: 'r5', recipeName: 'Guiso 5' }] } }
    expect(ids(generate(pizzaFriday, W1, { locked: { [FRIDAY]: { dinner: true } }, existing }).days[FRIDAY].dinner)).toEqual(['r5'])
  })

  it('4 · «no hay» has no slot, unless «¿Viene alguien?» adds that meal this week', () => {
    const off = weekType([[FRIDAY, 'dinner', { off: true, options: [{ kind: 'type', type: 'pizza' }] }]])
    expect(generate(off, W1).days[FRIDAY].dinner).toBeUndefined()
    const guests = generate(off, W1, { weekPlan: { guests: [{ day: FRIDAY, meal: 'dinner', diners: 6 }] } }).days[FRIDAY].dinner!
    expect(guests.servings).toBe(6)
    expect(guests.dishes[0].kind).toBe('recipe')
  })

  it('5 · the school menu filters inside the type: the type’s recipes go through every usual filter', () => {
    // A vegetarian household: the carpaccio (carne) can't come out; Carpaccio is a dish, so its name is written.
    const days = weekType([[3, 'dinner', { options: [{ kind: 'type', type: 'carpaccio-tartar' }], since: W1 }]])
    const out = generate(days, W1, { restrictions: ['vegetariano'], pool: [...POOL.map((r) => (r.id === 'carpaccio' ? { ...r, ingredients: [{ ingredientId: 'ternera', ingredientName: 'ternera', quantity: 200, unit: 'g', allergenTags: [] }] } : r))] })
    expect(ids(out.days[3].dinner)).toEqual(['note:Carpaccio y tartar'])
  })

  it('6 · something fixed with no recipe is the whole meal: «Fijo: …» with its things, or just its name', () => {
    const days = weekType([
      [0, 'breakfast', { options: [{ kind: 'fixed', label: 'Yogur con cereales', items: [{ name: 'yogur', quantity: 1, unit: 'u' }] }], since: W1 }],
      [6, 'dinner', { dishes: 2, options: [{ kind: 'fixed', label: 'Sándwich mixto', items: [] }], since: W1 }],
    ])
    const out = generate(days, W1).days
    expect(out[0].breakfast!.dishes).toEqual([{ kind: 'note', text: 'Fijo: Yogur con cereales', fixed: { items: [{ name: 'yogur', quantity: 1, unit: 'u' }] } }])
    expect(out[6].dinner!.dishes).toEqual([{ kind: 'note', text: 'Sándwich mixto', fixedDish: true }])
  })

  it('6 · the táper of the dinner before, Tuesday lunch', () => {
    const days = weekType([[1, 'lunch', { options: [{ kind: 'taper' }], since: W1 }]])
    const lunch = generate(days, W1).days[1].lunch!
    expect(lunch.taper).toBe(1)
    expect(lunch.dishes[0]).toMatchObject({ variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner' } })
  })

  it('7 · a free slot draws as before', () => {
    const out = generate(pizzaFriday, W1).days
    expect(out[0].lunch!.dishes[0].kind).toBe('recipe')
    expect(out[0].breakfast).toBeUndefined()
  })
})

describe('the chip of a dish drawn for a type (PRO-1186)', () => {
  it('the pizza of Friday dinner says it answers to «Pizza»', () => {
    const days = weekType([[FRIDAY, 'dinner', { options: [{ kind: 'type', type: 'pizza' }], since: W1 }]])
    const dish = generate(days, W1).days[FRIDAY].dinner!.dishes[0]
    expect(dish).toMatchObject({ kind: 'recipe', recipeId: 'pizza', fromWeekType: { type: 'pizza' } })
    // A free slot carries nothing.
    expect(generate(days, W1).days[0].lunch!.dishes[0].fromWeekType).toBeUndefined()
  })
})

describe('a type with no recipe that fits', () => {
  it('a dish (Pizza) is written by its name, with a warning for Cocina', () => {
    const days = weekType([[FRIDAY, 'dinner', { options: [{ kind: 'type', type: 'pizza' }], since: W1 }]])
    const out = generate(days, W1, { pool: FILLER })
    // PRO-1186: the note says it stands for the type with no recipe (the day card warns).
    expect(out.days[FRIDAY].dinner!.dishes).toEqual([{ kind: 'note', text: 'Pizza', fixedDish: true, fromWeekType: { type: 'pizza', missing: true } }])
    expect(missingDishTypes(out.warnings)).toEqual(['pizza'])
  })

  it('a broad type (Carne) takes any recipe, with the warning', () => {
    const days = weekType([[FRIDAY, 'dinner', { options: [{ kind: 'type', type: 'carne' }], since: W1 }]])
    const out = generate(days, W1, { pool: FILLER })
    expect(out.days[FRIDAY].dinner!.dishes[0].kind).toBe('recipe')
    expect(out.days[FRIDAY].dinner!.dishes[0].fromWeekType).toEqual({ type: 'carne', missing: true })
    expect(missingDishTypes(out.warnings)).toEqual(['carne'])
  })
})

describe('a concrete recipe', () => {
  const pizzaRecipe = weekType([[FRIDAY, 'dinner', { options: [{ kind: 'recipe', recipeId: 'pizza', name: 'Pizza margarita' }], since: W1 }]])

  it('goes in as it is, and doesn’t come out again in the week', () => {
    const out = generate(pizzaRecipe, W1).days
    expect(out[FRIDAY].dinner!.dishes).toEqual([{ kind: 'recipe', recipeId: 'pizza', recipeName: 'Pizza margarita', course: null, fixedDish: true }])
    expect(out.flatMap((d, i) => (i === FRIDAY ? [] : Object.values(d).flatMap((s) => ids(s))))).not.toContain('pizza')
  })

  it('that breaks an allergy is not put: the slot is free and says why', () => {
    const out = generate(pizzaRecipe, W1, { restrictions: ['sin gluten'] })
    const dish = out.days[FRIDAY].dinner!.dishes[0]
    expect(dish.kind === 'recipe' && dish.recipeId).not.toBe('pizza')
    expect(dish).toMatchObject({ kind: 'recipe', replaced: { recipeName: 'Pizza margarita', reason: 'restrictions' } })
    expect(out.warnings).toContain(`week_type_recipe_restricted_dinner_d${FRIDAY}`)
  })
})

describe('«Cambiar al azar», regenerating and swap_meal respect the slot', () => {
  const days = weekType([
    [3, 'dinner', { together: true, options: [{ kind: 'type', type: 'ceviche' }, { kind: 'recipe', recipeId: 'carpaccio', name: 'Carpaccio de ternera' }], since: W1 }],
    [FRIDAY, 'dinner', { options: [{ kind: 'type', type: 'pizza' }, { kind: 'any' }], since: W1 }],
  ])
  it('another recipe of that type where it asks for a type; any recipe where it fixed one', () => {
    expect(weekTypeDishTypeIn(days, W1, FRIDAY, 'dinner', 0)).toBe('pizza')
    expect(weekTypeDishTypeIn(days, W2, FRIDAY, 'dinner', 0)).toBeNull()
    expect(weekTypeDishTypeIn(days, W1, 3, 'dinner', 0)).toBe('ceviche')
    expect(weekTypeDishTypeIn(days, W1, 3, 'dinner', 1)).toBeNull()
    expect(poolOfDishType(POOL, 'pizza').map((r) => r.id)).toEqual(['pizza'])
    // A type nothing has: the whole pool.
    expect(poolOfDishType(FILLER, 'pizza')).toHaveLength(FILLER.length)
  })
})

describe('the migration from the old pieces (§7)', () => {
  const fact = (type: string, value: unknown) => ({ type, value })
  const LASANA_VERDURAS = recipe('lv', 'Lasaña de verduras', ['pasta'])
  const LASANA_CARNE = recipe('lc', 'Lasaña de carne', ['pasta'])
  const recipes = [...POOL, LASANA_VERDURAS, LASANA_CARNE]
  const template = {
    mealTemplate: { lunes: { almuerzo: 2, cena: 2 }, martes: { almuerzo: 2, cena: 2 }, miercoles: { almuerzo: 2, cena: 2 }, jueves: { almuerzo: 2, cena: 2 }, viernes: { almuerzo: 2, cena: 2 }, sabado: { almuerzo: 4, cena: 2 }, domingo: { almuerzo: 2, cena: 2 } },
    mealDishCounts: { lunch: 2 },
    fixedMeals: [{ meal: 'breakfast', days: ['lunes'], label: 'Yogur', items: [{ name: 'yogur', quantity: 1, unit: 'u' }] }],
    taperDays: ['martes'],
  }
  const facts = [
    fact('fixed_dish', { dish: 'pizza', days: ['viernes'], meal: 'dinner' }),
    fact('fixed_dish', { dish: 'ceviche', days: ['jueves'], meal: 'dinner' }),
    fact('fixed_dish', { dish: 'lasaña de verduras', days: ['jueves'], meal: 'dinner' }),
    fact('fixed_dish', { dish: 'lasaña', days: ['miercoles'], meal: 'lunch' }),
    fact('fixed_dish', { dish: 'sopa de la abuela', days: ['miercoles'], meal: 'dinner' }),
    fact('fixed_dish', { dish: 'pizza' }), // no day nor meal: stays a taste in the ficha
    fact('skipped_meal', { days: ['sabado'], meal: 'dinner' }), // phase 3: not migrated
  ]
  const migrated = legacyWeekType({ template, facts, recipes, since: W1 })

  it('plantilla, comidas fijas, táper and fixed_dish (a type; the one recipe of that name; else written; two by turns)', () => {
    expect(migrated[5].lunch).toEqual({ diners: 4, dishes: 2 })
    expect(migrated[0].breakfast).toEqual({ options: [{ kind: 'fixed', label: 'Yogur', items: [{ name: 'yogur', quantity: 1, unit: 'u' }] }], since: W1, offWhenFree: true })
    expect(migrated[1].breakfast).toEqual({ off: true })
    expect(migrated[1].lunch).toEqual({ diners: 2, dishes: 2, options: [{ kind: 'taper' }], since: W1 })
    expect(migrated[FRIDAY].dinner!.options).toEqual([{ kind: 'type', type: 'pizza' }])
    expect(migrated[3].dinner!.options).toEqual([{ kind: 'type', type: 'ceviche' }, { kind: 'recipe', recipeId: 'lv', name: 'Lasaña de verduras' }])
    expect(migrated[3].dinner!.together).toBeUndefined()
    expect(migrated[2].lunch!.options).toEqual([{ kind: 'fixed', label: 'Lasaña', items: [] }])
    expect(migrated[2].dinner!.options).toEqual([{ kind: 'fixed', label: 'Sopa de la abuela', items: [] }])
  })

  it('«skipped_meal» is not migrated in phase 1: the dinner stays', () => {
    expect(migrated[5].dinner).toEqual({ diners: 2 })
  })

  it('is the same every time it runs (the boot only creates what is missing)', () => {
    expect(legacyWeekType({ template, facts, recipes, since: W1 })).toEqual(migrated)
    expect(parseWeekTypeDays(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated)
  })

  it('«pizza los viernes» is the type, not always the same pizza; one recipe of a name is that recipe; two or none, the name written', () => {
    expect(optionForDishName('pizza', [PIZZA])).toEqual({ kind: 'type', type: 'pizza' })
    expect(optionForDishName('Pizzas', [PIZZA])).toEqual({ kind: 'type', type: 'pizza' })
    expect(optionForDishName('pizza margarita', [PIZZA])).toEqual({ kind: 'recipe', recipeId: 'pizza', name: 'Pizza margarita' })
    expect(optionForDishName('lasaña', recipes)).toEqual({ kind: 'fixed', label: 'Lasaña', items: [] })
    expect(optionForDishName('sándwich mixto', [])).toEqual({ kind: 'fixed', label: 'Sándwich mixto', items: [] })
    expect(recipesForDishName('pizza', [PIZZA, recipe('own', 'Pizza de casa', [], { authorId: 'u1' })]).household.map((r) => r.id)).toEqual(['own'])
  })

  it('a name is a dish type by its key or its label, singular or plural', () => {
    expect(dishTypeForName('Pizza')).toBe('pizza')
    expect(dishTypeForName('ensalada')).toBe('ensaladas')
    expect(dishTypeForName('legumbre')).toBe('legumbres')
    expect(dishTypeForName('tortillas')).toBe('huevos')
    expect(dishTypeForName('sopa de la abuela')).toBeNull()
  })

  it('a household of several members takes the plantilla of whoever generated its last menu; else the first that isn’t the default; else the owner’s', () => {
    const members = [
      { userId: 'owner', template: [] },
      { userId: 'ana', template: { mealTemplate: { lunes: { cena: 2 } } } },
      { userId: 'luis', template: { taperDays: ['martes'] } },
    ]
    expect(pickPlantillaOwner({ lastMenuUserId: 'luis', ownerId: 'owner', members })).toBe('luis')
    expect(pickPlantillaOwner({ lastMenuUserId: null, ownerId: 'owner', members })).toBe('ana')
    expect(pickPlantillaOwner({ lastMenuUserId: 'gone', ownerId: 'owner', members })).toBe('ana')
    expect(pickPlantillaOwner({ lastMenuUserId: null, ownerId: 'owner', members: [{ userId: 'owner', template: [] }, { userId: 'x', template: { preferences: {} } }] })).toBe('owner')
  })
})

describe('the same menu with comidas fijas, a táper and a plato fijo (§7)', () => {
  // Plantilla: lunch and dinner every day, no breakfast; fixed breakfast on
  // Monday; táper on Tuesday; «pizza el viernes por la noche» in the ficha.
  const blob = {
    mealTemplate: Object.fromEntries(['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'].map((d) => [d, { almuerzo: 2, cena: 2 }])),
    fixedMeals: [{ meal: 'breakfast', days: ['lunes'], label: 'Yogur con cereales', items: [{ name: 'yogur', quantity: 1, unit: 'u' }] }],
    taperDays: ['martes'],
  }
  const days = legacyWeekType({ template: blob, facts: [{ type: 'fixed_dish', value: { dish: 'pizza', days: ['viernes'], meal: 'dinner' } }], recipes: POOL, since: W1 })

  it('gives the week the old pieces gave: the fixed breakfast only on Monday, the táper of Monday’s dinner, a pizza on Friday, the rest drawn', () => {
    for (let i = 0; i < 5; i++) {
      vi.spyOn(Math, 'random').mockImplementation(seeded(40 + i))
      const out = generate(days, W1).days
      expect(out[0].breakfast!.dishes).toEqual([{ kind: 'note', text: 'Fijo: Yogur con cereales', fixed: { items: [{ name: 'yogur', quantity: 1, unit: 'u' }] } }])
      for (let d = 1; d < 7; d++) expect(out[d].breakfast).toBeUndefined()
      expect(out[1].lunch).toMatchObject({ taper: 1, servings: 1 })
      expect(out[1].lunch!.dishes[0]).toMatchObject({ variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner' } })
      expect(ids(out[FRIDAY].dinner)).toEqual(['pizza'])
      for (let d = 0; d < 7; d++) {
        expect(out[d].snack).toBeUndefined()
        expect(out[d].dinner!.servings).toBe(2)
        if (d !== 1) expect(out[d].lunch!.dishes[0].kind).toBe('recipe')
      }
    }
  })
})

describe('removing a comida fija never brings a new meal', () => {
  it('a slot only a comida fija turned on is «no hay» again when it goes (the profile card and Mimo)', () => {
    const blob = { fixedMeals: [{ meal: 'breakfast', days: ['lunes'], label: 'Yogur', items: [{ name: 'yogur', quantity: 1, unit: 'u' }] }] }
    const days = legacyWeekType({ template: blob, facts: [], since: W1 })
    const view = plantillaFromWeekType(days, 2)
    const edits = plantillaEdits(days, view, { ...view, fixedMeals: [] }, W2)
    expect(edits).toEqual([{ day: 0, meal: 'breakfast', slot: { off: true } }])
    // Added on a «no hay» slot from the card, then removed: the same.
    const plain = fullWeekTypeDays()
    const v0 = plantillaFromWeekType(plain, 2)
    const add = plantillaEdits(plain, v0, { ...v0, fixedMeals: blob.fixedMeals as any }, W1)
    expect(add[0].slot).toMatchObject({ offWhenFree: true })
    const withIt = structuredClone(plain)
    withIt[0].breakfast = add[0].slot
    const v1 = plantillaFromWeekType(withIt, 2)
    expect(plantillaEdits(withIt, v1, { ...v1, fixedMeals: [] }, W2)[0].slot).toEqual({ off: true })
  })
})

describe('a dish written with no recipe goes through the allergy and diet check (as PRO-1141)', () => {
  it('«jamón con melón» isn’t written in a vegetarian household: the slot is drawn and says why', () => {
    const days = weekType([[FRIDAY, 'dinner', { options: [{ kind: 'fixed', label: 'Jamón con melón', items: [] }], since: W1 }]])
    const out = generate(days, W1, { restrictions: ['vegetariano'] })
    expect(out.days[FRIDAY].dinner!.dishes[0]).toMatchObject({ kind: 'recipe', replaced: { recipeName: 'Jamón con melón', reason: 'restrictions' } })
    expect(ids(generate(days, W1).days[FRIDAY].dinner)).toEqual(['note:Jamón con melón'])
  })

  it('a dish type with no recipe that fits isn’t written when its name breaks the diet (Pasta in a celiac household): drawn free', () => {
    const days = weekType([[FRIDAY, 'dinner', { options: [{ kind: 'type', type: 'pasta' }], since: W1 }]])
    expect(writtenDishBreaks('Pasta', compileRestrictions(['sin gluten']))).toBe(true)
    expect(ids(generate(days, W1, { pool: FILLER }).days[FRIDAY].dinner)).toEqual(['note:Pasta'])
    const out = generate(days, W1, { pool: FILLER, restrictions: ['sin gluten'] })
    expect(out.days[FRIDAY].dinner!.dishes[0].kind).toBe('recipe')
    expect(missingDishTypes(out.warnings)).toEqual(['pasta'])
  })
})

describe('Perfil → «Platos fijos» lines with «Quitar» (until phase 2)', () => {
  it('lists the slots the card doesn’t show and takes their options away', () => {
    const days = weekType([
      [FRIDAY, 'dinner', { options: [{ kind: 'type', type: 'pizza' }, { kind: 'any' }], since: W1 }],
      [6, 'dinner', { options: [{ kind: 'fixed', label: 'Sándwich mixto', items: [] }], since: W1 }],
      [0, 'breakfast', { options: [{ kind: 'fixed', label: 'Yogur', items: [{ name: 'yogur', quantity: 1, unit: 'u' }] }], since: W1, offWhenFree: true }],
      [1, 'lunch', { options: [{ kind: 'taper' }], since: W1 }],
    ])
    expect(weekTypeDishLines(days)).toEqual([
      { day: FRIDAY, meal: 'dinner', label: 'Pizza / Cualquier receta' },
      { day: 6, meal: 'dinner', label: 'Sándwich mixto' },
    ])
    expect(slotWithoutOptions(days[FRIDAY].dinner!)).toEqual({})
    expect(slotWithoutOptions(days[0].breakfast!)).toEqual({ off: true })
    // The card's «Comidas fijas» shows only what carries its things.
    expect(plantillaFromWeekType(days, 2).fixedMeals.map((f) => f.label)).toEqual(['Yogur'])
  })
})

describe('Perfil → Plantilla semanal writes only what changed', () => {
  it('saving the profile with the same card writes nothing; one diner more writes only that slot and keeps its options', () => {
    const days = weekType([[FRIDAY, 'dinner', { diners: 2, options: [{ kind: 'type', type: 'pizza' }], since: W1 }]])
    const view = plantillaFromWeekType(days, 2)
    expect(plantillaEdits(days, view, structuredClone(view), W2)).toEqual([])
    const after = structuredClone(view)
    after.mealTemplate.viernes.cena = 3
    expect(plantillaEdits(days, view, after, W2)).toEqual([{ day: FRIDAY, meal: 'dinner', slot: { diners: 3, options: [{ kind: 'type', type: 'pizza' }], since: W1 } }])
  })
})

describe('dishTypesOf with real recipes (the seed catalogue)', () => {
  const typesOf = (name: string) => {
    const r = seedRecipes.find((x) => x.name === name)!
    return dishTypesOf({ name: r.name, tags: r.tags, ingredients: r.ingredients.map((i) => ({ ingredientName: i.name, quantity: i.quantity, unit: i.unit })) })
  }
  it.each([
    ['Lentejas guisadas', ['legumbres', 'guisos']],
    ['Garbanzos con sobrasada', ['legumbres']],
    ['Crema de calabacín', ['cremas-sopas', 'verduras']],
    ['Pizza', ['pizza', 'italiano']],
    ['Ceviche', ['pescado', 'ceviche', 'sudamericano']],
    ['Espaguetti carbonara', ['pasta', 'italiano']],
    ['Sushi en bowl', ['arroz', 'japones']],
    ['Fajitas de pollo', ['pollo', 'mexicano']],
    ['Sandwich mixto', ['bocadillos']],
    ['Huevos al plato', ['huevos']],
    ['Guisantes lágrima', ['verduras']],
    ['Curry cremoso de tofu', ['indio']],
    ['Tabule', ['ensaladas', 'oriente-medio']],
    ['Wok de ternera y verduras', ['carne', 'chino-wok']],
  ])('%s → %j', (name, expected) => {
    expect(typesOf(name)).toEqual(expected)
  })

  it('soja and tofu are not a pulse (the old script’s mistake)', () => {
    expect(dishTypesOf({ name: 'Salteado de tofu', ingredients: [{ ingredientName: 'tofu', quantity: 300, unit: 'g' }, { ingredientName: 'salsa de soja', quantity: 30, unit: 'ml' }] })).not.toContain('legumbres')
  })
})
