/**
 * PRO-225 · «Antes de planificar»: «¿Alguna comida fuera de casa esta
 * semana?» / «¿Viene alguien?» shape only that week's menu. «El jueves
 * cenamos fuera y el sábado somos 6» drops Thursday's dinner and puts 6
 * diners on Saturday; the household's plantilla never changes.
 */
import { describe, expect, it, vi } from 'vitest'
import catalog from './fixtures/catalog-2026-10-12.json'
import { parseWeekPlanAnswer, weekPlanSchema, type DayMenu, type WeekPlan } from '@ona/shared'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

vi.mock('../services/menuGenerator.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/menuGenerator.js')>()
  const { applyWeekPlan } = await import('../services/weekPlan.js')
  // The generator's own glue (menuGenerator.generateMenu) without the DB: the
  // household's plantilla is the default one, the pool the catalogue fixture.
  return {
    ...real,
    generateMenu: vi.fn(async (_u: string, _w: string, _t: unknown, _db: unknown, locked: any, existing: any, banned: any, skipped: any, plan?: WeekPlan) => {
      const { template, mealDiners } = applyWeekPlan(real.defaultTemplate(), real.extractMealDiners(null), plan)
      return real.buildRandomMenu(template, pool, 'autumn', [], new Set(), locked ?? {}, existing, banned, skipped, [], undefined, undefined, mealDiners)
    }),
  }
})
vi.mock('../services/calorieCalculator.js', () => ({ calculateMenuCaloriesFromDB: vi.fn(async () => 0) }))
vi.mock('../services/nutrientCalculator.js', () => ({ calculateMenuNutrientsFromDB: vi.fn(async () => ({})) }))
vi.mock('../services/nutrientBalance.js', () => ({ updateBalance: vi.fn(async () => {}) }))
vi.mock('../services/notificationScheduler.js', () => ({ enqueuePrepAlertsForMenu: vi.fn(async () => ({ inserted: 0, skipped: 0 })) }))
vi.mock('../services/menuFit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/menuFit.js')>()),
  evaluateAndSaveMenuFit: vi.fn(async () => null),
}))
vi.mock('../services/scopeResolver.js', () => ({
  resolveScope: vi.fn(async (userId: string) => ({ kind: 'user', value: userId })),
  scopeWhere: vi.fn(() => ({})),
  getPrimaryHouseholdId: vi.fn(async () => null),
}))

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

import { applyWeekPlan, describeWeekPlan } from '../services/weekPlan.js'
import { defaultTemplate } from '../services/menuGenerator.js'
import { skills } from '../services/assistant/skills.js'
import { WEEKLY_NUDGE_GUIDE, WEEKLY_NUDGE_TEXT, WEEK_PLAN_QUESTIONS } from '../services/whatsapp/proactive.js'

const ANSWER = 'el jueves cenamos fuera y el sábado somos 6'

describe('parseWeekPlanAnswer (free text from WhatsApp)', () => {
  it('reads «el jueves cenamos fuera y el sábado somos 6»', () => {
    expect(parseWeekPlanAnswer(ANSWER)).toEqual({ mealsOut: [{ day: 3, meal: 'dinner' }], guests: [{ day: 5, diners: 6 }] })
  })

  it('reads a whole day out, a meal with guests, numbers in words, and nothing from small talk', () => {
    expect(parseWeekPlanAnswer('El viernes estamos fuera. El domingo comemos cuatro')).toEqual({ mealsOut: [{ day: 4 }] })
    expect(parseWeekPlanAnswer('el domingo a comer seremos ocho')).toEqual({ guests: [{ day: 6, meal: 'lunch', diners: 8 }] })
    expect(parseWeekPlanAnswer('nada, todo normal')).toEqual({})
    expect(weekPlanSchema.safeParse(parseWeekPlanAnswer(ANSWER)).success).toBe(true)
  })
})

describe('the Sunday planning message (WhatsApp)', () => {
  it('asks both questions in the same message, not in another one', () => {
    expect(WEEKLY_NUDGE_TEXT).toContain('¿te preparo el menú de la semana que viene?')
    for (const q of WEEK_PLAN_QUESTIONS) {
      expect(WEEKLY_NUDGE_TEXT).toContain(q)
      expect(WEEKLY_NUDGE_GUIDE.required).toContain(q)
    }
  })
})

