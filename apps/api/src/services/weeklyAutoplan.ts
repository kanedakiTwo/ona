/**
 * Piloto automático de la semana, paso 1 (PRO-381, D-158; specs/menus.md
 * «Piloto automático»): every Thursday from 18:00 (Europe/Madrid) Mimo
 * leaves next week done for each household that
 *   - has had at least one menu,
 *   - has no menu with dishes for next week yet (made by hand → untouched),
 *   - has «La semana, hecha cada jueves» (`weekly_autoplan`) on — off if
 *     anyone in the house switched it off,
 *   - isn't on the free plan (PRO-385; until it exists, a paused account).
 *
 * The week is made by `generateAndSaveMenu`, the path of POST /menu/generate
 * (same generator, diet rules, ficha, what was cooked or changed). Once per
 * household and week: a row in `notification_schedule` claims it
 * (`autoplan:<scope>:<weekStart>`, never `pending`, so the tick never sends
 * it) and keeps what the /menu card needs (the menu, who saw it, whether the
 * household changed it). Runs in the scheduler tick, under its lock, a few
 * households per tick.
 *
 * Events: `autoplan_generated` (system, passive: it doesn't make the
 * household active), `autoplan_viewed` (the card was seen, once per person)
 * and `autoplan_changed` (a change in that week before its Monday, once per
 * household).
 */
import { and, eq, sql } from 'drizzle-orm'
import { alertKindOn, type AutoplanNotice } from '@ona/shared'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { menus, notificationSchedule } from '../db/schema.js'
import { isOnFreePlan } from './accountAccess.js'
import { addDays, madridMidnightUtc, madridParts, mondayOf } from './madridTime.js'
import { resolveScope } from './scopeResolver.js'
import { trackEvent, type UsageChannel } from './usageEvents.js'

/** Thursday (0 = Monday) from 18:00 Madrid, through Sunday (catches up a missed tick). */
export const AUTOPLAN_WEEKDAY = 3
export const AUTOPLAN_HOUR = 18
/** Households generated per scheduler tick (every 5 min); the rest wait for the next tick. */
export const AUTOPLAN_PER_TICK = 20

export function autoplanKey(scopeKey: string, weekStart: string): string {
  return `autoplan:${scopeKey}:${weekStart}`
}

/** Pure: is it time, and for which week (the Monday after)? */
export function autoplanDue(now: Date): { due: boolean; weekStart: string } {
  const p = madridParts(now)
  const weekStart = mondayOf(p.isoDate, p.weekday, 1)
  return { due: (p.weekday === AUTOPLAN_WEEKDAY && p.hour >= AUTOPLAN_HOUR) || p.weekday > AUTOPLAN_WEEKDAY, weekStart }
}

// ─── Who gets the week (pure) ──────────────────────────────────────

export interface AutoplanPerson {
  userId: string
  /** The scope this person's menus are read in: the household, or the person alone. */
  scopeKey: string
  /** Owns the household: the one the week is made for. */
  isOwner: boolean
  /** Joined the household (or signed up): the earliest stands in for an owner who isn't here. */
  since: Date | null
  /** `users.alert_prefs` and `whatsapp_links.prefs`. */
  prefs: Array<Record<string, boolean> | null | undefined>
  /** Free plan (PRO-385) or paused account: no autopilot. */
  freePlan: boolean
}

export interface AutoplanScopeWeeks {
  /** Some week before next one with dishes. */
  hadMenu: boolean
  /** Next week already has dishes (by hand, by Mimo or a previous run). */
  hasNextWeek: boolean
}

export type AutoplanSkip = 'never_had_menu' | 'week_done' | 'switched_off' | 'free_plan'

export interface AutoplanPick {
  scopeKey: string
  userId: string
}

