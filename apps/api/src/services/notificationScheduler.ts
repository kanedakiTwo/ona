/**
 * Notification scheduler — the heartbeat that turns "ingredient X
 * needs prep Y" into "fire a push 24h before the recipe lands in
 * the user's slot".
 *
 * Two pieces:
 *
 *   - `enqueuePrepAlertsForMenu(menuId)` — walks a menu, crosses every
 *     slot's recipe ingredients with their `prep_requirements`, filters
 *     by the user's `user_memories.prep_habits` (opt-in: alert fires
 *     only when the user has a habit keyword that matches the method),
 *     and INSERTs schedule rows. Idempotent via the `dedup_key` unique
 *     constraint — re-running after a swap_meal is safe.
 *
 *   - `tickScheduler()` — periodic poll (every 5 min) that picks up any
 *     `pending` row whose `fire_at` has elapsed, dispatches via
 *     `sendPushToUser`, and marks it sent / failed.
 *
 * The tick also sends the waitlist invitation reminder (PRO-97,
 * `sendWaitlistInviteRemindersIfDue`, once an hour).
 *
 * The interval kicks off at API boot from `index.ts` via `startScheduler`.
 * In dev it logs once per tick so we can see it's alive.
 */

import { and, desc, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { db, pool } from '../db/connection.js'
import { addDays, madridWallTimeUtc } from './madridTime.js'
import {
  menus,
  recipes,
  recipeIngredients,
  ingredients,
  notificationSchedule,
  userMemories,
} from '../db/schema.js'
import {
  PREP_METHOD_HOURS_BEFORE,
  type PrepMethod,
  type Meal,
} from '@ona/shared'
import {
  sendPushToUser,
  PushNotConfiguredError,
} from './pushNotifier.js'
import { deliverAlertOverWhatsApp, runProactiveTick } from './whatsapp/outbound.js'
import { runDailyReviewIfDue } from './whatsapp/reviewer.js'
import { runProfileRefinerIfDue } from './profile/refiner.js'
import { recordPendingReferralRewardsIfDue } from './referralRewards.js'
import { purgeOldUsageEventsIfDue } from './usageEvents.js'
import { CHAT_RETENTION_DAYS, purgeOldChatMessagesIfDue } from './chatMessages.js'
import { sendWaitlistInviteRemindersIfDue } from './waitlistInvites.js'
import { WAITLIST_RETENTION_DATE, purgeWaitlistPersonalDataIfDue } from './waitlistRetention.js'
import { isAccountPaused } from './accountAccess.js'
import { sendTrialEndingEmailsIfDue } from './trialEmails.js'
import { sendFounderOffersIfDue } from './founderOffer.js'
import { sendChargeNoticesIfDue } from './chargeNotice.js'
import { combineDelivery, type ChannelOutcome } from './whatsapp/proactive.js'

// ─── Habit → method matcher ─────────────────────────────────────
//
// Opt-in policy: a prep alert ONLY fires when the user's prep_habits
// contains a keyword that triggers the corresponding method. Without
// any habit, the scheduler stays silent — we don't pester users about
// defrosting boquerones if they buy them fresh.
//
// Adding a habit is a 1-line change here. The system prompt for
// `update_memory` already nudges the model to write to prep_habits
// when it picks up phrases like "siempre congelo el pescado".
const HABIT_KEYWORDS_BY_METHOD: Record<PrepMethod, RegExp> = {
  thaw_24h: /congel|descongel/i,
  thaw_48h: /congel|descongel/i,
  soak_overnight: /remoj|noche antes/i,
  soak_30min: /remoj/i,
  temper_30min: /tempero|atempero|fuera\s+de\s+la\s+nevera/i,
  marinate_2h: /marino|marinad/i,
  marinate_overnight: /marino|marinad/i,
  dough_rise_overnight: /masa|levado|fermenta/i,
}

function habitMatches(method: PrepMethod, habits: readonly string[]): boolean {
  const re = HABIT_KEYWORDS_BY_METHOD[method]
  return habits.some((h) => re.test(h))
}

// ─── Cook-time resolver ─────────────────────────────────────────
//
// Spanish defaults until / unless the user has set meal_times in their
// memory. The scheduler is HOUR-resolution — minute precision adds
// complexity for negligible UX value at this stage.
const DEFAULT_MEAL_HOUR: Record<Meal, number> = {
  breakfast: 9,
  lunch: 14,
  snack: 17,
  dinner: 21,
}

/**
 * When the user sits down to `meal` on day `dayIndex` of the week starting
 * `weekStart` (YYYY-MM-DD), as a UTC instant. Meal times are Spanish wall
 * clock; the server runs in UTC, so this used to fire alerts 1–2 h late.
 */
export function resolveCookAt(
  weekStart: string,
  dayIndex: number,
  meal: Meal,
  mealTimes: Partial<Record<Meal, string>>,
): Date {
  const isoDate = addDays(weekStart.slice(0, 10), dayIndex)
  const t = mealTimes[meal]
  if (t && /^[0-2]\d:\d\d$/.test(t)) {
    const [h, m] = t.split(':').map(Number)
    return madridWallTimeUtc(isoDate, h, m)
  }
  return madridWallTimeUtc(isoDate, DEFAULT_MEAL_HOUR[meal], 0)
}

// ─── Enqueue prep alerts for a whole menu ──────────────────────

interface SlotEntry {
  dayIndex: number
  meal: Meal
  recipeId: string
}

function flattenMenuSlots(days: unknown): SlotEntry[] {
  if (!Array.isArray(days)) return []
  const out: SlotEntry[] = []
  for (let i = 0; i < days.length; i += 1) {
    const day = days[i] as Record<string, unknown> | undefined
    if (!day) continue
    for (const [meal, slot] of Object.entries(day)) {
      if (!slot || typeof slot !== 'object') continue
      const s = slot as { dishes?: unknown[] }
      if (!Array.isArray(s.dishes)) continue
      for (const dish of s.dishes) {
        if (!dish || typeof dish !== 'object') continue
        const d = dish as { kind?: string; recipeId?: string; variant?: string }
        if (d.kind !== 'recipe') continue
        // Skip leftover dishes — they share the source's prep alerts.
        // …and freezer tápers (PRO-82): nothing to prepare.
        if (d.variant === 'leftover' || d.variant === 'freezer') continue
        if (typeof d.recipeId === 'string' && d.recipeId.length > 0) {
          out.push({ dayIndex: i, meal: meal as Meal, recipeId: d.recipeId })
        }
      }
    }
  }
  return out
}

interface PrepIngredient {
  recipeId: string
  ingredientId: string
  ingredientName: string
  prepRequirements: { method: PrepMethod; notes?: string } | null
}

async function loadPrepIngredientsForRecipes(
  recipeIds: string[],
): Promise<PrepIngredient[]> {
  if (recipeIds.length === 0) return []
  const rows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      ingredientName: ingredients.name,
      prepRequirements: ingredients.prepRequirements,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(
      and(
        inArray(recipeIngredients.recipeId, recipeIds),
        isNotNull(ingredients.prepRequirements),
      ),
    )
  return rows as PrepIngredient[]
}

async function loadUserHabits(userId: string): Promise<{
  habits: readonly string[]
  mealTimes: Partial<Record<Meal, string>>
}> {
  const rows = await db
    .select({ key: userMemories.key, value: userMemories.value })
    .from(userMemories)
    .where(eq(userMemories.userId, userId))
  let habits: readonly string[] = []
  let mealTimes: Partial<Record<Meal, string>> = {}
  for (const r of rows) {
    if (r.key === 'prep_habits' && Array.isArray(r.value)) {
      habits = (r.value as unknown[]).filter((x): x is string => typeof x === 'string')
    } else if (r.key === 'meal_times' && r.value && typeof r.value === 'object') {
      mealTimes = r.value as Partial<Record<Meal, string>>
    }
  }
  return { habits, mealTimes }
}

export interface EnqueueResult {
  inserted: number
  skipped: number
}

export async function enqueuePrepAlertsForMenu(
  menuId: string,
): Promise<EnqueueResult> {
  const [menu] = await db.select().from(menus).where(eq(menus.id, menuId)).limit(1)
  if (!menu) return { inserted: 0, skipped: 0 }

  const { habits, mealTimes } = await loadUserHabits(menu.userId)
  if (habits.length === 0) {
    // No opt-in habits → nothing to enqueue. The user can grow into
    // the feature by telling the assistant about their habits later.
    return { inserted: 0, skipped: 0 }
  }

  const slots = flattenMenuSlots(menu.days)
  const recipeIds = Array.from(new Set(slots.map((s) => s.recipeId)))
  const prepIngs = await loadPrepIngredientsForRecipes(recipeIds)

  // Build a recipeId → list of prep-bearing ingredients.
  const byRecipe = new Map<string, PrepIngredient[]>()
  for (const p of prepIngs) {
    if (!p.prepRequirements) continue
    const list = byRecipe.get(p.recipeId) ?? []
    list.push(p)
    byRecipe.set(p.recipeId, list)
  }

  const now = new Date()
  const weekStart = String(menu.weekStart)

  let inserted = 0
  let skipped = 0

  for (const slot of slots) {
    const ings = byRecipe.get(slot.recipeId) ?? []
    if (ings.length === 0) continue

    const cookAt = resolveCookAt(weekStart, slot.dayIndex, slot.meal, mealTimes)

    for (const ing of ings) {
      const req = ing.prepRequirements!
      if (!habitMatches(req.method, habits)) {
        skipped += 1
        continue
      }
      const hoursBefore = PREP_METHOD_HOURS_BEFORE[req.method]
      const fireAt = new Date(cookAt.getTime() - hoursBefore * 60 * 60 * 1000)
      if (fireAt <= now) {
        skipped += 1
        continue
      }

      const dedupKey = `menu:${menuId}:day:${slot.dayIndex}:meal:${slot.meal}:ing:${ing.ingredientId}:method:${req.method}`
      const title = `Acuérdate: ${ing.ingredientName}`
      const body =
        req.notes ??
        `${describeMethod(req.method)} para la cena del día ${slot.dayIndex + 1}.`

      try {
        await db.insert(notificationSchedule).values({
          userId: menu.userId,
          dedupKey,
          fireAt,
          payload: {
            title,
            body,
            url: `/menu?day=${slot.dayIndex}`,
            tag: dedupKey,
          },
          status: 'pending',
        })
        inserted += 1
      } catch (err: any) {
        // 23505 = unique_violation on dedupKey. Idempotency by design.
        if (err?.code !== '23505') throw err
        skipped += 1
      }
    }
  }

  return { inserted, skipped }
}

function describeMethod(method: PrepMethod): string {
  switch (method) {
    case 'thaw_24h':
      return 'Sácalo del congelador 24 h antes'
    case 'thaw_48h':
      return 'Sácalo del congelador 48 h antes'
    case 'soak_overnight':
      return 'Déjalo en remojo toda la noche'
    case 'soak_30min':
      return 'Déjalo en remojo 30 minutos antes'
    case 'temper_30min':
      return 'Sácalo de la nevera 30 min antes'
    case 'marinate_2h':
      return 'Empieza a marinarlo unas 2 h antes'
    case 'marinate_overnight':
      return 'Déjalo marinando toda la noche'
    case 'dough_rise_overnight':
      return 'Empieza la masa la noche antes'
    default:
      return 'Prepara con antelación'
  }
}

/** Idempotent: wipes pending alerts for a menu so the caller can re-enqueue
 *  cleanly after the menu was changed (e.g. swap_meal). Already-sent rows
 *  are kept for audit.
 */
export async function clearPendingForMenu(menuId: string): Promise<number> {
  const r = await db
    .delete(notificationSchedule)
    .where(
      and(
        eq(notificationSchedule.status, 'pending'),
        sql`${notificationSchedule.payload}->>'tag' LIKE ${`menu:${menuId}:%`}`,
      ),
    )
    .returning({ id: notificationSchedule.id })
  return r.length
}

// ─── Is a prep alert still true? ────────────────────────────────
//
// Alerts are written when a menu is generated, but the menu keeps changing:
// the week gets regenerated (a new menu row), a day is marked "sin cocinar",
// a dish is moved, noted or swapped through the assistant's REST paths. Only
// the legacy swap route re-enqueued, so on 2026-10-10/11 Miguel got "sácalo
// a la nevera: atún / costillas" for dishes no longer in his menu. Rather than
// chasing every mutation path, each prep alert is checked against the menu as
// it is right before it goes out, and cancelled when it no longer applies.

export interface PrepKey {
  menuId: string
  dayIndex: number
  meal: string
  ingredientId: string
}

/** `menu:<menuId>:day:<n>:meal:<m>:ing:<ingredientId>:method:<x>` → parts; null for other alerts. */
export function parsePrepKey(key: string): PrepKey | null {
  const m = /^menu:([0-9a-f-]{36}):day:(\d):meal:([a-z]+):ing:([0-9a-f-]{36}):method:/i.exec(key)
  if (!m) return null
  return { menuId: m[1], dayIndex: Number(m[2]), meal: m[3], ingredientId: m[4] }
}

/** Pure: why a prep alert no longer applies to the current menu, or null if it still does. */
export function prepAlertStaleReason(
  key: PrepKey,
  current: {
    /** The newest menu for that week and household/user, or null if none. */
    latestMenuId: string | null
    days: unknown
    skippedDays: readonly number[]
    /** Recipes (among the slot's) that use the alert's ingredient. */
    recipeIdsWithIngredient: ReadonlySet<string>
  },
): string | null {
  if (!current.latestMenuId) return 'el menú ya no existe'
  if (current.latestMenuId !== key.menuId) return 'el menú de esa semana se ha vuelto a generar'
  if (current.skippedDays.includes(key.dayIndex)) return 'ese día está marcado sin cocinar'
  const slot = flattenMenuSlots(current.days).filter((x) => x.dayIndex === key.dayIndex && x.meal === key.meal)
  if (!slot.some((x) => current.recipeIdsWithIngredient.has(x.recipeId))) return 'ese plato ya no está en el menú'
  return null
}

/** Loads the current state for `prepAlertStaleReason`. Null for non-prep alerts. */
export async function prepAlertStaleReasonFor(dedupKey: string): Promise<string | null> {
  const key = parsePrepKey(dedupKey)
  if (!key) return null
  const [menu] = await db
    .select({ userId: menus.userId, householdId: menus.householdId, weekStart: menus.weekStart })
    .from(menus)
    .where(eq(menus.id, key.menuId))
    .limit(1)
  if (!menu) return 'el menú ya no existe'
  // Same rule as the shopping list: the newest menu of that week wins.
  const [latest] = await db
    .select({ id: menus.id, days: menus.days, skippedDays: menus.skippedDays })
    .from(menus)
    .where(
      and(
        eq(menus.weekStart, menu.weekStart),
        menu.householdId ? eq(menus.householdId, menu.householdId) : eq(menus.userId, menu.userId),
      ),
    )
    .orderBy(desc(menus.createdAt))
    .limit(1)
  const slotRecipeIds = latest
    ? flattenMenuSlots(latest.days)
        .filter((x) => x.dayIndex === key.dayIndex && x.meal === key.meal)
        .map((x) => x.recipeId)
    : []
  const withIngredient = slotRecipeIds.length
    ? await db
        .select({ recipeId: recipeIngredients.recipeId })
        .from(recipeIngredients)
        .where(and(inArray(recipeIngredients.recipeId, slotRecipeIds), eq(recipeIngredients.ingredientId, key.ingredientId)))
    : []
  return prepAlertStaleReason(key, {
    latestMenuId: latest?.id ?? null,
    days: latest?.days ?? [],
    skippedDays: (latest?.skippedDays as number[] | undefined) ?? [],
    recipeIdsWithIngredient: new Set(withIngredient.map((r) => r.recipeId)),
  })
}

// ─── Tick ───────────────────────────────────────────────────────

/** App-wide key for the scheduler's Postgres advisory lock. */
export const SCHEDULER_LOCK_KEY = 4_206_101

/**
 * Run `fn` only if no other process holds the scheduler lock. Railway starts
 * the new container before stopping the old one, so during a deploy two
 * schedulers tick at once; without this, both send the same prep alert and
 * the same WhatsApp brief. Session-level lock on a dedicated connection:
 * released on unlock, or by Postgres if the process dies. Returns null when
 * another process is ticking.
 */
export async function withSchedulerLock<T>(
  fn: () => Promise<T>,
  p: { connect: () => Promise<{ query: (q: string, v: unknown[]) => Promise<{ rows: any[] }>; release: () => void }> } = pool,
): Promise<T | null> {
  const client = await p.connect()
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [SCHEDULER_LOCK_KEY])
    if (!rows[0]?.locked) return null
    try {
      return await fn()
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK_KEY]).catch(() => {})
    }
  } finally {
    client.release()
  }
}

