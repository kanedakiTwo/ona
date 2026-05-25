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
 * The interval kicks off at API boot from `index.ts` via `startScheduler`.
 * In dev it logs once per tick so we can see it's alive.
 */

import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { db } from '../db/connection.js'
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

function resolveCookAt(
  weekStart: Date,
  dayIndex: number,
  meal: Meal,
  mealTimes: Partial<Record<Meal, string>>,
): Date {
  const out = new Date(weekStart)
  out.setDate(out.getDate() + dayIndex)
  const t = mealTimes[meal]
  if (t && /^[0-2]\d:\d\d$/.test(t)) {
    const [h, m] = t.split(':').map(Number)
    out.setHours(h, m, 0, 0)
  } else {
    out.setHours(DEFAULT_MEAL_HOUR[meal], 0, 0, 0)
  }
  return out
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
      const s = slot as { recipeId?: string; kind?: string }
      // Skip leftover slots — they share the source's prep alerts.
      if (s.kind === 'leftover') continue
      if (typeof s.recipeId === 'string' && s.recipeId.length > 0) {
        out.push({ dayIndex: i, meal: meal as Meal, recipeId: s.recipeId })
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
  const weekStart = new Date(menu.weekStart as unknown as string)

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

// ─── Tick ───────────────────────────────────────────────────────

export async function tickScheduler(): Promise<void> {
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

  for (const row of due) {
    try {
      await sendPushToUser(row.userId, row.payload)
      await db
        .update(notificationSchedule)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(notificationSchedule.id, row.id))
    } catch (err: any) {
      const msg = err instanceof PushNotConfiguredError
        ? 'push-not-configured'
        : String(err?.message ?? err).slice(0, 500)
      await db
        .update(notificationSchedule)
        .set({ status: 'failed', sentAt: new Date(), errorMessage: msg })
        .where(eq(notificationSchedule.id, row.id))
    }
  }
}

let intervalHandle: NodeJS.Timeout | null = null

/** Kick off the periodic tick. Idempotent — calling twice is a no-op. */
export function startScheduler(opts: { intervalMs?: number } = {}): void {
  if (intervalHandle) return
  const intervalMs = opts.intervalMs ?? 5 * 60 * 1000
  intervalHandle = setInterval(() => {
    tickScheduler().catch((err) => {
      console.error('[notificationScheduler] tick failed:', err)
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
