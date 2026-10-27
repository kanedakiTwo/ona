/**
 * /menu "D · Luz y foto" view helpers (apps/web/src/lib/menuDay.ts).
 *
 * The redesign (2026-10-08) shows one featured meal as a photo hero with
 * "Empezar a cocinar" and the rest of the day as rows. Which slot gets the
 * hero, the week/day headings and the eyebrow copy are pure logic — this
 * suite pins them so the layout can't silently feature an empty slot or
 * mislabel a cross-month week.
 *
 * Run: pnpm --filter @ona/api test src/tests/menuDayView.test.ts
 */

import { describe, expect, it } from 'vitest'
import {
  absentMeals,
  dayHeading,
  mealEyebrow,
  missingMeals,
  orderedSlots,
  slotMinutes,
  splitDay,
  weekColumnLabel,
  weekHasDishes,
  weekMealRows,
  weekRangeLabel,
} from '../../../web/src/lib/menuDay'

const recipe = (name: string, extra: Record<string, unknown> = {}) => ({
  kind: 'recipe' as const,
  recipeId: `id-${name}`,
  recipeName: name,
  ...extra,
})

describe('weekRangeLabel', () => {
  it('same month', () => {
    expect(weekRangeLabel('2026-10-05')).toBe('Semana del 5 al 11 de octubre')
  })
  it('crosses a month', () => {
    expect(weekRangeLabel('2026-09-28')).toBe('Semana del 28 de septiembre al 4 de octubre')
  })
  it('crosses a year', () => {
    expect(weekRangeLabel('2026-12-28')).toBe('Semana del 28 de diciembre al 3 de enero')
  })
})

describe('dayHeading', () => {
  it('today → "Hoy, jueves"', () => {
    expect(dayHeading('2026-10-05', 3, 3)).toEqual({ lead: 'Hoy, ', accent: 'jueves', tail: '' })
  })
  it('today with date (desktop) → "Hoy, jueves 8"', () => {
    expect(dayHeading('2026-10-05', 3, 3, { withDate: true }).accent).toBe('jueves 8')
  })
  it('tomorrow → "Mañana, viernes"', () => {
    expect(dayHeading('2026-10-05', 4, 3)).toEqual({ lead: 'Mañana, ', accent: 'viernes', tail: '' })
  })
  it('any other day (or another week) → "Viernes 9"', () => {
    expect(dayHeading('2026-10-05', 4, -1)).toEqual({ lead: '', accent: 'Viernes', tail: ' 9' })
    expect(dayHeading('2026-10-05', 0, 3)).toEqual({ lead: '', accent: 'Lunes', tail: ' 5' })
  })
})

describe('weekColumnLabel', () => {
  it('marks today and abbreviates the rest', () => {
    expect(weekColumnLabel('2026-10-05', 3, 3)).toBe('Hoy, jue 8')
    expect(weekColumnLabel('2026-10-05', 2, 3)).toBe('Mié 7')
  })
})

describe('splitDay', () => {
  it('features the first meal (chronologically) that has a recipe', () => {
    const day = {
      dinner: { dishes: [recipe('Crema de calabaza')] },
      lunch: { dishes: [recipe('Garbanzos con espinacas')] },
    }
    const { featured, rest } = splitDay(day)
    expect(featured?.meal).toBe('lunch')
    expect(rest.map((s) => s.meal)).toEqual(['dinner'])
  })

  it('never features an empty slot or a note-only slot', () => {
    const day = {
      breakfast: { dishes: [] },
      lunch: { dishes: [{ kind: 'note' as const, text: 'comemos fuera' }] },
      dinner: { dishes: [recipe('Tortilla')] },
    }
    const { featured, rest } = splitDay(day)
    expect(featured?.meal).toBe('dinner')
    expect(rest.map((s) => s.meal)).toEqual(['breakfast', 'lunch'])
  })

  // Miguel, 2026-10-20: «la comida y la cena siempre deberían ir en los
  // lugares destacados; el desayuno y la merienda, en los huecos sin foto».
  it('features lunch, then dinner, over a breakfast or a snack with a recipe', () => {
    const full = {
      breakfast: { dishes: [recipe('Tostadas')] },
      lunch: { dishes: [recipe('Lentejas')] },
      snack: { dishes: [recipe('Yogur')] },
      dinner: { dishes: [recipe('Crema')] },
    }
    expect(splitDay(full).featured?.meal).toBe('lunch')
    expect(splitDay(full).rest.map((s) => s.meal)).toEqual(['breakfast', 'snack', 'dinner'])
    const noLunch = { breakfast: { dishes: [recipe('Tostadas')] }, dinner: { dishes: [recipe('Crema')] } }
    expect(splitDay(noLunch).featured?.meal).toBe('dinner')
    expect(splitDay({ breakfast: { dishes: [recipe('Tostadas')] }, lunch: { dishes: [] } }).featured?.meal).toBe('breakfast')
  })

  it('a day without recipes has no featured meal', () => {
    expect(splitDay({ lunch: { dishes: [] } }).featured).toBeNull()
    expect(splitDay(undefined)).toEqual({ featured: null, rest: [] })
  })

  it('orders merienda before cena', () => {
    const day = { dinner: { dishes: [] }, snack: { dishes: [] }, breakfast: { dishes: [] } }
    expect(orderedSlots(day).map((s) => s.meal)).toEqual(['breakfast', 'snack', 'dinner'])
  })
})