export async function tickScheduler(): Promise<void> {
  const ran = await withSchedulerLock(() => tickOnce())
  if (ran === null) console.log('[notificationScheduler] another process holds the lock; skipping this tick')
}

async function tickOnce(): Promise<true> {
  const now = new Date()
  const due = await db
    .select()
    .from(notificationSchedule)
    .where(
      and(
        eq(notificationSchedule.status, 'pending'),
        lte(notificationSchedule.fireAt, now),
      ),
    )

  // Each due alert goes out over Web Push AND WhatsApp (when the user linked
  // a phone and opted into "Avisos por WhatsApp"). Sent if either delivered.
  for (const row of due) {
    let stale: string | null = null
    try {
      stale = await prepAlertStaleReasonFor(row.dedupKey)
    } catch (err) {
      // A failed check must not swallow a real alert: send it as before.
      console.warn('[notificationScheduler] prep alert check failed (sending anyway):', err)
    }
    // PRO-135: a paused account gets no alerts (only the notice to choose a plan).
    if (!stale && (await isAccountPaused(row.userId, now))) stale = 'cuenta en pausa'
    if (stale) {
      await db
        .update(notificationSchedule)
        .set({ status: 'cancelled', errorMessage: `cancelado al enviar: ${stale}` })
        .where(eq(notificationSchedule.id, row.id))
      continue
    }
    let push: ChannelOutcome
    try {
      await sendPushToUser(row.userId, row.payload)
      push = { status: 'ok' }
    } catch (err: any) {
      push = {
        status: 'error',
        error: err instanceof PushNotConfiguredError
          ? 'push-not-configured'
          : String(err?.message ?? err).slice(0, 500),
      }
    }
    let whatsapp: ChannelOutcome
    try {
      whatsapp = await deliverAlertOverWhatsApp(row.userId, row.payload, now)
    } catch (err: any) {
      whatsapp = { status: 'error', error: String(err?.message ?? err).slice(0, 300) }
    }
    const { status, errorMessage } = combineDelivery(push, whatsapp)
    await db
      .update(notificationSchedule)
      .set({ status, sentAt: new Date(), errorMessage })
      .where(eq(notificationSchedule.id, row.id))
  }

  // WhatsApp daily brief + Sunday menu nudge (no-op when not configured).
  try {
    await runProactiveTick(now)
  } catch (err) {
    console.error('[notificationScheduler] whatsapp proactive tick failed:', err)
  }

  // Daily conversation review (yesterday, once, after 07:00 Madrid).
  try {
    const review = await runDailyReviewIfDue(now)
    if (review) console.log(`[reviewer] ${review.day}: ${review.status}, ${review.findings?.length ?? 0} findings`)
  } catch (err) {
    console.error('[notificationScheduler] conversation review failed:', err)
  }

  // Household ficha (PRO-152, in the shadow): after 03:00 Madrid send the
  // nightly refiner's batch for yesterday (once); collect ended batches.
  try {
    const r = await runProfileRefinerIfDue(now)
    if (r?.submit) console.log(`[refiner] ${r.submit.day}: ${r.submit.status}, ${r.submit.requested} hogares, omitidos ${JSON.stringify(r.submit.skipped)}`)
    if (r?.collected) console.log(`[refiner] ${r.collected} fichas refinadas`)
  } catch (err) {
    console.error('[notificationScheduler] profile refiner failed:', err)
  }

  // Product analytics retention: usage events older than 180 days (once a day).
  try {
    const purged = await purgeOldUsageEventsIfDue(now)
    if (purged) console.log(`[usage] purged ${purged} events older than 180 days`)
  } catch (err) {
    console.error('[notificationScheduler] usage events purge failed:', err)
  }

  // Web chat retention (PRO-148): messages older than 90 days (once a day).
  try {
    const purged = await purgeOldChatMessagesIfDue(now)
    if (purged) console.log(`[chat] purged ${purged} web chat messages older than ${CHAT_RETENTION_DAYS} days`)
  } catch (err) {
    console.error('[notificationScheduler] web chat purge failed:', err)
  }

  // Referrals (PRO-165): a pending reward per invited household that reached
  // its week 3 (checked once an hour; giving it is PRO-166).
  try {
    const created = await recordPendingReferralRewardsIfDue(now)
    if (created) console.log(`[referrals] ${created} pending rewards`)
  } catch (err) {
    console.error('[notificationScheduler] referral rewards failed:', err)
  }

  // Waitlist (PRO-97): one reminder 3 days after the invitation, if they
  // haven't created the account (checked once an hour).
  try {
    const r = await sendWaitlistInviteRemindersIfDue(now)
    if (r && r.sent + r.failed + r.skipped > 0) {
      console.log(`[waitlist] invite reminders: ${r.sent} sent, ${r.failed} failed, ${r.skipped} skipped`)
    }
  } catch (err) {
    console.error('[notificationScheduler] waitlist invite reminders failed:', err)
  }

  // Waitlist retention (PRO-171): from 2027-05-16 (Madrid), once a day,
  // remove email and name of every entry without the Friday newsletter.
  try {
    const purged = await purgeWaitlistPersonalDataIfDue(now)
    if (purged) console.log(`[waitlist] anonymised ${purged} entries (retention ${WAITLIST_RETENTION_DATE})`)
  } catch (err) {
    console.error('[notificationScheduler] waitlist retention purge failed:', err)
  }

  // PRO-135: «te quedan 2 días de prueba» to each household owner, once
  // (from launch day only; checked once an hour).
  try {
    const r = await sendTrialEndingEmailsIfDue(now)
    if (r && r.sent + r.failed + r.skipped > 0) {
      console.log(`[trial] ending emails: ${r.sent} sent, ${r.failed} failed, ${r.skipped} skipped`)
    }
  } catch (err) {
    console.error('[notificationScheduler] trial ending emails failed:', err)
  }

  // PRO-136: the day-7 founder-price offer (from launch day) and the legal
  // notice 15 days before a first charge (checked once an hour each).
  try {
    const r = await sendFounderOffersIfDue(now)
    if (r && r.offered > 0) console.log(`[founder-offer] ${r.offered} offered (${r.email.sent} emails, ${r.whatsapp} WhatsApp)`)
  } catch (err) {
    console.error('[notificationScheduler] founder offers failed:', err)
  }
  try {
    const r = await sendChargeNoticesIfDue(now)
    if (r && r.sent + r.failed + r.skipped > 0) console.log(`[charge-notice] ${r.sent} sent, ${r.failed} failed, ${r.skipped} skipped`)
  } catch (err) {
    console.error('[notificationScheduler] charge notices failed:', err)
  }
  return true
}

let intervalHandle: NodeJS.Timeout | null = null

/** Kick off the periodic tick. Idempotent — calling twice is a no-op. */
export function startScheduler(opts: { intervalMs?: number } = {}): void {
  if (intervalHandle) return
  const intervalMs = opts.intervalMs ?? 5 * 60 * 1000
  // A tick can outlive the interval now that it also sends WhatsApp messages
  // (20 s Graph timeout each); overlapping ticks would re-read the same
  // pending rows and double-send. Skip a tick while the previous one runs.
  let running = false
  intervalHandle = setInterval(() => {
    if (running) return
    running = true
    tickScheduler()
      .catch((err) => {
        console.error('[notificationScheduler] tick failed:', err)
      })
      .finally(() => {
        running = false
      })
  }, intervalMs)
  console.log(
    `[notificationScheduler] started; tick every ${Math.round(intervalMs / 1000)}s`,
  )
}

export function stopScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
