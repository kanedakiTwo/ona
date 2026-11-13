/**
 * PRO-1024 (trucos §6.2): the usage events the newsletter's tricks need, one
 * test per event — the route (or Mimo's tool) leaves it with its props, from
 * closed lists only — and `memory_set` never names a health key.
 */
import { describe, expect, it } from 'vitest'
import { screenOfPath } from '../../../web/src/lib/usagePaths'
import { CHANNEL_HEADER } from '../services/menuEdits.js'
import {
  CLIENT_USAGE_EVENTS,
  INTERNAL_CALL_HEADER,
  MEMORY_SET_KEYS,
  USAGE_EVENTS,
  USAGE_SCREENS,
  clientEventProps,
  memorySetEvents,
  recipeNoteEvents,
  routeUsageEvent,
  routeUsageEvents,
  sanitizeProps,
  shoppingRangeKind,
  skillUsageEvents,
  weekTypeSlotChanges,
  weekPlanProps,
} from '../services/usageEvents.js'
import { buildScreensWeekly } from '../services/usageReport.js'

const req = (method: string, path: string, body: any = {}, headers: Record<string, string> = {}, query: Record<string, unknown> = {}) => ({
  method,
  path,
  body,
  query: query as any,
  get: (h: string) => headers[h.toLowerCase()],
})
const mimo = { [INTERNAL_CALL_HEADER]: '1', [CHANNEL_HEADER]: 'whatsapp' }
/** Thursday: this week is 2–8 Nov, the next one 9–15 Nov. */
const TODAY = '2026-11-05'
const actionEvents = (...args: Parameters<typeof skillUsageEvents>) => skillUsageEvents(...args).filter((e) => e.name !== 'mimo_skill_used')

