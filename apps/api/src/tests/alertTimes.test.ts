/**
 * PRO-1301: each household chooses the time of the morning menu and of the
 * dinner question (Perfil → Avisos and Mimo's `set_alert_time`); the
 * proactive planner sends them then. Before, Mimo couldn't, and once said
 * «apuntado» without saving anything. specs/notifications.md «A qué hora».
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../services/recipeImport.js', () => ({ createRecipeFromParts: vi.fn(), importRecipeFromUrl: vi.fn() }))

import { alertTimeError, buildAlertRows, normalizeAlertTime, resolveAlertTimes, type AlertsOverview } from '@ona/shared'
import { setAlertTime } from '../services/assistant/alertTimeSkills.js'
import { describeAlerts } from '../services/assistant/appSkills.js'
import { toolsFor } from '../services/assistant/skills.js'
import { selectToolGroups } from '../services/assistant/toolGroups.js'
import { anyProactiveWindow, isDailyBriefWindow, isDinnerCheckinWindow, planProactive, type ProactiveInput } from '../services/whatsapp/proactive.js'
import type { MadridParts } from '../services/madridTime.js'
import type { AppApi } from '../services/assistant/appApi.js'

const at = (hour: number, minute = 0, weekday = 2): MadridParts => ({ hour, minute, weekday, isoDate: '2026-11-25' })

describe('resolveAlertTimes / alertTimeError (shared with the screen)', () => {
  it('none saved: the time it always had (breakfast; two hours after dinner, never after 22:00)', () => {
    expect(resolveAlertTimes({ saved: {} })).toEqual({
      daily_brief: { time: '09:00', custom: false },
      dinner_checkin: { time: '22:00', custom: false },
    })
    expect(resolveAlertTimes({ saved: {}, breakfast: '07:30', dinner: '19:30' })).toEqual({
      daily_brief: { time: '07:30', custom: false },
      dinner_checkin: { time: '21:30', custom: false },
    })
  })
  it('a saved time wins', () => {
    expect(resolveAlertTimes({ saved: { daily_brief: '08:15', dinner_checkin: '20:45' }, breakfast: '07:00' })).toEqual({
      daily_brief: { time: '08:15', custom: true },
      dinner_checkin: { time: '20:45', custom: true },
    })
  })
  it('normalizes what people write and keeps each one inside its hours', () => {
    expect(normalizeAlertTime('8:30')).toBe('08:30')
    expect(normalizeAlertTime('21.15')).toBe('21:15')
    expect(normalizeAlertTime('a las ocho')).toBeNull()
    expect(alertTimeError('daily_brief', '08:30')).toBeNull()
    expect(alertTimeError('daily_brief', '07:00')).toMatch(/entre las 08:00 y las 13:00/)
    expect(alertTimeError('dinner_checkin', '23:00')).toMatch(/entre las 19:00 y las 22:00/)
    expect(alertTimeError('dinner_checkin', null)).toMatch(/08:30/)
  })
})

describe('the planner with a changed time', () => {
  it('the morning menu goes at the household time, not at breakfast time', () => {
    expect(isDailyBriefWindow(at(9, 0), null, '11:00')).toBe(false)
    expect(isDailyBriefWindow(at(11, 5), null, '11:00')).toBe(true)
    expect(isDailyBriefWindow(at(12, 30), null, '11:00')).toBe(false)
    // Without one, as before.
    expect(isDailyBriefWindow(at(9, 0), null, null)).toBe(true)
  })
  it('the dinner question goes at the household time, for an hour', () => {
    // Dinner at 21:00 → by default 22:00–22:30; the household asked for 20:30.
    expect(isDinnerCheckinWindow(at(20, 35), '21:00', '20:30')).toBe(true)
    expect(isDinnerCheckinWindow(at(22, 10), '21:00', '20:30')).toBe(false)
    expect(isDinnerCheckinWindow(at(22, 10), '21:00', null)).toBe(true)
    // A late dinner had no question at all; with its own time it does.
    expect(isDinnerCheckinWindow(at(21, 50), '21:30', null)).toBe(false)
    expect(isDinnerCheckinWindow(at(21, 50), '21:30', '21:45')).toBe(true)
  })
  it('the cheap pre-check opens at the household time too', () => {
    expect(anyProactiveWindow(at(11, 10, 2), null, '21:00', null, { daily_brief: '11:00' })).toBe(true)
    expect(anyProactiveWindow(at(11, 10, 2), null, '21:00', null, {})).toBe(false)
  })

  const input = (o: Partial<ProactiveInput>): ProactiveInput => ({
    parts: at(9, 0),
    breakfastTime: null,
    dinnerTime: '21:00',
    prefs: { daily_brief: true },
    sentRecently: {},
    todayDay: async () => ({ lunch: { dishes: [{ kind: 'recipe' as const, recipeId: 'r1', recipeName: 'Lentejas' }] } }),
    todayDinner: async () => ({ names: ['Tortilla'], recipeIds: ['r2'], totalMinutes: 20 }),
    cookedToday: async () => false,
    pendingShopping: async () => [],
    hasNextWeekMenu: async () => true,
    webUrl: 'https://mimoia.com',
    ...o,
  })

  it('planProactive: menu at 11:00 instead of 09:00, dinner question at 20:30 instead of 22:00', async () => {
    const times = { daily_brief: '11:00', dinner_checkin: '20:30' }
    expect((await planProactive(input({ parts: at(9, 0), alertTimes: times }))).map((m) => m.kind)).not.toContain('daily_brief')
    expect((await planProactive(input({ parts: at(11, 0), alertTimes: times }))).map((m) => m.kind)).toContain('daily_brief')
    expect((await planProactive(input({ parts: at(20, 30), alertTimes: times }))).map((m) => m.kind)).toContain('dinner_checkin')
    expect((await planProactive(input({ parts: at(22, 0), alertTimes: times }))).map((m) => m.kind)).not.toContain('dinner_checkin')
    // Without times: as always.
    expect((await planProactive(input({ parts: at(22, 0) }))).map((m) => m.kind)).toContain('dinner_checkin')
  })
})

function overview(times: AlertsOverview['times'], prefs: Record<string, boolean> = { daily_brief: true }): AlertsOverview {
  return {
    whatsapp: { linked: true, notify: true },
    push: { subscribed: false },
    kinds: buildAlertRows({ userPrefs: prefs, whatsapp: { linked: true, notify: true, prefs: {} }, pushSubscribed: false }),
    times,
  }
}

function fakeApi(prefs?: Record<string, boolean>) {
  const calls: { method: string; path: string; body?: any }[] = []
  const api: AppApi = async (method, path, body) => {
    calls.push({ method, path, body })
    const t = (body as any)?.times ?? {}
    return overview(
      {
        daily_brief: t.daily_brief ? { time: t.daily_brief, custom: true } : { time: '09:00', custom: false },
        dinner_checkin: t.dinner_checkin ? { time: t.dinner_checkin, custom: true } : { time: '22:00', custom: false },
      },
      prefs,
    ) as any
  }
  return { api, calls }
}
const ctx = (api: AppApi, channel?: string) => ({ userId: 'u1', db: null, api, channel }) as any

describe('Mimo: set_alert_time (same route as Perfil → Avisos)', () => {
  it('is offered in the web chat and on WhatsApp, in the household group', () => {
    for (const mode of [undefined, 'whatsapp']) expect(toolsFor({ mode }).map((s) => s.name)).toContain('set_alert_time')
    expect([...selectToolGroups({ message: '¿me puedes cambiar la hora del menú del día a las 8?' }).tools]).toContain('set_alert_time')
    expect([...selectToolGroups({ message: '¿a qué hora me preguntas por la cena?' }).tools]).toContain('set_alert_time')
  })
  it('«mándame el menú a las 8:30» → PATCH the household time and say it in one line', async () => {
    const f = fakeApi()
    const r = await setAlertTime.handler({ kind: 'daily_brief', time: '8:30' }, ctx(f.api, 'whatsapp'))
    expect(f.calls).toEqual([{ method: 'PATCH', path: '/notifications/prefs', body: { times: { daily_brief: '08:30' } } }])
    expect(r.summary).toMatch(/^Hecho: el menú del día llegará a las 08:30, para todo el hogar\./)
  })
  it('reset goes back to the time it always had', async () => {
    const f = fakeApi()
    const r = await setAlertTime.handler({ kind: 'dinner_checkin', reset: true }, ctx(f.api))
    expect(f.calls[0].body).toEqual({ times: { dinner_checkin: null } })
    expect(r.summary).toContain('a las 22:00 (la hora de siempre)')
  })
  it('a time out of its hours, or another aviso, changes nothing and says why (no «apuntado» without saving)', async () => {
    const f = fakeApi()
    expect((await setAlertTime.handler({ kind: 'dinner_checkin', time: '23:30' }, ctx(f.api))).summary).toMatch(/^No he cambiado nada: .*19:00 y las 22:00/)
    expect((await setAlertTime.handler({ kind: 'shopping_reminder', time: '10:00' }, ctx(f.api))).summary).toMatch(/^No he cambiado nada/)
    expect(f.calls).toHaveLength(0)
  })
  it('warns when that aviso is switched off', async () => {
    const f = fakeApi({})
    const r = await setAlertTime.handler({ kind: 'daily_brief', time: '10:00' }, ctx(f.api))
    expect(r.summary).toContain('está apagado')
  })
  it('get_alerts says both times', () => {
    const s = describeAlerts(overview({ daily_brief: { time: '08:30', custom: true }, dinner_checkin: { time: '22:00', custom: false } }))
    expect(s).toContain('menu del dia a las 08:30;')
    expect(s).toContain('"¿hiciste la cena?" a las 22:00 (la de siempre)')
  })
})
