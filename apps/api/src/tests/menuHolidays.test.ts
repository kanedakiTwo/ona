/**
 * PRO-226: festivos en el menú. The table has 2026 and 2027 whole (BOE annex),
 * and a weekday holiday of the household's comunidad autónoma loses the
 * weekday time limit — in that comunidad only.
 */
import { describe, expect, it } from 'vitest'
import {
  HOLIDAY_YEARS,
  PUBLIC_HOLIDAYS,
  SPANISH_REGION_CODES,
  holidayOn,
  weekHolidays,
  validateMemoryFactValue,
  type DayTimeBudget,
} from '@ona/shared'
import { holidayTimeBudgets, slotTimeBudget, regionFromMemory } from '../services/menuHolidays.js'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import { weekTimeBudgets } from '../services/onboardingPreferences.js'
import { holidayLine, weekMenuDigest } from '../services/menuText.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

describe('the holidays table (BOE annex 2026 and 2027)', () => {
  it('has both years', () => {
    expect([...HOLIDAY_YEARS]).toEqual([2026, 2027])
  })

  for (const year of HOLIDAY_YEARS) {
    it(`${year}: every comunidad has its 12 fiestas (Canarias 11 + the island one, not in the table)`, () => {
      const list = PUBLIC_HOLIDAYS[year]
      for (const h of list) {
        expect(h.date.startsWith(`${year}-`)).toBe(true)
        expect(Number.isNaN(new Date(`${h.date}T00:00:00Z`).getTime())).toBe(false)
      }
      for (const region of SPANISH_REGION_CODES) {
        const n = list.filter((h) => h.regions === 'todas' || h.regions.includes(region)).length
        expect(n, `${year} ${region}`).toBe(region === 'CN' ? 11 : 12)
      }
      // Fiestas for everyone: Año Nuevo, Epifanía, Viernes Santo, 1 de mayo,
      // 12 de octubre, Inmaculada, Navidad (+ Asunción / Todos los Santos /
      // Constitución depending on the weekday).
      expect(list.filter((h) => h.regions === 'todas').length).toBeGreaterThanOrEqual(8)
    })
  }

  it('spot checks against the BOE', () => {
    expect(holidayOn('2026-04-03', 'MD')?.name).toBe('Viernes Santo')
    expect(holidayOn('2026-05-02', 'MD')?.name).toBe('Fiesta de la Comunidad de Madrid')
    expect(holidayOn('2026-05-02', 'CT')).toBeNull()
    expect(holidayOn('2026-04-02', 'CT')).toBeNull() // Jueves Santo: not in Cataluña
    expect(holidayOn('2026-04-02', 'VC')).toBeNull() // nor in the Comunitat Valenciana
    expect(holidayOn('2026-04-02', 'AN')?.name).toBe('Jueves Santo')
    expect(holidayOn('2027-10-07', 'PV')?.name).toBe('Aniversario 1er Gobierno Euskadi')
    expect(holidayOn('2027-08-16', 'MD')?.name).toBe('Lunes siguiente a asunción de la Virgen')
    expect(holidayOn('2027-08-16', 'CT')).toBeNull()
    expect(holidayOn('2028-01-01', 'MD')).toBeNull() // year not in the table
    expect(holidayOn('2026-01-01', null)).toBeNull()
  })

  it('weekHolidays gives the day indexes of a week', () => {
    expect(weekHolidays('2026-12-07', 'MD').map((h) => h.dayIndex)).toEqual([0, 1])
    expect(weekHolidays('2026-12-07', 'CT').map((h) => h.dayIndex)).toEqual([1])
  })

  it('region is a memory key with the ISO codes', () => {
    expect(validateMemoryFactValue('region', 'MD').ok).toBe(true)
    expect(validateMemoryFactValue('region', 'Madrid').ok).toBe(false)
    expect(regionFromMemory('AR')).toBe('AR')
    expect(regionFromMemory('XX')).toBeNull()
  })
})

// Week of 20 April 2026: Thursday 23 is San Jorge / Día de Aragón (AR) and
// Fiesta de Castilla y León (CL), not a holiday in Madrid.
const WEEK = '2026-04-20'
const THURSDAY = 3
const rapido = { lunes: 30, martes: 30, miercoles: 30, jueves: 30, viernes: 30 }

