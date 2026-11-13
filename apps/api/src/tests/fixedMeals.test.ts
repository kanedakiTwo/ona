/**
 * PRO-218: comidas fijas. The shopping list adds the week's amounts, the
 * generator leaves the meal alone, and Mimo's tools save it — since D-182 as
 * «algo fijo sin receta» in the household's «semana tipo».
 */
import { describe, expect, it, vi } from 'vitest'
import { fixedMealsFromTemplate, fixedNoteText, fullWeekTypeDays, plantillaEdits, plantillaFromWeekType, type DayMenu, type FixedMeal, type LockedSlots, type WeekTypeDays } from '@ona/shared'
import { fixedLinesToItems, splitFixedLines, sumFixedItems, aggregateScaledRows, type CatalogRow } from '../services/shoppingList.js'
import { buildRandomMenu } from '../services/menuGenerator.js'
import { planWeekType } from '../services/weekTypePlan.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

const BREAKFAST: FixedMeal = {
  meal: 'breakfast',
  days: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'],
  label: 'Yogur con cereales',
  items: [
    { name: 'yogur', quantity: 1, unit: 'u' },
    { name: 'cereales', quantity: 40, unit: 'g' },
    { name: 'galletas', quantity: 2, unit: 'u' },
  ],
}

const pool: RecipeWithCourse[] = Array.from({ length: 20 }, (_, i) => ({
  id: `r${i}`,
  name: `Receta ${i}`,
  meals: ['breakfast', 'lunch', 'dinner'],
  seasons: ['spring', 'summer', 'autumn', 'winter'],
  frequency: null,
  tags: [],
  allergens: [],
  course: null,
  ingredients: [{ ingredientId: `i${i}`, ingredientName: 'cebolla', quantity: 100, unit: 'g', allergenTags: [] }],
}))

const WEEK = '2026-11-09'

/** The week type with a fixed breakfast, as the profile's «Comidas fijas» saves it. */
function withFixed(fixed: FixedMeal[], diners?: number): WeekTypeDays {
  const days = fullWeekTypeDays()
  const before = plantillaFromWeekType(days, 2)
  for (const e of plantillaEdits(days, before, { ...before, fixedMeals: fixed }, WEEK)) days[e.day][e.meal] = { ...e.slot, ...(diners ? { diners } : {}) }
  return days
}

/** The generator's draw on a week type (what generateMenu does, without the DB). */
function generate(days: WeekTypeDays, opts: { locked?: LockedSlots; existing?: DayMenu[]; skipped?: Set<number> } = {}) {
  const plan = planWeekType(days, WEEK, { recipes: pool, restrictions: [] })
  return buildRandomMenu(plan.template, pool, 'autumn', [], new Set(), opts.locked ?? {}, opts.existing, undefined, opts.skipped, undefined, undefined, undefined, plan.mealDiners, plan.dishCounts, undefined, undefined, undefined, undefined, plan.specs).days
}

describe('the shopping list', () => {
  const week = generate(withFixed([BREAKFAST]))

  it('a 7-day fixed breakfast for 1 with 1 yogur, 40 g of cereales and 2 galletas adds 7 yogures, 280 g of cereales and 14 galletas', () => {
    expect(sumFixedItems(week, 1)).toEqual([
      { name: 'yogur', quantity: 7, unit: 'u' },
      { name: 'cereales', quantity: 280, unit: 'g' },
      { name: 'galletas', quantity: 14, unit: 'u' },
    ])
    const items = fixedLinesToItems(sumFixedItems(week, 1))
    expect(items.map((i) => [i.name, i.quantity, i.unit])).toEqual([
      ['yogur', 7, 'u'],
      ['cereales', 280, 'g'],
      ['galletas', 14, 'u'],
    ])
    expect(new Set(items.map((i) => i.id)).size).toBe(3)
  })

  it('scales by the slot’s diners (or the household) and skips ordinary notes', () => {
    const two = week.map((d, i) => (i === 0 ? { ...d, breakfast: { ...d.breakfast!, servings: 3 } } : d))
    expect(sumFixedItems(two, 2).find((l) => l.name === 'yogur')!.quantity).toBe(3 + 6 * 2)
    const notes: DayMenu[] = [{ breakfast: { dishes: [{ kind: 'note', text: 'Tostada' }] } }]
    expect(sumFixedItems(notes, 1)).toEqual([])
  })

  it('an item named like a catalogue ingredient joins that line (plural or not)', () => {
    const catalog: CatalogRow = { id: 'ing-galleta', name: 'galleta', aisle: 'despensa' as any, density: null, unitWeight: 8 }
    const { matched, unmatched } = splitFixedLines(sumFixedItems(week, 1), new Map([['galleta', catalog]]))
    expect(matched.map((m) => [m.catalog.id, m.quantity])).toEqual([['ing-galleta', 14]])
    expect(unmatched.map((u) => u.name)).toEqual(['yogur', 'cereales'])
    const items = aggregateScaledRows(
      [
        { ingredientId: 'ing-galleta', quantity: 14, unit: 'u', note: null },
        { ingredientId: 'ing-galleta', quantity: 6, unit: 'u', note: null },
      ],
      new Map([['ing-galleta', catalog]]),
    )
    expect(items.map((i) => [i.name, i.quantity, i.unit])).toEqual([['galleta', 20, 'u']])
  })
})

