/**
 * Product analytics (specs/metrics.md "Usage events"): which request or skill
 * becomes which event, that props never carry free text, and that the
 * assistant's own loopback calls are not counted twice.
 */
import { describe, expect, it } from 'vitest'
import {
  INTERNAL_CALL_HEADER,
  USAGE_EVENTS,
  channelOfMode,
  routeUsageEvent,
  sanitizeProps,
  skillUsageEvents,
  trackEvent,
  urlImportProps,
} from '../services/usageEvents.js'

const req = (method: string, path: string, body: any = {}, headers: Record<string, string> = {}) => ({
  method,
  path,
  body,
  get: (h: string) => headers[h.toLowerCase()],
})

describe('sanitizeProps', () => {
  it('keeps slugs, finite numbers and booleans only', () => {
    expect(sanitizeProps({ source: 'url', orders: 2, withSource: true })).toEqual({ source: 'url', orders: 2, withSource: true })
  })

  it('drops free text, URLs, emails, phones, nested objects and odd keys', () => {
    expect(
      sanitizeProps({
        note: 'le sube el azúcar a Antonio',
        url: 'https://example.com/receta',
        email: 'ana@example.com',
        phone: '+34 600 111 222',
        nested: { a: 1 },
        'Bad Key': 'x',
        n: Number.NaN,
      }),
    ).toBeNull()
  })

  it('caps the number of keys', () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))
    expect(Object.keys(sanitizeProps(many) ?? {})).toHaveLength(8)
  })
})

describe('routeUsageEvent (web requests)', () => {
  it('maps the tracked routes to their events, channel web', () => {
    expect(routeUsageEvent(req('POST', '/menu/generate'))).toEqual({ name: 'menu_generated', channel: 'web' })
    expect(routeUsageEvent(req('POST', '/user/u1/onboarding'))?.name).toBe('onboarding_completed')
    expect(routeUsageEvent(req('GET', '/shopping-list'))?.name).toBe('shopping_list_viewed')
    expect(routeUsageEvent(req('GET', '/shopping-list/m1'))?.name).toBe('shopping_list_viewed')
    expect(routeUsageEvent(req('POST', '/cook-logs'))?.name).toBe('meal_cooked')
    expect(routeUsageEvent(req('POST', '/shop-orders/prepare'))?.name).toBe('shop_order_prepared')
    expect(routeUsageEvent(req('POST', '/recipes', { sourceUrl: 'https://x' }))).toEqual({ name: 'recipe_created', channel: 'web', props: { withSource: true } })
  })

  it('a meal swap says whether the user picked the recipe', () => {
    expect(routeUsageEvent(req('PUT', '/menu/m1/day/2/meal/dinner', { recipeId: 'r1' }))?.props).toEqual({ target: 'meal', how: 'picked' })
    expect(routeUsageEvent(req('PUT', '/menu/m1/day/2/meal/dinner'))?.props).toEqual({ target: 'meal', how: 'auto' })
    expect(routeUsageEvent(req('POST', '/menu/m1/day/2/meal/dinner/dish/0/regenerate'))?.props).toEqual({ target: 'dish', how: 'auto' })
  })

  it('recipe imports carry the source, never the URL', () => {
    expect(routeUsageEvent(req('POST', '/recipes/extract-from-image'))?.props).toEqual({ source: 'photo' })
    expect(routeUsageEvent(req('POST', '/recipes/extract-from-url', { url: 'https://www.instagram.com/p/abc' }))?.props).toEqual({ source: 'social', kind: 'instagram' })
    expect(routeUsageEvent(req('POST', '/recipes/extract-from-url', { url: 'https://youtu.be/xyz' }))?.props).toEqual({ source: 'url', kind: 'youtube' })
  })

  it('the web chat counts a Mimo message, voice when spoken', () => {
    expect(routeUsageEvent(req('POST', '/assistant/u1/chat', { mode: 'text' }))).toEqual({ name: 'mimo_message', channel: 'web' })
    expect(routeUsageEvent(req('POST', '/assistant/u1/chat', { mode: 'voice' }))?.channel).toBe('voice')
  })

  it('first steps: completed vs skipped from the body; an old client without it is not counted', () => {
    expect(routeUsageEvent(req('POST', '/user/u1/first-steps', { outcome: 'completed' }))?.name).toBe('first_steps_completed')
    expect(routeUsageEvent(req('POST', '/user/u1/first-steps', { outcome: 'skipped' }))?.name).toBe('first_steps_skipped')
    expect(routeUsageEvent(req('POST', '/user/u1/first-steps', {}))).toBeNull()
  })

  it('ignores reads and routes that are not tracked', () => {
    expect(routeUsageEvent(req('GET', '/menu/u1/2026-10-12'))).toBeNull()
    expect(routeUsageEvent(req('GET', '/shopping-list/l1/totals'))).toBeNull()
    expect(routeUsageEvent(req('POST', '/recipes/r1/copy'))).toBeNull()
  })

  it("skips the assistant's own loopback calls (counted by the skill runner instead)", () => {
    expect(routeUsageEvent(req('GET', '/shopping-list', {}, { [INTERNAL_CALL_HEADER]: '1' }))).toBeNull()
    expect(routeUsageEvent(req('POST', '/cook-logs', {}, { [INTERNAL_CALL_HEADER]: '1' }))).toBeNull()
  })
})