export function pickAutoplanHouseholds(input: {
  now: Date
  people: readonly AutoplanPerson[]
  weeks: ReadonlyMap<string, AutoplanScopeWeeks>
}): { weekStart: string | null; picks: AutoplanPick[]; skipped: Record<AutoplanSkip, number> } {
  const skipped: Record<AutoplanSkip, number> = { never_had_menu: 0, week_done: 0, switched_off: 0, free_plan: 0 }
  const { due, weekStart } = autoplanDue(input.now)
  if (!due) return { weekStart: null, picks: [], skipped }

  const byScope = new Map<string, AutoplanPerson[]>()
  for (const p of input.people) byScope.set(p.scopeKey, [...(byScope.get(p.scopeKey) ?? []), p])

  const picks: AutoplanPick[] = []
  for (const [scopeKey, people] of byScope) {
    const weeks = input.weeks.get(scopeKey)
    if (!weeks?.hadMenu) {
      skipped.never_had_menu++
      continue
    }
    if (weeks.hasNextWeek) {
      skipped.week_done++
      continue
    }
    // The week is the household's: anyone who switched it off, switches it off.
    if (people.some((p) => !alertKindOn('weekly_autoplan', ...p.prefs))) {
      skipped.switched_off++
      continue
    }
    const who =
      people.find((p) => p.isOwner) ??
      [...people].sort((a, b) => (a.since?.getTime() ?? Infinity) - (b.since?.getTime() ?? Infinity))[0]
    if (who.freePlan) {
      skipped.free_plan++
      continue
    }
    picks.push({ scopeKey, userId: who.userId })
  }
  return { weekStart, picks, skipped }
}

// ─── The run (in the scheduler tick) ───────────────────────────────

export interface AutoplanDeps {
  load: (weekStart: string, now: Date) => Promise<{ people: AutoplanPerson[]; weeks: Map<string, AutoplanScopeWeeks> }>
  /** Claims the household's week; null when it was already claimed (once per household and week). */
  claim: (pick: AutoplanPick, weekStart: string, now: Date) => Promise<string | null>
  /** Right before generating: the week still has no dishes. */
  stillOpen: (userId: string, weekStart: string) => Promise<boolean>
  generate: (userId: string, weekStart: string) => Promise<{ menuId: string }>
  finish: (claimId: string, outcome: { menuId: string } | { skipped: string } | { error: string }) => Promise<void>
  track: (pick: AutoplanPick, weekStart: string) => void
}

export interface AutoplanRunResult {
  weekStart: string
  generated: number
  failed: number
  skipped: Record<AutoplanSkip | 'claimed' | 'made_meanwhile', number>
}

/** Between full passes (unless the last one stopped at `AUTOPLAN_PER_TICK`). */
export const AUTOPLAN_PASS_EVERY_MS = 30 * 60_000
let lastPass: { weekStart: string; at: number; more: boolean } | null = null

export async function runWeeklyAutoplanIfDue(now: Date = new Date(), deps: AutoplanDeps = defaultAutoplanDeps): Promise<AutoplanRunResult | null> {
  const { due, weekStart } = autoplanDue(now)
  if (!due) return null
  if (deps === defaultAutoplanDeps && lastPass?.weekStart === weekStart && !lastPass.more && now.getTime() - lastPass.at < AUTOPLAN_PASS_EVERY_MS) return null
  const { people, weeks } = await deps.load(weekStart, now)
  const plan = pickAutoplanHouseholds({ now, people, weeks })
  const result: AutoplanRunResult = { weekStart, generated: 0, failed: 0, skipped: { ...plan.skipped, claimed: 0, made_meanwhile: 0 } }
  let more = false
  for (const pick of plan.picks) {
    if (result.generated + result.failed >= AUTOPLAN_PER_TICK) {
      more = true
      break
    }
    const claimId = await deps.claim(pick, weekStart, now)
    if (!claimId) {
      result.skipped.claimed++
      continue
    }
    try {
      // The household may have made it between the read and now: never on top.
      if (!(await deps.stillOpen(pick.userId, weekStart))) {
        result.skipped.made_meanwhile++
        await deps.finish(claimId, { skipped: 'hecha a mano' })
        continue
      }
      const { menuId } = await deps.generate(pick.userId, weekStart)
      await deps.finish(claimId, { menuId })
      deps.track(pick, weekStart)
      result.generated++
    } catch (err: any) {
      result.failed++
      console.error(`[autoplan] ${pick.scopeKey} ${weekStart} failed:`, err)
      await deps.finish(claimId, { error: String(err?.message ?? err).slice(0, 200) }).catch(() => {})
    }
  }
  lastPass = { weekStart, at: now.getTime(), more }
  return result
}

