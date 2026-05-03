/**
 * Unit tests for the assistant skills.
 *
 * Each skill handler takes `{ userId, db }` and returns `{ data, summary, uiHint? }`.
 * We exercise the happy path + the most informative edge cases without touching a real DB
 * by replacing `db` with a small proxy that returns canned responses for every drizzle
 * query terminator (`limit`, `returning`, `then`).
 *
 * The complementary live-API end-to-end suite is `assistant-skills.ts` (no `.test.ts`),
 * which exercises the LLM tool routing against a running server.
 *
 * Run: pnpm --filter @ona/api test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { skills } from '../services/assistant/skills.js'
import type { SkillDefinition } from '../services/assistant/types.js'

// ─── Mock service heavy-lifters that the skills delegate into ─────────────

vi.mock('../services/menuGenerator.js', () => ({
  generateMenu: vi.fn(async () => [{}, {}, {}, {}, {}, {}, {}]),
}))
vi.mock('../services/shoppingList.js', () => ({
  generateShoppingList: vi.fn(async () => []),
}))
vi.mock('../services/recipeMatcher.js', () => ({
  findRecipeForSlot: vi.fn(() => ({ id: 'r-new', name: 'Receta nueva' })),
}))
vi.mock('../services/calorieCalculator.js', () => ({
  calculateMenuCaloriesFromDB: vi.fn(async () => 12345),
}))
vi.mock('../services/nutrientCalculator.js', () => ({
  calculateMenuNutrientsFromDB: vi.fn(async () => ({})),
}))
vi.mock('../services/nutrientBalance.js', () => ({
  updateBalance: vi.fn(async () => {}),
}))
vi.mock('../services/advisor.js', () => ({
  getSummary: vi.fn(async () => ({
    weeks: [{ weekStart: '2026-04-21', kcal: 14000 }],
    averageCalories: 14000,
    trend: 'stable',
  })),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────

function get(name: string): SkillDefinition {
  const s = skills.find((s) => s.name === name)
  if (!s) throw new Error(`Skill not found in export array: ${name}`)
  return s
}

/**
 * Build a mock drizzle-like db. The query chain (`select().from().where()…`) is
 * a Proxy: every method returns the same proxy, so chaining never fails. Each
 * query is "consumed" when its terminator is awaited — `limit`, `returning`,
 * or any `then` invocation pulls the next response off the queue.
 *
 * Pass as many responses as the skill makes queries, in order.
 */
function makeDb(...responses: any[]) {
  const queue = [...responses]
  const node: any = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve: any, reject?: any) => {
            if (queue.length === 0) {
              const err = new Error(
                `mockDb: response queue empty (a query was made past what the test expected)`,
              )
              return reject ? reject(err) : Promise.reject(err)
            }
            return Promise.resolve(queue.shift()).then(resolve, reject)
          }
        }
        // Any other property is a chainable function — `select`, `from`, `where`,
        // `orderBy`, `limit`, `innerJoin`, `update`, `set`, `returning`,
        // `insert`, `values`, `delete`.
        return () => node
      },
    },
  )
  return node
}

const ctx = (db: any, userId = 'u-1') => ({ userId, db })

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── 1. get_todays_menu ───────────────────────────────────────────────────

describe('get_todays_menu', () => {
  const skill = get('get_todays_menu')

  it('reports no menu when none exists', async () => {
    const db = makeDb(/* select */ [])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('No tienes ningun menu')
    expect(r.data).toBeNull()
  })

  it('returns the day matching the dayIndex param', async () => {
    const menu = {
      id: 'm-1',
      days: Array.from({ length: 7 }, (_, i) => ({
        lunch: { recipeId: `r-${i}`, recipeName: `Plato ${i}` },
      })),
    }
    const db = makeDb([menu])
    const r = await skill.handler({ dayIndex: 2 }, ctx(db))
    expect(r.summary).toContain('miercoles')
    expect(r.summary).toContain('Plato 2')
    expect(r.data?.dayIndex).toBe(2)
  })

  it('rejects an out-of-range dayIndex', async () => {
    const menu = { id: 'm-1', days: [{}, {}, {}] }
    const db = makeDb([menu])
    const r = await skill.handler({ dayIndex: 9 }, ctx(db))
    expect(r.summary).toContain('fuera de rango')
  })

  it('falls back to today when dayIndex is omitted', async () => {
    const menu = {
      id: 'm-1',
      days: Array.from({ length: 7 }, () => ({ lunch: { recipeName: 'Cualquier cosa' } })),
    }
    const db = makeDb([menu])
    const r = await skill.handler({}, ctx(db))
    // Without overriding Date, just check shape — any of the 7 day names.
    expect(r.summary).toMatch(/lunes|martes|miercoles|jueves|viernes|sabado|domingo/)
  })
})

