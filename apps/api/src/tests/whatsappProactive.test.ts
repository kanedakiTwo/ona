/**
 * Proactive WhatsApp messages: Madrid clock, time windows, Meta's 24 h
 * window, template flattening, daily-brief text, the planner, and the
 * two-channel status for prep alerts.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  madridParts,
  mondayOf,
  isWeeklyNudgeWindow,
  isDailyBriefWindow,
  chooseDelivery,
  templateParamFrom,
  formatDailyBrief,
  planProactive,
  combineDelivery,
  WEEKLY_NUDGE_TEXT,
  type MadridParts,
} from '../services/whatsapp/proactive.js'
import { mealLinesForDay } from '../services/menuText.js'

const WEB = 'https://ona.test'
const parts = (over: Partial<MadridParts>): MadridParts => ({ isoDate: '2026-10-11', weekday: 6, hour: 19, minute: 0, ...over })

describe('madridParts / mondayOf', () => {
  it('reads the wall clock in Madrid, not UTC (CEST = UTC+2)', () => {
    // 2026-10-11 is a Sunday; 17:30 UTC = 19:30 Madrid.
    expect(madridParts(new Date('2026-10-11T17:30:00Z'))).toEqual({ isoDate: '2026-10-11', weekday: 6, hour: 19, minute: 30 })
    // 23:30 UTC Sunday is already Monday 01:30 in Madrid.
    expect(madridParts(new Date('2026-10-11T23:30:00Z'))).toMatchObject({ isoDate: '2026-10-12', weekday: 0, hour: 1 })
  })

  it("madridWeekStart: early Monday in Madrid is already the new week (server is UTC)", async () => {
    const { madridWeekStart } = await import('../services/madridTime.js')
    // Sunday 23:30 UTC = Monday 01:30 Madrid.
    expect(madridWeekStart(new Date('2026-10-11T23:30:00Z'))).toBe('2026-10-12')
    expect(madridWeekStart(new Date('2026-10-11T21:00:00Z'))).toBe('2026-10-05')
    expect(madridWeekStart(new Date('2026-10-11T21:00:00Z'), 1)).toBe('2026-10-12')
  })

  it('computes this and next Monday', () => {
    expect(mondayOf('2026-10-11', 6)).toBe('2026-10-05')
    expect(mondayOf('2026-10-11', 6, 1)).toBe('2026-10-12')
    expect(mondayOf('2026-10-05', 0)).toBe('2026-10-05')
  })
})

describe('time windows', () => {
  it('nudges on Sunday 18:00–21:59 only', () => {
    expect(isWeeklyNudgeWindow(parts({ hour: 18 }))).toBe(true)
    expect(isWeeklyNudgeWindow(parts({ hour: 21, minute: 59 }))).toBe(true)
    expect(isWeeklyNudgeWindow(parts({ hour: 22 }))).toBe(false)
    expect(isWeeklyNudgeWindow(parts({ weekday: 5, hour: 19 }))).toBe(false)
  })

  it('briefs for 90 min from the breakfast time (default 09:00)', () => {
    expect(isDailyBriefWindow(parts({ hour: 9, minute: 0 }), null)).toBe(true)
    expect(isDailyBriefWindow(parts({ hour: 10, minute: 29 }), null)).toBe(true)
    expect(isDailyBriefWindow(parts({ hour: 10, minute: 30 }), null)).toBe(false)
    expect(isDailyBriefWindow(parts({ hour: 7, minute: 45 }), '07:30')).toBe(true)
    expect(isDailyBriefWindow(parts({ hour: 9, minute: 0 }), '07:30')).toBe(false)
    expect(isDailyBriefWindow(parts({ hour: 9, minute: 0 }), 'garbage')).toBe(true)
  })
})

describe('chooseDelivery (Meta 24 h window)', () => {
  const now = new Date('2026-10-11T18:00:00Z')
  it('sends free-form inside the window', () => {
    expect(chooseDelivery(new Date(now.getTime() - 2 * 3600_000), now, false)).toBe('session')
  })
  it('uses the template outside the window when configured, else skips', () => {
    const old = new Date(now.getTime() - 25 * 3600_000)
    expect(chooseDelivery(old, now, true)).toBe('template')
    expect(chooseDelivery(old, now, false)).toBe('skip')
    expect(chooseDelivery(null, now, false)).toBe('skip')
  })
  it('keeps a safety margin before the 24 h edge', () => {
    expect(chooseDelivery(new Date(now.getTime() - 23.8 * 3600_000), now, false)).toBe('skip')
  })
})

describe('templateParamFrom', () => {
  it('flattens newlines and folds buttons into text (Meta rejects newlines in params)', () => {
    const p = templateParamFrom([
      { type: 'text', text: 'Buenos días.\nHoy toca:\n- Comida: Lentejas' },
      { type: 'buttons', text: '¿Cambio algo?', buttons: [{ id: 'a', title: 'Sí' }, { id: 'b', title: 'No' }] },
    ])
    expect(p).toBe('Buenos días. Hoy toca: - Comida: Lentejas ¿Cambio algo? Responde: Sí / No.')
    expect(p).not.toMatch(/\n|\t| {4,}/)
  })
})

describe('daily brief', () => {
  const day = {
    breakfast: { dishes: [{ kind: 'recipe' as const, recipeId: 'x', recipeName: 'Tostadas' }] },
    lunch: { dishes: [{ kind: 'recipe' as const, recipeId: 'a', recipeName: 'Lentejas estofadas' }] },
    dinner: { dishes: [{ kind: 'note' as const, text: 'Cena fuera' }] },
  }

  it('lists lunch and dinner (not breakfast) with a link to the menu', () => {
    expect(formatDailyBrief(day, WEB)).toBe(
      `Buenos días. Hoy toca:\n- Comida: Lentejas estofadas\n- Cena: Cena fuera\n\n¿Quieres cambiar algo?\n\nVer menú: ${WEB}/menu`,
    )
  })

  it('stays silent on an empty day', () => {
    expect(formatDailyBrief({}, WEB)).toBeNull()
    expect(formatDailyBrief(null, WEB)).toBeNull()
  })

  it('mealLinesForDay orders meals and joins multi-dish slots', () => {
    expect(mealLinesForDay(day)).toEqual(['desayuno: Tostadas', 'comida: Lentejas estofadas', 'cena: Cena fuera'])
  })
})

describe('planProactive', () => {
  const day = { lunch: { dishes: [{ kind: 'recipe' as const, recipeId: 'a', recipeName: 'Lentejas' }] } }
  const dinner = { names: ['Carrilleras de ternera'], totalMinutes: 90 }
  const base = {
    breakfastTime: null,
    dinnerTime: '20:00',
    prefs: {},
    sentRecently: {},
    todayDay: async () => day,
    todayDinner: async () => dinner,
    cookedToday: async () => false,
    pendingShopping: async () => ['leche', 'pan', 'huevos', 'tomates'],
    hasNextWeekMenu: async () => false,
    webUrl: WEB,
  }
  const kinds = (r: { kind: string }[]) => r.map((p) => p.kind)

  it('sends the daily brief at breakfast time', async () => {
    expect(kinds(await planProactive({ ...base, parts: parts({ weekday: 2, hour: 9, minute: 10 }) }))).toEqual(['daily_brief'])
  })

  it('respects cooldowns, per-kind switches and empty days', async () => {
    const at9 = parts({ weekday: 2, hour: 9 })
    expect(await planProactive({ ...base, sentRecently: { daily_brief: true }, parts: at9 })).toEqual([])
    expect(await planProactive({ ...base, prefs: { daily_brief: false }, parts: at9 })).toEqual([])
    expect(await planProactive({ ...base, todayDay: async () => null, parts: at9 })).toEqual([])
  })

  it('reminds to start cooking a long dinner in time (90 min recipe, dinner 20:00 → ~18:20)', async () => {
    const r = await planProactive({ ...base, parts: parts({ weekday: 2, hour: 18, minute: 20 }) })
    expect(kinds(r)).toEqual(['cooking_reminder'])
    expect(r[0].messages[0].text).toBe('Si quieres cenar a las 20:00, toca empezar con *Carrilleras de ternera* (unos 90 min).')
    // Short dinners never trigger it.
    expect(await planProactive({ ...base, todayDinner: async () => ({ names: ['Tortilla'], totalMinutes: 20 }), parts: parts({ weekday: 2, hour: 19, minute: 30 }) })).toEqual([])
  })

  it('asks "¿hiciste la cena?" 2-3 h after dinner unless it was already logged', async () => {
    const at22 = parts({ weekday: 2, hour: 22, minute: 15 })
    const r = await planProactive({ ...base, parts: at22 })
    expect(r).toEqual([
      {
        kind: 'dinner_checkin',
        messages: [{ type: 'buttons', text: '¿Hiciste hoy la cena (*Carrilleras de ternera*)? Así lo apunto.', buttons: [{ id: 'checkin:yes', title: 'Sí, la hice' }, { id: 'checkin:no', title: 'No' }] }],
      },
    ])
    expect(await planProactive({ ...base, cookedToday: async () => true, parts: at22 })).toEqual([])
  })

  it('sends the Saturday shopping reminder only with 3+ pending items', async () => {
    const sat = parts({ weekday: 5, hour: 10, minute: 30 })
    const r = await planProactive({ ...base, parts: sat })
    expect(kinds(r)).toEqual(['shopping_reminder'])
    expect(r[0].messages[0].text).toContain('Te faltan 4 cosas: leche, pan, huevos, tomates')
    expect(await planProactive({ ...base, pendingShopping: async () => ['leche'], parts: sat })).toEqual([])
  })

  it('nudges on Sunday evening with reply buttons when next week has no menu', async () => {
    const r = await planProactive({ ...base, dinnerTime: '23:59', parts: parts({ weekday: 6, hour: 19 }) })
    expect(r).toEqual([
      {
        kind: 'weekly_nudge',
        messages: [{ type: 'buttons', text: WEEKLY_NUDGE_TEXT, buttons: [{ id: 'nudge:yes', title: 'Sí, prepáralo' }, { id: 'nudge:no', title: 'Ahora no' }] }],
      },
    ])
  })

  it('skips the nudge when next week is planned or it was already sent', async () => {
    const sun = parts({ weekday: 6, hour: 19 })
    const quiet = { ...base, dinnerTime: '23:59' }
    expect(await planProactive({ ...quiet, hasNextWeekMenu: vi.fn(async () => true), parts: sun })).toEqual([])
    expect(await planProactive({ ...quiet, sentRecently: { weekly_nudge: true }, parts: sun })).toEqual([])
  })

  it('does not hit the DB outside the windows', async () => {
    const todayDay = vi.fn(async () => day)
    const todayDinner = vi.fn(async () => dinner)
    const hasNextWeekMenu = vi.fn(async () => false)
    const pendingShopping = vi.fn(async () => [])
    expect(await planProactive({ ...base, todayDay, todayDinner, hasNextWeekMenu, pendingShopping, parts: parts({ weekday: 3, hour: 12 }) })).toEqual([])
    expect(todayDay).not.toHaveBeenCalled()
    expect(todayDinner).not.toHaveBeenCalled()
    expect(hasNextWeekMenu).not.toHaveBeenCalled()
    expect(pendingShopping).not.toHaveBeenCalled()
  })

  it('anyProactiveWindow is false in a quiet hour and kindEnabled defaults to on', async () => {
    const { anyProactiveWindow, kindEnabled } = await import('../services/whatsapp/proactive.js')
    expect(anyProactiveWindow(parts({ weekday: 3, hour: 12 }), null, '20:00')).toBe(false)
    expect(anyProactiveWindow(parts({ weekday: 3, hour: 22, minute: 30 }), null, '20:00')).toBe(true)
    expect(kindEnabled({}, 'daily_brief')).toBe(true)
    expect(kindEnabled({ daily_brief: false }, 'daily_brief')).toBe(false)
  })
})

describe('combineDelivery (prep alerts over push + WhatsApp)', () => {
  it('is sent when either channel delivered', () => {
    expect(combineDelivery({ status: 'ok' }, { status: 'skipped' })).toEqual({ status: 'sent', errorMessage: null })
    expect(combineDelivery({ status: 'error', error: 'push-not-configured' }, { status: 'ok' })).toEqual({ status: 'sent', errorMessage: null })
  })
  it('keeps the legacy failure when push is not configured and WhatsApp is not linked', () => {
    expect(combineDelivery({ status: 'error', error: 'push-not-configured' }, { status: 'skipped' })).toEqual({
      status: 'failed',
      errorMessage: 'push-not-configured',
    })
  })
  it('reports both errors', () => {
    expect(combineDelivery({ status: 'error', error: 'boom' }, { status: 'error', error: 'graph 500' }).errorMessage).toBe('boom · whatsapp: graph 500')
  })
})

describe('templateFor — one approved template per kind (WHATSAPP_TEMPLATES)', () => {
  it('uses the per-kind template, then the generic one, then none', async () => {
    const { templateFor, parseTemplateMap } = await import('../services/whatsapp/proactive.js')
    const map = parseTemplateMap('{"daily_brief":"ona_menu_de_hoy","alert":" ona_aviso_preparacion "}')
    expect(templateFor('daily_brief', map, 'ona_aviso')).toBe('ona_menu_de_hoy')
    expect(templateFor('alert', map, '')).toBe('ona_aviso_preparacion')
    expect(templateFor('weekly_nudge', map, 'ona_aviso')).toBe('ona_aviso')
    expect(templateFor('weekly_nudge', map, '')).toBeNull()
  })

  it('ignores malformed config instead of crashing the scheduler', async () => {
    const { parseTemplateMap } = await import('../services/whatsapp/proactive.js')
    expect(parseTemplateMap('not json')).toEqual({})
    expect(parseTemplateMap('["a"]')).toEqual({})
    expect(parseTemplateMap('{"daily_brief": 3, "alert": "ok"}')).toEqual({ alert: 'ok' })
  })
})
