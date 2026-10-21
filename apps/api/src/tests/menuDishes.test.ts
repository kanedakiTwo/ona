import { describe, it, expect } from 'vitest'
import type { DayMenu, Dish, RecipeDish } from '@ona/shared'
import {
  addDish,
  removeDishAt,
  reorderDish,
  patchDish,
  dishCountFor,
  coursesFor,
  slotWithDishes,
  moveSlotInWeek,
  isLeftoverSource,
} from '../services/menuDishes.js'

const r = (id: string, course?: 'starter' | 'main' | 'dessert'): RecipeDish => ({
  kind: 'recipe',
  recipeId: id,
  course: course ?? null,
})

describe('addDish', () => {
  it('appends a dish at the end', () => {
    const before: Dish[] = [r('a')]
    const after = addDish(before, r('b'))
    expect(after.map((d) => (d as RecipeDish).recipeId)).toEqual(['a', 'b'])
  })
  it('does not mutate the input', () => {
    const before: Dish[] = [r('a')]
    addDish(before, r('b'))
    expect(before.length).toBe(1)
  })
})

describe('removeDishAt', () => {
  it('removes at the given index, compacts positions', () => {
    const before: Dish[] = [r('a'), r('b'), r('c')]
    const after = removeDishAt(before, 1)
    expect(after.map((d) => (d as RecipeDish).recipeId)).toEqual(['a', 'c'])
  })
  it('throws when index is out of range', () => {
    expect(() => removeDishAt([r('a')], 5)).toThrow(/out of range/i)
  })
})

describe('reorderDish', () => {
  it('moves a dish from one position to another', () => {
    const before: Dish[] = [r('a'), r('b'), r('c')]
    const after = reorderDish(before, 0, 2)
    expect(after.map((d) => (d as RecipeDish).recipeId)).toEqual(['b', 'c', 'a'])
  })
  it('no-op when from == to', () => {
    const before: Dish[] = [r('a'), r('b')]
    const after = reorderDish(before, 1, 1)
    expect(after).toEqual(before)
  })
  it('throws when either index is out of range', () => {
    expect(() => reorderDish([r('a')], 0, 5)).toThrow()
  })
})

describe('patchDish', () => {
  it('updates note text', () => {
    const before: Dish[] = [{ kind: 'note', text: 'old' }]
    const after = patchDish(before, 0, { text: 'new' })
    expect((after[0] as { text: string }).text).toBe('new')
  })
  it('updates pinnedType on a recipe dish', () => {
    const before: Dish[] = [r('a')]
    const after = patchDish(before, 0, { pinnedType: 'legumbres' })
    expect((after[0] as RecipeDish).pinnedType).toBe('legumbres')
  })
  it('ignores text on a recipe dish', () => {
    const before: Dish[] = [r('a')]
    const after = patchDish(before, 0, { text: 'nope' })
    expect(after[0]).toEqual(before[0])
  })
  it('ignores pinnedType on a note dish', () => {
    const before: Dish[] = [{ kind: 'note', text: 'x' }]
    const after = patchDish(before, 0, { pinnedType: 'legumbres' })
    expect(after[0]).toEqual(before[0])
  })
  // Miguel, 2026-10-20: a dish already in the menu can be marked «del congelador».
  it('marks a recipe dish as a freezer táper and back', () => {
    const frozen = patchDish([r('a')], 0, { variant: 'freezer' })
    expect((frozen[0] as RecipeDish).variant).toBe('freezer')
    expect((patchDish(frozen, 0, { variant: 'planned' })[0] as RecipeDish).variant).toBe('planned')
  })
  it('marks a recipe dish as «sobras de otro día» and back', () => {
    const cooked = patchDish([r('a')], 0, { variant: 'cooked' })
    expect((cooked[0] as RecipeDish).variant).toBe('cooked')
    expect((patchDish(cooked, 0, { variant: 'planned' })[0] as RecipeDish).variant).toBe('planned')
  })
  it('never turns a leftover or a note into a freezer táper', () => {
    const leftover: Dish = { ...r('a'), variant: 'leftover', leftoverOf: { day: 0, meal: 'lunch', dishPosition: 0 } }
    expect(patchDish([leftover], 0, { variant: 'freezer' })[0]).toEqual(leftover)
    const note: Dish = { kind: 'note', text: 'x' }
    expect(patchDish([note], 0, { variant: 'freezer' })[0]).toEqual(note)
  })
})

describe('isLeftoverSource', () => {
  const leftoverOf = (day: number, meal: string, dishPosition = 0): Dish => ({
    ...r('a'),
    variant: 'leftover',
    leftoverOf: { day, meal, dishPosition },
  })
  it('true when another slot of the week eats its leftovers', () => {
    const days: DayMenu[] = [{ lunch: { dishes: [r('a')] } }, { dinner: { dishes: [leftoverOf(0, 'lunch')] } }]
    expect(isLeftoverSource(days, 0, 'lunch', 0)).toBe(true)
    expect(isLeftoverSource(days, 0, 'lunch', 1)).toBe(false)
    expect(isLeftoverSource(days, 1, 'dinner', 0)).toBe(false)
  })
})

