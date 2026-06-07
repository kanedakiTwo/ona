import { describe, it, expect } from 'vitest'
import {
  isRecipeDish,
  isNoteDish,
  recipeDishesOf,
  type Dish,
  type RecipeDish,
  type NoteDish,
} from '@ona/shared'

describe('Dish discriminated union', () => {
  const recipeDish: RecipeDish = { kind: 'recipe', recipeId: 'r1', recipeName: 'Cocido' }
  const noteDish: NoteDish = { kind: 'note', text: 'en casa de Paqui' }

  it('isRecipeDish narrows correctly', () => {
    expect(isRecipeDish(recipeDish)).toBe(true)
    expect(isRecipeDish(noteDish)).toBe(false)
  })

  it('isNoteDish narrows correctly', () => {
    expect(isNoteDish(recipeDish)).toBe(false)
    expect(isNoteDish(noteDish)).toBe(true)
  })

  it('recipeDishesOf filters and preserves order', () => {
    const dishes: Dish[] = [recipeDish, noteDish, { ...recipeDish, recipeId: 'r2' }]
    const out = recipeDishesOf(dishes)
    expect(out.map((d) => d.recipeId)).toEqual(['r1', 'r2'])
  })
})
