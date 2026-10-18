/**
 * PRO-215 (D-069): the weekly budget of avisos Mimo sends by itself —
 * priorities, the priority-1 reserve, one message per moment, what never
 * counts, and the morning brief only for whoever asked for it.
 */
import { describe, it, expect } from 'vitest'
import {
  WEEKLY_NOTICE_BUDGET,
  countsAgainstBudget,
  logEntriesFor,
  noticePriority,
  planMoment,
  upcomingMoments,
  type BudgetState,
} from '../services/notifications/budget.js'
import { cookingReminderTimes } from '../services/notifications/budgetStore.js'
import { mergeMessages, planProactive, type MadridParts } from '../services/whatsapp/proactive.js'
import { mergeAlertPayloads } from '../services/notificationScheduler.js'

const state = (over: Partial<BudgetState> = {}): BudgetState => ({ budget: WEEKLY_NOTICE_BUDGET, used: 0, reservedP1: 0, ...over })

describe('priorities', () => {
  it('ranks what has no fix if forgotten first and planning help third', () => {
    expect(WEEKLY_NOTICE_BUDGET).toBe(4)
    expect(noticePriority('prep_alerts')).toBe(1)
    expect(noticePriority('cooking_reminder')).toBe(1)
    expect(noticePriority('shopping_reminder')).toBe(3)
    expect(noticePriority('weekly_nudge')).toBe(3)
    expect(noticePriority('dinner_checkin')).toBe(4)
    expect(noticePriority('something_new')).toBe(4)
  })
})

describe('planMoment', () => {
  it('with the budget spent, priority 2–4 is dropped and logged as descartado_tope', () => {
    const plan = planMoment([{ kind: 'shopping_reminder' }, { kind: 'dinner_checkin' }], state({ used: 4 }))
    expect(plan.send).toEqual([])
    expect(plan.counts).toBe(false)
    expect(logEntriesFor(plan, null)).toEqual([
      { kind: 'shopping_reminder', priority: 3, outcome: 'descartado_tope', counted: false },
      { kind: 'dinner_checkin', priority: 4, outcome: 'descartado_tope', counted: false },
    ])
  })

  it('a priority-1 aviso on Friday goes out although Monday and Tuesday had priority-3 candidates', () => {
    // The week's menu is made: three priority-1 moments are known (Wed, Thu, Fri).
    let used = 0
    let reserved = 3
    const run = (kind: string) => {
      const p1 = noticePriority(kind) === 1
      if (p1) reserved -= 1 // this one was in the reserve
      const plan = planMoment([{ kind }], state({ used, reservedP1: p1 ? 0 : reserved }))
      if (plan.counts) used += 1
      return plan.send.length > 0
    }
    expect(run('shopping_reminder')).toBe(true) // Monday: 4 − 0 − 3 reserved leaves one
    expect(run('weekly_nudge')).toBe(false) // Tuesday: nothing left beyond the reserve
    expect(run('prep_alerts')).toBe(true) // Wednesday
    expect(run('cooking_reminder')).toBe(true) // Thursday
    expect(run('prep_alerts')).toBe(true) // Friday
    expect(used).toBe(4)
  })

  it('without a reserve priority 2–4 spends what is left', () => {
    expect(planMoment([{ kind: 'weekly_nudge' }], state({ used: 3 })).send).toHaveLength(1)
    expect(planMoment([{ kind: 'weekly_nudge' }], state({ used: 3, reservedP1: 1 })).send).toHaveLength(0)
    // Priority 1 itself may use the last unit.
    expect(planMoment([{ kind: 'prep_alerts' }], state({ used: 3, reservedP1: 2 })).send).toHaveLength(1)
    expect(planMoment([{ kind: 'prep_alerts' }], state({ used: 4 })).dropped).toHaveLength(1)
  })

  it('two avisos of the same moment go out in one message and count one', () => {
    const plan = planMoment([{ kind: 'dinner_checkin' }, { kind: 'cooking_reminder' }], state({ used: 1 }))
    expect(plan.send.map((c) => c.kind)).toEqual(['cooking_reminder', 'dinner_checkin'])
    expect(plan.counts).toBe(true)
    const log = logEntriesFor(plan, 'ok')
    expect(log.map((e) => e.outcome)).toEqual(['enviado', 'fusionado'])
    expect(log.filter((e) => e.counted)).toHaveLength(1)
    // …and they really are one WhatsApp message.
    const merged = mergeMessages([
      [{ type: 'text', text: 'Toca empezar con *Carrilleras*.' }],
      [{ type: 'buttons', text: '¿Hiciste la cena?', buttons: [{ id: 'checkin:yes', title: 'Sí, la hice' }] }],
    ])
    expect(merged).toEqual([
      { type: 'buttons', text: 'Toca empezar con *Carrilleras*.\n\n¿Hiciste la cena?', buttons: [{ id: 'checkin:yes', title: 'Sí, la hice' }] },
    ])
  })

  it('a second message in the same tick (another person of the house) rides on the first', () => {
    const plan = planMoment([{ kind: 'weekly_nudge' }], state({ used: 4, momentAlreadyCounted: true }))
    expect(plan.send).toHaveLength(1)
    expect(plan.counts).toBe(false)
  })

  it('a reply to the person never counts, even with the budget spent', () => {
    expect(countsAgainstBudget('reply')).toBe(false)
    expect(countsAgainstBudget('founder_offer')).toBe(false)
    expect(countsAgainstBudget('charge_notice')).toBe(false)
    const plan = planMoment([{ kind: 'reply' }], state({ used: 4 }))
    expect(plan.send).toHaveLength(1)
    expect(plan.counts).toBe(false)
  })

  it('a message that could not go out is logged as fuera_ventana or fallido and spends nothing', () => {
    const plan = planMoment([{ kind: 'cooking_reminder' }], state())
    expect(logEntriesFor(plan, 'outside-window')).toEqual([{ kind: 'cooking_reminder', priority: 1, outcome: 'fuera_ventana', counted: false }])
    expect(logEntriesFor(plan, 'error')[0]).toMatchObject({ outcome: 'fallido', counted: false })
  })
})

