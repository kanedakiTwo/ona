/**
 * Unit tests for the menu generation algorithm.
 * Pure logic — no database, no API calls.
 *
 * Run: cd apps/api && npx vitest run src/tests/unit-algorithm.test.ts
 */

import { describe, it, expect } from 'vitest'
import { calculateBMR, getActivityFactor, calculateTDEE, calculateMenuTargetCalories } from '@ona/shared'
import { ingredientCalories, recipeCalories } from '@ona/shared'
import { ingredientNutrients, sumNutrients, nutrientsToPercentages, updateNutrientBalance, normalizeDeviation } from '@ona/shared'
import { detectSeason, isInSeason } from '@ona/shared'
import { TARGET_MACROS, MENU_GENERATION, EMA_WEIGHTS } from '@ona/shared'
import type { Season, NutrientBalance } from '@ona/shared'

// ═══════════════════════════════════════
// BMR & CALORIE CALCULATIONS
// ═══════════════════════════════════════

describe('BMR (Mifflin-St Jeor)', () => {
  it('calculates BMR for male correctly', () => {
    // 10*80 + 6.25*180 - 5*30 + 5 = 800 + 1125 - 150 + 5 = 1780
    expect(calculateBMR('male', 80, 180, 30)).toBe(1780)
  })

  it('calculates BMR for female correctly', () => {
    // 10*60 + 6.25*165 - 5*25 - 161 = 600 + 1031.25 - 125 - 161 = 1345.25
    expect(calculateBMR('female', 60, 165, 25)).toBe(1345.25)
  })

  it('male BMR is higher than female with same stats', () => {
    const male = calculateBMR('male', 70, 170, 30)
    const female = calculateBMR('female', 70, 170, 30)
    expect(male).toBeGreaterThan(female)
    // Difference should be exactly 166 (5 - (-161))
    expect(male - female).toBe(166)
  })

  it('heavier person has higher BMR', () => {
    const light = calculateBMR('male', 60, 175, 30)
    const heavy = calculateBMR('male', 90, 175, 30)
    expect(heavy).toBeGreaterThan(light)
  })

  it('older person has lower BMR', () => {
    const young = calculateBMR('male', 80, 180, 20)
    const old = calculateBMR('male', 80, 180, 50)
    expect(young).toBeGreaterThan(old)
  })
})

describe('Activity Factor', () => {
  it('none = 1.2', () => expect(getActivityFactor('none')).toBe(1.2))
  it('light = 1.375', () => expect(getActivityFactor('light')).toBe(1.375))
  it('moderate = 1.55', () => expect(getActivityFactor('moderate')).toBe(1.55))
  it('high = 1.725', () => expect(getActivityFactor('high')).toBe(1.725))
})

describe('TDEE', () => {
  it('TDEE = BMR * activity factor', () => {
    const bmr = calculateBMR('male', 80, 180, 30)
    const tdee = calculateTDEE('male', 80, 180, 30, 'moderate')
    expect(tdee).toBe(bmr * 1.55)
  })

  it('higher activity = higher TDEE', () => {
    const sedentary = calculateTDEE('male', 80, 180, 30, 'none')
    const active = calculateTDEE('male', 80, 180, 30, 'high')
    expect(active).toBeGreaterThan(sedentary)
  })
})

describe('Menu Target Calories', () => {
  it('scales with number of meals', () => {
    const cal7 = calculateMenuTargetCalories('male', 80, 180, 30, 'moderate', 7)
    const cal14 = calculateMenuTargetCalories('male', 80, 180, 30, 'moderate', 14)
    expect(cal14).toBe(cal7 * 2)
  })

  it('0 meals = 0 calories', () => {
    const cal = calculateMenuTargetCalories('male', 80, 180, 30, 'moderate', 0)
    expect(cal).toBe(0)
  })
})

// ═══════════════════════════════════════
// INGREDIENT & RECIPE CALORIES
// ═══════════════════════════════════════

describe('Ingredient Calories', () => {
  it('100g of 200kcal ingredient = 200kcal', () => {
    expect(ingredientCalories(200, 100)).toBe(200)
  })

  it('50g of 200kcal ingredient = 100kcal', () => {
    expect(ingredientCalories(200, 50)).toBe(100)
  })

  it('0g = 0kcal', () => {
    expect(ingredientCalories(200, 0)).toBe(0)
  })

  it('handles decimal quantities', () => {
    expect(ingredientCalories(100, 33)).toBeCloseTo(33)
  })
})

