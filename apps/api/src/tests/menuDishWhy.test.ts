/**
 * PRO-259 — la línea de por qué de cada plato (specs/smart-menu.md). Mimo
 * reads the menu through `mealLinesForDay` (context block on the web and on
 * WhatsApp, and the tools get_todays_menu / get_weekly_menu), so the why
 * there is what it tells when asked «¿por qué me has puesto esto?».
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu } from '@ona/shared'
import { dishWhys, mealLinesForDay } from '../services/menuText.js'

describe('mealLinesForDay with the planner\'s why', () => {
  it('carries the why of each dish that has one', () => {
    const day: DayMenu = {
      lunch: { dishes: [{ kind: 'recipe', recipeId: 'r1', recipeName: 'Lentejas estofadas', why: 'Lentejas porque os gustan los guisos y el martes tenéis tiempo' }] },
      dinner: { dishes: [{ kind: 'recipe', recipeId: 'r2', recipeName: 'Crema de calabacín' }] },
    }
    expect(mealLinesForDay(day)).toEqual([
      'comida: Lentejas estofadas (por qué: «Lentejas porque os gustan los guisos y el martes tenéis tiempo»)',
      'cena: Crema de calabacín',
    ])
  })

  it('today\'s generator menus read exactly as before', () => {
    const day: DayMenu = { lunch: { servings: 4, dishes: [{ kind: 'recipe', recipeId: 'r1', recipeName: 'Lentejas' }, { kind: 'note', text: 'pan' }] } }
    expect(mealLinesForDay(day)).toEqual(['comida [solo hoy: 4]: Lentejas + pan'])
  })

  it('ignores empty whys and notes, and clips a long one', () => {
    expect(dishWhys([{ kind: 'note', text: 'x' }, { kind: 'recipe', recipeId: 'a', why: '  ' }])).toEqual([])
    expect(dishWhys([{ kind: 'recipe', recipeId: 'a', why: 'a'.repeat(400) }])[0].length).toBeLessThanOrEqual(202)
  })
})
