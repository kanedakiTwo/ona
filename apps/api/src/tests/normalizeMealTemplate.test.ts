import { describe, expect, it } from 'vitest'
import { normalizeMealTemplate } from '../services/menuGenerator.js'

describe('normalizeMealTemplate', () => {
  it('honors the user disabling breakfasts everywhere', () => {
    // This is the bug Miguel reported: he unchecked desayuno on every day
    // in the profile preferences but the menu kept producing breakfasts.
    const lunchAndDinnerOnly: Record<string, string[]> = {
      lunes: ['almuerzo', 'cena'],
      martes: ['almuerzo', 'cena'],
      miercoles: ['almuerzo', 'cena'],
      jueves: ['almuerzo', 'cena'],
      viernes: ['almuerzo', 'cena'],
      sabado: ['almuerzo', 'cena'],
      domingo: ['almuerzo', 'cena'],
    }
    const out = normalizeMealTemplate({ mealTemplate: lunchAndDinnerOnly })
    expect(out).toHaveLength(7)
    for (const day of out!) {
      expect(day.breakfast).toBeFalsy()
      expect(day.lunch).toBe(true)
      expect(day.dinner).toBe(true)
    }
  })

  it('maps the Spanish meal aliases used by the profile UI', () => {
    const out = normalizeMealTemplate({
      mealTemplate: {
        lunes: ['desayuno', 'almuerzo', 'merienda', 'cena'],
      },
    })
    expect(out![0]).toEqual({
      breakfast: true,
      lunch: true,
      snack: true,
      dinner: true,
    })
    // Untouched days stay empty (no slots = nothing gets generated).
    expect(out![6]).toEqual({})
  })

  it('treats "comida" as an alias of lunch', () => {
    const out = normalizeMealTemplate({
      mealTemplate: { lunes: ['comida'] },
    })
    expect(out![0]).toEqual({ lunch: true })
  })

  it('accepts the legacy DayTemplate[] shape verbatim', () => {
    const legacy = Array.from({ length: 7 }, () => ({
      breakfast: true,
      lunch: true,
      dinner: true,
    }))
    expect(normalizeMealTemplate(legacy)).toBe(legacy)
  })

  it('handles accented day names from the UI', () => {
    const out = normalizeMealTemplate({
      mealTemplate: { miércoles: ['cena'], sábado: ['cena'] },
    })
    expect(out![2]).toEqual({ dinner: true })
    expect(out![5]).toEqual({ dinner: true })
  })

  it('returns null when the blob is unusable so the caller can default', () => {
    expect(normalizeMealTemplate(null)).toBeNull()
    expect(normalizeMealTemplate(undefined)).toBeNull()
    expect(normalizeMealTemplate({})).toBeNull()
    expect(normalizeMealTemplate({ mealTemplate: {} })).toBeNull()
    expect(normalizeMealTemplate({ mealTemplate: { lunes: [] } })).toBeNull()
    expect(normalizeMealTemplate({ mealTemplate: 'not-an-object' })).toBeNull()
  })

  it('ignores unknown day or meal names instead of crashing', () => {
    const out = normalizeMealTemplate({
      mealTemplate: {
        lunes: ['desayuno', 'tapa'], // 'tapa' is not in the canonical set
        funday: ['cena'],            // unknown day key
      },
    })
    expect(out![0]).toEqual({ breakfast: true })
    // Unknown 'funday' shouldn't appear anywhere — every other day stays empty.
    for (let i = 1; i < 7; i++) expect(out![i]).toEqual({})
  })
})
