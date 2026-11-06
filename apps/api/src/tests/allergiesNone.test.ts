/**
 * PRO-347 · «No tengo ninguna» without the health-data consent is an answer:
 * /menu stops asking (`allergiesAnswered`), and nothing of health is stored.
 * Saving restrictions or withdrawing the consent clears it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allergiesAnswered, householdAllergiesStatus } from '../services/householdAllergies.js'

const routes = readFileSync(new URL('../routes/users.ts', import.meta.url), 'utf8')
const consent = readFileSync(new URL('../services/healthConsent.ts', import.meta.url), 'utf8')

describe('«No tengo ninguna» without consent', () => {
  it('counts as answered', () => {
    expect(allergiesAnswered({ restrictions: [], consentAt: null, withdrawnAt: null })).toBe(false)
    expect(allergiesAnswered({ restrictions: [], consentAt: null, withdrawnAt: null, noneAt: new Date() })).toBe(true)
    expect(allergiesAnswered({ restrictions: [], consentAt: null, withdrawnAt: null, noneAt: null })).toBe(false)
  })

  it('the warning above «Generar mi menú» goes for that person', () => {
    const base = { restrictions: [], consentAt: null, withdrawnAt: null }
    const status = householdAllergiesStatus(
      [
        { ...base, userId: 'me', username: 'pablo', noneAt: '2026-10-24T10:00:00Z' },
        { ...base, userId: 'o', username: 'ana' },
      ],
      'me',
    )
    expect(status).toEqual({ meAnswered: true, pending: ['ana'], anyAnswered: true })
  })

  it('the route needs no consent; saving restrictions or withdrawing clears it', () => {
    const route = routes.slice(routes.indexOf("router.post('/user/:id/allergies-none'"))
    expect(route.slice(0, route.indexOf('})\n'))).not.toContain('hasHealthConsent')
    expect(routes).toMatch(/body\.restrictions\.length > 0 \? \{ allergiesNoneAt: null \}/)
    expect(consent).toMatch(/allergiesNoneAt: null/)
  })

  it('reading the free text needs the consent (it is health data)', () => {
    const route = routes.slice(routes.indexOf("router.post('/user/:id/restrictions/read'"))
    expect(route.slice(0, route.indexOf('\n})'))).toContain('hasHealthConsent')
  })
})
