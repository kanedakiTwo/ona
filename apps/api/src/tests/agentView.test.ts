/**
 * What the agents' read token sees (specs/metrics.md, constraints): counts,
 * categories and severity — never text written by or about a user, never user ids.
 */
import { describe, expect, it } from 'vitest'
import { errorType, errorsForAgents, feedbackForAgents, flagsForAgents, normalisePath } from '../services/agentView.js'

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