describe('Recipe Calories', () => {
  it('sums calories from all ingredients', () => {
    const ings = [
      { calories: 200, quantity: 100 }, // 200 kcal
      { calories: 100, quantity: 50 },  // 50 kcal
      { calories: 50, quantity: 200 },  // 100 kcal
    ]
    expect(recipeCalories(ings)).toBe(350)
  })

  it('empty recipe = 0 calories', () => {
    expect(recipeCalories([])).toBe(0)
  })
})

// ═══════════════════════════════════════
// NUTRIENT CALCULATIONS
// ═══════════════════════════════════════

describe('Ingredient Nutrients', () => {
  it('scales nutrients by quantity/100', () => {
    const n = ingredientNutrients(20, 50, 10, 200)
    expect(n.protein).toBe(40)      // 20 * 200/100
    expect(n.carbohydrates).toBe(100) // 50 * 200/100
    expect(n.fat).toBe(20)           // 10 * 200/100
  })

  it('100g returns per-100g values', () => {
    const n = ingredientNutrients(15, 60, 5, 100)
    expect(n.protein).toBe(15)
    expect(n.carbohydrates).toBe(60)
    expect(n.fat).toBe(5)
  })
})

describe('Sum Nutrients', () => {
  it('sums multiple nutrient sources', () => {
    const items = [
      { protein: 10, carbohydrates: 20, fat: 5 },
      { protein: 15, carbohydrates: 30, fat: 10 },
    ]
    const total = sumNutrients(items)
    expect(total.protein).toBe(25)
    expect(total.carbohydrates).toBe(50)
    expect(total.fat).toBe(15)
  })

  it('empty array = zeros', () => {
    const total = sumNutrients([])
    expect(total.protein).toBe(0)
    expect(total.carbohydrates).toBe(0)
    expect(total.fat).toBe(0)
  })
})

describe('Nutrients to Percentages', () => {
  it('converts to correct percentages', () => {
    const p = nutrientsToPercentages({ protein: 25, carbohydrates: 50, fat: 25 })
    expect(p.protein).toBe(25)
    expect(p.carbohydrates).toBe(50)
    expect(p.fat).toBe(25)
  })

  it('percentages sum to 100', () => {
    const p = nutrientsToPercentages({ protein: 30, carbohydrates: 120, fat: 50 })
    expect(p.protein + p.carbohydrates + p.fat).toBeCloseTo(100)
  })

  it('handles all zeros', () => {
    const p = nutrientsToPercentages({ protein: 0, carbohydrates: 0, fat: 0 })
    expect(p.protein).toBe(0)
    expect(p.carbohydrates).toBe(0)
    expect(p.fat).toBe(0)
  })
})

// ═══════════════════════════════════════
// FITNESS SCORING
// ═══════════════════════════════════════

describe('Normalize Deviation', () => {
  it('perfect match = 0', () => {
    expect(normalizeDeviation(100, 100)).toBe(0)
  })

  it('50% overshoot = 50', () => {
    expect(normalizeDeviation(100, 150)).toBe(50)
  })

  it('50% undershoot = 50', () => {
    expect(normalizeDeviation(100, 50)).toBe(50)
  })

  it('target 0 = 0 (no division by zero)', () => {
    expect(normalizeDeviation(0, 50)).toBe(0)
  })

  it('deviation is always positive', () => {
    expect(normalizeDeviation(200, 100)).toBeGreaterThan(0)
    expect(normalizeDeviation(200, 300)).toBeGreaterThan(0)
  })
})

describe('Fitness Constants', () => {
  it('MAX_ITERATIONS is 200', () => {
    expect(MENU_GENERATION.MAX_ITERATIONS).toBe(200)
  })

  it('OPTIMAL_FITNESS is 5', () => {
    expect(MENU_GENERATION.OPTIMAL_FITNESS).toBe(5)
  })

  it('target macros sum to ~97% (carbs 57 + fat 25 + protein 15)', () => {
    const sum = TARGET_MACROS.carbohydrates + TARGET_MACROS.fat + TARGET_MACROS.protein
    expect(sum).toBe(97) // deliberate: leaves room for fiber etc.
  })
})

// ═══════════════════════════════════════
// EMA (NUTRIENT BALANCE TRACKING)
// ═══════════════════════════════════════