// ─── DB ────────────────────────────────────────────────────────────

/** SQL: the menu row `m` holds at least one dish. */
const MENU_HAS_DISHES = sql`EXISTS (
  SELECT 1
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.days) = 'array' THEN m.days ELSE '[]'::jsonb END) AS d(day),
         jsonb_each(CASE WHEN jsonb_typeof(d.day) = 'object' THEN d.day ELSE '{}'::jsonb END) AS s(meal, slot)
   WHERE jsonb_typeof(s.slot -> 'dishes') = 'array' AND jsonb_array_length(s.slot -> 'dishes') > 0
)`

/** The scope a menu row or a person is read in (the same rule as `resolveScope`). */
function scopeKeyOf(userId: string, householdId: string | null): string {
  return env.SHARED_HOUSEHOLD_SCOPE && householdId ? householdId : userId
}

async function loadFromDb(weekStart: string, now: Date): Promise<{ people: AutoplanPerson[]; weeks: Map<string, AutoplanScopeWeeks> }> {
  const menuRows: any = await db.execute(sql`
    SELECT m.user_id::text AS user_id, m.household_id::text AS household_id,
           bool_or(m.week_start < ${weekStart}::date) AS had_before,
           bool_or(m.week_start = ${weekStart}::date) AS has_next
      FROM menus m
     WHERE ${MENU_HAS_DISHES}
     GROUP BY m.user_id, m.household_id
  `)
  const weeks = new Map<string, AutoplanScopeWeeks>()
  for (const r of (menuRows.rows ?? menuRows) as any[]) {
    const key = scopeKeyOf(r.user_id, r.household_id)
    const w = weeks.get(key) ?? { hadMenu: false, hasNextWeek: false }
    weeks.set(key, { hadMenu: w.hadMenu || Boolean(r.had_before), hasNextWeek: w.hasNextWeek || Boolean(r.has_next) })
  }

  const peopleRows: any = await db.execute(sql`
    SELECT u.id::text AS user_id, u.primary_household_id::text AS household_id,
           (h.owner_id = u.id) AS is_owner, COALESCE(hm.joined_at, u.created_at) AS since,
           u.alert_prefs, wl.prefs AS wa_prefs
      FROM users u
      LEFT JOIN households h ON h.id = u.primary_household_id
      LEFT JOIN household_members hm ON hm.household_id = u.primary_household_id AND hm.user_id = u.id
      LEFT JOIN whatsapp_links wl ON wl.user_id = u.id
     WHERE u.suspended_at IS NULL
  `)
  const people: AutoplanPerson[] = []
  for (const r of (peopleRows.rows ?? peopleRows) as any[]) {
    const scopeKey = scopeKeyOf(r.user_id, r.household_id)
    if (!weeks.get(scopeKey)?.hadMenu) continue
    people.push({
      userId: r.user_id,
      scopeKey,
      isOwner: Boolean(r.is_owner),
      since: r.since ? new Date(r.since) : null,
      prefs: [r.alert_prefs, r.wa_prefs],
      freePlan: await isOnFreePlan(r.user_id, now),
    })
  }
  return { people, weeks }
}

