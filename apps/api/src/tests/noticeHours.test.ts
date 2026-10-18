/**
 * PRO-236 (D-080): Mimo never writes before 08:00 nor after 22:30 (Madrid);
 * what can't come late moves earlier; household avisos go to one person.
 */
import { describe, it, expect } from 'vitest'
import { awakeFireAt, earliestAwakeAtOrAfter, isAwakeTime, latestAwakeAtOrBefore } from '../services/notifications/hours.js'
import { householdNoticeRecipient } from '../services/notifications/recipient.js'
import { isDinnerCheckinWindow, planProactive, type MadridParts } from '../services/whatsapp/proactive.js'

// 2026-10-20 is a Tuesday; Madrid is UTC+2 (CEST).
const madrid = (hhmm: string, day = '2026-10-20') => new Date(`${day}T${hhmm}:00+02:00`)

describe('the hours', () => {
  it('08:00 to 22:30 only', () => {
    expect(isAwakeTime({ hour: 7, minute: 59 })).toBe(false)
    expect(isAwakeTime({ hour: 8, minute: 0 })).toBe(true)
    expect(isAwakeTime({ hour: 22, minute: 29 })).toBe(true)
    expect(isAwakeTime({ hour: 22, minute: 30 })).toBe(false)
    expect(isAwakeTime({ hour: 2, minute: 0 })).toBe(false)
  })

  it('what cannot come late moves earlier, to 22:25 the evening before', () => {
    expect(latestAwakeAtOrBefore(madrid('02:00')).toISOString()).toBe(madrid('22:25', '2026-10-19').toISOString())
    expect(latestAwakeAtOrBefore(madrid('23:10')).toISOString()).toBe(madrid('22:25').toISOString())
    expect(latestAwakeAtOrBefore(madrid('19:00')).toISOString()).toBe(madrid('19:00').toISOString())
    expect(earliestAwakeAtOrAfter(madrid('23:10')).toISOString()).toBe(madrid('08:00', '2026-10-21').toISOString())
  })

  it('a soak alert at 02:00 for a 14:00 lunch goes the evening before; if that passed, at 08:00', () => {
    const cookAt = madrid('14:00')
    expect(awakeFireAt(madrid('02:00'), madrid('12:00', '2026-10-19'), cookAt)?.toISOString()).toBe(madrid('22:25', '2026-10-19').toISOString())
    expect(awakeFireAt(madrid('02:00'), madrid('23:00', '2026-10-19'), cookAt)?.toISOString()).toBe(madrid('08:00').toISOString())
    // No allowed moment before the meal → none.
    expect(awakeFireAt(madrid('06:30'), madrid('23:00', '2026-10-19'), madrid('07:00'))).toBeNull()
  })

  it('what can wait (the dinner check-in) moves inside the hours or is skipped', () => {
    const p = (hour: number, minute = 0): MadridParts => ({ isoDate: '2026-10-20', weekday: 1, hour, minute })
    // Dinner 21:00: was 23:00–24:00, now 22:00–22:30.
    expect(isDinnerCheckinWindow(p(22, 10), '21:00')).toBe(true)
    expect(isDinnerCheckinWindow(p(22, 30), '21:00')).toBe(false)
    expect(isDinnerCheckinWindow(p(23, 0), '21:00')).toBe(false)
    // Dinner 20:00 keeps 22:00–22:30; dinner 21:45 gets none (less than 1 h after).
    expect(isDinnerCheckinWindow(p(22, 15), '20:00')).toBe(true)
    expect(isDinnerCheckinWindow(p(22, 15), '21:45')).toBe(false)
  })

  it('the planner no longer asks «¿hiciste la cena?» at 23:15 (the tick also stops everything outside 08:00–22:30)', async () => {
    const r = await planProactive({
      parts: { isoDate: '2026-10-20', weekday: 1, hour: 23, minute: 15 },
      breakfastTime: null,
      dinnerTime: '21:00',
      prefs: {},
      sentRecently: {},
      todayDay: async () => null,
      todayDinner: async () => ({ names: ['Lentejas'], totalMinutes: 30 }),
      cookedToday: async () => false,
      pendingShopping: async () => [],
      hasNextWeekMenu: async () => true,
      webUrl: 'https://mimoia.test',
    })
    expect(r).toEqual([])
  })
})

describe('household avisos to one person', () => {
  const owner = { userId: 'owner', isOwner: true, joinedAt: new Date('2026-10-01') }
  const ana = { userId: 'ana', isOwner: false, joinedAt: new Date('2026-10-05') }
  const leo = { userId: 'leo', isOwner: false, joinedAt: new Date('2026-10-03') }

  it('goes to whoever manages the household', () => {
    expect(householdNoticeRecipient([ana, owner, leo], () => true)).toBe('owner')
  })

  it('goes to the next person (by join date) when the owner switched it off or has no avisos', () => {
    expect(householdNoticeRecipient([ana, owner, leo], (id) => id !== 'owner')).toBe('leo')
    expect(householdNoticeRecipient([ana, leo], () => true)).toBe('leo')
  })

  it('nobody when nobody gets it', () => {
    expect(householdNoticeRecipient([ana, owner], () => false)).toBeNull()
  })
})
