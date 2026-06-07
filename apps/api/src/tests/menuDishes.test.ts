import { describe, it, expect } from 'vitest'
import type { Dish, RecipeDish } from '@ona/shared'
import {
  addDish,
  removeDishAt,
  reorderDish,
  patchDish,
  dishCountFor,
  coursesFor,
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
