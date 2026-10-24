/**
 * PRO-120: the seven new usage events (no text, closed lists only), the
 * server-side daily cap key and the /admin/usage blocks built from them.
 */
import { describe, expect, it } from 'vitest'
import { alertChanges, clientEventProps, dailyCapKey, routeUsageEvent, skillUsageEvents, USAGE_EVENTS } from '../services/usageEvents.js'
import { buildOnboardingSteps, buildPropBreakdown, buildScreensWeekly } from '../services/usageReport.js'

describe('clientEventProps', () => {
  it('accepts only the client events, with props from closed lists', () => {
    expect(clientEventProps('screen_viewed', { screen: 'menu' })).toEqual({ name: 'screen_viewed', props: { screen: 'menu' } })
    expect(clientEventProps('screen_viewed', { screen: 'cualquier cosa' })).toBeNull()
    expect(clientEventProps('menu_generated', {})).toBeNull()
    expect(clientEventProps('whatsapp_unlinked', {})).toBeNull()
    expect(clientEventProps(undefined, undefined)).toBeNull()
  })

  it('drops any extra prop, so no free text is ever stored', () => {
    const ev = clientEventProps('onboarding_step', { step: 'hogar', action: 'visto', note: 'mi hija es celíaca', email: 'a@b.c' })
    expect(ev).toEqual({ name: 'onboarding_step', props: { step: 'hogar', action: 'visto' } })
    expect(clientEventProps('onboarding_step', { step: 'hogar' })).toBeNull()
    expect(clientEventProps('onboarding_step', { step: 'canal', action: 'hecho', via: 'whatsapp' })?.props).toEqual({
      step: 'canal',
      action: 'hecho',
      via: 'whatsapp',
    })
    // `via` only on the channel step.
    expect(clientEventProps('onboarding_step', { step: 'hogar', action: 'hecho', via: 'whatsapp' })?.props).toEqual({ step: 'hogar', action: 'hecho' })
  })

  it('falls back to «otro» for an unknown origin or notification kind', () => {
    expect(clientEventProps('recipe_viewed', { from: 'mimo' })?.props).toEqual({ from: 'mimo' })
    expect(clientEventProps('recipe_viewed', { from: 'https://x.com' })?.props).toEqual({ from: 'otro' })
    expect(clientEventProps('push_opened', { kind: 'daily_brief' })?.props).toEqual({ kind: 'daily_brief' })
    expect(clientEventProps('push_opened', { kind: 'menu:123' })?.props).toEqual({ kind: 'otro' })
  })

  it('taste_tuning keeps the action, a bounded card count and where', () => {
    expect(clientEventProps('taste_tuning', { action: 'terminado', cards: 10.4, where: 'alta' })?.props).toEqual({ action: 'terminado', cards: 10, where: 'alta' })
    expect(clientEventProps('taste_tuning', { action: 'abandonado', cards: 'x' })?.props).toEqual({ action: 'abandonado', cards: 0, where: 'pagina' })
    expect(clientEventProps('taste_tuning', { action: 'gustado' })).toBeNull()
  })

  it('every client event is a known usage event', () => {
    for (const n of ['onboarding_step', 'screen_viewed', 'recipe_viewed', 'taste_tuning', 'push_opened', 'alerts_changed', 'whatsapp_unlinked', 'feedback_left']) {
      expect(USAGE_EVENTS).toContain(n)
    }
  })
})

describe('dailyCapKey (once per person, screen / step and Madrid day, on the server)', () => {
  it('caps screens and sign-up steps, not recipes or taps', () => {
    expect(dailyCapKey({ name: 'screen_viewed', props: { screen: 'lista' } })).toEqual({ screen: 'lista' })
    expect(dailyCapKey({ name: 'onboarding_step', props: { step: 'dieta', action: 'hecho' } })).toEqual({ step: 'dieta', action: 'hecho' })
    expect(dailyCapKey({ name: 'recipe_viewed', props: { from: 'menu' } })).toBeNull()
    expect(dailyCapKey({ name: 'push_opened', props: { kind: 'otro' } })).toBeNull()
  })
})