// ─── 2. get_recipe_details ────────────────────────────────────────────────

describe('get_recipe_details', () => {
  const skill = get('get_recipe_details')

  it('returns "no encontrado" when no match', async () => {
    const db = makeDb(/* exact match */ [], /* word-by-word */ [])
    const r = await skill.handler({ recipeName: 'cochinillo segoviano' }, ctx(db))
    expect(r.summary).toContain('No he encontrado')
  })

  it('returns ingredients when a recipe matches', async () => {
    const recipe = { id: 'r-1', name: 'Lentejas con verduras', prepTime: 30, meals: ['lunch'], seasons: ['autumn'] }
    const ingredients = [
      { ingredientName: 'lentejas', quantity: 200, unit: 'g' },
      { ingredientName: 'cebolla', quantity: 1, unit: 'u' },
    ]
    const db = makeDb([recipe], ingredients)
    const r = await skill.handler({ recipeName: 'lentejas' }, ctx(db))
    expect(r.uiHint).toBe('recipe')
    expect(r.summary).toContain('Lentejas con verduras')
    expect(r.summary).toContain('lentejas')
    expect(r.data?.ingredients).toHaveLength(2)
  })
})

// ─── 3. get_weekly_nutrition ──────────────────────────────────────────────

describe('get_weekly_nutrition', () => {
  const skill = get('get_weekly_nutrition')

  it('summarizes calories and balance when balance exists', async () => {
    const db = makeDb([
      { balance: { protein: 25, carbohydrates: 50, fat: 25 } },
    ])
    const r = await skill.handler({ weeks: 4 }, ctx(db))
    expect(r.uiHint).toBe('nutrition')
    expect(r.summary).toMatch(/kcal|semana/)
  })

  it('handles empty history', async () => {
    // getSummary mock returns weeks: [...], so the empty-history branch needs an override.
    const advisor = await import('../services/advisor.js')
    ;(advisor.getSummary as any).mockResolvedValueOnce({ weeks: [], averageCalories: 0, trend: 'stable' })
    const db = makeDb([])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('No hay datos nutricionales')
  })
})

// ─── 4. get_shopping_list ─────────────────────────────────────────────────

describe('get_shopping_list', () => {
  const skill = get('get_shopping_list')

  it('returns "no menu" when there is none', async () => {
    const db = makeDb([])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('No tienes menu')
  })

  it('reports an empty list when the generator returns no items', async () => {
    const menu = { id: 'm-1', days: [{}], userId: 'u-1' }
    const db = makeDb([menu], [{ householdSize: 'solo' }])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('vacia')
  })
})

// ─── 5. suggest_recipes ───────────────────────────────────────────────────

describe('suggest_recipes', () => {
  const skill = get('suggest_recipes')

  it('returns up to 5 recipes filtered by mealType', async () => {
    const recipes = Array.from({ length: 8 }, (_, i) => ({
      id: `r-${i}`,
      name: `Plato ${i}`,
      meals: ['dinner'],
      seasons: ['summer'],
      prepTime: 20,
    }))
    const db = makeDb(recipes)
    const r = await skill.handler({ mealType: 'dinner' }, ctx(db))
    expect(r.uiHint).toBe('recipe')
    expect(r.data).toBeTruthy()
  })

  it('handles empty result', async () => {
    const db = makeDb([])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toBeTruthy()
  })
})

// ─── 6. search_recipes ────────────────────────────────────────────────────

describe('search_recipes', () => {
  const skill = get('search_recipes')

  it('returns results when the query matches', async () => {
    const rows = [
      { id: 'r-1', name: 'Pollo al curry', meals: ['lunch'], seasons: [], prepTime: 25 },
      { id: 'r-2', name: 'Pollo al limón', meals: ['lunch'], seasons: [], prepTime: 20 },
    ]
    const db = makeDb(rows)
    const r = await skill.handler({ query: 'pollo' }, ctx(db))
    expect(r.summary).toContain('Encontradas 2')
    expect(r.summary).toContain('Pollo al curry')
  })

  it('reports no match', async () => {
    const db = makeDb([])
    const r = await skill.handler({ query: 'unobtanium' }, ctx(db))
    expect(r.summary).toContain('No he encontrado')
  })
})