describe('the morning brief (daily_brief)', () => {
  const parts = (over: Partial<MadridParts>): MadridParts => ({ isoDate: '2026-10-20', weekday: 1, hour: 9, minute: 10, ...over })
  const input = {
    parts: parts({}),
    breakfastTime: null,
    dinnerTime: null,
    sentRecently: {},
    todayDay: async () => ({ lunch: { dishes: [{ kind: 'recipe' as const, recipeId: 'a', recipeName: 'Lentejas' }] } }),
    todayDinner: async () => null,
    cookedToday: async () => false,
    pendingShopping: async () => [],
    hasNextWeekMenu: async () => true,
    webUrl: 'https://mimoia.test',
  }

  it('does not go out unless asked for, and when asked for it spends nothing', async () => {
    expect(await planProactive({ ...input, prefs: {} })).toEqual([])
    const planned = await planProactive({ ...input, prefs: { daily_brief: true } })
    expect(planned.map((p) => p.kind)).toEqual(['daily_brief'])
    const plan = planMoment(planned, state({ used: 4 }))
    expect(plan.send).toHaveLength(1)
    expect(plan.counts).toBe(false)
  })
})

describe('the priority-1 reserve', () => {
  const now = new Date('2026-10-19T08:00:00Z') // Monday 10:00 Madrid
  const weekEnd = new Date('2026-10-25T22:00:00Z') // next Monday 00:00 Madrid

  it('counts future moments of this week; avisos minutes apart are one', () => {
    const t = (iso: string) => new Date(iso)
    expect(
      upcomingMoments(
        [t('2026-10-18T10:00:00Z'), t('2026-10-21T17:00:00Z'), t('2026-10-21T17:02:00Z'), t('2026-10-23T17:00:00Z'), t('2026-10-27T17:00:00Z')],
        now,
        weekEnd,
      ),
    ).toBe(2)
  })

  it('cookingReminderTimes: dinners of 40+ minutes, at dinner − time − 10 (Madrid)', () => {
    const times = cookingReminderTimes('2026-10-19', [90, 20, null, 45], '21:00')
    // 21:00 − 90 − 10 = 19:20 Madrid = 17:20 UTC (CEST); 21:00 − 45 − 10 = 20:05.
    expect(times.map((d) => d.toISOString())).toEqual(['2026-10-19T17:20:00.000Z', '2026-10-22T18:05:00.000Z'])
  })
})

describe('prep alerts of one moment', () => {
  it('several alerts due at once become one notification', () => {
    expect(mergeAlertPayloads([{ title: 'Acuérdate: Merluza', body: 'Sácalo del congelador 24 h antes', url: '/menu?day=2' }])).toEqual({
      title: 'Acuérdate: Merluza',
      body: 'Sácalo del congelador 24 h antes',
      url: '/menu?day=2',
    })
    expect(
      mergeAlertPayloads([
        { title: 'Acuérdate: Merluza', body: 'Sácalo del congelador 24 h antes', url: '/menu?day=2', tag: 'a' },
        { title: 'Acuérdate: Garbanzos', body: 'Déjalo en remojo toda la noche', url: '/menu?day=3', tag: 'b' },
      ]),
    ).toEqual({
      title: 'Acuérdate: Merluza y Garbanzos',
      body: 'Merluza: Sácalo del congelador 24 h antes\nGarbanzos: Déjalo en remojo toda la noche',
      url: '/menu?day=2',
      tag: 'a',
    })
  })
})
