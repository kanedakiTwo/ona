/**
 * UI-parity skills (appSkills.ts): each maps a chat request onto the same
 * REST calls the web app makes. A fake AppApi records calls and serves canned
 * responses, so these pin the exact endpoint + body per skill.
 */
import { describe, it, expect } from 'vitest'
import { appSkills, bestMatch, toBuyable, applyTemplateChange, normalize } from '../services/assistant/appSkills.js'
import { AppApiError, type AppApi } from '../services/assistant/appApi.js'
import { madridWeekStart } from '../services/madridTime.js'

const get = (name: string) => {
  const s = appSkills.find((x) => x.name === name)
  if (!s) throw new Error(`skill ${name} missing`)
  return s
}

const MENU = {
  id: 'm1',
  days: [
    { lunch: { dishes: [{ kind: 'recipe', recipeId: 'r-lent', recipeName: 'Lentejas estofadas' }, { kind: 'recipe', recipeId: 'r-ens', recipeName: 'Ensalada verde' }] } },
    {},
    {},
    { lunch: { dishes: [{ kind: 'recipe', recipeId: 'r-cal', recipeName: 'Crema de calabaza' }] } },
    {},
    { dinner: { dishes: [{ kind: 'recipe', recipeId: 'r-gr', recipeName: 'Ensalada griega' }] } },
    {},
  ],
}

function fakeApi(routes: Record<string, unknown | ((body: any) => unknown)> = {}) {
  const calls: { method: string; path: string; body?: any }[] = []
  const api: AppApi = async (method, path, body) => {
    calls.push({ method, path, body })
    const key = `${method} ${path.split('?')[0]}`
    for (const [pattern, value] of Object.entries(routes)) {
      if (pattern === key || (pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1)))) {
        if (value instanceof Error) throw value
        return (typeof value === 'function' ? (value as any)(body, path) : value) as any
      }
    }
    if (method === 'GET' && path.startsWith('/menu/u1/')) return MENU as any
    return {} as any
  }
  return { api, calls }
}
const ctx = (api: AppApi) => ({ userId: 'u1', db: null, api })
const writes = (calls: { method: string }[]) => calls.filter((c) => c.method !== 'GET')

describe('pure helpers', () => {
  it('bestMatch prefers exact > prefix > contains > token overlap, and rejects junk', () => {
    const items = ['Lentejas estofadas', 'Lentejas con chorizo', 'Crema de calabaza']
    expect(bestMatch(items, 'lentejas estofadas', (x) => x)).toBe('Lentejas estofadas')
    expect(bestMatch(items, 'crema', (x) => x)).toBe('Crema de calabaza')
    expect(bestMatch(items, 'lentejas chorizo', (x) => x)).toBe('Lentejas con chorizo')
    expect(bestMatch(items, 'paella', (x) => x)).toBeNull()
    expect(normalize('  Ensalada  Griega ')).toBe('ensalada griega')
  })

  it('searchWords expands everyday dish words to how recipes are named', async () => {
    const { searchWords } = await import('../services/assistant/appSkills.js')
    const w = searchWords('un filete de carne de vaca')
    expect(w).toEqual(expect.arrayContaining(['filete', 'vaca', 'ternera', 'entrecot']))
    expect(w).not.toContain('de')
  })

  it('toBuyable maps everyday units to what the list accepts', () => {
    expect(toBuyable(2, 'litros')).toEqual({ quantity: 2000, unit: 'ml' })
    expect(toBuyable(1, 'kg')).toEqual({ quantity: 1000, unit: 'g' })
    expect(toBuyable(6)).toEqual({ quantity: 6, unit: 'u' })
    expect(toBuyable(2, 'paquetes')).toEqual({ suffix: '2 paquetes' })
    expect(toBuyable(undefined, 'g')).toEqual({})
  })

  it('applyTemplateChange edits diners per day/meal and dish counts, keeping the rest', () => {
    const t = applyTemplateChange(
      { physical: { age: 42 }, mealTemplate: { lunes: { almuerzo: 2, cena: 2 } } },
      { days: [0, 1], meal: 'lunch', diners: 0, dishes: 2 },
    )
    expect(t.physical).toEqual({ age: 42 })
    expect(t.mealTemplate.lunes).toEqual({ almuerzo: 0, cena: 2 })
    expect(t.mealTemplate.martes).toEqual({ almuerzo: 0 })
    expect(t.mealDishCounts).toEqual({ lunch: 2 })
  })
})