describe('PRO-1024 server events', () => {
  it('menu_generated counts the meals out, the guests and the fridge, never what', () => {
    const plan = { mealsOut: [{ day: 3, meal: 'dinner' }], guests: [{ day: 1, diners: 6 }, { day: 2, diners: 4 }], fridgeText: 'medio calabacín, nata y dos huevos' }
    expect(routeUsageEvent(req('POST', '/menu/generate', { userId: 'u', weekStart: '2026-11-02', weekPlan: plan }))).toEqual({
      name: 'menu_generated',
      channel: 'web',
      props: { mealsOut: 1, guests: 2, fridge: 3 },
    })
    expect(weekPlanProps({ fridge: ['nata', 'pollo'] })).toEqual({ mealsOut: 0, guests: 0, fridge: 2 })
    // Mimo: its params, and `answer` when the reply came written in one go.
    expect(actionEvents('generate_weekly_menu', { data: {} }, 'whatsapp', { answer: 'el jueves cenamos fuera', fridge_text: 'nata' })).toEqual([
      { name: 'menu_generated', props: { mealsOut: 0, guests: 0, fridge: 1, answer: true } },
    ])
  })

  it('meal_adjusted: servings, the dish type and the lock', () => {
    expect(routeUsageEvent(req('PATCH', '/menu/m1/day/2/meal/dinner', { servings: 4 }))).toEqual({ name: 'meal_adjusted', channel: 'web', props: { what: 'servings' } })
    expect(routeUsageEvent(req('PATCH', '/menu/m1/day/2/meal/dinner', { eaten: true }))).toBeNull()
    expect(routeUsageEvent(req('PATCH', '/menu/m1/day/2/meal/dinner/dish/0', { newPosition: 1 }))).toBeNull()
    expect(routeUsageEvent(req('PUT', '/menu/m1/day/2/meal/dinner/lock', { locked: true }))?.props).toEqual({ what: 'lock', on: true })
    expect(routeUsageEvent(req('PUT', '/menu/m1/day/2/meal/dinner/lock', { locked: false }))?.props).toEqual({ what: 'lock', on: false })
  })

  it('taper_set from the menu', () => {
    expect(routeUsageEvent(req('POST', '/menu/m1/day/3/meal/lunch/taper', { count: 2 }))).toEqual({ name: 'taper_set', channel: 'web', props: { via: 'menu' } })
    expect(routeUsageEvent(req('DELETE', '/menu/m1/day/3/meal/lunch/taper'))).toBeNull()
  })

  it('leftover_dish_set: del congelador, de la nevera or ya hecho, adding or changing a dish', () => {
    expect(routeUsageEvent(req('POST', '/menu/m1/day/1/meal/lunch/dish', { kind: 'recipe', recipeId: 'r', variant: 'freezer' }))).toEqual({
      name: 'leftover_dish_set',
      channel: 'web',
      props: { variant: 'freezer' },
    })
    expect(routeUsageEvent(req('POST', '/menu/m1/day/1/meal/lunch/dish', { kind: 'recipe', recipeId: 'r', variant: 'fridge' }))?.props).toEqual({ variant: 'fridge' })
    expect(routeUsageEvent(req('PATCH', '/menu/m1/day/1/meal/lunch/dish/0', { variant: 'cooked' }))?.props).toEqual({ variant: 'cooked' })
    expect(routeUsageEvent(req('PATCH', '/menu/m1/day/1/meal/lunch/dish/0', { variant: 'planned' }))).toBeNull()
  })

  it('dish_added says when it came from «Añadir al menú» on the recipe', () => {
    expect(routeUsageEvent(req('POST', '/menu/m1/day/1/meal/lunch', { recipeId: 'r', from: 'receta' }))).toEqual({ name: 'dish_added', channel: 'web', props: { from: 'receta' } })
    expect(routeUsageEvent(req('POST', '/menu/m1/day/1/meal/lunch/dish', { kind: 'recipe', recipeId: 'r' }))?.props).toEqual({ from: 'menu' })
    expect(routeUsageEvent(req('POST', '/menu/m1/day/1/meal/lunch/dish', { kind: 'note', text: 'Cenamos fuera' }))).toBeNull()
    // Replacing a full meal from the recipe is a swap, also marked.
    expect(routeUsageEvent(req('PUT', '/menu/m1/day/1/meal/lunch', { recipeId: 'r', from: 'receta' }))?.props).toEqual({ target: 'meal', how: 'picked', from: 'receta' })
  })

  it('template_changed: one per part of a «semana tipo» slot that changed (D-182)', () => {
    const before = { diners: 2, options: [{ kind: 'taper' as const }] }
    expect(weekTypeSlotChanges(before, { ...before })).toEqual([])
    expect(weekTypeSlotChanges(before, { diners: 3, options: [{ kind: 'taper' }] })).toEqual(['diners'])
    expect(weekTypeSlotChanges(before, { off: true })).toEqual(['meals', 'diners', 'taper_days'])
    expect(weekTypeSlotChanges({}, { dishes: 2 })).toEqual(['dish_counts'])
    expect(weekTypeSlotChanges({}, { options: [{ kind: 'fixed', label: 'Yogur', items: [] }] })).toEqual(['fixed_meals'])
    expect(weekTypeSlotChanges({}, { options: [{ kind: 'type', type: 'pizza' }, { kind: 'any' }] })).toEqual(['week_type'])
    expect(weekTypeSlotChanges(undefined, {})).toEqual([])
  })

  it('memory_set names the key from PATCH /memory and from Mimo, never the value', () => {
    expect(routeUsageEvents(req('PATCH', '/memory', { key: 'equipment', value: ['olla exprés'] }))).toEqual([
      { name: 'memory_set', channel: 'web', props: { key: 'equipment' } },
    ])
    expect(routeUsageEvents(req('PATCH', '/memory', { facts: [{ key: 'time_available', value: {} }, { key: 'region', value: 'MD' }] })).map((e) => e.props)).toEqual([
      { key: 'time_available' },
      { key: 'region' },
    ])
    expect(actionEvents('update_memory', { data: { updated: 1 } }, 'whatsapp', { facts: [{ key: 'prep_habits', value: ['remojo'] }] })).toEqual([
      { name: 'memory_set', props: { key: 'prep_habits' } },
    ])
  })

  it('memory_set is never emitted for restrictions (nor any other health key)', () => {
    expect(routeUsageEvents(req('PATCH', '/memory', { key: 'restrictions', value: ['celiaquia'] }))).toEqual([])
    expect(routeUsageEvents(req('PATCH', '/memory', { facts: [{ key: 'restrictions', value: ['sin lactosa'] }, { key: 'physical.weight_kg', value: 70 }] }))).toEqual([])
    expect(actionEvents('update_memory', { data: { updated: 2 } }, 'web', { facts: [{ key: 'restrictions', value: ['celiaquia'] }, { key: 'meal_times', value: {} }] })).toEqual([
      { name: 'memory_set', props: { key: 'meal_times' } },
    ])
    expect(memorySetEvents(['restrictions', 'physical.age', 'physical.sex', 'nutrition_principles', 'household.adults'])).toEqual([])
    expect(MEMORY_SET_KEYS).not.toContain('restrictions')
  })

  it('recipe_rated when the stars change, with where they came from', () => {
    const rated = (before: any, after: any, body: any, internal = false) => recipeNoteEvents(before, after, body, { internal }).filter((e) => e.name === 'recipe_rated')
    expect(rated(null, { rating: 4 }, { rating: 4, from: 'que_tal' })).toEqual([{ name: 'recipe_rated', props: { rating: 4, via: 'que_tal' } }])
    expect(rated({ rating: 3 }, { rating: 5 }, { rating: 5 })).toEqual([{ name: 'recipe_rated', props: { rating: 5, via: 'estrellas' } }])
    expect(rated({ rating: 2 }, { rating: 4 }, { rating: 4 }, true)).toEqual([{ name: 'recipe_rated', props: { rating: 4, via: 'mimo' } }])
    // Same stars again, or cleared: no event.
    expect(rated({ rating: 4 }, { rating: 4 }, { rating: 4 })).toEqual([])
    expect(rated({ rating: 4 }, { rating: null }, { rating: null })).toEqual([])
  })

  it('recipe_note_saved: one per part that changed, never the text', () => {
    const before = { notes: 'con comino', substitutions: null, customTags: ['rápido'], minServings: null, ingredientOverrides: [] }
    const after = { ...before, notes: 'con comino y pimentón', customTags: ['rápido', 'para sara'], minServings: 6 }
    const evs = recipeNoteEvents(before, after, { notes: after.notes, customTags: after.customTags, minServings: 6, substitutions: null }, { internal: false })
    expect(evs).toEqual([
      { name: 'recipe_note_saved', props: { what: 'notes' } },
      { name: 'recipe_note_saved', props: { what: 'tags' } },
      { name: 'recipe_note_saved', props: { what: 'min_servings' } },
    ])
    expect(recipeNoteEvents(null, { ingredientOverrides: [{ x: 1 }] }, { ingredientOverrides: [{ x: 1 }] }, { internal: false })).toEqual([
      { name: 'recipe_note_saved', props: { what: 'overrides' } },
    ])
    for (const e of evs) expect(sanitizeProps(e.props)).toEqual(e.props)
  })

  it('favorite_toggled from Mimo says on or off (the web route records it inline)', () => {
    expect(actionEvents('toggle_favorite', { data: { recipeId: 'r', favorited: true } }, 'web')).toEqual([{ name: 'favorite_toggled', props: { on: true } }])
    expect(actionEvents('toggle_favorite', { data: { recipeId: 'r', favorited: false } }, 'whatsapp')).toEqual([{ name: 'favorite_toggled', props: { on: false } }])
    expect(skillUsageEvents('toggle_favorite', { data: null }, 'web')).toEqual([])
  })

  it('recipe_photo_main: a cooked photo made the main one, or an uploaded image', () => {
    expect(routeUsageEvent(req('POST', '/recipes/r1/photos/p1/use-as-recipe-image'))).toEqual({ name: 'recipe_photo_main', channel: 'web', props: { via: 'foto' } })
    expect(routeUsageEvent(req('POST', '/recipes/r1/upload-image'))?.props).toEqual({ via: 'subida' })
    expect(routeUsageEvent(req('POST', '/recipes/r1/photos'))).toBeNull()
  })

  it('with_what_i_have_used counts the chosen ingredients', () => {
    const a = '0b1c2d3e-0000-4000-8000-000000000001'
    const b = '0b1c2d3e-0000-4000-8000-000000000002'
    expect(routeUsageEvent(req('GET', '/recipes/with-what-i-have', {}, {}, { ingredient: [a, b] }))).toEqual({
      name: 'with_what_i_have_used',
      channel: 'web',
      props: { n: 2 },
    })
    expect(routeUsageEvent(req('GET', '/recipes/with-what-i-have', {}, {}, { ingredient: a }))?.props).toEqual({ n: 1 })
  })

  it('shopping_line_edited: skip, amount, unit and habitual', () => {
    const edit = (body: any) => routeUsageEvents(req('PUT', '/shopping-list/l1/item/i1/edit', body)).filter((e) => e.name === 'shopping_line_edited').map((e) => e.props?.action)
    expect(edit({ skipped: true })).toEqual(['skip'])
    expect(edit({ skipped: false })).toEqual(['unskip'])
    expect(edit({ quantity: 2, unit: 'u' })).toEqual(['amount', 'unit'])
    expect(edit({ habitual: true })).toEqual(['habitual_on'])
    expect(edit({ habitual: false })).toEqual(['habitual_off'])
  })

  it('shopping_have_set on «nos queda…»', () => {
    expect(routeUsageEvent(req('PUT', '/shopping-list/l1/item/i1/have', { quantity: 1 }))).toEqual({ name: 'shopping_have_set', channel: 'web' })
  })

  it('staple_toggled from Perfil, from the list and from Mimo', () => {
    expect(routeUsageEvent(req('POST', '/staples', { name: 'Pan' }))).toEqual({ name: 'staple_toggled', channel: 'web', props: { on: true, via: 'perfil' } })
    expect(routeUsageEvent(req('PATCH', '/staples/s1', { active: false }))?.props).toEqual({ on: false, via: 'perfil' })
    expect(routeUsageEvent(req('PATCH', '/staples/s1', { quantity: 2 }))).toBeNull()
    expect(routeUsageEvents(req('PUT', '/shopping-list/l1/item/i1/edit', { habitual: true })).find((e) => e.name === 'staple_toggled')?.props).toEqual({ on: true, via: 'lista' })
    // manage_staples calls the same routes: counted there, with the conversation's channel.
    expect(routeUsageEvent(req('PATCH', '/staples/s1', { active: true }, mimo))).toEqual({ name: 'staple_toggled', channel: 'whatsapp', props: { on: true, via: 'mimo' } })
    expect(routeUsageEvent(req('POST', '/staples', { name: 'Leche' }, { [INTERNAL_CALL_HEADER]: '1' }))).toEqual({ name: 'staple_toggled', channel: 'web', props: { on: true, via: 'mimo' } })
  })

  it('shopping_list_viewed says which range, in Madrid days', () => {
    const view = (query: Record<string, unknown>) => routeUsageEvent(req('GET', '/shopping-list', {}, {}, query), TODAY)?.props
    expect(view({})).toEqual({ range: 'dos_semanas' })
    expect(view({ from: TODAY, to: TODAY })).toEqual({ range: 'hoy' })
    expect(view({ from: '2026-11-06', to: '2026-11-06' })).toEqual({ range: 'manana' })
    expect(view({ from: TODAY, to: '2026-11-08' })).toEqual({ range: 'esta_semana' })
    expect(view({ from: '2026-11-09', to: '2026-11-15' })).toEqual({ range: 'la_que_viene' })
    expect(view({ from: TODAY, to: '2026-11-15' })).toEqual({ range: 'dos_semanas' })
    expect(view({ from: '2026-11-03', to: '2026-11-04' })).toEqual({ range: 'otro' })
    // On a Sunday «Hoy» and «Esta semana» are the same day.
    expect(shoppingRangeKind('2026-11-08', '2026-11-08', '2026-11-08')).toBe('hoy')
  })

  it('the routes Mimo calls without a `mimo` mark stay skipped (its tools count them)', () => {
    expect(routeUsageEvent(req('PATCH', '/menu/m1/day/2/meal/dinner', { servings: 4 }, mimo))).toBeNull()
    expect(routeUsageEvent(req('POST', '/menu/m1/day/3/meal/lunch/taper', {}, mimo))).toBeNull()
    expect(routeUsageEvent(req('PUT', '/shopping-list/l1/item/i1/edit', { skipped: true }, mimo))).toBeNull()
  })
})

