/**
 * PRO-220 (D-069): prep alerts that come from the recipe («Saca el filete del
 * frigorífico» · 1,5 h; «Pon los garbanzos en remojo» · 10 h), with no prep
 * habits needed. The DB path is in recipePrepAlerts.smoke.ts.
 */
import { describe, expect, it } from 'vitest'
import { advancePrepSchema, createRecipeSchema } from '@ona/shared'
import {
  LATE_PREP_MAX_HOURS,
  PREP_ALERT_PRIORITY,
  parsePrepKey,
  parseRecipePrepKey,
  planRecipePrep,
  prepAlertStaleReason,
  recipePrepCopy,
  recipePrepKey,
  resolveCookAt,
} from '../services/notificationScheduler.js'

const MENU = '7975e19a-ef82-4733-a548-9fbc836e736d'
const RECIPE = '11111111-2222-3333-4444-555555555555'
const H = 3_600_000
// Monday 2026-10-19; Madrid is UTC+2 that day.
const madrid = (hhmm: string, day = '2026-10-19') => new Date(`${day}T${hhmm}:00+02:00`)

describe('planRecipePrep — when the alert goes out', () => {
  it('a 1,5 h preparativo for a 21:00 dinner goes out at 19:30', () => {
    const cookAt = resolveCookAt('2026-10-19', 0, 'dinner', {})
    expect(cookAt.toISOString()).toBe(madrid('21:00').toISOString())
    expect(planRecipePrep(cookAt, 1.5, madrid('09:00'))).toEqual({ fireAt: madrid('19:30'), late: false })
  })
  it('picked at 13:00 for a 14:30 meal: the 1,5 h one goes out right now, the 10 h one is not scheduled', () => {
    const cookAt = madrid('14:30')
    const now = madrid('13:00')
    expect(planRecipePrep(cookAt, 1.5, now)).toEqual({ fireAt: now, late: true })
    expect(planRecipePrep(cookAt, 10, now)).toBeNull()
  })
  it('picked at 13:00 for a 21:00 dinner: 1,5 h is scheduled at 19:30; a 10 h soak is not (never in the past)', () => {
    expect(planRecipePrep(madrid('21:00'), 1.5, madrid('13:00'))).toEqual({ fireAt: madrid('19:30'), late: false })
    expect(planRecipePrep(madrid('21:00'), 10, madrid('13:00'))).toBeNull()
  })
  it('late only for short preps with half the time left; nothing once the meal has started', () => {
    expect(LATE_PREP_MAX_HOURS).toBe(3)
    expect(planRecipePrep(madrid('14:00'), 1.5, madrid('13:30'))).toBeNull() // 30 min of 90 left
    expect(planRecipePrep(madrid('14:00'), 1, madrid('14:00'))).toBeNull()
    expect(planRecipePrep(madrid('14:00'), 2, madrid('13:00'))!.late).toBe(true)
    expect(planRecipePrep(new Date(madrid('14:00').getTime()), 0.5, new Date(madrid('14:00').getTime() - 0.25 * H))!.late).toBe(true)
  })
})

describe('the alert itself', () => {
  it('words for the usual and the late case', () => {
    expect(recipePrepCopy({ text: 'Saca el filete del frigorífico', meal: 'dinner', dayIndex: 3, recipeName: 'Filete a la plancha', late: false })).toEqual({
      title: 'Acuérdate: Saca el filete del frigorífico',
      body: 'Para la cena del jueves: Filete a la plancha.',
    })
    expect(recipePrepCopy({ text: 'Saca el filete del frigorífico.', meal: 'dinner', dayIndex: 3, recipeName: 'Filete a la plancha', late: true })).toEqual({
      title: 'Para la cena: saca el filete del frigorífico',
      body: 'Hazlo ya, que aún da tiempo (Filete a la plancha).',
    })
  })
  it('priority 1 in the weekly cap (PRO-215)', () => {
    expect(PREP_ALERT_PRIORITY).toBe(1)
  })
  it('its key names the recipe, and is not mistaken for an ingredient alert', () => {
    const key = recipePrepKey(MENU, 2, 'dinner', RECIPE, 0)
    expect(parseRecipePrepKey(key)).toEqual({ menuId: MENU, dayIndex: 2, meal: 'dinner', recipeId: RECIPE })
    expect(parsePrepKey(key)).toBeNull()
  })
  it('changing the day\'s recipe makes the old alert stale (cancelled before sending)', () => {
    const days = (recipeId: string) => {
      const d: any[] = [{}, {}, {}, {}, {}, {}, {}]
      d[2] = { dinner: { dishes: [{ kind: 'recipe', recipeId, recipeName: 'x' }] } }
      return d
    }
    const key = { menuId: MENU, dayIndex: 2, meal: 'dinner', ingredientId: '' }
    expect(prepAlertStaleReason(key, { latestMenuId: MENU, days: days(RECIPE), skippedDays: [], recipeIdsWithIngredient: new Set([RECIPE]) })).toBeNull()
    expect(prepAlertStaleReason(key, { latestMenuId: MENU, days: days('otra'), skippedDays: [], recipeIdsWithIngredient: new Set() })).toBe('ese plato ya no está en el menú')
  })
})

describe('the recipe field', () => {
  it('text + hours before, validated; optional in the recipe payload', () => {
    expect(advancePrepSchema.safeParse({ text: 'Pon los garbanzos en remojo', hoursBefore: 10 }).success).toBe(true)
    expect(advancePrepSchema.safeParse({ text: 'x', hoursBefore: 10 }).success).toBe(false)
    expect(advancePrepSchema.safeParse({ text: 'Pon los garbanzos', hoursBefore: 0 }).success).toBe(false)
    const base = { name: 'Garbanzos', servings: 2, meals: ['lunch'], ingredients: [{ ingredientId: RECIPE, quantity: 100, unit: 'g' }] }
    expect(createRecipeSchema.safeParse(base).success).toBe(true)
    expect(createRecipeSchema.safeParse({ ...base, advancePrep: [{ text: 'Pon los garbanzos en remojo', hoursBefore: 10 }] }).success).toBe(true)
  })
})