describe('dishCountFor + coursesFor', () => {
  it('dishCountFor falls back to 1 when meal is missing', () => {
    expect(dishCountFor('lunch', {})).toBe(1)
    expect(dishCountFor('lunch', { lunch: 2 })).toBe(2)
  })
  it('coursesFor returns the convention', () => {
    expect(coursesFor(1)).toEqual([null])
    expect(coursesFor(2)).toEqual(['starter', 'main'])
    expect(coursesFor(3)).toEqual(['starter', 'main', 'dessert'])
  })
})

// PRO-102: a changed or moved dish keeps its diners and its leftovers.
describe('slotWithDishes', () => {
  it('keeps «Solo hoy» (servings) when the dishes change', () => {
    const slot = { servings: 4, dishes: [r('old')] as Dish[] }
    expect(slotWithDishes(slot, [r('new')])).toEqual({ servings: 4, dishes: [r('new')] })
    expect(slot.dishes).toEqual([r('old')])
  })
  it('a slot without diners stays without them; a missing slot gets just the dishes', () => {
    expect(slotWithDishes({ dishes: [r('old')] }, [r('new')])).toEqual({ dishes: [r('new')] })
    expect(slotWithDishes(undefined, [r('new')])).toEqual({ dishes: [r('new')] })
  })
})

describe('moveSlotInWeek', () => {
  const curry: RecipeDish = { kind: 'recipe', recipeId: 'curry', recipeName: 'Curry de garbanzos' }
  const leftover = (day: number, meal: string): RecipeDish => ({ ...curry, variant: 'leftover', leftoverOf: { day, meal, dishPosition: 0 } })
  // Laura, 2026-10-14: Monday's curry, cooked for 2 with a táper for Saturday.
  const week = (): DayMenu[] => {
    const days: DayMenu[] = Array.from({ length: 7 }, () => ({}))
    days[0].dinner = { servings: 2, dishes: [curry] }
    days[3].dinner = { dishes: [r('tortilla')] }
    days[5].lunch = { servings: 1, dishes: [leftover(0, 'dinner')] }
    return days
  }

  it('moving a dish to an empty slot carries its «Solo hoy» and its leftovers follow it', () => {
    const days = week()
    delete days[3].dinner
    const out = moveSlotInWeek(days, { day: 0, meal: 'dinner' }, { day: 3, meal: 'dinner' })
    expect(out[0].dinner).toBeUndefined()
    expect(out[3].dinner).toEqual({ servings: 2, dishes: [curry] })
    expect(out[5].lunch).toEqual({ servings: 1, dishes: [leftover(3, 'dinner')] })
    // the input is untouched
    expect(days[0].dinner).toEqual({ servings: 2, dishes: [curry] })
    expect(days[5].lunch!.dishes[0]).toEqual(leftover(0, 'dinner'))
  })

  it('a swap moves both slots whole and repoints the leftovers of each', () => {
    const days = week()
    days[6].lunch = { dishes: [{ ...r('tortilla'), variant: 'leftover', leftoverOf: { day: 3, meal: 'dinner', dishPosition: 0 } }] }
    const out = moveSlotInWeek(days, { day: 0, meal: 'dinner' }, { day: 3, meal: 'dinner' })
    expect(out[3].dinner).toEqual({ servings: 2, dishes: [curry] })
    expect(out[0].dinner).toEqual({ dishes: [r('tortilla')] })
    expect((out[5].lunch!.dishes[0] as RecipeDish).leftoverOf).toEqual({ day: 3, meal: 'dinner', dishPosition: 0 })
    expect((out[6].lunch!.dishes[0] as RecipeDish).leftoverOf).toEqual({ day: 0, meal: 'dinner', dishPosition: 0 })
  })

  it('the batch the moved dish cooks still counts the táper (same rule as the shopping list)', async () => {
    const { withLeftoverBatches } = await import('../services/shoppingList.js')
    const days = week()
    delete days[3].dinner
    const out = moveSlotInWeek(days, { day: 0, meal: 'dinner' }, { day: 3, meal: 'dinner' })
    // Monday's «Solo hoy: 2» already covers Saturday's táper: before and
    // after the move, the leftover adds nothing to the list.
    expect(withLeftoverBatches(days)[5].lunch!.dishes).toEqual([])
    expect(withLeftoverBatches(out)[5].lunch!.dishes).toEqual([])
    expect(withLeftoverBatches(out)[3].dinner).toEqual({ servings: 2, dishes: [curry] })
  })
})
