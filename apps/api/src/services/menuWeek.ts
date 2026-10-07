import { and, desc, eq } from 'drizzle-orm'
import type { DayMenu, LockedSlots } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { menus } from '../db/schema.js'
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
