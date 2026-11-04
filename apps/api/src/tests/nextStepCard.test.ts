/**
 * PRO-387 (D-158, «camino recto»): /menu shows one next step at a time
 * (apps/web/src/lib/nextStep.ts, apps/web/src/lib/weekSteps.ts). Order:
 * safety → «Primeros pasos» → billing → «Manda la lista» → «¿Qué tal la cena
 * de ayer?» → the rest; the price survey and the install prompt only when
 * there is nothing else.
 */
import { describe, expect, it } from 'vitest'
import type { BillingState, DayMenu } from '@ona/shared'
import { accountNoticeTier, pickNextStepCard, type NextStepState } from '../../../web/src/lib/nextStep'
import { lastNightDish, weekHasCooked } from '../../../web/src/lib/weekSteps'

const ALL: NextStepState = {
  noHealthData: true,
  afinaNotice: true,
  accountPaused: true,
  firstSteps: true,
  billing: true,
  sendList: true,
  lastNight: true,
  tasteCard: true,
  whatsappNudge: true,
  priceSurvey: true,
  install: true,
}

/** Everything on, minus the flags given: the first one left is what shows. */
const without = (...off: (keyof NextStepState)[]) =>
  pickNextStepCard({ ...ALL, ...Object.fromEntries(off.map((k) => [k, false])) })

describe('pickNextStepCard', () => {
  it('nothing to show → null', () => {
    expect(pickNextStepCard({})).toBeNull()
  })

  it('one card at a time, in the order of D-158', () => {
    expect(without()).toBe('no_health_data')
    expect(without('noHealthData')).toBe('afina_notice')
    expect(without('noHealthData', 'afinaNotice')).toBe('account_paused')
    expect(without('noHealthData', 'afinaNotice', 'accountPaused')).toBe('first_steps')
    expect(without('noHealthData', 'afinaNotice', 'accountPaused', 'firstSteps')).toBe('billing')
    expect(without('noHealthData', 'afinaNotice', 'accountPaused', 'firstSteps', 'billing')).toBe('send_list')
    expect(without('noHealthData', 'afinaNotice', 'accountPaused', 'firstSteps', 'billing', 'sendList')).toBe('last_night')
    expect(without('noHealthData', 'afinaNotice', 'accountPaused', 'firstSteps', 'billing', 'sendList', 'lastNight')).toBe('taste_card')
    expect(
      without('noHealthData', 'afinaNotice', 'accountPaused', 'firstSteps', 'billing', 'sendList', 'lastNight', 'tasteCard'),
    ).toBe('whatsapp_nudge')
  })

  it('safety goes before billing and the first week', () => {
    expect(pickNextStepCard({ noHealthData: true, billing: true, sendList: true })).toBe('no_health_data')
    expect(pickNextStepCard({ accountPaused: true, sendList: true, lastNight: true })).toBe('account_paused')
  })

  it('billing goes before «Manda la lista»', () => {
    expect(pickNextStepCard({ billing: true, sendList: true, whatsappNudge: true })).toBe('billing')
  })

  it('«Manda la lista» goes before «¿Qué tal la cena de ayer?» and the rest', () => {
    expect(pickNextStepCard({ sendList: true, lastNight: true, tasteCard: true })).toBe('send_list')
    expect(pickNextStepCard({ lastNight: true, tasteCard: true, whatsappNudge: true })).toBe('last_night')
  })

  it('the price survey and the install prompt only when there is no other card', () => {
    expect(pickNextStepCard({ whatsappNudge: true, priceSurvey: true, install: true })).toBe('whatsapp_nudge')
    expect(pickNextStepCard({ sendList: true, priceSurvey: true })).toBe('send_list')
    expect(pickNextStepCard({ priceSurvey: true, install: true })).toBe('price_survey')
    expect(pickNextStepCard({ install: true })).toBe('install')
  })
})

describe('accountNoticeTier', () => {
  const access = (state: string, daysLeft: number | null = null) => ({ state, daysLeft, trialDays: 14 })
  const billing = (over: Record<string, unknown>) =>
    ({ enabled: true, canManage: true, founder: null, subscription: null, ...over }) as unknown as BillingState

  it('no billing data, beta or subscribed with nothing to say → no card', () => {
    expect(accountNoticeTier(undefined)).toBeNull()
    expect(accountNoticeTier(billing({ access: access('beta') }))).toBeNull()
    expect(accountNoticeTier(billing({ access: access('subscribed') }))).toBeNull()
    expect(accountNoticeTier(billing({ access: access('trial', 9) }))).toBeNull()
  })

  it('a paused account is safety', () => {
    expect(accountNoticeTier(billing({ access: access('paused'), founder: { offer: true } }))).toBe('paused')
  })

  it('last days of the trial, the founder offer, the first charge and unknown states are billing', () => {
    expect(accountNoticeTier(billing({ access: access('trial', 2) }))).toBe('billing')
    expect(accountNoticeTier(billing({ access: access('trial', 9), founder: { offer: true } }))).toBe('billing')
    expect(
      accountNoticeTier(billing({ access: access('subscribed'), subscription: { upcomingCharge: { at: '2026-12-01', amount: '4,99 €' } } })),
    ).toBe('billing')
    expect(accountNoticeTier(billing({ access: access('payment_pending') }))).toBe('billing')
  })
})

describe('lastNightDish / weekHasCooked', () => {
  const recipe = (recipeId: string, recipeName: string, variant?: string) => ({ kind: 'recipe' as const, recipeId, recipeName, ...(variant ? { variant } : {}) })
  const week = (): DayMenu[] => Array.from({ length: 7 }, () => ({}))

  it('yesterday’s dinner, or its lunch without one', () => {
    const days = week()
    days[1] = { lunch: { dishes: [recipe('r1', 'Lentejas')] }, dinner: { dishes: [recipe('r2', 'Tortilla')] } }
    days[2] = { lunch: { dishes: [recipe('r3', 'Paella')] } }
    expect(lastNightDish(days, 2)).toEqual({ day: 1, meal: 'dinner', recipeId: 'r2', recipeName: 'Tortilla' })
    expect(lastNightDish(days, 3)).toEqual({ day: 2, meal: 'lunch', recipeId: 'r3', recipeName: 'Paella' })
  })

  it('none on Monday, outside the week, on a skipped day, a táper or an eaten meal', () => {
    const days = week()
    days[0] = { dinner: { dishes: [recipe('r1', 'Crema')] } }
    days[1] = { dinner: { dishes: [recipe('r2', 'Táper', 'fridge')] } }
    days[2] = { dinner: { dishes: [recipe('r3', 'Pisto')], eaten: true } }
    expect(lastNightDish(days, 0)).toBeNull()
    expect(lastNightDish(days, -1)).toBeNull()
    expect(lastNightDish(days, 1, [0])).toBeNull()
    expect(lastNightDish(days, 2)).toBeNull()
    expect(lastNightDish(days, 3)).toBeNull()
    expect(lastNightDish(days, 1)).toMatchObject({ recipeId: 'r1' })
  })

  it('something cooked this week: an eaten meal or a cook log since Monday', () => {
    const days = week()
    expect(weekHasCooked(days, '2026-11-02', null)).toBe(false)
    expect(weekHasCooked(days, '2026-11-02', '2026-10-30T20:00:00Z')).toBe(false)
    expect(weekHasCooked(days, '2026-11-02', '2026-11-03T20:00:00Z')).toBe(true)
    days[4] = { lunch: { dishes: [recipe('r1', 'Lentejas')], eaten: true } }
    expect(weekHasCooked(days, '2026-11-02', null)).toBe(true)
  })
})