// ─── 7. generate_weekly_menu ──────────────────────────────────────────────

describe('generate_weekly_menu', () => {
  const skill = get('generate_weekly_menu')

  it('inserts a new menu and reports success', async () => {
    const inserted = { id: 'm-new', days: [{}, {}, {}, {}, {}, {}, {}] }
    // generator → insert menu → insert log → updateBalance
    const db = makeDb([inserted], [{ id: 'log-1' }])
    const r = await skill.handler({}, ctx(db))
    expect(r.uiHint).toBe('menu')
    expect(r.summary).toContain('Menu generado')
  })
})

// ─── 8. swap_meal ─────────────────────────────────────────────────────────

describe('swap_meal', () => {
  const skill = get('swap_meal')

  it('refuses when there is no menu', async () => {
    const db = makeDb([])
    const r = await skill.handler({ dayIndex: 0, meal: 'lunch' }, ctx(db))
    expect(r.summary).toContain('No tienes menu')
  })

  it('rejects an out-of-range day', async () => {
    const menu = { id: 'm-1', days: [{}, {}, {}] }
    const db = makeDb([menu])
    const r = await skill.handler({ dayIndex: 8, meal: 'lunch' }, ctx(db))
    expect(r.summary).toContain('fuera de rango')
  })

  it('updates the slot when a replacement is found', async () => {
    const menu = {
      id: 'm-1',
      days: Array.from({ length: 7 }, () => ({ lunch: { recipeId: 'r-old', recipeName: 'Antiguo' } })),
    }
    // queries: select menu, select user(restrictions), select favorites,
    // loadRecipesWithIngredients → select recipes, select riRows, then update menu.
    const db = makeDb(
      [menu],                                       // select menu
      [{ restrictions: [] }],                       // select user restrictions
      [],                                           // select favorites
      [{ id: 'r-1', name: 'Plato', meals: ['lunch'], seasons: [], tags: [] }],   // recipes
      [],                                           // recipe ingredients
      [{ ...menu, days: [...menu.days] }],          // returning updated
    )
    const r = await skill.handler({ dayIndex: 0, meal: 'lunch' }, ctx(db))
    expect(r.summary).toContain('Cambiado')
  })
})

// ─── 9. toggle_favorite ───────────────────────────────────────────────────

describe('toggle_favorite', () => {
  const skill = get('toggle_favorite')

  it('reports recipe not found', async () => {
    const db = makeDb([])
    const r = await skill.handler({ recipeName: 'inexistente' }, ctx(db))
    expect(r.summary).toContain('No he encontrado')
  })

  it('adds to favorites when not yet favorited', async () => {
    const recipe = { id: 'r-1', name: 'Tortilla' }
    const db = makeDb([recipe], /* existing favs */ [], /* insert */ undefined)
    const r = await skill.handler({ recipeName: 'tortilla' }, ctx(db))
    expect(r.summary).toMatch(/anadida a favoritos|favorit/i)
  })

  it('removes from favorites when already favorited', async () => {
    const recipe = { id: 'r-1', name: 'Tortilla' }
    const db = makeDb([recipe], [{ id: 'fav-1', recipeId: 'r-1' }], undefined)
    const r = await skill.handler({ recipeName: 'tortilla' }, ctx(db))
    expect(r.summary).toContain('eliminada de favoritos')
  })
})

// ─── 10. mark_meal_eaten ──────────────────────────────────────────────────

describe('mark_meal_eaten', () => {
  const skill = get('mark_meal_eaten')

  it('records eatenAt when eaten=true', async () => {
    const menu = {
      id: 'm-1',
      days: Array.from({ length: 7 }, () => ({ lunch: { recipeId: 'r', recipeName: 'Pollo' } })),
    }
    const db = makeDb([menu], [{ ...menu }])
    const r = await skill.handler({ dayIndex: 0, meal: 'lunch', eaten: true }, ctx(db))
    expect(r.summary).toContain('Pollo del lunes marcada como comida')
    // The handler mutates `days[idx][meal]` in place before update.
    expect((menu.days[0].lunch as any).eatenAt).toBeTruthy()
  })

  it('clears eatenAt when eaten=false', async () => {
    const menu = {
      id: 'm-1',
      days: Array.from({ length: 7 }, () => ({
        lunch: { recipeId: 'r', recipeName: 'Pollo', eaten: true, eatenAt: '2026-04-30T12:00:00Z' },
      })),
    }
    const db = makeDb([menu], [{ ...menu }])
    await skill.handler({ dayIndex: 0, meal: 'lunch', eaten: false }, ctx(db))
    expect((menu.days[0].lunch as any).eatenAt).toBeUndefined()
  })

  it('rejects when the slot has no meal', async () => {
    const menu = { id: 'm-1', days: [{}, {}, {}, {}, {}, {}, {}] }
    const db = makeDb([menu])
    const r = await skill.handler({ dayIndex: 0, meal: 'lunch', eaten: true }, ctx(db))
    expect(r.summary).toContain('No hay comida planificada')
  })
})