describe('Nutrient Balance EMA', () => {
  it('first entry = raw values (no previous balance)', () => {
    const n: NutrientBalance = { protein: 20, carbohydrates: 60, fat: 20 }
    const result = updateNutrientBalance(n)
    expect(result.protein).toBe(20)
    expect(result.carbohydrates).toBe(60)
    expect(result.fat).toBe(20)
  })

  it('applies 0.7 new + 0.3 old weighting', () => {
    const old: NutrientBalance = { protein: 10, carbohydrates: 50, fat: 40 }
    const current: NutrientBalance = { protein: 20, carbohydrates: 60, fat: 20 }
    const result = updateNutrientBalance(current, old)

    expect(result.protein).toBeCloseTo(20 * 0.7 + 10 * 0.3)   // 17
    expect(result.carbohydrates).toBeCloseTo(60 * 0.7 + 50 * 0.3) // 57
    expect(result.fat).toBeCloseTo(20 * 0.7 + 40 * 0.3)        // 26
  })

  it('converges toward new values over iterations', () => {
    let balance: NutrientBalance = { protein: 0, carbohydrates: 0, fat: 0 }
    const target: NutrientBalance = { protein: 20, carbohydrates: 60, fat: 20 }

    for (let i = 0; i < 20; i++) {
      balance = updateNutrientBalance(target, balance)
    }

    // After 20 iterations of constant input, should be very close to target
    expect(balance.protein).toBeCloseTo(20, 0)
    expect(balance.carbohydrates).toBeCloseTo(60, 0)
    expect(balance.fat).toBeCloseTo(20, 0)
  })

  it('EMA weights are 0.7 and 0.3', () => {
    expect(EMA_WEIGHTS.NEW).toBe(0.7)
    expect(EMA_WEIGHTS.OLD).toBe(0.3)
  })
})

// ═══════════════════════════════════════
// SEASON DETECTION
// ═══════════════════════════════════════

describe('Season Detection', () => {
  it('January = winter', () => {
    expect(detectSeason(new Date(2026, 0, 15))).toBe('winter')
  })

  it('April = spring', () => {
    expect(detectSeason(new Date(2026, 3, 15))).toBe('spring')
  })

  it('July = summer', () => {
    expect(detectSeason(new Date(2026, 6, 15))).toBe('summer')
  })

  it('October = autumn', () => {
    expect(detectSeason(new Date(2026, 9, 15))).toBe('autumn')
  })

  it('December = winter', () => {
    expect(detectSeason(new Date(2026, 11, 15))).toBe('winter')
  })
})

describe('Season Matching', () => {
  it('recipe with matching season passes', () => {
    expect(isInSeason(['spring', 'summer'], 'spring')).toBe(true)
  })

  it('recipe without matching season fails', () => {
    expect(isInSeason(['spring', 'summer'], 'winter')).toBe(false)
  })

  it('recipe with empty seasons matches all (all-year)', () => {
    expect(isInSeason([], 'winter')).toBe(true)
    expect(isInSeason([], 'summer')).toBe(true)
  })

  it('recipe with all 4 seasons matches any', () => {
    const all: Season[] = ['spring', 'summer', 'autumn', 'winter']
    expect(isInSeason(all, 'spring')).toBe(true)
    expect(isInSeason(all, 'autumn')).toBe(true)
  })
})

// ═══════════════════════════════════════
// RECIPE MATCHER (pure logic)
// ═══════════════════════════════════════

// We test the matching predicates that the recipeMatcher uses
// without importing the actual module (which requires DB types)