async function claimInDb(pick: AutoplanPick, weekStart: string, now: Date): Promise<string | null> {
  const rows = await db
    .insert(notificationSchedule)
    .values({
      userId: pick.userId,
      dedupKey: autoplanKey(pick.scopeKey, weekStart),
      fireAt: now,
      payload: { title: 'La semana, hecha', body: `Semana del ${weekStart}`, url: `/menu?week=${weekStart}`, tag: 'weekly_autoplan' },
      // Never `pending`: the tick must not send it.
      status: 'sent',
      sentAt: now,
    })
    .onConflictDoNothing({ target: notificationSchedule.dedupKey })
    .returning({ id: notificationSchedule.id })
  return rows[0]?.id ?? null
}

async function stillOpenInDb(userId: string, weekStart: string): Promise<boolean> {
  const scope = await resolveScope(userId)
  const owner = scope.kind === 'household' ? sql`m.household_id = ${scope.value}::uuid` : sql`m.user_id = ${scope.value}::uuid`
  const res: any = await db.execute(sql`SELECT 1 FROM menus m WHERE ${owner} AND m.week_start = ${weekStart}::date AND ${MENU_HAS_DISHES} LIMIT 1`)
  return ((res.rows ?? res) as unknown[]).length === 0
}

async function finishInDb(claimId: string, outcome: { menuId: string } | { skipped: string } | { error: string }): Promise<void> {
  if ('menuId' in outcome) {
    await db
      .update(notificationSchedule)
      .set({ payload: sql`${notificationSchedule.payload} || ${JSON.stringify({ menuId: outcome.menuId, viewedBy: [] })}::jsonb` })
      .where(eq(notificationSchedule.id, claimId))
  } else if ('skipped' in outcome) {
    await db.update(notificationSchedule).set({ status: 'cancelled', errorMessage: outcome.skipped }).where(eq(notificationSchedule.id, claimId))
  } else {
    await db.update(notificationSchedule).set({ status: 'failed', errorMessage: outcome.error }).where(eq(notificationSchedule.id, claimId))
  }
}

export const defaultAutoplanDeps: AutoplanDeps = {
  load: loadFromDb,
  claim: claimInDb,
  stillOpen: stillOpenInDb,
  async generate(userId, weekStart) {
    // Lazy: menuGenerate → notificationScheduler → this module would be a cycle at load.
    const { generateAndSaveMenu } = await import('./menuGenerate.js')
    const { menu } = await generateAndSaveMenu({ userId, weekStart })
    return { menuId: menu.id }
  },
  finish: finishInDb,
  track(pick, weekStart) {
    trackEvent('autoplan_generated', { userId: pick.userId, props: { week: weekStart } })
  },
}

// ─── The /menu card and the events ─────────────────────────────────

interface AutoplanRow {
  id: string
  userId: string
  payload: { menuId?: string; viewedBy?: string[]; changed?: boolean } & Record<string, unknown>
}

async function loadAutoplanRow(scopeKey: string, weekStart: string): Promise<AutoplanRow | null> {
  const [row] = await db
    .select({ id: notificationSchedule.id, userId: notificationSchedule.userId, payload: notificationSchedule.payload, status: notificationSchedule.status })
    .from(notificationSchedule)
    .where(eq(notificationSchedule.dedupKey, autoplanKey(scopeKey, weekStart)))
    .limit(1)
  if (!row || row.status !== 'sent') return null
  return { id: row.id, userId: row.userId, payload: row.payload as AutoplanRow['payload'] }
}

/** The week's newest menu id (what the household sees), or null. */
async function newestMenuId(userId: string, weekStart: string): Promise<string | null> {
  const scope = await resolveScope(userId)
  const owner = scope.kind === 'household' ? eq(menus.householdId, scope.value) : eq(menus.userId, scope.value)
  const [row] = await db
    .select({ id: menus.id })
    .from(menus)
    .where(and(owner, eq(menus.weekStart, weekStart)))
    .orderBy(sql`${menus.createdAt} DESC`)
    .limit(1)
  return row?.id ?? null
}