describe('server-side events', () => {
  it('feedback_left: the button through the route, Mimo through the skill, never the text', () => {
    expect(routeUsageEvent({ method: 'POST', path: '/feedback', body: { text: 'no me gusta' } })).toEqual({
      name: 'feedback_left',
      props: { channel: 'boton' },
      channel: 'web',
    })
    // Mimo's own call to /feedback carries the internal header: counted by the skill instead.
    expect(routeUsageEvent({ method: 'POST', path: '/feedback', body: {}, get: () => '1' })).toBeNull()
    expect(skillUsageEvents('leave_feedback', { data: { ok: true } }, 'whatsapp')[0]).toEqual({ name: 'feedback_left', props: { channel: 'whatsapp' } })
    expect(skillUsageEvents('leave_feedback', { data: { ok: true } }, 'web')[0]).toEqual({ name: 'feedback_left', props: { channel: 'mimo' } })
  })

  it('whatsapp_unlinked on DELETE /whatsapp/link', () => {
    expect(routeUsageEvent({ method: 'DELETE', path: '/whatsapp/link', body: {} })?.name).toBe('whatsapp_unlinked')
  })

  it('alertChanges: only the switches that changed, both ways', () => {
    expect(alertChanges({ all: true, daily_brief: false, weekly_nudge: true }, { all: true, daily_brief: true, weekly_nudge: false })).toEqual([
      { kind: 'daily_brief', on: true },
      { kind: 'weekly_nudge', on: false },
    ])
    expect(alertChanges({ all: true }, { all: true })).toEqual([])
  })
})

describe('/admin/usage blocks (counts only)', () => {
  it('onboardingSteps lists every step in order, with seen and done people', () => {
    const steps = buildOnboardingSteps([
      { step: 'hogar', action: 'visto', people: 5 },
      { step: 'hogar', action: 'hecho', people: 4 },
      { step: 'dieta', action: 'visto', people: 3 },
    ])
    expect(steps.map((s) => s.step)).toEqual(['afina', 'canal', 'hogar', 'frecuencia', 'cocina', 'tiempo', 'dieta', 'prioridad'])
    expect(steps.find((s) => s.step === 'hogar')).toEqual({ step: 'hogar', seen: 5, done: 4 })
    expect(steps.find((s) => s.step === 'dieta')).toEqual({ step: 'dieta', seen: 3, done: 0 })
  })

  it('screens: people-days per ISO week, most viewed first', () => {
    const weeks = buildScreensWeekly(
      ['2026-10-19', '2026-10-20', '2026-10-26'],
      [
        { day: '2026-10-19', screen: 'menu', count: 3 },
        { day: '2026-10-20', screen: 'menu', count: 2 },
        { day: '2026-10-20', screen: 'lista', count: 4 },
        { day: '2026-10-26', screen: 'receta', count: 1 },
      ],
    )
    expect(weeks).toHaveLength(2)
    expect(weeks[0].top).toEqual([
      { screen: 'menu', views: 5 },
      { screen: 'lista', views: 4 },
    ])
    expect(weeks[0].screens.perfil).toBe(0)
    expect(weeks[1].top).toEqual([{ screen: 'receta', views: 1 }])
  })

  it('breakdown groups by event, prop and value', () => {
    expect(
      buildPropBreakdown([
        { name: 'recipe_viewed', key: 'from', value: 'menu', count: 3 },
        { name: 'recipe_viewed', key: 'from', value: 'mimo', count: 1 },
        { name: 'alerts_changed', key: 'on', value: 'false', count: 2 },
      ]),
    ).toEqual({ recipe_viewed: { from: { menu: 3, mimo: 1 } }, alerts_changed: { on: { false: 2 } } })
  })
})