describe('PRO-1024 client events', () => {
  it('content_shared: receta, lista or semana', () => {
    for (const what of ['receta', 'lista', 'semana']) expect(clientEventProps('content_shared', { what })).toEqual({ name: 'content_shared', props: { what } })
    expect(clientEventProps('content_shared', { what: 'https://mimoia.app/r/1' })).toBeNull()
  })

  it('week_printed says whether the list went with it', () => {
    expect(clientEventProps('week_printed', { withList: true })).toEqual({ name: 'week_printed', props: { withList: true } })
    expect(clientEventProps('week_printed', { withList: 'sí' })).toEqual({ name: 'week_printed', props: { withList: false } })
  })

  it('handsfree_started: in cook mode or from the panel', () => {
    expect(clientEventProps('handsfree_started', { where: 'cocina' })).toEqual({ name: 'handsfree_started', props: { where: 'cocina' } })
    expect(clientEventProps('handsfree_started', { where: 'panel' })?.props).toEqual({ where: 'panel' })
    expect(clientEventProps('handsfree_started', { where: 'salon' })).toBeNull()
  })

  it('the new screens: the web names them and the API accepts them', () => {
    const paths: Record<string, string> = {
      '/profile/ficha': 'ficha',
      '/afinar': 'afinar',
      '/menu/history': 'historial',
      '/menu/imprimir': 'imprimir',
      '/profile/cookbooks': 'recetarios',
      '/cookbooks/0b1c': 'recetarios',
      '/compra/tiendas': 'tiendas',
    }
    for (const [path, screen] of Object.entries(paths)) {
      expect(screenOfPath(path)).toBe(screen)
      expect(clientEventProps('screen_viewed', { screen })).toEqual({ name: 'screen_viewed', props: { screen } })
    }
    expect(screenOfPath('/profile/ficha/historial')).toBeNull()
  })

  it('the new screens come out in /admin/usage (data/uso)', () => {
    const weeks = buildScreensWeekly(['2026-11-02'], [
      { day: '2026-11-02', screen: 'ficha', count: 3 },
      { day: '2026-11-02', screen: 'tiendas', count: 1 },
    ])
    expect(weeks[0].screens).toMatchObject({ ficha: 3, afinar: 0, historial: 0, imprimir: 0, recetarios: 0, tiendas: 1 })
    expect(weeks[0].top[0]).toEqual({ screen: 'ficha', views: 3 })
  })

  it('every new event is a known usage event, and the client ones go through POST /usage/event', () => {
    for (const n of ['content_shared', 'week_printed', 'handsfree_started']) {
      expect(CLIENT_USAGE_EVENTS).toContain(n)
      expect(USAGE_EVENTS).toContain(n)
    }
    for (const s of ['ficha', 'afinar', 'historial', 'imprimir', 'recetarios', 'tiendas']) expect(USAGE_SCREENS).toContain(s)
  })
})
