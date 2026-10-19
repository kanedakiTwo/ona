/**
 * DB side of the weekly aviso budget (PRO-215, `budget.ts` has the rules).
 *
 *   const key = await budgetKeyFor(userId)
 *   const plan = planMoment(candidates, await loadBudgetState(key, now))
 *   … send plan.send as one message …
 *   await recordNotices({ budgetKey: key, userId, entries: logEntriesFor(plan, delivery), channel, now })
 *
 * `now` is the scheduler tick's instant: everything a tick sends to a
 * household is one moment and spends at most one unit.
 */
import { and, desc, eq, gt, inArray, lt, or, sql } from 'drizzle-orm'
import type { DayMenu } from '@ona/shared'
import { db } from '../../db/connection.js'
import { menus, noticeCandidates, notificationSchedule, recipes, userMemories, users, whatsappLinks } from '../../db/schema.js'
import { addDays, madridMidnightUtc, madridWallTimeUtc, madridWeekStart } from '../madridTime.js'
import { resolveScope, scopeWhere } from '../scopeResolver.js'
import {
  WEEKLY_NOTICE_BUDGET,
  upcomingMoments,
  type BudgetState,
  type NoticeLogEntry,
} from './budget.js'

/** The household the budget belongs to (primary), or the user without one. */
export async function budgetKeyFor(userId: string): Promise<string> {
  const [row] = await db.select({ h: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
  return row?.h ?? userId
}

/** Users that share the budget key: the household's members (by primary household), or the user. */
async function usersOfKey(budgetKey: string): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.primaryHouseholdId, budgetKey), eq(users.id, budgetKey)))
  return rows.map((r) => r.id)
}

/** Pure: the cooking-reminder instants of the rest of the week (dinners of ≥ 40 min). */
export function cookingReminderTimes(
  weekStart: string,
  dinnerMinutesByDay: ReadonlyArray<number | null>,
  dinnerTime: string | null,
): Date[] {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(dinnerTime ?? '')
  const dinner = m ? Number(m[1]) * 60 + Number(m[2]) : 21 * 60
  const out: Date[] = []
  dinnerMinutesByDay.forEach((total, i) => {
    if (!total || total < 40) return
    const start = Math.max(0, dinner - total - 10)
    out.push(madridWallTimeUtc(addDays(weekStart, i), Math.floor(start / 60), start % 60))
  })
  return out
}

/** Priority-1 moments still to come this week for the household (the reserve). */
export async function reservedP1For(budgetKey: string, now: Date): Promise<number> {
  const weekStart = madridWeekStart(now)
  const weekEnd = madridMidnightUtc(addDays(weekStart, 7))
  const members = await usersOfKey(budgetKey)
  if (members.length === 0) return 0
  const prep = await db
    .select({ fireAt: notificationSchedule.fireAt })
    .from(notificationSchedule)
    .where(
      and(
        inArray(notificationSchedule.userId, members),
        eq(notificationSchedule.status, 'pending'),
        gt(notificationSchedule.fireAt, now),
        lt(notificationSchedule.fireAt, weekEnd),
      ),
    )
  const times: Date[] = prep.map((r) => r.fireAt)

  // Cooking reminders: only when someone in the house gets them by WhatsApp.
  const links = await db
    .select({ userId: whatsappLinks.userId, notify: whatsappLinks.notify, prefs: whatsappLinks.prefs })
    .from(whatsappLinks)
    .where(inArray(whatsappLinks.userId, members))
  const reminded = links.find((l) => l.notify && l.prefs?.cooking_reminder !== false)
  if (reminded) {
    const [menu] = await db
      .select({ days: menus.days })
      .from(menus)
      .where(and(scopeWhere(menus.userId, menus.householdId, await resolveScope(reminded.userId)), eq(menus.weekStart, weekStart)))
      .orderBy(desc(menus.createdAt))
      .limit(1)
    const days = (menu?.days as DayMenu[] | undefined) ?? []
    const idsByDay = days.map((d) =>
      ((d?.dinner?.dishes ?? []) as Array<{ kind: string; recipeId?: string }>)
        .filter((x) => x.kind === 'recipe' && x.recipeId)
        .map((x) => x.recipeId!),
    )
    const ids = [...new Set(idsByDay.flat())]
    if (ids.length) {
      const rows = await db
        .select({ id: recipes.id, totalTime: recipes.totalTime, prepTime: recipes.prepTime, cookTime: recipes.cookTime })
        .from(recipes)
        .where(inArray(recipes.id, ids))
      const minutes = new Map(rows.map((r) => [r.id, r.totalTime ?? ((r.prepTime ?? 0) + (r.cookTime ?? 0) || null)]))
      const perDay = idsByDay.map((dayIds) => {
        const ms = dayIds.map((id) => minutes.get(id)).filter((x): x is number => typeof x === 'number' && x > 0)
        return ms.length ? Math.max(...ms) : null
      })
      const [mt] = await db
        .select({ value: userMemories.value })
        .from(userMemories)
        .where(and(eq(userMemories.userId, reminded.userId), eq(userMemories.key, 'meal_times')))
        .limit(1)
      const dinnerTime = (mt?.value as { dinner?: unknown } | undefined)?.dinner
      times.push(...cookingReminderTimes(weekStart, perDay, typeof dinnerTime === 'string' ? dinnerTime : null))
    }
  }
  return upcomingMoments(times, now, weekEnd)
}