describe('menu skills', () => {
  it("set_meal_note replaces a slot's dishes with a note (\"el sábado cenamos fuera\")", async () => {
    const f = fakeApi()
    const r = await get('set_meal_note').handler({ dayIndex: 5, meal: 'dinner', text: 'Cenamos fuera' }, ctx(f.api))
    expect(f.calls[0]).toEqual({ method: 'GET', path: `/menu/u1/${madridWeekStart()}`, body: undefined })
    expect(writes(f.calls)).toEqual([
      { method: 'DELETE', path: '/menu/m1/day/5/meal/dinner', body: undefined },
      { method: 'POST', path: '/menu/m1/day/5/meal/dinner/dish', body: { kind: 'note', text: 'Cenamos fuera' } },
    ])
    expect(r.summary).toMatch(/^Hecho: la cena del sábado queda como "Cenamos fuera"/)
  })

  it('set_meal_note on next week reads next Monday and can keep dishes', async () => {
    const f = fakeApi()
    await get('set_meal_note').handler({ dayIndex: 5, meal: 'dinner', text: 'Pizza', keepDishes: true, nextWeek: true }, ctx(f.api))
    expect(f.calls[0].path).toBe(`/menu/u1/${madridWeekStart(new Date(), 1)}`)
    expect(writes(f.calls)).toEqual([{ method: 'POST', path: '/menu/m1/day/5/meal/dinner/dish', body: { kind: 'note', text: 'Pizza' } }])
  })

  it('says there is no menu instead of silently doing nothing', async () => {
    const f = fakeApi({ 'GET /menu/*': new AppApiError(404, 'Menu not found') })
    const r = await get('clear_meal').handler({ dayIndex: 1, meal: 'lunch' }, ctx(f.api))
    expect(r.summary).toMatch(/No hay menú esta semana/)
    expect(writes(f.calls)).toEqual([])
  })

  it('validates day and meal', async () => {
    const f = fakeApi()
    expect((await get('clear_meal').handler({ dayIndex: 9, meal: 'lunch' }, ctx(f.api))).summary).toMatch(/dayIndex/)
    expect((await get('clear_meal').handler({ dayIndex: 1, meal: 'brunch' }, ctx(f.api))).summary).toMatch(/meal/)
  })

  it('set_day_skipped skips and unskips', async () => {
    const f = fakeApi()
    await get('set_day_skipped').handler({ dayIndex: 6 }, ctx(f.api))
    await get('set_day_skipped').handler({ dayIndex: 6, skipped: false }, ctx(f.api))
    expect(writes(f.calls)).toEqual([
      { method: 'POST', path: '/menu/m1/day/6/skip', body: undefined },
      { method: 'DELETE', path: '/menu/m1/day/6/skip', body: undefined },
    ])
  })

  it('add_dish puts a dish that is not in the catalogue as a note (no blocking "¿la creo?")', async () => {
    const f = fakeApi({ 'GET /recipes': [] })
    const r = await get('add_dish').handler({ dayIndex: 0, meal: 'lunch', recipeName: 'pizza casera' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'POST', path: '/menu/m1/day/0/meal/lunch/dish', body: { kind: 'note', text: 'Pizza casera' } }])
    expect(r.uiHint).toBe('menu')
    expect(r.summary).toContain('como nota')
    expect(r.summary).toContain('crear la receta')
  })

  it('add_dish finds the closest catalogue recipe; random when unnamed', async () => {
    const f = fakeApi({ 'GET /recipes': [{ id: 'r9', name: 'Ensalada de tomate y ventresca' }] })
    const r = await get('add_dish').handler({ dayIndex: 0, meal: 'lunch', recipeName: 'ensalada de tomate' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'POST', path: '/menu/m1/day/0/meal/lunch/dish', body: { kind: 'recipe', recipeId: 'r9' } }])
    expect(r.summary).toContain('Ensalada de tomate y ventresca')
    const g = fakeApi()
    await get('add_dish').handler({ dayIndex: 0, meal: 'lunch' }, ctx(g.api))
    expect(writes(g.calls)).toEqual([{ method: 'POST', path: '/menu/m1/day/0/meal/lunch/dish/random', body: undefined }])
  })

  it('remove_dish deletes by position found by name', async () => {
    const f = fakeApi()
    await get('remove_dish').handler({ dayIndex: 0, meal: 'lunch', dishName: 'ensalada' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'DELETE', path: '/menu/m1/day/0/meal/lunch/dish/1', body: undefined }])
  })

  it('servings, lock and move map to their endpoints', async () => {
    const f = fakeApi()
    await get('set_meal_servings').handler({ dayIndex: 4, meal: 'dinner', servings: 6 }, ctx(f.api))
    await get('lock_meal').handler({ dayIndex: 6, meal: 'lunch' }, ctx(f.api))
    await get('move_meal').handler({ fromDay: 0, fromMeal: 'dinner', toDay: 1, toMeal: 'dinner' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([
      { method: 'PATCH', path: '/menu/m1/day/4/meal/dinner', body: { servings: 6 } },
      { method: 'PUT', path: '/menu/m1/day/6/meal/lunch/lock', body: { locked: true } },
      { method: 'POST', path: '/menu/m1/move-slot', body: { fromDay: 0, fromMeal: 'dinner', toDay: 1, toMeal: 'dinner' } },
    ])
  })

  it('ban_recipe_this_week resolves the recipe from the menu first', async () => {
    const f = fakeApi()
    await get('ban_recipe_this_week').handler({ recipeName: 'lentejas' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'POST', path: '/menu/m1/ban', body: { recipeId: 'r-lent' } }])
  })

  it('set_leftovers clears an occupied target first', async () => {
    const f = fakeApi()
    await get('set_leftovers').handler({ sourceDay: 0, sourceMeal: 'lunch', targetDay: 3, targetMeal: 'lunch' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([
      { method: 'DELETE', path: '/menu/m1/day/3/meal/lunch', body: undefined },
      { method: 'POST', path: '/menu/m1/day/3/leftover', body: { sourceDay: 0, sourceMeal: 'lunch', targetMeal: 'lunch' } },
    ])
  })
})

describe('shopping, pantry, staples', () => {
  const LIST = { id: 'L1', items: [{ id: 'i1', name: 'Leche entera' }, { id: 'i2', name: 'Pan de barra' }] }

  it('add_shopping_items posts each item with normalized units', async () => {
    const f = fakeApi({ 'GET /shopping-list': LIST })
    const r = await get('add_shopping_items').handler({ items: [{ name: 'leche', quantity: 2, unit: 'litros' }, { name: 'servilletas', quantity: 2, unit: 'paquetes' }] }, ctx(f.api))
    expect(writes(f.calls)).toEqual([
      { method: 'POST', path: '/shopping-list/L1/items', body: { name: 'leche', quantity: 2000, unit: 'ml' } },
      { method: 'POST', path: '/shopping-list/L1/items', body: { name: 'servilletas (2 paquetes)' } },
    ])
    expect(r.uiHint).toBe('shopping_list')
  })

  it('remove_shopping_items deletes matches and reports the rest', async () => {
    const f = fakeApi({ 'GET /shopping-list': LIST })
    const r = await get('remove_shopping_items').handler({ names: ['leche', 'caviar'] }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'DELETE', path: '/shopping-list/L1/item/i1', body: undefined }])
    expect(r.summary).toContain('No estaban en la lista: caviar')
  })

  it('update_pantry adds to an existing row in the same unit, creates new ones, removes', async () => {
    const pantry = [{ id: 'p1', name: 'Arroz', quantity: 500, unit: 'g' }]
    const f = fakeApi({ 'GET /pantry': pantry })
    await get('update_pantry').handler({ action: 'add', name: 'arroz', quantity: 1, unit: 'kg' }, ctx(f.api))
    await get('update_pantry').handler({ action: 'add', name: 'garbanzos', quantity: 400, unit: 'g', expiresAt: '2026-12-01' }, ctx(f.api))
    await get('update_pantry').handler({ action: 'remove', name: 'arroz' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([
      { method: 'PATCH', path: '/pantry/p1', body: { quantity: 1500, unit: 'g' } },
      { method: 'POST', path: '/pantry', body: { name: 'garbanzos', quantity: 400, unit: 'g', expiresAt: '2026-12-01' } },
      { method: 'DELETE', path: '/pantry/p1', body: undefined },
    ])
  })

  it('manage_staples adds, pauses and removes', async () => {
    const f = fakeApi({ 'GET /staples': [{ id: 's1', name: 'Pan', active: true }] })
    await get('manage_staples').handler({ action: 'add', name: 'Café' }, ctx(f.api))
    await get('manage_staples').handler({ action: 'pause', name: 'pan' }, ctx(f.api))
    await get('manage_staples').handler({ action: 'remove', name: 'pan' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([
      { method: 'POST', path: '/staples', body: { name: 'Café' } },
      { method: 'PATCH', path: '/staples/s1', body: { active: false } },
      { method: 'DELETE', path: '/staples/s1', body: undefined },
    ])
  })
})

describe('recipes, profile, household', () => {
  it('log_cooked uses the menu slot when day+meal are given', async () => {
    const f = fakeApi({ 'POST /cook-logs': { pantry: { updatedRowIds: ['a', 'b'] } } })
    const r = await get('log_cooked').handler({ dayIndex: 3, meal: 'lunch' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'POST', path: '/cook-logs', body: { recipeId: 'r-cal', menuId: 'm1', dayIndex: 3, meal: 'lunch' } }])
    expect(r.summary).toContain('despensa actualizada: 2')
  })

  it('update_recipe_notes prefers the recipe in this week\'s menu ("las lentejas")', async () => {
    const f = fakeApi({
      'GET /recipes': [{ id: 'r-curry', name: 'Curry de berenjena y lentejas' }],
      'GET /recipes/r-lent/notes': null,
    })
    await get('update_recipe_notes').handler({ recipeName: 'las lentejas', rating: 5 }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'PUT', path: '/recipes/r-lent/notes', body: { rating: 5 } }])
  })

  it('update_recipe_notes appends notes and clamps the rating', async () => {
    const f = fakeApi({
      'GET /recipes': [{ id: 'r-lent', name: 'Lentejas estofadas' }],
      'GET /recipes/r-lent/notes': { notes: 'Mejor con chorizo', customTags: ['rápido'] },
    })
    await get('update_recipe_notes').handler({ recipeName: 'lentejas', rating: 7, notes: 'Un toque de comino', tags: ['invierno'] }, ctx(f.api))
    expect(writes(f.calls)).toEqual([
      { method: 'PUT', path: '/recipes/r-lent/notes', body: { rating: 5, notes: 'Mejor con chorizo\nUn toque de comino', customTags: ['rápido', 'invierno'] } },
    ])
  })

  it('update_recipe_notes sets / clears "siempre la cocino para al menos N"', async () => {
    const f = fakeApi({
      'GET /recipes': [{ id: 'r-lent', name: 'Lentejas estofadas' }],
      'GET /recipes/r-lent/notes': null,
    })
    const r = await get('update_recipe_notes').handler({ recipeName: 'lentejas', minServings: 6 }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'PUT', path: '/recipes/r-lent/notes', body: { minServings: 6 } }])
    expect(r.summary).toContain('al menos 6')
    const g = fakeApi({ 'GET /recipes': [{ id: 'r-lent', name: 'Lentejas estofadas' }], 'GET /recipes/r-lent/notes': null })
    await get('update_recipe_notes').handler({ recipeName: 'lentejas', minServings: 0 }, ctx(g.api))
    expect(writes(g.calls)).toEqual([{ method: 'PUT', path: '/recipes/r-lent/notes', body: { minServings: null } }])
  })

  it('delete_recipe only touches recipes the user owns', async () => {
    const f = fakeApi({ 'GET /user/u1/recipes': { own: [{ id: 'mine1', name: 'Fabada de mi madre' }], favorites: [] } })
    expect((await get('delete_recipe').handler({ recipeName: 'paella' }, ctx(f.api))).summary).toMatch(/no he borrado nada/)
    await get('delete_recipe').handler({ recipeName: 'fabada' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'DELETE', path: '/recipes/mine1', body: undefined }])
  })

  it('manage_cookbook add_recipe creates the cookbook if it does not exist', async () => {
    const f = fakeApi({
      'GET /cookbooks': [],
      'POST /cookbooks': { id: 'cb1', name: 'Recetas de mamá' },
      'GET /recipes': [{ id: 'r-lent', name: 'Lentejas estofadas' }],
    })
    await get('manage_cookbook').handler({ action: 'add_recipe', cookbookName: 'Recetas de mamá', recipeName: 'lentejas' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([
      { method: 'POST', path: '/cookbooks', body: { name: 'Recetas de mamá' } },
      { method: 'POST', path: '/cookbooks/cb1/recipes/r-lent', body: undefined },
    ])
  })

  it('update_profile merges restriction changes with the current profile', async () => {
    const f = fakeApi({ 'GET /user/u1': { restrictions: ['sin gluten', 'sin vacuno'] } })
    await get('update_profile').handler({ removeRestrictions: ['vacuno'], addRestrictions: ['sin lactosa'], priority: 'quick' }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'PUT', path: '/user/u1', body: { priority: 'quick', restrictions: ['sin gluten', 'sin lactosa'] } }])
  })

  it('update_weekly_template writes the merged settings blob', async () => {
    const f = fakeApi({ 'GET /user/u1/settings': { template: { mealTemplate: { sabado: { cena: 2 } } } } })
    await get('update_weekly_template').handler({ days: [5], meal: 'dinner', diners: 0 }, ctx(f.api))
    expect(writes(f.calls)).toEqual([{ method: 'PUT', path: '/user/u1/settings', body: { template: { mealTemplate: { sabado: { cena: 0 } } } } }])
  })

  it('invite_to_household returns a shareable link', async () => {
    const f = fakeApi({ 'POST /households/me/invites': { token: 'abc123' } })
    const r = await get('invite_to_household').handler({}, ctx(f.api))
    expect(r.summary).toMatch(/\/invites\/abc123/)
  })
})
