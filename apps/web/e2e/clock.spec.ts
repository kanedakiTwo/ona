/**
 * PRO-273: the date helpers of `_clock.ts` read «today» in Madrid, not in the
 * process clock. CI runs in UTC, and from 00:00 to 02:00 Madrid (01:00 in
 * winter) the two disagree on the day: the menu specs then read the wrong
 * day of the week, or the wrong week on a Monday. No browser: pure logic.
 */

import { test, expect } from '@playwright/test'
import { madridToday, madridTodayIdx, madridWeekStart, pinnedDay } from './_clock'

test('00:30 Madrid (summer time) is already the next day, though UTC still says the previous one', () => {
  // 2026-10-19 is a Monday; 22:30 UTC on it is Tuesday 00:30 in Madrid (UTC+2).
  const now = new Date('2026-10-19T22:30:00Z')
  expect(now.getUTCDay()).toBe(1) // the runner's clock: Monday
  expect(madridToday(now)).toBe('2026-10-20')
  expect(madridTodayIdx(now)).toBe(1)
  expect(madridWeekStart(now)).toBe('2026-10-19')

  const mondayHalfPast = new Date('2026-10-18T22:30:00Z') // Sunday 22:30 UTC = Monday 00:30 Madrid
  expect(mondayHalfPast.getUTCDay()).toBe(0) // the runner's clock: Sunday
  expect(madridToday(mondayHalfPast)).toBe('2026-10-19')
  expect(madridTodayIdx(mondayHalfPast)).toBe(0)
  expect(madridWeekStart(mondayHalfPast)).toBe('2026-10-19') // not the week of the 12th
})

test('winter time: Monday 00:30 Madrid is Sunday 23:30 UTC', () => {
  const now = new Date('2026-11-01T23:30:00Z')
  expect(madridToday(now)).toBe('2026-11-02')
  expect(madridTodayIdx(now)).toBe(0)
  expect(madridWeekStart(now)).toBe('2026-11-02')
})

test('Sunday late evening in Madrid stays in its own week', () => {
  const now = new Date('2026-10-25T21:30:00Z') // Sunday 22:30 Madrid (UTC+1 from the 25th)
  expect(madridTodayIdx(now)).toBe(6)
  expect(madridWeekStart(now)).toBe('2026-10-19')
})

test('pinnedDay pins today at midday Madrid in the Madrid week', () => {
  const now = new Date('2026-10-18T22:30:00Z') // Monday 00:30 Madrid
  const day = pinnedDay(madridTodayIdx(now), now)
  expect(day).toMatchObject({ weekStart: '2026-10-19', dayIdx: 0 })
  expect(madridToday(day.at)).toBe('2026-10-19')
  expect(day.at.toISOString()).toBe('2026-10-19T10:00:00.000Z')
})
