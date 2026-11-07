import { and, desc, eq, sql } from 'drizzle-orm'
import { pastDayIndexes, type DayMenu, type LockedSlots } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { menuLogs, menus } from '../db/schema.js'
import { resolveScope, scopeWhere } from './scopeResolver.js'

/**
 * What a (re)generation of a week must carry over from the week's current
 * menu: locked slots (the user said "don't touch"), vetoed recipes and
 * "sin cocinar" days. The previous row stays in the DB as history; the new
 * row is what the UI reads. Used by POST /menu/generate and the assistant's
 * generate_weekly_menu so both keep the same promises.
 */
export interface PreviousWeek {
  days: DayMenu[] | undefined
  locked: LockedSlots
  bannedRecipeIds: Set<string>
  skippedDays: Set<number>
}

export async function loadPreviousWeek(userId: string, weekStart: string, db: any = defaultDb): Promise<PreviousWeek> {
  const scope = await resolveScope(userId, db)
  const [previous] = await db
    .select({
      days: menus.days,
      locked: menus.locked,
      bannedRecipeIds: menus.bannedRecipeIds,
      skippedDays: menus.skippedDays,
    })
    .from(menus)
    .where(and(scopeWhere(menus.userId, menus.householdId, scope), eq(menus.weekStart, weekStart)))
    .orderBy(desc(menus.createdAt))
    .limit(1)
  return {
    days: Array.isArray(previous?.days) ? (previous.days as DayMenu[]) : undefined,
    locked: lockedThatExist((previous?.locked as LockedSlots | null) ?? {}, previous?.days as DayMenu[] | undefined),
    bannedRecipeIds: new Set<string>(previous?.bannedRecipeIds ?? []),
    skippedDays: new Set<number>(previous?.skippedDays ?? []),
  }
}

/** Locks that still point at a slot with dishes (a lock on an empty slot protects nothing). */
export function lockedThatExist(locked: LockedSlots, days: DayMenu[] | undefined): LockedSlots {
  const out: LockedSlots = {}
  if (!days) return out
  for (const [day, meals] of Object.entries(locked ?? {})) {
    for (const [meal, isLocked] of Object.entries(meals ?? {})) {
      const slot = days[Number(day)]?.[meal] as { dishes?: unknown[] } | undefined
      if (isLocked && Array.isArray(slot?.dishes) && slot!.dishes!.length > 0) {
        out[day] = { ...(out[day] ?? {}), [meal]: true }
      }
    }
  }
  return out
}

/** True when any slot of the week holds at least one dish. */
export function menuHasDishes(days: DayMenu[] | undefined): boolean {
  if (!Array.isArray(days)) return false
  return days.some((day) =>
    Object.values(day ?? {}).some((slot: any) => Array.isArray(slot?.dishes) && slot.dishes.length > 0),
  )
}

/** Copy locked slots from the previous week into freshly built days (in place) and return them. */
export function keepLockedSlots(days: DayMenu[], previous: DayMenu[] | undefined, locked: LockedSlots): DayMenu[] {
  if (!previous) return days
  for (const [day, meals] of Object.entries(locked)) {
    const d = Number(day)
    for (const [meal, isLocked] of Object.entries(meals)) {
      if (!isLocked || !days[d] || !previous[d]?.[meal]) continue
      days[d][meal] = previous[d][meal]
    }
  }
  return days
}

/**
 * How many different weeks the caller's household has had GENERATED (the
 * snowball line, 2026-10-15): menus with a `menu_logs` row — written only by
 * generate_weekly_menu / POST /menu/generate, never by the empty row the web
 * creates when opening a week — counted by `week_start`, so regenerating the
 * same week doesn't count twice. Read after the turn: includes this week.
 * Used by WhatsApp (week digest/caption) and the web chat (PRO-170).
 */
export async function generatedWeeksOf(userId: string, db: any = defaultDb): Promise<number> {
  const scope = scopeWhere(menus.userId, menus.householdId, await resolveScope(userId, db))
  const [row] = await db
    .select({ n: sql<number>`count(distinct ${menus.weekStart})::int` })
    .from(menus)
    .innerJoin(menuLogs, eq(menuLogs.menuId, menus.id))
    .where(scope)
  return Number(row?.n ?? 0)
}

/**
 * PRO-244: the days the matcher leaves empty — the week's "sin cocinar"
 * days plus, for a first menu (`fromDate`, the sign-up day), the days of
 * the week that already went by. Only for generation: the stored
 * `skippedDays` stay the user's own.
 */
export function generationSkips(skippedDays: Set<number>, weekStart: string, fromDate?: string | null): Set<number> {
  if (!fromDate) return skippedDays
  return new Set<number>([...skippedDays, ...pastDayIndexes(weekStart, fromDate)])
}

/**
 * PRO-349: a dish put on a «sin cocinar» day reactivates it. Every write that
 * places a dish on a day stores `skippedDays: unskipDay(menu.skippedDays, day)`
 * next to its `days`. Before, Mimo put «arroz de limpieza» on a skipped
 * Saturday: the list counted it and the day still said «Día marcado sin
 * cocinar» (Dani y Sara, 2026-10-22).
 */
export function unskipDay(skippedDays: readonly number[] | null | undefined, dayIndex: number): number[] {
  return (skippedDays ?? []).filter((d) => d !== dayIndex)
}
