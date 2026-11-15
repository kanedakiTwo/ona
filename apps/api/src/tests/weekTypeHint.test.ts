/**
 * PRO-1233: in a week with no dishes yet, each empty slot shows what the
 * semana tipo puts there that week — a type, a recipe, something fixed,
 * «Cualquier receta» — and, by turns («cada 2»), only that week's turn.
 */
import { describe, expect, it } from 'vitest'
import type { WeekTypeDays } from '@ona/shared'
import { weekTypeHint } from '../../../web/src/lib/weekTypeHint'

const WEEK = '2026-11-16'
const NEXT = '2026-11-23'

const days: WeekTypeDays = [
  { lunch: { options: [{ kind: 'type', type: 'legumbres' }] } },
  { lunch: { options: [{ kind: 'recipe', recipeId: 'r1', name: 'Lentejas de la abuela' }] } },
  { dinner: { options: [{ kind: 'fixed', label: 'Sobras', items: [] }] } },
  { breakfast: { options: [{ kind: 'fixed', label: 'Leche con cereales y fruta', items: [{ name: 'leche', quantity: 200, unit: 'ml' }] }] } },
  { dinner: { options: [{ kind: 'type', type: 'pizza' }, { kind: 'any' }], since: WEEK } },
  { lunch: { options: [{ kind: 'type', type: 'legumbres' }, { kind: 'type', type: 'pescado' }], since: WEEK } },
  { lunch: { options: [{ kind: 'type', type: 'pasta' }, { kind: 'type', type: 'ensaladas' }], together: true }, dinner: { off: true } },
]

describe('weekTypeHint', () => {
  it('a dish type: its icon and its name', () => {
    expect(weekTypeHint(days, 0, 'lunch', WEEK)).toEqual({ icon: 'legumbres', label: 'Legumbres' })
  })

  it('a concrete recipe: its name', () => {
    expect(weekTypeHint(days, 1, 'lunch', WEEK)).toEqual({ icon: 'recipe', label: 'Lentejas de la abuela' })
  })

  it('something fixed reads «Fijo: …»', () => {
    expect(weekTypeHint(days, 2, 'dinner', WEEK)).toEqual({ icon: 'fixed', label: 'Fijo: Sobras' })
    expect(weekTypeHint(days, 3, 'breakfast', WEEK)).toEqual({ icon: 'fixed', label: 'Fijo: Leche con cereales y fruta' })
  })

  it('a free slot (lunch and dinner by default) is «Cualquier receta»', () => {
    expect(weekTypeHint(days, 0, 'dinner', WEEK)).toEqual({ icon: 'any', label: 'Cualquier receta' })
  })

  it('«cada 2»: the type the week it takes it, «Cualquier receta» the other', () => {
    expect(weekTypeHint(days, 4, 'dinner', WEEK)?.label).toBe('Pizza')
    expect(weekTypeHint(days, 4, 'dinner', NEXT)).toEqual({ icon: 'any', label: 'Cualquier receta' })
  })

  it('by turns: only the option of that week', () => {
    expect(weekTypeHint(days, 5, 'lunch', WEEK)?.label).toBe('Legumbres')
    expect(weekTypeHint(days, 5, 'lunch', NEXT)).toEqual({ icon: 'pescado', label: 'Pescado' })
  })

  it('together: every option, the icon of the first', () => {
    expect(weekTypeHint(days, 6, 'lunch', WEEK)).toEqual({ icon: 'pasta', label: 'Pasta + Ensaladas' })
  })

  it('«no hay» (and breakfast by default) or the week type not loaded yet: nothing', () => {
    expect(weekTypeHint(days, 6, 'dinner', WEEK)).toBeNull()
    expect(weekTypeHint(days, 0, 'breakfast', WEEK)).toBeNull()
    expect(weekTypeHint(undefined, 0, 'lunch', WEEK)).toBeNull()
  })
})