describe('Recipe Matching Predicates', () => {
  const recipes = [
    { id: '1', name: 'Pasta', meals: ['lunch', 'dinner'], seasons: ['spring', 'summer', 'autumn', 'winter'], ingredients: [] },
    { id: '2', name: 'Salmon', meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'], ingredients: [] },
    { id: '3', name: 'Porridge', meals: ['breakfast'], seasons: ['spring', 'summer', 'autumn', 'winter'], ingredients: [] },
    { id: '4', name: 'Ensalada', meals: ['lunch', 'dinner'], seasons: ['spring', 'summer'], ingredients: [] },
    { id: '5', name: 'Lentejas', meals: ['lunch'], seasons: ['autumn', 'winter'], ingredients: [] },
  ]

  function matchMeal(recipe: typeof recipes[0], meal: string): boolean {
    return recipe.meals.includes(meal)
  }

  function matchSeason(recipe: typeof recipes[0], season: Season): boolean {
    return recipe.seasons.length === 0 || recipe.seasons.includes(season)
  }

  function notUsed(recipe: typeof recipes[0], usedIds: Set<string>): boolean {
    return !usedIds.has(recipe.id)
  }

  function findMatching(meal: string, season: Season, usedIds: Set<string>) {
    return recipes.filter(r => matchMeal(r, meal) && matchSeason(r, season) && notUsed(r, usedIds))
  }

  it('filters by meal type correctly', () => {
    const breakfastRecipes = recipes.filter(r => matchMeal(r, 'breakfast'))
    expect(breakfastRecipes).toHaveLength(1)
    expect(breakfastRecipes[0].name).toBe('Porridge')
  })

  it('filters by season correctly', () => {
    const winterRecipes = recipes.filter(r => matchSeason(r, 'winter'))
    expect(winterRecipes.map(r => r.name)).toContain('Pasta')
    expect(winterRecipes.map(r => r.name)).toContain('Salmon')
    expect(winterRecipes.map(r => r.name)).toContain('Lentejas')
    expect(winterRecipes.map(r => r.name)).not.toContain('Ensalada')
  })

  it('excludes already used recipes', () => {
    const used = new Set(['1', '2'])
    const available = findMatching('lunch', 'winter', used)
    expect(available.map(r => r.name)).not.toContain('Pasta')
    expect(available.map(r => r.name)).not.toContain('Salmon')
    expect(available.map(r => r.name)).toContain('Lentejas')
  })

  it('combined filters narrow candidates correctly', () => {
    // Summer lunch, no recipes used
    const candidates = findMatching('lunch', 'summer', new Set())
    expect(candidates.map(r => r.name)).toEqual(expect.arrayContaining(['Pasta', 'Ensalada']))
    expect(candidates.map(r => r.name)).not.toContain('Salmon') // not summer
    expect(candidates.map(r => r.name)).not.toContain('Porridge') // not lunch
    expect(candidates.map(r => r.name)).not.toContain('Lentejas') // not summer
  })

  it('returns empty when all matching recipes are used', () => {
    const used = new Set(['1', '4']) // Pasta and Ensalada used
    const candidates = findMatching('lunch', 'summer', used)
    expect(candidates).toHaveLength(0)
  })

  it('no-repeat: after using all lunch recipes in a season, pool is empty', () => {
    // Winter lunch recipes: Pasta(1), Salmon(2), Lentejas(5)
    const used = new Set(['1', '2', '5'])
    const candidates = findMatching('lunch', 'winter', used)
    expect(candidates).toHaveLength(0)
  })
})

// ═══════════════════════════════════════
// SHOPPING LIST LOGIC (pure)
// ═══════════════════════════════════════

describe('Shopping List Consolidation', () => {
  interface Item { name: string; quantity: number }

  function consolidate(items: Item[]): Item[] {
    const map = new Map<string, number>()
    for (const item of items) {
      map.set(item.name, (map.get(item.name) ?? 0) + item.quantity)
    }
    return Array.from(map.entries()).map(([name, quantity]) => ({ name, quantity }))
  }

  it('merges duplicate ingredients', () => {
    const items = [
      { name: 'tomate', quantity: 200 },
      { name: 'cebolla', quantity: 50 },
      { name: 'tomate', quantity: 150 },
    ]
    const result = consolidate(items)
    const tomate = result.find(i => i.name === 'tomate')
    expect(tomate?.quantity).toBe(350)
    expect(result).toHaveLength(2)
  })

  it('handles single occurrence', () => {
    const result = consolidate([{ name: 'ajo', quantity: 10 }])
    expect(result).toHaveLength(1)
    expect(result[0].quantity).toBe(10)
  })

  it('handles empty input', () => {
    expect(consolidate([])).toHaveLength(0)
  })

  it('sums 3+ occurrences of same ingredient', () => {
    const items = [
      { name: 'aceite', quantity: 10 },
      { name: 'aceite', quantity: 15 },
      { name: 'aceite', quantity: 20 },
    ]
    const result = consolidate(items)
    expect(result[0].quantity).toBe(45)
  })
})

describe('Household Multiplier', () => {
  const MULTIPLIERS: Record<string, number> = {
    solo: 1,
    couple: 2,
    family_with_kids: 4,
    family_no_kids: 3,
  }

  it('solo = 1x', () => expect(MULTIPLIERS.solo).toBe(1))
  it('couple = 2x', () => expect(MULTIPLIERS.couple).toBe(2))
  it('family with kids = 4x', () => expect(MULTIPLIERS.family_with_kids).toBe(4))
  it('family no kids = 3x', () => expect(MULTIPLIERS.family_no_kids).toBe(3))

  it('multiplied quantity is correct', () => {
    const baseQty = 200 // 200g of ingredient
    expect(baseQty * MULTIPLIERS.couple).toBe(400)
    expect(baseQty * MULTIPLIERS.family_with_kids).toBe(800)
  })
})