describe('applyWeekPlan (pure)', () => {
  it('drops Thursday dinner, sets 6 on Saturday and leaves the plantilla untouched', () => {
    const template = defaultTemplate()
    const before = JSON.stringify(template)
    const out = applyWeekPlan(template, Array.from({ length: 7 }, () => ({}) as any), parseWeekPlanAnswer(ANSWER))
    expect(out.template[3].dinner).toBe(false)
    expect(out.template[3].lunch).toBe(true)
    expect(out.mealDiners[5]).toEqual({ lunch: 6, dinner: 6 })
    expect(out.mealDiners[4]).toEqual({})
    expect(JSON.stringify(template)).toBe(before)
  })

  it('never drops a locked slot', () => {
    const out = applyWeekPlan(defaultTemplate(), [], { mealsOut: [{ day: 3 }] }, (d, m) => d === 3 && m === 'dinner')
    expect(out.template[3]).toMatchObject({ lunch: false, dinner: true })
  })

  it('describes the plan for Mimo', () => {
    expect(describeWeekPlan(parseWeekPlanAnswer(ANSWER))).toBe('sin la cena del jueves; sábado: 6 comensales')
  })
})

/** Fake drizzle: queued answers; records inserted values and any update. */
function makeDb(...responses: any[]) {
  const queue = [...responses]
  const calls = { inserted: [] as any[], updates: 0 }
  const node: any = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'then') return (res: any) => Promise.resolve(queue.shift()).then(res)
        if (prop === 'update') return () => { calls.updates++; return node }
        if (prop === 'values') return (v: any) => { calls.inserted.push(v); return node }
        if (prop === 'returning') return () => Promise.resolve([{ id: 'm-new', ...calls.inserted[calls.inserted.length - 1] }])
        return () => node
      },
    },
  )
  return { db: node, calls }
}

describe('generate_weekly_menu with the answers (Mimo, WhatsApp)', () => {
  const skill = skills.find((s) => s.name === 'generate_weekly_menu')!
  const recipeCount = (slot: DayMenu[string]) => (slot?.dishes ?? []).filter((d) => d.kind === 'recipe').length

  for (const [label, params] of [
    ['the user\'s text', { nextWeek: true, answer: ANSWER }],
    ['structured fields', { nextWeek: true, mealsOut: [{ day: 3, meal: 'dinner' }], guests: [{ day: 5, diners: 6 }] }],
  ] as const) {
    it(`«${ANSWER}» (${label}): no Thursday dinner, 6 on Saturday, plantilla untouched`, async () => {
      const { db, calls } = makeDb([], undefined, undefined)
      const r = await skill.handler(params, { userId: 'u-1', db } as any)
      const days = calls.inserted[0].days as DayMenu[]
      expect(days[3].dinner).toBeUndefined()
      expect(recipeCount(days[3].lunch)).toBe(1)
      expect(days[5].lunch?.servings).toBe(6)
      expect(days[5].dinner?.servings).toBe(6)
      expect(days[4].dinner?.servings).toBeUndefined()
      expect(recipeCount(days[2].dinner)).toBe(1)
      // Only inserts (menu + log): the profile's plantilla is never written.
      expect(calls.updates).toBe(0)
      expect(r.summary).toContain('Solo esta semana (la plantilla no cambia): sin la cena del jueves; sábado: 6 comensales')
    })
  }

  it('without answers, the week follows the plantilla', async () => {
    const { db, calls } = makeDb([], undefined, undefined)
    const r = await skill.handler({ nextWeek: true }, { userId: 'u-1', db } as any)
    const days = calls.inserted[0].days as DayMenu[]
    expect(recipeCount(days[3].dinner)).toBe(1)
    expect(days[5].lunch?.servings).toBeUndefined()
    expect(r.summary).not.toContain('Solo esta semana')
  })
})

