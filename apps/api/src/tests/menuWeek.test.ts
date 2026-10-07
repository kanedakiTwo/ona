/** Pure helpers behind "regenerate / Vaciar semana never lose locked dishes". */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {} }))

import { keepLockedSlots, lockedThatExist, menuHasDishes } from '../services/menuWeek.js'

const dish = (id: string) => ({ kind: 'recipe', recipeId: id, recipeName: id })
const week = () =>
  Array.from({ length: 7 }, () => ({ lunch: { dishes: [] as any[] }, dinner: { dishes: [] as any[] } })) as any[]

describe('menuHasDishes', () => {
  it('is false for an empty or missing week, true with any dish', () => {
    expect(menuHasDishes(undefined)).toBe(false)
    expect(menuHasDishes(week())).toBe(false)
    const w = week()
    w[3].dinner.dishes.push(dish('r1'))
    expect(menuHasDishes(w)).toBe(true)
  })
})

describe('lockedThatExist', () => {
  it('drops locks on empty or missing slots', () => {
    const w = week()
    w[0].lunch.dishes.push(dish('r1'))
    expect(lockedThatExist({ '0': { lunch: true, dinner: true }, '9': { lunch: true } }, w)).toEqual({ '0': { lunch: true } })
    expect(lockedThatExist({ '0': { lunch: false } }, w)).toEqual({})
    expect(lockedThatExist({ '0': { lunch: true } }, undefined)).toEqual({})
  })
})

describe('keepLockedSlots', () => {
  it('copies only locked slots from the previous week', () => {
    const prev = week()
    prev[0].lunch.dishes.push(dish('kept'))
    prev[1].dinner.dishes.push(dish('replaced'))
    const fresh = week()
    fresh[1].dinner.dishes.push(dish('new'))
    keepLockedSlots(fresh, prev, { '0': { lunch: true } })
    expect(fresh[0].lunch.dishes[0].recipeId).toBe('kept')
    expect(fresh[1].dinner.dishes[0].recipeId).toBe('new')
  })
})