describe('time limits on a holiday', () => {
  it('a Thursday holiday in the household’s comunidad has no 30-minute limit; in another comunidad it keeps it', () => {
    const base = weekTimeBudgets(rapido, {})
    expect(base[THURSDAY]).toEqual({ mode: 'total', minutes: 30 })
    expect(holidayTimeBudgets(base, WEEK, 'AR').budgets[THURSDAY]).toBeUndefined()
    expect(holidayTimeBudgets(base, WEEK, 'MD').budgets[THURSDAY]).toEqual({ mode: 'total', minutes: 30 })
    expect(holidayTimeBudgets(base, WEEK, null).budgets[THURSDAY]).toEqual({ mode: 'total', minutes: 30 })
    // The other days don't change, and the input isn't touched.
    expect(holidayTimeBudgets(base, WEEK, 'AR').budgets[2]).toEqual({ mode: 'total', minutes: 30 })
    expect(base[THURSDAY]).toEqual({ mode: 'total', minutes: 30 })
  })

  it('takes Saturday’s limit when the household has one', () => {
    const base: Record<number, DayTimeBudget> = { 3: { mode: 'total', minutes: 30 }, 5: { mode: 'activo', minutes: 45 } }
    expect(holidayTimeBudgets(base, WEEK, 'CL').budgets[THURSDAY]).toEqual({ mode: 'activo', minutes: 45 })
  })

  it('single-slot paths (Cambiar al azar…) apply the same rule', () => {
    const memory = { time_available: { value: rapido }, region: { value: 'AR' } }
    expect(slotTimeBudget(memory, WEEK, THURSDAY)).toBeNull()
    expect(slotTimeBudget({ ...memory, region: { value: 'MD' } }, WEEK, THURSDAY)).toEqual({ mode: 'total', minutes: 30 })
    expect(slotTimeBudget(memory, WEEK, 2)).toEqual({ mode: 'total', minutes: 30 })
  })

  it('the generator: only long recipes → the holiday Thursday gets dishes in Aragón, none in Madrid', () => {
    const pool: RecipeWithCourse[] = Array.from({ length: 30 }, (_, i) => ({
      id: `long${i}`,
      name: `Guiso lento ${i}`,
      meals: ['lunch', 'dinner'],
      seasons: ['spring', 'summer', 'autumn', 'winter'],
      frequency: null,
      tags: [],
      prepTime: 20,
      cookTime: 100,
      totalTime: 120,
      allergens: [],
      course: null,
      ingredients: [{ ingredientId: `i${i}`, ingredientName: 'garbanzo', quantity: 100, unit: 'g', allergenTags: [] }],
    }))
    const run = (region: 'AR' | 'MD') => {
      const budgets = holidayTimeBudgets(weekTimeBudgets(rapido, {}), WEEK, region).budgets
      return buildRandomMenu(defaultTemplate(), pool, 'spring', [], new Set(), {}, undefined, undefined, undefined, undefined, undefined, budgets).days
    }
    const aragon = run('AR')
    const madrid = run('MD')
    expect(aragon[THURSDAY].lunch?.dishes.length).toBe(1)
    expect(aragon[THURSDAY].dinner?.dishes.length).toBe(1)
    expect(madrid[THURSDAY].lunch).toBeUndefined()
    expect(madrid[THURSDAY].dinner).toBeUndefined()
    // A normal weekday stays capped in both.
    expect(aragon[2].lunch).toBeUndefined()
    // The weekend is free in both.
    expect(madrid[5].lunch?.dishes.length).toBe(1)
  })
})

describe('the Sunday message says it', () => {
  it('«El jueves es festivo: te he puesto algo con más calma.» when the limit was lifted', () => {
    expect(holidayLine(WEEK, [0, 1, 2, 3, 4, 5, 6], { region: 'AR', timeAvailable: rapido })).toBe(
      'El jueves es festivo: te he puesto algo con más calma.',
    )
    expect(holidayLine(WEEK, [0, 1, 2, 3, 4, 5, 6], { region: 'AR', timeAvailable: {} })).toBe('El jueves es festivo.')
    expect(holidayLine(WEEK, [0, 1, 2, 3, 4, 5, 6], { region: 'MD', timeAvailable: rapido })).toBeNull()
    expect(holidayLine(WEEK, [4, 5, 6], { region: 'AR', timeAvailable: rapido })).toBeNull() // already past
    expect(holidayLine('2026-12-07', [0, 1, 2, 3, 4, 5, 6], { region: 'MD', timeAvailable: rapido })).toBe(
      'El lunes y el martes son festivos: te he puesto algo con más calma.',
    )
  })

  it('goes under the opener of a generated week, not when the user only asks to see it', () => {
    const menu = { weekStart: WEEK, days: Array.from({ length: 7 }, () => ({ lunch: { dishes: [{ kind: 'note' as const, text: 'Lentejas' }] } })) }
    const generated = weekMenuDigest(menu, { today: '2026-04-19', region: 'AR', timeAvailable: rapido })
    expect(generated.split('\n\n')[1]).toBe('El jueves es festivo: te he puesto algo con más calma.')
    const viewing = weekMenuDigest(menu, { today: '2026-04-19', region: 'AR', timeAvailable: rapido, view: 'viewing' })
    expect(viewing).not.toContain('festivo')
  })
})