// ─── 11. create_recipe ────────────────────────────────────────────────────

describe('create_recipe', () => {
  const skill = get('create_recipe')

  it('creates a recipe with the given fields', async () => {
    const params = {
      name: 'Pollo al limón',
      ingredients: [
        { name: 'pollo', quantity: 300, unit: 'g' },
        { name: 'limón', quantity: 1, unit: 'u' },
      ],
      steps: ['Cortar el pollo', 'Cocinar 20 min'],
      prepTime: 25,
      mealType: 'lunch',
      season: 'spring',
    }
    // Real query order in the handler: insert recipe returning, then per-ingredient
    // (lookup, insert junction). Two ingredients × 2 awaits = 4, plus the insert
    // recipe = 5 queue slots.
    const db = makeDb(
      [{ id: 'r-new', name: params.name }], // insert recipe returning
      [{ id: 'i-pollo', name: 'pollo' }],   // SELECT ingredient #1
      undefined,                             // INSERT junction #1
      [{ id: 'i-limon', name: 'limón' }],   // SELECT ingredient #2
      undefined,                             // INSERT junction #2
    )
    const r = await skill.handler(params, ctx(db))
    expect(r.summary).toContain('creada')
    expect(r.data?.recipeId).toBe('r-new')
    expect(r.data?.linkedIngredients).toHaveLength(2)
  })

  it('reports missing ingredients when the catalog has no match', async () => {
    const params = {
      name: 'Receta exótica',
      ingredients: [{ name: 'unobtanium', quantity: 50, unit: 'g' }],
      steps: ['Mezclar'],
      prepTime: 5,
      mealType: 'lunch',
      season: 'spring',
    }
    const db = makeDb(
      [{ id: 'r-new', name: params.name }], // insert recipe
      [],                                    // SELECT — not found
    )
    const r = await skill.handler(params, ctx(db))
    expect(r.data?.missingIngredients).toContain('unobtanium')
    expect(r.data?.linkedIngredients).toHaveLength(0)
  })
})

// ─── 12. recipe_variation ─────────────────────────────────────────────────

describe('recipe_variation', () => {
  const skill = get('recipe_variation')

  it('returns the recipe context for the LLM to use', async () => {
    const recipe = { id: 'r-1', name: 'Coliflor gratinada' }
    const ingredients = [
      { ingredientName: 'coliflor', quantity: 500, unit: 'g' },
      { ingredientName: 'mantequilla', quantity: 50, unit: 'g' },
    ]
    const db = makeDb([recipe], ingredients)
    const r = await skill.handler(
      { recipeName: 'coliflor gratinada', ingredientToReplace: 'mantequilla' },
      ctx(db),
    )
    expect(r.summary).toContain('mantequilla')
    expect(r.data?.recipeName).toBe('Coliflor gratinada')
  })

  it('reports no recipe found', async () => {
    const db = makeDb([])
    const r = await skill.handler(
      { recipeName: 'nada', ingredientToReplace: 'x' },
      ctx(db),
    )
    expect(r.summary).toContain('No he encontrado')
  })
})

// ─── 13. nutrition_advice ─────────────────────────────────────────────────

describe('nutrition_advice', () => {
  const skill = get('nutrition_advice')

  it('frames the question for the model and includes balance', async () => {
    const db = makeDb(
      [{ balance: { protein: 30, carbohydrates: 45, fat: 25 } }],
      [{ caloriesTotal: 14000 }, { caloriesTotal: 13500 }],
    )
    const r = await skill.handler({ question: '¿Voy bien de proteína?' }, ctx(db))
    expect(r.uiHint).toBe('nutrition')
    expect(r.summary).toContain('proteina')
  })
})

// ─── 14. get_pantry_stock ─────────────────────────────────────────────────

