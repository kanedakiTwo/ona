/**
 * «Tu semana tipo» (D-182 phase 2): how the slot panel reads and writes a
 * slot — «cada N» as one option, turns restarting when the options change —
 * and «Así lo pondría Mimo».
 */
import { describe, expect, it } from 'vitest'
import { weekTypePreview, weekTypeSlotFromView, weekTypeSlotView, type WeekTypeSlot } from '@ona/shared'

const W1 = '2026-11-09'
const W2 = '2026-11-16'
const pizza = { kind: 'type' as const, type: 'pizza' }
const ceviche = { kind: 'type' as const, type: 'ceviche' }
const any = { kind: 'any' as const }

describe('the panel’s view of a slot', () => {
  it('«Pizza, cada 3» is stored as its turn and read back as one option', () => {
    const slot = weekTypeSlotFromView({}, { off: false, options: [pizza], together: false, every: 3 }, W1)
    expect(slot).toEqual({ options: [pizza, any, any], since: W1 })
    expect(weekTypeSlotView(slot)).toEqual({ off: false, options: [pizza], together: false, every: 3 })
  })

  it('two options by turns, then together; together needs two', () => {
    const turns = weekTypeSlotFromView({ diners: 3 }, { off: false, options: [pizza, ceviche], together: false, every: 1 }, W1)
    expect(turns).toEqual({ diners: 3, options: [pizza, ceviche], since: W1 })
    const together = weekTypeSlotFromView(turns, { ...weekTypeSlotView(turns), together: true }, W2)
    expect(together).toEqual({ diners: 3, options: [pizza, ceviche], together: true, since: W2 })
    expect(weekTypeSlotFromView(together, { off: false, options: [pizza], together: true, every: 1 }, W2)).toEqual({ diners: 3, options: [pizza], since: W2 })
  })

  it('the turns keep counting when nothing about the options changes; «no hay» keeps them for later', () => {
    const slot: WeekTypeSlot = { options: [pizza, ceviche], since: W1 }
    expect(weekTypeSlotFromView(slot, weekTypeSlotView(slot), W2).since).toBe(W1)
    const off = weekTypeSlotFromView(slot, { ...weekTypeSlotView(slot), off: true }, W2)
    expect(off).toEqual({ off: true, options: [pizza, ceviche], since: W1 })
    expect(weekTypeSlotFromView({ options: [pizza], since: W1 }, { off: false, options: [], together: false, every: 1 }, W2)).toEqual({})
  })

  it('«Así lo pondría Mimo»: the next 4 weeks', () => {
    expect(weekTypePreview({ options: [pizza, any], since: W1 }, W1).map((w) => w.label)).toEqual(['Pizza', 'Cualquier receta', 'Pizza', 'Cualquier receta'])
    expect(weekTypePreview({ options: [pizza, ceviche], together: true, since: W1 }, W2, 2)).toEqual([
      { weekStart: W2, label: 'Pizza + Ceviche' },
      { weekStart: '2026-11-23', label: 'Pizza + Ceviche' },
    ])
    expect(weekTypePreview({ off: true }, W1, 1)[0].label).toBe('No hay')
    expect(weekTypePreview({}, W1, 1)[0].label).toBe('Cualquier receta')
  })
})
