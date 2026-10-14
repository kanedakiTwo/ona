/**
 * PRO-84 — «Hacer este pedido en Carrefour.es» (specs/shop-orders.md):
 * plain search links on carrefour.es, no affiliate parameters, and the click
 * counted as `carrefour_click` with only the number of lines.
 */
import { describe, expect, it } from 'vitest'
import { carrefourLinks, carrefourSearchUrl } from '@ona/shared'
import { USAGE_EVENTS, carrefourClickProps, sanitizeProps } from '../services/usageEvents.js'
import { buildDaily, buildTotals } from '../services/usageReport.js'

const lines = [
  { key: 'l1', name: 'leche entera', eci: 'leche entera' },
  { key: 'l2', name: 'galletas daniela' },
  { key: 'l3', name: 'mantequilla', eci: 'mantequilla 250 g', included: false },
]

describe('carrefour search links', () => {
  it('one link per line still in the order, on carrefour.es, with only the search term', () => {
    const links = carrefourLinks(lines)
    expect(links.map((l) => l.key)).toEqual(['l1', 'l2'])
    for (const { url } of links) {
      const u = new URL(url)
      expect(u.protocol).toBe('https:')
      expect(u.hostname).toBe('www.carrefour.es')
      expect([...u.searchParams.keys()]).toEqual(['q'])
    }
    expect(new URL(links[1].url).searchParams.get('q')).toBe('galletas daniela')
  })

  it('never carries affiliate or campaign parameters', () => {
    const url = carrefourSearchUrl('tomate de ensalada')
    expect(url).toBe('https://www.carrefour.es/?q=tomate%20de%20ensalada')
    expect(url).not.toMatch(/utm_|aff|ref=|partner|awin|tag=/i)
  })
})

describe('carrefour_click usage event', () => {
  it('is in the catalogue and its props are only the number of lines', () => {
    expect(USAGE_EVENTS).toContain('carrefour_click')
    const props = carrefourClickProps(lines)
    expect(props).toEqual({ items: 2 })
    expect(sanitizeProps(props)).toEqual({ items: 2 })
  })

  it('/admin/usage counts it like any other event', () => {
    const input = {
      days: ['2026-10-14'],
      today: '2026-10-14',
      counts: [{ day: '2026-10-14', name: 'carrefour_click', channel: 'web', count: 3 }],
      householdDays: [{ householdId: 'h1', day: '2026-10-14', name: 'carrefour_click' }],
    }
    expect(buildDaily(input)[0].events.carrefour_click).toBe(3)
    expect(buildTotals(input).events.carrefour_click).toBe(3)
    expect(buildTotals(input).householdsByEvent.carrefour_click).toBe(1)
  })
})