describe('missingMeals', () => {
  it('lists the meals the day can still add', () => {
    expect(missingMeals({ lunch: { dishes: [] }, dinner: { dishes: [] } })).toEqual(['breakfast', 'snack'])
  })
})

// Miguel, 2026-10-19: «no se ve que el viernes no hay comida». A day that
// lacks a meal the rest of the week has says so («El viernes no hay comida»).
describe('absentMeals', () => {
  const both = { lunch: { dishes: [recipe('a')] }, dinner: { dishes: [recipe('b')] } }
  const lunchOnly = { lunch: { dishes: [recipe('a')] } }
  const dinnerOnly = { dinner: { dishes: [recipe('b')] } }

  it('a day without the lunch the other days have', () => {
    const days = [both, both, both, lunchOnly, dinnerOnly, {}, both]
    expect(absentMeals(days, 4, [5])).toEqual(['lunch'])
    expect(absentMeals(days, 3, [5])).toEqual(['dinner'])
    expect(absentMeals(days, 0, [5])).toEqual([])
  })
  it('an empty slot is not absent: it already shows «Añadir plato»', () => {
    const days = [both, both, both, both, { lunch: { dishes: [] }, dinner: { dishes: [recipe('b')] } }, both, both]
    expect(absentMeals(days, 4, [])).toEqual([])
  })
  it('meals the week rarely has are not flagged (a household that never has lunch at home)', () => {
    const days = [dinnerOnly, dinnerOnly, dinnerOnly, dinnerOnly, dinnerOnly, dinnerOnly, { ...dinnerOnly, breakfast: { dishes: [] } }]
    expect(absentMeals(days, 0, [])).toEqual([])
  })
  it('a skipped day lacks nothing, and skipped days do not count', () => {
    const days = [both, both, {}, {}, {}, {}, {}]
    expect(absentMeals(days, 2, [2, 3, 4, 5, 6])).toEqual([])
    expect(absentMeals(days, 2, [3, 4, 5, 6])).toEqual(['lunch', 'dinner'])
  })
  it('one day alone does not make a meal usual', () => {
    expect(absentMeals([both, {}, {}, {}, {}, {}, {}], 1, [2, 3, 4, 5, 6])).toEqual([])
  })
})

// Miguel, 2026-10-27 (opción C): «La semana» on desktop is one row per meal
// with a photo cell per day; until then the dinner was a text line under the
// lunch's photo. The rows are the meals the week uses, in the order of the day.
describe('weekMealRows', () => {
  const both = { lunch: { dishes: [recipe('a')] }, dinner: { dishes: [recipe('b')] } }
  const dinnerOnly = { dinner: { dishes: [recipe('b')] } }

  it('lunch and dinner, in the order of the day', () => {
    expect(weekMealRows([both, both, both, both, both, {}, {}], [])).toEqual(['lunch', 'dinner'])
  })
  it('breakfast and snack only when some day has them, in their place in the day', () => {
    const days = [both, { ...both, snack: { dishes: [recipe('c')] }, breakfast: { dishes: [] } }, both, {}, {}, {}, {}]
    expect(weekMealRows(days, [])).toEqual(['breakfast', 'lunch', 'snack', 'dinner'])
  })
  it('one day with a meal is enough for its row (the other days say «no hay»)', () => {
    expect(weekMealRows([dinnerOnly, dinnerOnly, { lunch: { dishes: [recipe('a')] } }, {}, {}, {}, {}], [])).toEqual(['lunch', 'dinner'])
  })
  it('an empty slot counts: it is a meal of the week waiting for a dish', () => {
    expect(weekMealRows([{ lunch: { dishes: [] } }, {}, {}, {}, {}, {}, {}], [])).toEqual(['lunch'])
  })
  it('skipped days do not add rows', () => {
    expect(weekMealRows([dinnerOnly, { breakfast: { dishes: [recipe('x')] } }, {}, {}, {}, {}, {}], [1])).toEqual(['dinner'])
  })
  it('a week with no meals at all still shows lunch and dinner', () => {
    expect(weekMealRows([{}, {}, {}, {}, {}, {}, {}], [])).toEqual(['lunch', 'dinner'])
    expect(weekMealRows([both, both, {}, {}, {}, {}, {}], [0, 1, 2, 3, 4, 5, 6])).toEqual(['lunch', 'dinner'])
  })
})

describe('slotMinutes + mealEyebrow', () => {
  it('uses total time, falls back to prep time', () => {
    expect(slotMinutes({ dishes: [recipe('a', { totalTime: 28, prepTime: 10 })] })).toBe(28)
    expect(slotMinutes({ dishes: [recipe('a', { prepTime: 10 })] })).toBe(10)
    expect(slotMinutes({ dishes: [recipe('a')] })).toBeNull()
  })
  it('"Comida · 28 min · 3 raciones", skipping unknowns', () => {
    expect(mealEyebrow('Comida', 28, 3)).toBe('Comida · 28 min · 3 raciones')
    expect(mealEyebrow('Cena', 25)).toBe('Cena · 25 min')
    expect(mealEyebrow('Cena', null, 1)).toBe('Cena · 1 ración')
  })
})

describe('weekHasDishes', () => {
  it('an empty-mode week (slots without dishes) is blank', () => {
    expect(weekHasDishes([{ lunch: { dishes: [] } }, {}])).toBe(false)
    expect(weekHasDishes([{ lunch: { dishes: [] } }, { dinner: { dishes: [recipe('x')] } }])).toBe(true)
    expect(weekHasDishes(undefined)).toBe(false)
  })
})
