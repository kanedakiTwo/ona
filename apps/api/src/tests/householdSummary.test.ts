/**
 * Mimo after changing the household speaks of people, not of «5 raciones»
 * for 3 adults and 4 kids (2026-10-22, a tester with a large family).
 */
import { describe, expect, it } from 'vitest'
import { householdUpdatedSummary } from '../services/assistant/skills.js'

describe('householdUpdatedSummary', () => {
  it('a large family: the people, and why kids weigh half', () => {
    const s = householdUpdatedSummary(3, 4)
    expect(s).toBe('Hogar actualizado: 3 adultos y 4 niños de 2 a 10 años, 7 personas. La compra sale para las 7 (cada niño de 2 a 10 años cuenta como media ración de adulto).')
    expect(s).not.toMatch(/\b5 raciones\b/)
  })

  it('singulars and no kids', () => {
    expect(householdUpdatedSummary(1, 0)).toBe('Hogar actualizado: 1 adulto. La compra sale para 1 persona.')
    expect(householdUpdatedSummary(2, 0)).toBe('Hogar actualizado: 2 adultos. La compra sale para 2 personas.')
    expect(householdUpdatedSummary(2, 1)).toContain('2 adultos y 1 niño de 2 a 10 años, 3 personas')
  })
})