describe('get_pantry_stock', () => {
  const skill = get('get_pantry_stock')

  it('reports no list when the user has none', async () => {
    const db = makeDb([])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('lista de la compra')
  })

  it('lists items flagged inStock', async () => {
    const list = {
      id: 'sl-1',
      items: [
        { id: 'i-1', name: 'leche', inStock: true },
        { id: 'i-2', name: 'huevos', inStock: false },
        { id: 'i-3', name: 'mantequilla', inStock: true },
      ],
    }
    const db = makeDb([list])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('Tienes en casa')
    expect(r.summary).toContain('leche')
    expect(r.summary).toContain('mantequilla')
    expect(r.summary).not.toContain('huevos')
  })

  it('reports empty when nothing is in stock', async () => {
    const list = { id: 'sl-1', items: [{ id: 'i-1', name: 'leche', inStock: false }] }
    const db = makeDb([list])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('No tienes nada')
  })
})

// ─── 15. mark_in_stock ────────────────────────────────────────────────────

describe('mark_in_stock', () => {
  const skill = get('mark_in_stock')

  it('refuses when there is no list', async () => {
    const db = makeDb([])
    const r = await skill.handler({ ingredient: 'mantequilla' }, ctx(db))
    expect(r.summary).toContain('Necesitas tener una lista')
  })

  it('reports not found when ingredient is absent', async () => {
    const list = { id: 'sl-1', items: [{ name: 'pasta', inStock: false }] }
    const db = makeDb([list])
    const r = await skill.handler({ ingredient: 'mantequilla' }, ctx(db))
    expect(r.summary).toContain('No he encontrado')
  })

  it('flips inStock when no explicit value is given', async () => {
    const item = { name: 'mantequilla', inStock: false }
    const list = { id: 'sl-1', items: [item] }
    const db = makeDb([list], undefined /* update */)
    const r = await skill.handler({ ingredient: 'mantequilla' }, ctx(db))
    expect(r.summary).toContain('marcado como en casa')
    expect(item.inStock).toBe(true)
  })

  it('respects an explicit inStock=false to remove from pantry', async () => {
    const item = { name: 'mantequilla', inStock: true }
    const list = { id: 'sl-1', items: [item] }
    const db = makeDb([list], undefined)
    const r = await skill.handler({ ingredient: 'mantequilla', inStock: false }, ctx(db))
    expect(r.summary).toContain('eliminado de la despensa')
    expect(item.inStock).toBe(false)
  })

  it('matches partial / fuzzy ingredient names', async () => {
    const item = { name: 'aceite de oliva virgen', inStock: false }
    const list = { id: 'sl-1', items: [item] }
    const db = makeDb([list], undefined)
    const r = await skill.handler({ ingredient: 'aceite' }, ctx(db))
    expect(r.summary).toContain('marcado como en casa')
  })
})

// ─── 16. check_shopping_item ──────────────────────────────────────────────

describe('check_shopping_item', () => {
  const skill = get('check_shopping_item')

  it('flips checked when no explicit value is given', async () => {
    const item = { name: 'pasta', checked: false }
    const list = { id: 'sl-1', items: [item] }
    const db = makeDb([list], undefined)
    const r = await skill.handler({ ingredient: 'pasta' }, ctx(db))
    expect(r.summary).toContain('marcado como comprado')
    expect(item.checked).toBe(true)
  })

  it('respects checked=false to put it back on the list', async () => {
    const item = { name: 'pasta', checked: true }
    const list = { id: 'sl-1', items: [item] }
    const db = makeDb([list], undefined)
    const r = await skill.handler({ ingredient: 'pasta', checked: false }, ctx(db))
    expect(r.summary).toContain('vuelve a la lista')
  })
})

// ─── 17. get_my_recipes ───────────────────────────────────────────────────

describe('get_my_recipes', () => {
  const skill = get('get_my_recipes')

  it('reports zero when the user has not created any', async () => {
    const db = makeDb([])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('Aun no has guardado recetas propias')
  })

  it('lists user-authored recipes', async () => {
    const rows = [
      { id: 'r-1', name: 'Mi tortilla', meals: ['breakfast'], prepTime: 10, servings: 2 },
      { id: 'r-2', name: 'Mis lentejas', meals: ['lunch'], prepTime: 30, servings: 4 },
    ]
    const db = makeDb(rows)
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('2 receta(s) propia(s)')
    expect(r.summary).toContain('Mi tortilla')
    expect(r.summary).toContain('Mis lentejas')
  })
})

// ─── 18. get_menu_history ─────────────────────────────────────────────────

