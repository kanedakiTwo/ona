/**
 * 19-nov (Miguel): the WhatsApp sign-up's answers where the menu reads them,
 * and the dishes the household makes often in the first menu for sure
 * (services/signupFirstMenu.ts).
 */
import { describe, expect, it } from 'vitest'
import { cookingFreqForMealCounts, cookedDays, placeSignupDishes, recipeForDish, weekTypeForMealCounts } from '../services/signupFirstMenu.js'

const recipe = (recipeId: string, recipeName: string, extra: Record<string, unknown> = {}) => ({ kind: 'recipe', recipeId, recipeName, ...extra })
const week = () => Array.from({ length: 7 }, (_, i) => ({ lunch: { dishes: [recipe(`l${i}`, `Comida ${i}`)] }, dinner: { dishes: [recipe(`d${i}`, `Cena ${i}`)] } })) as any

describe('meals they cook → the week type', () => {
  it('«6 cenas y 1 comida»: Sunday lunch, every dinner but Saturday', () => {
    expect(cookedDays('lunch', 1)).toEqual([6])
    expect(cookedDays('dinner', 6)).toEqual([0, 1, 2, 3, 4, 6])
    expect(cookedDays('dinner', 5)).toEqual([0, 1, 2, 3, 4])
    const changes = weekTypeForMealCounts(1, 6)
    expect(changes).toHaveLength(14)
    expect(changes.filter((c) => c.slot.off).map((c) => `${c.meal}:${c.day}`)).toEqual(['lunch:0', 'lunch:1', 'lunch:2', 'lunch:3', 'lunch:4', 'lunch:5', 'dinner:5'])
  })
  it('a meal not said, or all seven, changes nothing', () => {
    expect(weekTypeForMealCounts(undefined, undefined)).toEqual([])
    expect(weekTypeForMealCounts(7, 7)).toEqual([])
    expect(weekTypeForMealCounts(undefined, 5).every((c) => c.meal === 'dinner')).toBe(true)
  })
  it('how often they cook, from the days with a cooked meal', () => {
    expect(cookingFreqForMealCounts(1, 6)).toBe('daily')
    expect(cookingFreqForMealCounts(0, 4)).toBe('3_4_times')
    expect(cookingFreqForMealCounts(2, 0)).toBe('rarely')
    expect(cookingFreqForMealCounts(undefined, undefined)).toBeUndefined()
  })
})

describe('recipeForDish', () => {
  const pool = [
    { id: 'a', name: 'Salmón al horno con patatas y cebolla' },
    { id: 'b', name: 'Salmón al horno con patatas' },
    { id: 'c', name: 'Patatas bravas' },
    { id: 'd', name: 'Bacalao con tomate', authorId: 'u1' },
    { id: 'e', name: 'Bacalao con tomate' },
  ]
  it('every significant word of the dish, the shortest name first, their own recipe before the catalogue', () => {
    expect(recipeForDish('salmón al horno con patatas', pool)?.id).toBe('b')
    expect(recipeForDish('bacalao con tomate', pool, 'u1')?.id).toBe('d')
    expect(recipeForDish('Patata brava', pool)?.id).toBe('c')
  })
  it('a word in common is not the dish', () => {
    expect(recipeForDish('tortilla de patatas', pool)).toBeNull()
    expect(recipeForDish('', pool)).toBeNull()
  })
})

describe('placeSignupDishes', () => {
  it('one per day, dinner first, from the first day with a free main dish; a recipe already drawn stays where it is', () => {
    const days = week()
    days[0] = {}
    days[3].lunch.dishes = [recipe('salmon', 'Salmón al horno con patatas')]
    const out = placeSignupDishes(days, [
      { dish: 'salmón al horno con patatas', recipe: { id: 'salmon', name: 'Salmón al horno con patatas' } },
      { dish: 'pollo a la plancha', recipe: { id: 'pollo', name: 'Pollo a la plancha', meals: ['dinner'] } },
      { dish: 'tortilla de mi abuela', recipe: null },
    ])
    expect(out.placed).toEqual([
      { dish: 'salmón al horno con patatas', dayIndex: 3, meal: 'lunch', recipeName: 'Salmón al horno con patatas', already: true },
      { dish: 'pollo a la plancha', dayIndex: 1, meal: 'dinner', recipeName: 'Pollo a la plancha' },
      { dish: 'tortilla de mi abuela', dayIndex: 2, meal: 'dinner' },
    ])
    expect(out.days[1].dinner.dishes[0]).toMatchObject({ kind: 'recipe', recipeId: 'pollo' })
    expect(out.days[2].dinner.dishes[0]).toEqual({ kind: 'note', text: 'tortilla de mi abuela' })
    expect(days[1].dinner.dishes[0].recipeId).toBe('d1') // a copy
    expect(out.left).toEqual([])
  })
  it('a dish said later and already drawn keeps its slot: an earlier dish never takes it (PRO-1296)', () => {
    const days = week()
    days[0].dinner.dishes = [recipe('costillas', 'Costillas a la riojana')]
    const out = placeSignupDishes(days, [
      { dish: 'bacalao con tomate', recipe: { id: 'bacalao', name: 'Bacalao con tomate' } },
      { dish: 'costillas a la riojana', recipe: { id: 'costillas', name: 'Costillas a la riojana' } },
    ])
    expect(out.placed).toEqual([
      { dish: 'bacalao con tomate', dayIndex: 1, meal: 'dinner', recipeName: 'Bacalao con tomate' },
      { dish: 'costillas a la riojana', dayIndex: 0, meal: 'dinner', recipeName: 'Costillas a la riojana', already: true },
    ])
    expect(out.days[0].dinner.dishes[0].recipeId).toBe('costillas')
  })
  it('locked slots, leftovers and fixed dishes are never touched; what finds no slot is left for next week', () => {
    const days = week().slice(0, 1)
    days[0].lunch.dishes = [recipe('t', 'Táper', { leftoverOf: { dayIndex: 0, meal: 'dinner' } })]
    const out = placeSignupDishes(days, [{ dish: 'lentejas', recipe: { id: 'len', name: 'Lentejas' } }, { dish: 'pisto', recipe: null }], { '0': { dinner: true } })
    expect(out.placed).toEqual([])
    expect(out.left.map((d) => d.dish)).toEqual(['lentejas', 'pisto'])
    expect(out.days[0].dinner.dishes[0].recipeId).toBe('d0')
  })
})
