/**
 * What the agents' read token sees (specs/metrics.md, constraints): counts,
 * categories and severity — never text written by or about a user, never user ids.
 */
import { describe, expect, it } from 'vitest'
import { buildApiProblemMessage } from '@ona/shared'
import { errorType, errorsForAgents, feedbackForAgents, flagsForAgents, normalisePath } from '../services/agentView.js'
import { normalizeMessage } from '../services/appErrors.js'

describe('agents view (read token)', () => {
  it('normalises paths and keeps only the error class', () => {
    expect(normalisePath('/recipes/3f2a9c1e-1234-4abc-9def-0123456789ab?ref=x')).toBe('/recipes/:id')
    expect(normalisePath('GET /users/123/menu')).toBe('GET /users/:id/menu')
    expect(normalisePath('/buscar?q=ana@example.com')).toBe('/buscar')
    expect(normalisePath('<script>')).toBe('otra')
    expect(normalisePath(null)).toBeNull()
    expect(errorType("TypeError: Cannot read properties of undefined (reading 'Ana')")).toBe('TypeError')
    expect(errorType('Error con ana@example.com')).toBe('Error')
    expect(errorType('algo raro con ana@example.com')).toBe('other')
  })

  it("keeps the web's own reports of failed API calls: a fixed format over a route pattern", () => {
    // As stored (normalizeMessage turns numbers into <n>) and as built (buildApiProblemMessage).
    expect(errorType('API GET /menu/:id/:id → HTTP <n>')).toBe('API GET /menu/:id/:id → HTTP <n>')
    expect(errorType('API POST /billing/checkout → HTTP 500')).toBe('API POST /billing/checkout → HTTP 500')
    expect(errorType('API POST /recipes/extract-from-image: sin respuesta (red)')).toBe('API POST /recipes/extract-from-image: sin respuesta (red)')
    expect(errorType('API GET /shopping-list: más de <n> s sin respuesta')).toBe('API GET /shopping-list: más de <n> s sin respuesta')
    // Anything else after the route is not that format.
    expect(errorType('API GET /buscar Ana → HTTP <n>')).toBe('other')
    expect(errorType('API GET /Ana → HTTP <n>')).toBe('other')
    expect(errorType('API GET /menu → HTTP <n> de ana@example.com')).toBe('other')
  })

  it('contract: every report the web builds, once stored, is recognised', () => {
    for (const problem of ['status', 'network', 'slow'] as const) {
      const built = buildApiProblemMessage({ method: 'get', path: '/menu/3f2a9c1e-1234-4abc-9def-0123456789ab/2026-W43?q=ana', problem, status: 503 })
      const stored = normalizeMessage(built)
      expect(errorType(stored)).toBe(stored)
      expect(stored).not.toMatch(/3f2a9c1e|ana/)
    }
  })

  it('feedback: counts by channel and page, possible allergies with their date only', () => {
    const at = new Date('2026-10-20T10:00:00Z')
    const v = feedbackForAgents(1, [
      { channel: 'whatsapp', page: null, text: 'Soy celíaca y Mimo me puso pan', createdAt: at },
      { channel: 'app', page: '/recipes/3f2a9c1e-1234-4abc-9def-0123456789ab', text: 'Me encanta', createdAt: at },
    ])
    expect(v).toEqual({
      days: 1,
      count: 2,
      byChannel: { whatsapp: 1, app: 1 },
      byPage: { none: 1, '/recipes/:id': 1 },
      possibleAllergies: [{ date: '2026-10-20', channel: 'whatsapp' }],
    })
    expect(JSON.stringify(v)).not.toMatch(/celíaca|encanta/)
  })

  it('possible allergies: allergens, coeliac disease and capitals count; ordinary opinions do not', () => {
    const at = new Date('2026-10-20T10:00:00Z')
    const flagged = (text: string) => feedbackForAgents(1, [{ channel: 'app', page: null, text, createdAt: at }]).possibleAllergies.length
    expect(flagged('No veo los alérgenos de cada receta')).toBe(1)
    expect(flagged('Mi hija tiene celiaquía')).toBe(1)
    expect(flagged('Alérgico a los frutos secos')).toBe(1)
    expect(flagged('La lista de la compra tarda en cargar')).toBe(0)
  })

  it('errors: no message, no user id, no stack', () => {
    const v = errorsForAgents({
      totals: { groups: 1 },
      groups: [{ id: 'g1', kind: 'client', message: 'TypeError: x of Ana', path: '/menu', release: 'r', userAgentFamily: 'Chrome · Android', lastUserId: 'u-1', count: 2, firstSeen: 'a', lastSeen: 'b', resolvedAt: null, sampleStack: 'at f' }],
    })
    expect(v.groups[0]).toEqual({ id: 'g1', kind: 'client', release: 'r', userAgentFamily: 'Chrome · Android', count: 2, firstSeen: 'a', lastSeen: 'b', resolvedAt: null, type: 'TypeError', path: '/menu' })
    expect(v.totals).toEqual({ groups: 1 })
  })

  it('assistant flags: no reply, no note', () => {
    const v = flagsForAgents({
      counts: { x: 1 },
      items: [{ date: 'd', channel: 'whatsapp', category: 'other', source: 'reviewer', reviewerCategory: 'proactividad', severity: 'alta', reply: 'Para [nombre]…', note: 'Su hijo…' }],
    })
    expect(v.items).toEqual([{ date: 'd', channel: 'whatsapp', category: 'other', source: 'reviewer', reviewerCategory: 'proactividad', severity: 'alta' }])
    expect(v.counts).toEqual({ x: 1 })
  })
})