describe('skillUsageEvents (Mimo)', () => {
  it('maps the skills that do something to events', () => {
    expect(skillUsageEvents('generate_weekly_menu', { data: {} }, 'whatsapp')).toEqual([{ name: 'menu_generated' }])
    expect(skillUsageEvents('complete_onboarding', { data: {} }, 'whatsapp').map((e) => e.name)).toEqual(['onboarding_completed', 'menu_generated'])
    expect(skillUsageEvents('start_cooking_mode', { data: { recipeId: 'r' } }, 'voice')).toEqual([{ name: 'cook_mode_started' }])
    expect(skillUsageEvents('log_cooked', { data: {} }, 'web')).toEqual([{ name: 'meal_cooked' }])
    expect(skillUsageEvents('swap_meal', { data: {} }, 'web', { recipeName: 'lentejas' })).toEqual([{ name: 'meal_swapped', props: { target: 'meal', how: 'picked' } }])
  })

  it('a recipe link sent over WhatsApp is whatsapp_url; a reel is social', () => {
    expect(skillUsageEvents('import_recipe_from_url', { data: {} }, 'whatsapp', { url: 'https://cocina.example/receta' })[0].props).toEqual({ source: 'whatsapp_url', kind: 'article' })
    expect(skillUsageEvents('import_recipe_from_url', { data: {} }, 'whatsapp', { url: 'https://vm.tiktok.com/abc' })[0].props).toEqual({ source: 'social', kind: 'tiktok' })
  })

  it('"not found" results (data: null) and shop orders with nothing prepared do not count', () => {
    expect(skillUsageEvents('swap_meal', { data: null }, 'web')).toEqual([])
    expect(skillUsageEvents('prepare_shop_orders', { data: { navigateTo: '/compra/tiendas' } }, 'whatsapp')).toEqual([])
    expect(skillUsageEvents('prepare_shop_orders', { data: { orderIds: ['a', 'b'] } }, 'whatsapp')).toEqual([{ name: 'shop_order_prepared', props: { orders: 2 } }])
    expect(skillUsageEvents('get_todays_menu', { data: {} }, 'web')).toEqual([])
  })
})

describe('helpers', () => {
  it('channelOfMode', () => {
    expect(channelOfMode('whatsapp')).toBe('whatsapp')
    expect(channelOfMode('voice')).toBe('voice')
    expect(channelOfMode('text')).toBe('web')
    expect(channelOfMode('onboarding')).toBe('web')
    expect(channelOfMode(undefined)).toBe('web')
  })

  it('urlImportProps survives garbage', () => {
    expect(urlImportProps('not a url', 'web')).toEqual({ source: 'url', kind: 'unknown' })
  })

  it('trackEvent never throws, even with an unknown event name or junk', () => {
    expect(() => trackEvent('nope' as any, { userId: 'x', props: { a: 'b' } })).not.toThrow()
    expect(() => trackEvent(USAGE_EVENTS[0], { props: null })).not.toThrow()
  })
})
