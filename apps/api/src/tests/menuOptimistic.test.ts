/**
 * The menu changes shown at once in the browser (apps/web/src/lib/menuOptimistic.ts,
 * 2026-11-10: «hago cambios sobre el menú y tardan mucho en mostrarse»), and
 * the split of a meal into its main dish and the others (`slotDishParts`,
 * 2026-11-10: «había una nota de Romanescu que no se veía»). Each change must
 * give the same week the route gives, so the screen doesn't jump when the
 * server's answer replaces it.
 *
 * Run: pnpm --filter @ona/api test src/tests/menuOptimistic.test.ts
 */
import { describe, expect, it } from 'vitest'
import { moveSlotInWeek } from '../services/menuDishes.js'
import {
  addDishIn,
  addSlotIn,
  lockIn,
  moveSlotIn,
  patchDishIn,
  patchSlotIn,
  pickRecipeIn,
  removeDishIn,
  removeSlotIn,
} from '../../../web/src/lib/menuOptimistic'
import { dishName, slotDishParts } from '../../../web/src/lib/menuDay'

const conejo = { kind: 'recipe' as const, recipeId: 'r-conejo', recipeName: 'Conejo confitado con ajo y romero' }
const romanescu = { kind: 'note' as const, text: 'Romanescu' }

function week() {
  const days: any[] = Array.from({ length: 7 }, () => ({}))
  days[3] = { lunch: { servings: 3, dishes: [conejo, romanescu] }, dinner: { dishes: [{ kind: 'recipe', recipeId: 'r-crema', recipeName: 'Crema de calabaza' }] } }
  days[4] = { dinner: { dishes: [{ kind: 'recipe', recipeId: 'r-pizza', recipeName: 'Pizza' }] } }
  return { id: 'm1', days, locked: {}, skippedDays: [5] }
}

describe('pickRecipeIn («Elegir otra receta»)', () => {
  it('swaps the recipe, keeps the note and «Solo hoy», and draws the new name at once', () => {
    const before = week()
    const after = pickRecipeIn(before, 3, 'lunch', { id: 'r-lentejas', name: 'Lentejas', imageUrl: '/l.jpg' })
    expect(after.days[3].lunch.dishes).toEqual([
      { kind: 'recipe', recipeId: 'r-lentejas', recipeName: 'Lentejas', imageUrl: '/l.jpg' },
      romanescu,
    ])
    expect(after.days[3].lunch.servings).toBe(3)
    // Pure: the cached week is not touched (it is the one put back on error).
    expect(before.days[3].lunch.dishes[0]).toBe(conejo)
  })

  it('a slot with only a note gets the recipe after it', () => {
    const m = week()
    m.days[3].lunch.dishes = [romanescu]
    expect(pickRecipeIn(m, 3, 'lunch', { id: 'r-x', name: 'X' }).days[3].lunch.dishes.map(dishName)).toEqual(['Romanescu', 'X'])
  })

  it('a dish on a skipped day takes the day back (PRO-349)', () => {
    const m = week()
    m.days[5] = { lunch: { dishes: [] } }
    expect(pickRecipeIn(m, 5, 'lunch', { id: 'r-x', name: 'X' }).skippedDays).toEqual([])
  })
})

describe('dish and slot changes', () => {
  it('a written dish is added at the end, and a missing meal is created', () => {
    expect(addDishIn(week(), 3, 'dinner', { kind: 'note', text: 'Pan' }).days[3].dinner.dishes.map(dishName)).toEqual(['Crema de calabaza', 'Pan'])
    expect(addDishIn(week(), 4, 'lunch', { kind: 'note', text: 'Romanescu' }).days[4].lunch).toEqual({ servings: null, dishes: [romanescu] })
  })

  it('removes a dish by position, edits a note and reorders', () => {
    expect(removeDishIn(week(), 3, 'lunch', 1).days[3].lunch.dishes).toEqual([conejo])
    expect(patchDishIn(week(), 3, 'lunch', 1, { text: 'Romanesco' }).days[3].lunch.dishes[1]).toEqual({ kind: 'note', text: 'Romanesco' })
    expect(patchDishIn(week(), 3, 'lunch', 1, { newPosition: 0 }).days[3].lunch.dishes).toEqual([romanescu, conejo])
  })

  it('removes and adds a meal, servings, eaten and lock', () => {
    expect(removeSlotIn(week(), 3, 'dinner').days[3].dinner).toBeUndefined()
    expect(addSlotIn(week(), 4, 'lunch', { id: 'r-x', name: 'X' }).days[4].lunch.dishes).toEqual([{ kind: 'recipe', recipeId: 'r-x', recipeName: 'X', imageUrl: null }])
    expect(patchSlotIn(week(), 3, 'lunch', { servings: null }).days[3].lunch.servings).toBeNull()
    expect(patchSlotIn(week(), 3, 'dinner', { eaten: true }).days[3].dinner.eaten).toBe(true)
    expect(lockIn(week(), 3, 'lunch', true).locked).toEqual({ '3': { lunch: true } })
  })

  it('drag and drop gives the same week as the server (swap and move)', () => {
    for (const [from, to] of [
      [{ day: 3, meal: 'lunch' }, { day: 3, meal: 'dinner' }],
      [{ day: 4, meal: 'dinner' }, { day: 4, meal: 'lunch' }],
      [{ day: 3, meal: 'dinner' }, { day: 4, meal: 'dinner' }],
    ]) {
      expect(moveSlotIn(week(), from, to).days).toEqual(moveSlotInWeek(week().days, from, to))
    }
  })
})

describe('slotDishParts (every dish of a meal shows)', () => {
  it('the recipe is the main dish and the note an other line, with its position', () => {
    const { main, others } = slotDishParts(week().days[3].lunch)
    expect(main).toBe(conejo)
    expect(others).toEqual([{ dish: romanescu, position: 1 }])
  })

  it('a note before the recipe stays a line; a note-only meal shows its first text as the main one', () => {
    expect(slotDishParts({ dishes: [romanescu, conejo] }).others).toEqual([{ dish: romanescu, position: 0 }])
    const notes = slotDishParts({ dishes: [{ kind: 'note', text: 'Cenamos fuera' }, { kind: 'note', text: 'Pan' }] })
    expect(dishName(notes.main!)).toBe('Cenamos fuera')
    expect(notes.others.map((o) => dishName(o.dish))).toEqual(['Pan'])
    expect(slotDishParts({ dishes: [] })).toEqual({ main: null, others: [] })
  })
})
