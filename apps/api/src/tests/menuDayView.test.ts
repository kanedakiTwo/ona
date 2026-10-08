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
  dayHeading,
  mealEyebrow,
  missingMeals,
  orderedSlots,
  slotMinutes,
  splitDay,
  weekColumnLabel,
  weekHasDishes,
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