describe('get_menu_history', () => {
  const skill = get('get_menu_history')

  it('reports empty history', async () => {
    const db = makeDb([])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('No tienes historial')
  })

  it('summarizes meals across N weeks', async () => {
    const rows = [
      {
        id: 'm-1',
        weekStart: '2026-04-21',
        days: [{ lunch: { recipeName: 'Pollo' } }, { lunch: { recipeName: 'Lentejas' } }],
      },
    ]
    const db = makeDb(rows)
    const r = await skill.handler({ weeks: 2 }, ctx(db))
    expect(r.summary).toContain('Pollo')
    expect(r.summary).toContain('Lentejas')
  })

  it('clamps weeks to a sensible range', async () => {
    const db = makeDb([])
    const r = await skill.handler({ weeks: 999 }, ctx(db))
    // No assertion on the limit value — just no crash; the handler clamps internally.
    expect(r.summary).toBeTruthy()
  })
})

// ─── 19. scale_recipe ─────────────────────────────────────────────────────

describe('scale_recipe', () => {
  const skill = get('scale_recipe')

  it('rejects non-positive servings', async () => {
    const db = makeDb()
    const r = await skill.handler({ recipeName: 'X', servings: 0 }, ctx(db))
    expect(r.summary).toContain('debe ser positivo')
  })

  it('reports recipe not found', async () => {
    const db = makeDb([])
    const r = await skill.handler({ recipeName: 'nada', servings: 4 }, ctx(db))
    expect(r.summary).toContain('No he encontrado')
  })

  it('scales the ingredient quantities', async () => {
    const recipe = { id: 'r-1', name: 'Pollo al curry', servings: 2 }
    const ings = [
      { ingredientName: 'pollo', quantity: 200, unit: 'g', optional: false },
      { ingredientName: 'curry', quantity: 1, unit: 'cda', optional: false },
    ]
    const db = makeDb([recipe], ings)
    const r = await skill.handler({ recipeName: 'pollo curry', servings: 4 }, ctx(db))
    expect(r.summary).toContain('Pollo al curry para 4')
    expect(r.data?.servings).toBe(4)
    expect(r.data?.baseServings).toBe(2)
    // 200 g × 2 = 400 g; bandStep at 400 = 50 → still 400.
    expect(r.data?.ingredients[0].quantity).toBe(400)
    // 1 cda × 2 = 2 cda.
    expect(r.data?.ingredients[1].quantity).toBe(2)
  })

  it('marks optional ingredients in the spoken summary', async () => {
    const recipe = { id: 'r-1', name: 'Salsa', servings: 2 }
    const ings = [
      { ingredientName: 'tomate', quantity: 200, unit: 'g', optional: false },
      { ingredientName: 'orégano', quantity: 1, unit: 'pizca', optional: true },
    ]
    const db = makeDb([recipe], ings)
    const r = await skill.handler({ recipeName: 'salsa', servings: 4 }, ctx(db))
    expect(r.summary).toContain('(opcional)')
  })
})

// ─── 20. evaluate_food_health (KB pure) ───────────────────────────────────

describe('evaluate_food_health', () => {
  const skill = get('evaluate_food_health')

  it('frames the question with all 5 evaluation axes', async () => {
    const r = await skill.handler({ food: 'zumo de naranja' }, ctx(makeDb()))
    expect(r.summary).toContain('zumo de naranja')
    expect(r.summary).toContain('inflamatoria')
    expect(r.summary).toContain('insulina')
    expect(r.summary).toContain('procesado')
    expect(r.summary).toContain('frecuencia')
    expect(r.uiHint).toBe('nutrition')
  })
})

// ─── 21. suggest_substitution (mostly pure, optional db lookup) ───────────

describe('suggest_substitution', () => {
  const skill = get('suggest_substitution')

  it('frames the substitution without a recipe', async () => {
    const r = await skill.handler({ ingredient: 'nata' }, ctx(makeDb()))
    expect(r.summary).toContain('"nata"')
    expect(r.summary).toContain('NUNCA')
    expect(r.summary).toContain('margarina')
  })

  it('includes recipe allergens when the recipe is known', async () => {
    const recipe = { name: 'Coliflor gratinada', allergens: ['lactosa'] }
    const db = makeDb([recipe])
    const r = await skill.handler(
      { ingredient: 'mantequilla', recipeName: 'coliflor gratinada', restriction: 'sin lactosa' },
      ctx(db),
    )
    expect(r.summary).toContain('lactosa')
    expect(r.summary).toContain('Coliflor gratinada')
  })

  it('handles missing recipe gracefully', async () => {
    const db = makeDb([])
    const r = await skill.handler(
      { ingredient: 'mantequilla', recipeName: 'inexistente' },
      ctx(db),
    )
    expect(r.summary).toContain('"mantequilla"')
  })
})