describe('the /menu questions → POST /menu/generate body (form ↔ schema contract)', () => {
  it('builds a plan the API accepts, and nothing when skipped', async () => {
    const { buildWeekPlan, mealsByDay } = await import('../../../web/src/lib/weekPlanForm')
    expect(buildWeekPlan([], {})).toBeUndefined()
    const plan = buildWeekPlan(['3:dinner'], { 5: 6 })
    expect(plan).toEqual({ mealsOut: [{ day: 3, meal: 'dinner' }], guests: [{ day: 5, diners: 6 }] })
    expect(weekPlanSchema.safeParse(plan).success).toBe(true)
    // Garbage from the UI never reaches the API.
    expect(buildWeekPlan(['9:dinner', 'x:lunch'], { 2: 0, 4: 30 })).toBeUndefined()
    expect(mealsByDay([{ dinner: {}, lunch: {} }, {}])[0]).toEqual(['lunch', 'dinner'])
    expect(mealsByDay(undefined)[6]).toEqual(['lunch', 'dinner'])
    // PRO-229: «¿Qué te queda en la nevera?» travels in the same body.
    const withFridge = buildWeekPlan([], {}, 'medio calabacín, nata')
    expect(withFridge).toEqual({ fridge: ['medio calabacín', 'nata'] })
    expect(weekPlanSchema.safeParse(withFridge).success).toBe(true)
  })
})

/**
 * PRO-275 (revisor de Mimo, 2026-10-18): «un menú para dos» in a household of
 * 4 came out with the saved diners. `diners` puts them on every meal of that
 * week only; the plantilla never changes.
 */
describe('«hazme el menú para dos» in a household of 4 (PRO-275)', () => {
  const skill = skills.find((s) => s.name === 'generate_weekly_menu')!

  it('applyWeekPlan puts the diners on every planned meal; guests and meals out still win', () => {
    const out = applyWeekPlan(defaultTemplate(), Array.from({ length: 7 }, () => ({ lunch: 4, dinner: 4 }) as any), {
      diners: 2,
      guests: [{ day: 5, meal: 'lunch', diners: 6 }],
      mealsOut: [{ day: 3, meal: 'dinner' }],
    })
    expect(out.mealDiners[0]).toEqual({ lunch: 2, dinner: 2 })
    expect(out.mealDiners[5]).toEqual({ lunch: 6, dinner: 2 })
    expect(out.mealDiners[3]).toEqual({ lunch: 2 })
  })

  it('describes it for Mimo and reads it from the tool call', async () => {
    expect(describeWeekPlan({ diners: 2 })).toBe('toda la semana: 2 comensales')
    const { weekPlanFromParams } = await import('../services/assistant/skills.js')
    expect(weekPlanFromParams({ diners: 2 })).toEqual({ diners: 2 })
    expect(weekPlanFromParams({ diners: 30 })).toBeUndefined()
    expect(weekPlanFromParams({ diners: 2, answer: 'el jueves cenamos fuera' })).toEqual({ diners: 2, mealsOut: [{ day: 3, meal: 'dinner' }] })
    expect(weekPlanSchema.safeParse({ diners: 2 }).success).toBe(true)
    expect(weekPlanSchema.safeParse({ diners: 0 }).success).toBe(false)
  })

  it('generate_weekly_menu with diners: 2 → every meal for 2, the list scaled to 2, plantilla untouched', async () => {
    const { sumDinersByRecipe } = await import('../services/shoppingList.js')
    const { db, calls } = makeDb([], undefined, undefined)
    const r = await skill.handler({ nextWeek: true, diners: 2 }, { userId: 'u-1', db } as any)
    const days = calls.inserted[0].days as DayMenu[]
    const slots = days.flatMap((d) => Object.values(d)).filter((s) => s && recipeCountOf(s) > 0)
    expect(slots.length).toBeGreaterThan(0)
    for (const s of slots) expect(s!.servings).toBe(2)
    // Household of 4: the list counts 2 per meal, not 4.
    const perRecipe = sumDinersByRecipe(days, 4)
    const occurrences = new Map<string, number>()
    for (const s of slots) for (const d of s!.dishes ?? []) if (d.kind === 'recipe') occurrences.set(d.recipeId, (occurrences.get(d.recipeId) ?? 0) + 1)
    for (const [id, n] of occurrences) expect(perRecipe.get(id)).toBe(2 * n)
    expect(calls.updates).toBe(0)
    expect(r.summary).toContain('Solo esta semana (la plantilla no cambia): toda la semana: 2 comensales')
  })
})

function recipeCountOf(slot: DayMenu[string]): number {
  return (slot?.dishes ?? []).filter((d) => d.kind === 'recipe').length
}
