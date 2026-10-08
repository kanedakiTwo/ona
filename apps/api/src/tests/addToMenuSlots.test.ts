/**
 * PRO-04 "Añadir al menú" from the recipe detail (apps/web/src/lib/addToMenu.ts):
 * the sheet lists the 7 days × comida/cena of this week. A missing slot is
 * added (POST), an existing one — empty or with a dish — is replaced (PUT
 * with recipeId), a locked one can't be touched.
 */
import { describe, expect, it } from 'vitest'
import type { Menu } from '@ona/shared'
import { addToMenuSlots, mondayOf } from '../../../web/src/lib/addToMenu'

function menu(days: Menu['days'], locked: Menu['locked'] = {}): Menu {
  return {
    id: 'm1', userId: 'u1', weekStart: '2026-10-05', days, locked,
    bannedRecipeIds: [], skippedDays: [], createdAt: '2026-10-05T00:00:00Z',
  } as Menu
}

const dish = (recipeId: string, recipeName: string) => ({ kind: 'recipe' as const, recipeId, recipeName })

describe('addToMenuSlots', () => {
  it('lists 7 days × lunch/dinner with the right action per slot', () => {
    const days: Menu['days'] = Array.from({ length: 7 }, () => ({}))
    days[0] = { lunch: { dishes: [dish('r1', 'Lentejas')] } }
    days[1] = { lunch: { dishes: [] }, dinner: { dishes: [dish('r2', 'Tortilla')] } }
    const slots = addToMenuSlots(menu(days, { '1': { dinner: true } }), 'r9')

    expect(slots).toHaveLength(14)
    expect(slots[0]).toMatchObject({ day: 0, meal: 'lunch', action: 'replace', current: 'Lentejas' })
    expect(slots[1]).toMatchObject({ day: 0, meal: 'dinner', action: 'add', current: null })
    expect(slots[2]).toMatchObject({ day: 1, meal: 'lunch', action: 'replace', current: null })
    expect(slots[3]).toMatchObject({ day: 1, meal: 'dinner', action: 'locked', current: 'Tortilla' })
  })

  it('marks a slot that already holds this recipe', () => {
    const days: Menu['days'] = Array.from({ length: 7 }, () => ({}))
    days[2] = { dinner: { dishes: [dish('r9', 'Crema')] } }
    expect(addToMenuSlots(menu(days), 'r9')[5]).toMatchObject({ action: 'already' })
  })
})

describe('mondayOf', () => {
  it('returns the local Monday as YYYY-MM-DD', () => {
    expect(mondayOf(new Date(2026, 9, 8))).toBe('2026-10-05') // jueves
    expect(mondayOf(new Date(2026, 9, 11))).toBe('2026-10-05') // domingo
    expect(mondayOf(new Date(2026, 9, 12))).toBe('2026-10-12') // lunes
  })
})