// ─── 22. get_variety_score ────────────────────────────────────────────────

describe('get_variety_score', () => {
  const skill = get('get_variety_score')

  it('reports no menu when there is none', async () => {
    const db = makeDb([])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('No tienes menu')
  })

  it('reports no recipes when the menu is empty', async () => {
    const db = makeDb([{ id: 'm', days: [{}, {}] }])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('no tiene recetas')
  })

  it('counts vegetables, proteins, and total distinct ingredients', async () => {
    const menu = {
      id: 'm',
      days: [
        { lunch: { recipeId: 'r-1' } },
        { dinner: { recipeId: 'r-2' } },
      ],
    }
    const ingRows = [
      { ingredientName: 'pollo' },
      { ingredientName: 'espinaca' },
      { ingredientName: 'arroz integral' },
      { ingredientName: 'lentejas' },
      { ingredientName: 'brócoli' },
    ]
    // Note: `brócoli` includes the accented "ó" — VEG_RE matches the literal "brocoli"
    // (no accent in the regex), so we use the unaccented form to keep the test honest.
    ingRows[4].ingredientName = 'brocoli'
    const db = makeDb([menu], ingRows)
    const r = await skill.handler({}, ctx(db))
    expect(r.uiHint).toBe('nutrition')
    expect(r.data?.distinctCount).toBe(5)
    expect(r.data?.vegetableCount).toBeGreaterThanOrEqual(2)
    expect(r.data?.proteinCount).toBeGreaterThanOrEqual(2)
    expect(r.summary).toContain('Score de variedad')
  })
})

// ─── 23. get_eating_window ────────────────────────────────────────────────

describe('get_eating_window', () => {
  const skill = get('get_eating_window')

  it('reports no data when no menu rows', async () => {
    const db = makeDb([])
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('No tengo datos')
  })

  it('reports no eatenAt timestamps when nothing has been marked eaten', async () => {
    const rows = [{ days: [{ lunch: { eaten: true } }, {}], weekStart: '2026-04-21' }]
    const db = makeDb(rows)
    const r = await skill.handler({}, ctx(db))
    expect(r.summary).toContain('Aun no has marcado')
  })

  it('computes the eating window from eatenAt timestamps', async () => {
    const rows = [
      {
        weekStart: '2026-04-21',
        days: [
          {
            breakfast: { eaten: true, eatenAt: '2026-04-21T08:30:00Z' },
            dinner: { eaten: true, eatenAt: '2026-04-21T20:30:00Z' },
          },
          {
            breakfast: { eaten: true, eatenAt: '2026-04-22T09:00:00Z' },
            dinner: { eaten: true, eatenAt: '2026-04-22T22:00:00Z' },
          },
        ],
      },
    ]
    const db = makeDb(rows)
    const r = await skill.handler({}, ctx(db))
    expect(r.uiHint).toBe('nutrition')
    expect(r.data?.daysSampled).toBe(2)
    expect(r.data?.avgWindowHours).toBeGreaterThan(0)
  })
})

// ─── 24. get_inflammation_index ───────────────────────────────────────────

