/**
 * The «Avisos» switches (PRO-237, D-080; specs/notifications.md «Avisos»).
 *
 * One switch per kind in `users.alert_prefs`, mirrored into
 * `whatsapp_links.prefs` when the person has WhatsApp linked, so the old
 * readers (the proactive planner, `PATCH /whatsapp/link`) keep agreeing.
 * A kind is on unless either store says off.
 */
import { and, eq, sql } from 'drizzle-orm'
import { buildAlertRows, resolveAlertTimes, type AlertKind, type AlertsOverview, type AlertTimeKind } from '@ona/shared'
import { db } from '../../db/connection.js'
import { households, pushSubscriptions, userMemories, users } from '../../db/schema.js'
import * as store from '../whatsapp/store.js'

export async function loadUserAlertPrefs(userId: string): Promise<Record<string, boolean>> {
  const [row] = await db.select({ prefs: users.alertPrefs }).from(users).where(eq(users.id, userId)).limit(1)
  return (row?.prefs as Record<string, boolean> | undefined) ?? {}
}

/** Both stores in one: a kind is off if either says off (for the proactive planner). */
export function mergeAlertPrefs(...prefs: Array<Record<string, boolean> | null | undefined>): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const p of prefs) for (const [k, v] of Object.entries(p ?? {})) out[k] = out[k] === false ? false : v
  return out
}

/**
 * PRO-1301: the times the user's primary household chose for the morning
 * menu and the dinner question (null = the default).
 */
export async function loadHouseholdAlertTimes(userId: string): Promise<Record<AlertTimeKind, string | null>> {
  const [row] = await db
    .select({ daily_brief: households.dailyBriefTime, dinner_checkin: households.dinnerCheckinTime })
    .from(users)
    .innerJoin(households, eq(households.id, users.primaryHouseholdId))
    .where(eq(users.id, userId))
    .limit(1)
  return { daily_brief: row?.daily_brief ?? null, dinner_checkin: row?.dinner_checkin ?? null }
}

/** Save (or with null, go back to the default) one household time. False when the user has no household. */
export async function setHouseholdAlertTime(userId: string, kind: AlertTimeKind, time: string | null): Promise<boolean> {
  const [u] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
  if (!u?.householdId) return false
  const col = kind === 'daily_brief' ? { dailyBriefTime: time } : { dinnerCheckinTime: time }
  await db.update(households).set(col).where(eq(households.id, u.householdId))
  return true
}

async function loadMealTimesMemory(userId: string): Promise<{ breakfast: string | null; dinner: string | null }> {
  const [row] = await db
    .select({ value: userMemories.value })
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.key, 'meal_times')))
    .limit(1)
  const v = row?.value as { breakfast?: unknown; dinner?: unknown } | undefined
  return { breakfast: typeof v?.breakfast === 'string' ? v.breakfast : null, dinner: typeof v?.dinner === 'string' ? v.dinner : null }
}

export async function loadAlertsOverview(userId: string): Promise<AlertsOverview> {
  const [userPrefs, link, pushRows, saved, meals] = await Promise.all([
    loadUserAlertPrefs(userId),
    store.getLinkByUser(userId),
    db.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)),
    loadHouseholdAlertTimes(userId),
    loadMealTimesMemory(userId),
  ])
  const whatsapp = { linked: Boolean(link), notify: Boolean(link?.notify && !link?.suspendedAt) }
  const pushSubscribed = (pushRows[0]?.n ?? 0) > 0
  return {
    whatsapp,
    push: { subscribed: pushSubscribed },
    kinds: buildAlertRows({ userPrefs, whatsapp: { ...whatsapp, prefs: link?.prefs ?? null }, pushSubscribed }),
    times: resolveAlertTimes({ saved, ...meals }),
  }
}

/**
 * Change some switches. Turning a kind on with WhatsApp linked also turns on
 * the master «Avisos por WhatsApp» (as the chat always did).
 */
export async function setAlertPrefs(userId: string, patch: Partial<Record<AlertKind, boolean>>): Promise<AlertsOverview> {
  const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>
  if (Object.keys(clean).length > 0) {
    const current = await loadUserAlertPrefs(userId)
    await db.update(users).set({ alertPrefs: { ...current, ...clean } }).where(eq(users.id, userId))
    const link = await store.getLinkByUser(userId)
    if (link) {
      await store.setPrefs(userId, clean)
      if (Object.values(clean).some(Boolean) && !link.notify) await store.setNotify(userId, true)
    }
  }
  return loadAlertsOverview(userId)
}