describe('the generator', () => {
  it('never picks a recipe for a fixed meal and puts «Fijo: …» there', () => {
    for (const d of generate(withFixed([BREAKFAST]))) {
      expect(d.breakfast?.dishes).toEqual([{ kind: 'note', text: 'Fijo: Yogur con cereales', fixed: { items: BREAKFAST.items } }])
      expect(d.lunch?.dishes[0].kind).toBe('recipe')
    }
  })

  it('only on its days; a locked slot and a «sin cocinar» day are kept as they are', () => {
    const weekdays: FixedMeal = { ...BREAKFAST, days: ['lunes', 'martes'] }
    const existing: DayMenu[] = Array.from({ length: 7 }, () => ({}))
    existing[1] = { breakfast: { dishes: [{ kind: 'note', text: 'Churros' }] } }
    const out = generate(withFixed([weekdays]), { locked: { '1': { breakfast: true } }, existing, skipped: new Set([0]) })
    expect(out[0].breakfast).toBeUndefined() // sin cocinar
    expect(out[1].breakfast?.dishes[0]).toEqual({ kind: 'note', text: 'Churros' }) // locked
    expect(out[2].breakfast).toBeUndefined() // not its day
  })

  it('takes the slot’s diners', () => {
    expect(generate(withFixed([BREAKFAST], 2))[0].breakfast?.servings).toBe(2)
  })
})

describe('storage', () => {
  it('reads only well-formed fixed meals from the old template blob (its migration)', () => {
    expect(fixedMealsFromTemplate({ fixedMeals: [BREAKFAST, { meal: 'breakfast', days: ['lunes'], label: 'x', items: [{ name: 'a', quantity: 1, unit: 'u' }] }, { meal: 'cena', days: [], label: '', items: [] }] })).toEqual([BREAKFAST])
    expect(fixedMealsFromTemplate([{ lunch: true }])).toEqual([])
    expect(fixedNoteText(BREAKFAST)).toBe('Fijo: Yogur con cereales')
  })

  it('the week type gives back the same fixed meal; one per meal', () => {
    const dinner: FixedMeal = { ...BREAKFAST, meal: 'dinner', label: 'Fruta' }
    expect(plantillaFromWeekType(withFixed([BREAKFAST, dinner]), 2).fixedMeals).toEqual([BREAKFAST, dinner])
    expect(plantillaFromWeekType(withFixed([dinner]), 2).fixedMeals).toEqual([dinner])
  })
})

describe('Mimo', () => {
  it('set_fixed_meal validates and saves into the week type; remove takes it away', async () => {
    const views: any[] = []
    let current = plantillaFromWeekType(fullWeekTypeDays(), 2)
    vi.doMock('../services/weekType.js', () => ({
      loadWeekTypeForUser: vi.fn(async () => ({ householdId: 'h1', days: fullWeekTypeDays() })),
      editWeekTypeAsPlantilla: vi.fn(async (_userId: string, edit: (v: any) => any) => {
        current = edit(current)
        views.push(current)
        return { changes: [], days: [] }
      }),
    }))
    const { fixedMealSkills } = await import('../services/assistant/fixedMealSkills.js')
    const set = fixedMealSkills.find((s) => s.name === 'set_fixed_meal')!
    const ctx = { userId: 'u1', db: {} } as any
    const ok = await set.handler({ meal: 'breakfast', label: 'Yogur con cereales', items: BREAKFAST.items }, ctx)
    expect(views[0].fixedMeals).toEqual([BREAKFAST])
    expect(ok.summary).toContain('Fijo: Yogur con cereales')
    const bad = await set.handler({ meal: 'breakfast', label: '', items: [] }, ctx)
    expect(bad.summary).toMatch(/No he cambiado nada/)
    expect(views).toHaveLength(1)
    await set.handler({ meal: 'breakfast', remove: true }, ctx)
    expect(views[1].fixedMeals).toEqual([])
    vi.doUnmock('../services/weekType.js')
  })
})
