/**
 * When Mimo may write first (PRO-236, D-080): never before 08:00 nor after
 * 22:30, Europe/Madrid. What can't be recovered if it comes late (defrost,
 * soak, start cooking) is moved EARLIER, to the evening before; what can
 * wait (shopping, Sunday) just waits for the morning.
 * Pure (noticeHours.test.ts).
 */
import { addDays, madridParts, madridWallTimeUtc, type MadridParts } from '../madridTime.js'

/** 08:00 Madrid, in minutes. */
export const AWAKE_START_MIN = 8 * 60
/** 22:30 Madrid, in minutes (exclusive). */
export const AWAKE_END_MIN = 22 * 60 + 30
/**
 * The last moment an aviso moved earlier is planned for: 22:25, so the
 * 5-minute scheduler tick sends it before 22:30.
 */
export const LAST_AWAKE_SLOT_MIN = AWAKE_END_MIN - 5

export function isAwakeTime(p: Pick<MadridParts, 'hour' | 'minute'>): boolean {
  const m = p.hour * 60 + p.minute
  return m >= AWAKE_START_MIN && m < AWAKE_END_MIN
}

export function isAwakeInstant(at: Date): boolean {
  return isAwakeTime(madridParts(at))
}

/** The latest allowed instant at or before `at` (22:25 the evening before when it falls before 08:00). */
export function latestAwakeAtOrBefore(at: Date): Date {
  const p = madridParts(at)
  const m = p.hour * 60 + p.minute
  if (m >= AWAKE_START_MIN && m < AWAKE_END_MIN) return at
  const day = m >= AWAKE_END_MIN ? p.isoDate : addDays(p.isoDate, -1)
  return madridWallTimeUtc(day, Math.floor(LAST_AWAKE_SLOT_MIN / 60), LAST_AWAKE_SLOT_MIN % 60)
}

/** The first allowed instant at or after `at` (08:00 that morning or the next). */
export function earliestAwakeAtOrAfter(at: Date): Date {
  const p = madridParts(at)
  const m = p.hour * 60 + p.minute
  if (m >= AWAKE_START_MIN && m < AWAKE_END_MIN) return at
  const day = m >= AWAKE_END_MIN ? addDays(p.isoDate, 1) : p.isoDate
  return madridWallTimeUtc(day, 8, 0)
}

/**
 * When a priority-1 aviso (a prep alert) should fire: its time if allowed;
 * else the evening before (22:25); if that has already passed, the next
 * 08:00, as long as it's still before the meal. Null = no allowed moment
 * left before the meal.
 */
export function awakeFireAt(fireAt: Date, now: Date, cookAt: Date): Date | null {
  const earlier = latestAwakeAtOrBefore(fireAt)
  if (earlier > now) return earlier
  const later = earliestAwakeAtOrAfter(now)
  return later < cookAt ? later : null
}
