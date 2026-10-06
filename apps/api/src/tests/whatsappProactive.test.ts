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
  const base = {
    breakfastTime: null,
    briefedRecently: false,
    nudgedRecently: false,
    todayDay: async () => day,
    hasNextWeekMenu: async () => false,
    webUrl: WEB,
  }

  it('sends the daily brief at breakfast time', async () => {
    const r = await planProactive({ ...base, parts: parts({ weekday: 2, hour: 9, minute: 10 }) })
    expect(r.map((p) => p.kind)).toEqual(['daily_brief'])
  })

  it('does not repeat the brief within the cooldown, and skips days without a menu', async () => {
    expect(await planProactive({ ...base, briefedRecently: true, parts: parts({ weekday: 2, hour: 9 }) })).toEqual([])
    expect(await planProactive({ ...base, todayDay: async () => null, parts: parts({ weekday: 2, hour: 9 }) })).toEqual([])
  })

  it('nudges on Sunday evening with reply buttons when next week has no menu', async () => {
    const r = await planProactive({ ...base, parts: parts({ weekday: 6, hour: 19 }) })
    expect(r).toEqual([
      {
        kind: 'weekly_nudge',
        messages: [{ type: 'buttons', text: WEEKLY_NUDGE_TEXT, buttons: [{ id: 'nudge:yes', title: 'Sí, prepáralo' }, { id: 'nudge:no', title: 'Ahora no' }] }],
      },
    ])
  })

  it('skips the nudge when next week is planned or it was already sent', async () => {
    const hasNextWeekMenu = vi.fn(async () => true)
    expect(await planProactive({ ...base, hasNextWeekMenu, parts: parts({ weekday: 6, hour: 19 }) })).toEqual([])
    expect(await planProactive({ ...base, nudgedRecently: true, parts: parts({ weekday: 6, hour: 19 }) })).toEqual([])
  })

  it('does not hit the DB outside the windows', async () => {
    const todayDay = vi.fn(async () => day)
    const hasNextWeekMenu = vi.fn(async () => false)
    expect(await planProactive({ ...base, todayDay, hasNextWeekMenu, parts: parts({ weekday: 3, hour: 15 }) })).toEqual([])
    expect(todayDay).not.toHaveBeenCalled()
    expect(hasNextWeekMenu).not.toHaveBeenCalled()
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