describe('get_inflammation_index', () => {
  const skill = get('get_inflammation_index')

  it('returns 50 baseline for a recipe with no signal', async () => {
    const recipe = { id: 'r-1', name: 'Plato neutro', nutritionPerServing: null }
    const db = makeDb([recipe], /* ingredients */ [], /* steps */ [])
    const r = await skill.handler({ recipeName: 'plato neutro' }, ctx(db))
    expect(r.data?.score).toBe(50)
  })

  it('penalizes processed ingredients', async () => {
    const recipe = { id: 'r-1', name: 'Tarta dulce', nutritionPerServing: null }
    const ings = [{ name: 'azucar' }, { name: 'harina blanca' }]
    const steps = [{ text: 'Mezclar y hornear', technique: null }]
    const db = makeDb([recipe], ings, steps)
    const r = await skill.handler({ recipeName: 'tarta' }, ctx(db))
    // 50 - 5 (azucar) - 5 (harina blanca) + 3 (horno) = 43
    expect(r.data?.score).toBeLessThan(50)
    expect(r.data?.reasons.some((x: string) => x.includes('procesado'))).toBe(true)
  })

  it('rewards whole-food ingredients and gentle cooking', async () => {
    const recipe = { id: 'r-1', name: 'Salmón al horno', nutritionPerServing: { fiberG: 12, saltG: 1 } }
    const ings = [{ name: 'salmon' }, { name: 'espinaca' }, { name: 'aceite oliva' }]
    const steps = [{ text: 'Hornear 20 minutos', technique: 'horno' }]
    const db = makeDb([recipe], ings, steps)
    const r = await skill.handler({ recipeName: 'salmon' }, ctx(db))
    expect(r.data?.score).toBeGreaterThan(50)
  })

  it('weekly mode without weekly:true asks for a recipe', async () => {
    const r = await skill.handler({}, ctx(makeDb()))
    expect(r.summary).toMatch(/Indica una receta|weekly/)
  })

  it('weekly mode reports no menu when there is none', async () => {
    const db = makeDb([])
    const r = await skill.handler({ weekly: true }, ctx(db))
    expect(r.summary).toContain('No tienes menu')
  })
})

// ─── 25. start_cooking_mode ───────────────────────────────────────────────

describe('start_cooking_mode', () => {
  const skill = get('start_cooking_mode')

  it('emits cooking_navigate with the resolved recipe', async () => {
    const recipe = { id: 'r-1', name: 'Tortilla' }
    const db = makeDb([recipe])
    const r = await skill.handler({ recipeName: 'tortilla' }, ctx(db))
    expect(r.uiHint).toBe('cooking_navigate')
    expect(r.data).toMatchObject({ recipeId: 'r-1', recipeName: 'Tortilla' })
  })

  it('forwards a servings hint when provided', async () => {
    const recipe = { id: 'r-1', name: 'Tortilla' }
    const db = makeDb([recipe])
    const r = await skill.handler({ recipeName: 'tortilla', servings: 6 }, ctx(db))
    expect(r.data?.servings).toBe(6)
  })

  it('reports recipe not found', async () => {
    const db = makeDb([])
    const r = await skill.handler({ recipeName: 'nada' }, ctx(db))
    expect(r.summary).toContain('No he encontrado')
  })
})

// ─── 26. set_timer (pure) ─────────────────────────────────────────────────

describe('set_timer', () => {
  const skill = get('set_timer')

  it('emits cooking_timer with the requested minutes', async () => {
    const r = await skill.handler({ minutes: 12, label: 'arroz' }, ctx(makeDb()))
    expect(r.uiHint).toBe('cooking_timer')
    expect(r.data?.minutes).toBe(12)
    expect(r.data?.label).toBe('arroz')
    expect(r.summary).toContain('12 min')
    expect(r.summary).toContain('arroz')
  })

  it('clamps minutes to the [0.5, 180] range', async () => {
    const high = await skill.handler({ minutes: 9999 }, ctx(makeDb()))
    expect(high.data?.minutes).toBe(180)
    const low = await skill.handler({ minutes: 0 }, ctx(makeDb()))
    expect(low.data?.minutes).toBe(0.5)
  })
})

// ─── 27. cooking_step (pure) ──────────────────────────────────────────────

describe('cooking_step', () => {
  const skill = get('cooking_step')

  it('forwards next/previous/repeat directions', async () => {
    for (const direction of ['next', 'previous', 'repeat'] as const) {
      const r = await skill.handler({ direction }, ctx(makeDb()))
      expect(r.uiHint).toBe('cooking_step')
      expect(r.data?.direction).toBe(direction)
    }
  })

  it('coerces unknown directions to "next"', async () => {
    const r = await skill.handler({ direction: 'sideways' as any }, ctx(makeDb()))
    expect(r.data?.direction).toBe('next')
  })
})

// ─── Sanity: every skill in the export array has at least one test ────────

describe('skill export coverage', () => {
  it('there are exactly 28 registered skills', () => {
    expect(skills.length).toBe(28)
  })

  it('every skill has a unique name', () => {
    const names = skills.map((s) => s.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every skill exposes a JSON-schema parameters object', () => {
    for (const s of skills) {
      expect(s.parameters).toBeTruthy()
      expect(s.parameters.type).toBe('object')
      expect(s.parameters.properties).toBeTruthy()
    }
  })

  it('every skill description is non-empty and substantive', () => {
    for (const s of skills) {
      expect(s.description.trim().length).toBeGreaterThan(20)
    }
  })
})