/** Pure: the card is shown until the week starts its Tuesday (Madrid) — «tras el lunes», gone. */
export function autoplanCardLive(weekStart: string, now: Date): boolean {
  return now.getTime() < madridMidnightUtc(addDays(weekStart, 1)).getTime()
}

/** Pure: a change counts for `autoplan_changed` only before the week's Monday. */
export function autoplanChangeCounts(weekStart: string, now: Date): boolean {
  return now.getTime() < madridMidnightUtc(weekStart).getTime()
}

/**
 * GET /menu/autoplan: the card for this person, or null. It shows while the
 * week Mimo made is still the one the household sees, this person hasn't
 * opened it yet and it's not past its Monday.
 */
export async function autoplanNoticeFor(userId: string, now: Date = new Date()): Promise<AutoplanNotice | null> {
  // The card is about the week Mimo is making: the next one, or (on Monday) this one.
  const p = madridParts(now)
  const candidates = [mondayOf(p.isoDate, p.weekday, 1), mondayOf(p.isoDate, p.weekday, 0)]
  const scope = await resolveScope(userId)
  for (const weekStart of candidates) {
    if (!autoplanCardLive(weekStart, now)) continue
    const row = await loadAutoplanRow(scope.value, weekStart)
    if (!row?.payload.menuId) continue
    if ((row.payload.viewedBy ?? []).includes(userId)) continue
    if ((await newestMenuId(userId, weekStart)) !== row.payload.menuId) continue
    return { weekStart, weekEnd: addDays(weekStart, 6) }
  }
  return null
}

/** POST /menu/autoplan/viewed: this person opened the week; the card goes and `autoplan_viewed` is recorded once. */
export async function markAutoplanViewed(userId: string, weekStart: string): Promise<boolean> {
  const scope = await resolveScope(userId)
  const row = await loadAutoplanRow(scope.value, weekStart)
  if (!row?.payload.menuId || (row.payload.viewedBy ?? []).includes(userId)) return false
  const viewedBy = [...(row.payload.viewedBy ?? []), userId]
  await db
    .update(notificationSchedule)
    .set({ payload: sql`${notificationSchedule.payload} || ${JSON.stringify({ viewedBy })}::jsonb` })
    .where(eq(notificationSchedule.id, row.id))
  trackEvent('autoplan_viewed', { userId, channel: 'web', props: { week: weekStart } })
  return true
}

/**
 * A change in a week Mimo made (a dish swapped, added, removed, the week
 * redone…), from the app or from Mimo: `autoplan_changed`, once per
 * household and week, only before its Monday. Never throws, never blocks.
 */
export function noteAutoplanChange(userId: string | null | undefined, weekStart: string, channel: UsageChannel, now: Date = new Date()): void {
  if (!userId || !autoplanChangeCounts(weekStart, now) || process.env.VITEST) return
  ;(async () => {
    const scope = await resolveScope(userId)
    const row = await loadAutoplanRow(scope.value, weekStart)
    if (!row?.payload.menuId || row.payload.changed) return
    await db
      .update(notificationSchedule)
      .set({ payload: sql`${notificationSchedule.payload} || '{"changed": true}'::jsonb` })
      .where(eq(notificationSchedule.id, row.id))
    trackEvent('autoplan_changed', { userId, channel, props: { week: weekStart } })
  })().catch((err) => console.warn('[autoplan] change note failed (ignored):', err?.message ?? err))
}

/** Same, from a menu id (routes that change one menu: services/menuEdits.ts). */
export function noteAutoplanChangeForMenu(menuId: string, userId: string | null | undefined, channel: UsageChannel, now: Date = new Date()): void {
  if (!userId || process.env.VITEST) return
  ;(async () => {
    const [m] = await db.select({ weekStart: menus.weekStart }).from(menus).where(eq(menus.id, menuId)).limit(1)
    if (m?.weekStart) noteAutoplanChange(userId, String(m.weekStart), channel, now)
  })().catch((err) => console.warn('[autoplan] change note failed (ignored):', err?.message ?? err))
}
