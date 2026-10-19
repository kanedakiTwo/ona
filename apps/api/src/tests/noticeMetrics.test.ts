/**
 * PRO-216: the `notifications` block of GET /admin/metrics — what the weekly
 * aviso budget left out, per ISO week, by kind and by priority.
 */
import { describe, it, expect } from 'vitest'
import { buildNoticeMetrics, type NoticeCountRow } from '../services/notifications/metrics.js'
import { kindsSwitchedOff } from '../services/whatsapp/proactive.js'

const W1 = '2026-10-12'
const W2 = '2026-10-19'
const row = (over: Partial<NoticeCountRow>): NoticeCountRow => ({ week: W2, kind: 'prep_alerts', priority: 1, outcome: 'enviado', count: 1, answered: 0, ...over })

describe('buildNoticeMetrics', () => {
  const weekly = buildNoticeMetrics({
    weeks: [W1, W2],
    currentWeek: W2,
    counts: [
      row({ kind: 'prep_alerts', priority: 1, outcome: 'enviado', count: 3, answered: 1 }),
      row({ kind: 'prep_alerts', priority: 1, outcome: 'fusionado', count: 1 }),
      row({ kind: 'cooking_reminder', priority: 1, outcome: 'descartado_tope', count: 1 }),
      row({ kind: 'shopping_reminder', priority: 3, outcome: 'descartado_tope', count: 2 }),
      row({ kind: 'weekly_nudge', priority: 3, outcome: 'fuera_ventana', count: 1 }),
      row({ kind: 'dinner_checkin', priority: 4, outcome: 'fallido', count: 1 }),
      row({ week: W1, kind: 'weekly_nudge', priority: 3, outcome: 'enviado', count: 1, answered: 1 }),
    ],
    householdsByWeek: new Map([[W1, 1], [W2, 2]]),
    optOutsByWeek: new Map([[W2, 1]]),
    kindOffsByWeek: new Map(),
  })

  it('counts candidates and outcomes per week', () => {
    expect(weekly.map((w) => [w.isoWeek, w.partial])).toEqual([['2026-W42', false], ['2026-W43', true]])
    const w = weekly[1]
    expect(w).toMatchObject({
      householdsWithNotices: 2,
      candidates: 9,
      sent: 3,
      merged: 1,
      droppedByBudget: 3,
      outsideWindow: 1,
      failed: 1,
      answered: 1,
      optOutHouseholds: 1,
      kindOffHouseholds: 0,
    })
    expect(weekly[0]).toMatchObject({ candidates: 1, sent: 1, answered: 1, priority1Dropped: 0, optOutHouseholds: 0 })
  })

  it('shows a dropped priority-1 aviso apart', () => {
    expect(weekly[1].priority1Dropped).toBe(1)
    expect(weekly[1].byPriority['1']).toMatchObject({ candidates: 5, droppedByBudget: 1 })
    expect(weekly[1].byPriority['3']).toMatchObject({ candidates: 3, droppedByBudget: 2, outsideWindow: 1 })
  })

  it('breaks it down by kind', () => {
    expect(weekly[1].byKind.prep_alerts).toMatchObject({ candidates: 4, sent: 3, merged: 1, answered: 1 })
    expect(weekly[1].byKind.shopping_reminder).toMatchObject({ candidates: 2, droppedByBudget: 2 })
    expect(Object.keys(weekly[0].byKind)).toEqual(['weekly_nudge'])
  })
})

describe('kindsSwitchedOff (notifications_off usage event)', () => {
  it('reports the master switch and each kind that was on', () => {
    expect(kindsSwitchedOff({ notify: true, prefs: {} }, { notify: false })).toEqual(['all'])
    expect(kindsSwitchedOff({ notify: false, prefs: {} }, { notify: false })).toEqual([])
    expect(kindsSwitchedOff({ notify: true, prefs: {} }, { prefs: { shopping_reminder: false, weekly_nudge: true } })).toEqual(['shopping_reminder'])
    // The morning brief is off unless asked for: switching it "off" again isn't news.
    expect(kindsSwitchedOff({ notify: true, prefs: {} }, { prefs: { daily_brief: false } })).toEqual([])
    expect(kindsSwitchedOff({ notify: true, prefs: { daily_brief: true } }, { prefs: { daily_brief: false } })).toEqual(['daily_brief'])
  })
})