/**
 * The household's budget this week. `reserve` is only computed when the
 * caller needs it (a moment with no priority-1 aviso), via `withReserve`.
 */
export async function loadBudgetState(budgetKey: string, now: Date): Promise<Omit<BudgetState, 'reservedP1'>> {
  const week = madridWeekStart(now)
  const rows = await db
    .select({ momentAt: noticeCandidates.momentAt })
    .from(noticeCandidates)
    .where(and(eq(noticeCandidates.budgetKey, budgetKey), eq(noticeCandidates.week, week), eq(noticeCandidates.counted, true)))
  const moments = new Set(rows.map((r) => r.momentAt.getTime()))
  return { budget: WEEKLY_NOTICE_BUDGET, used: moments.size, momentAlreadyCounted: moments.has(now.getTime()) }
}

/** `loadBudgetState` + the priority-1 reserve. */
export async function loadFullBudgetState(budgetKey: string, now: Date, needReserve: boolean): Promise<BudgetState> {
  const base = await loadBudgetState(budgetKey, now)
  const reservedP1 = needReserve && !base.momentAlreadyCounted ? await reservedP1For(budgetKey, now) : 0
  return { ...base, reservedP1 }
}

/** Log the moment's candidates (PRO-216 reads them). Never throws. */
export async function recordNotices(row: {
  budgetKey: string
  userId: string
  entries: readonly NoticeLogEntry[]
  channel: 'whatsapp' | 'push' | 'both' | null
  now: Date
}): Promise<void> {
  if (row.entries.length === 0) return
  const week = madridWeekStart(row.now)
  try {
    await db.insert(noticeCandidates).values(
      row.entries.map((e) => ({
        budgetKey: row.budgetKey,
        userId: row.userId,
        kind: e.kind,
        priority: e.priority,
        outcome: e.outcome,
        counted: e.counted,
        channel: row.channel,
        week,
        momentAt: row.now,
      })),
    )
  } catch (err: any) {
    console.error('[notices] could not log candidates:', err?.message ?? err)
  }
}

/** Kinds logged for this user since `since` (any outcome), with their latest time: the cooldown also covers merged and dropped avisos. */
export async function recentNoticeKinds(userId: string, since: Date): Promise<Map<string, Date>> {
  const rows = await db
    .select({ kind: noticeCandidates.kind, at: sql<Date>`max(${noticeCandidates.createdAt})` })
    .from(noticeCandidates)
    .where(and(eq(noticeCandidates.userId, userId), gt(noticeCandidates.createdAt, since)))
    .groupBy(noticeCandidates.kind)
  return new Map(rows.map((r) => [r.kind, new Date(r.at)]))
}

