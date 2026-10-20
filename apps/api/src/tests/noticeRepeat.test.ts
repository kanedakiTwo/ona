/**
 * PRO-235 (D-080, regla 3): Mimo doesn't repeat what the household has just
 * seen — no morning brief after today's menu came up in a conversation, and
 * «¿hiciste la cena?» + «¿repetimos?» in one message.
 */
import { describe, it, expect, vi } from 'vitest'
import { CHECKIN_RATING_BUTTONS, planProactive, sawTodaysMenu, type MadridParts } from '../services/whatsapp/proactive.js'

const parts = (over: Partial<MadridParts>): MadridParts => ({ isoDate: '2026-10-20', weekday: 1, hour: 9, minute: 10, ...over })
const base = {
  parts: parts({}),
  breakfastTime: null,
  dinnerTime: '20:00',
  prefs: { daily_brief: true },
  sentRecently: {},
  todayDay: async () => ({ lunch: { dishes: [{ kind: 'recipe' as const, recipeId: 'a', recipeName: 'Lentejas' }] } }),
  todayDinner: async () => ({ names: ['Merluza en salsa'], recipeIds: ['r1'], totalMinutes: 30 }),
  cookedToday: async () => false,
  pendingShopping: async () => [],
  hasNextWeekMenu: async () => true,
  webUrl: 'https://mimoia.test',
}

describe('the morning brief does not repeat a menu already seen', () => {
  it('sawTodaysMenu: asking for today’s or the week’s menu, or making the week', () => {
    expect(sawTodaysMenu([{ tools: ['get_todays_menu'] }])).toBe(true)
    expect(sawTodaysMenu([{ tools: ['add_shopping_items'] }, { tools: ['generate_weekly_menu'] }])).toBe(true)
    expect(sawTodaysMenu([{ tools: ['add_shopping_items'] }, { tools: [] }, {}])).toBe(false)
    expect(sawTodaysMenu([])).toBe(false)
  })

  it('skips the brief when the person already saw it this morning; sends it otherwise', async () => {
    expect(await planProactive({ ...base, sawTodaysMenu: async () => true })).toEqual([])
    const r = await planProactive({ ...base, sawTodaysMenu: async () => false })
    expect(r.map((p) => p.kind)).toEqual(['daily_brief'])
  })

  it('only looks at the conversation inside the brief window', async () => {
    const saw = vi.fn(async () => false)
    await planProactive({ ...base, sawTodaysMenu: saw, parts: parts({ hour: 13 }) })
    expect(saw).not.toHaveBeenCalled()
  })
})

describe('«¿hiciste la cena?» and «¿repetimos?» are one message', () => {
  const at22 = parts({ hour: 22, minute: 10 })

  it('asks both, with buttons that answer both, when the recipe has no recent rating', async () => {
    const askRating = vi.fn(async () => true)
    const r = await planProactive({ ...base, prefs: {}, parts: at22, askRating })
    expect(askRating).toHaveBeenCalledWith('r1')
    expect(r).toHaveLength(1)
    expect(r[0].kind).toBe('dinner_checkin')
    expect(r[0].messages).toHaveLength(1)
    const m = r[0].messages[0]
    expect(m.type).toBe('buttons')
    if (m.type !== 'buttons') return
    expect(m.text).toContain('*Merluza en salsa*')
    expect(m.text).toContain('¿La repetimos?')
    expect(m.buttons.map((b) => b.title)).toEqual(CHECKIN_RATING_BUTTONS.map((b) => b.title))
    expect(m.buttons.every((b) => b.title.length <= 20)).toBe(true)
    expect(r[0].guide?.facts.join(' ')).toContain('si la repetimos')
  })

  it('keeps the plain question when the household rated it in the last 30 days', async () => {
    const r = await planProactive({ ...base, prefs: {}, parts: at22, askRating: async () => false })
    const m = r[0].messages[0]
    expect(m.type === 'buttons' && m.buttons.map((b) => b.title)).toEqual(['Sí, hecho', 'No'])
  })
})
