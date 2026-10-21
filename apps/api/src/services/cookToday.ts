/**
 * «Hoy cocina Pablo, mándale la receta» (PRO-230, D-069; specs/whatsapp.md
 * «Who cooks today»). Only when someone asks Mimo; nothing new in the app.
 *
 * Mimo sends that household member (if they have WhatsApp linked with avisos
 * on and Meta lets the message through) the day's recipe with the pending
 * preparativos, and from then on that day's prep alerts go to them, not to
 * whoever asked (`cook_of_day`, read by `enqueuePrepAlertsForMenu`). Without
 * WhatsApp, Mimo says so and gives a link to forward it.
 */
import { and, desc, eq, inArray, like, sql } from 'drizzle-orm'
import type { DayMenu, Dish, Meal } from '@ona/shared'
import { isTaperDish } from '@ona/shared'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { cookOfDay, menus, notificationSchedule } from '../db/schema.js'
import { loadHouseholdForUser, type HouseholdMember } from './householdStore.js'
import { shortRecipeLink } from './menuText.js'
import { isMenuDayError, resolveMenuDay, type MenuDay } from './assistant/menuDay.js'
import type { ChannelOutcome } from './whatsapp/proactive.js'

const MEAL_ES: Record<Meal, string> = { breakfast: 'el desayuno', lunch: 'la comida', snack: 'la merienda', dinner: 'la cena' }

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Pure: the member a name means («Pablo» → username «pablo_g»), or null. */
export function findMember(members: readonly HouseholdMember[], name: string): HouseholdMember | null {
  const q = norm(name)
  if (!q) return null
  const named = members.map((m) => ({ m, n: norm(m.username) }))
  return (
    named.find((x) => x.n === q)?.m ??
    named.find((x) => x.n.split(' ')[0] === q.split(' ')[0])?.m ??
    named.find((x) => x.n.startsWith(q) || q.startsWith(x.n))?.m ??
    null
  )
}

export interface DayRecipe {
  id: string
  name: string
}

export interface PendingPrep {
  title: string
  fireAt: Date
}

const hhmm = (d: Date) =>
  new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(d)
const stripAcuerdate = (t: string) => t.replace(/^Acuérdate:\s*/i, '')

/** Pure: the message for the cook (also the text to forward when they have no WhatsApp). */
export function cookMessage(p: {
  requester: string
  day: MenuDay
  isToday: boolean
  meal: Meal
  recipes: readonly DayRecipe[]
  preps: readonly PendingPrep[]
  webUrl: string
}): string {
  const when = p.isToday ? 'Hoy' : `El ${p.day.label}`
  const lines = [`${when} cocinas tú ${MEAL_ES[p.meal]} (te lo pide ${p.requester}):`]
  for (const r of p.recipes) lines.push(`→ ${r.name}: ${shortRecipeLink(p.webUrl, r.id)}`)
  if (p.preps.length) {
    lines.push('', 'Con antelación:')
    for (const x of p.preps) lines.push(`- ${stripAcuerdate(x.title)} (a las ${hhmm(x.fireAt)})`)
    lines.push('', 'Te aviso yo a esa hora.')
  }
  return lines.join('\n')
}

/** `https://wa.me/?text=…`: opens WhatsApp with the message ready to forward. */
export function forwardLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export type CookTodayResult =
  | { status: 'sent'; cook: string; text: string }
  | { status: 'not_reachable'; cook: string; reason: 'no_whatsapp' | 'avisos_off' | 'window'; text: string; forwardUrl: string }
  | { status: 'error'; message: string }

export interface CookTodayDeps {
  loadHousehold: (userId: string) => Promise<{ id: string; members: HouseholdMember[] } | null>
  loadDay: (householdId: string, userId: string, day: MenuDay) => Promise<{ menuId: string; days: DayMenu[] } | null>
  loadRecipes: (ids: string[]) => Promise<DayRecipe[]>
  pendingPreps: (menuId: string, dayIndex: number) => Promise<PendingPrep[]>
  /** The cook's WhatsApp: null = not linked. */
  whatsAppOf: (userId: string) => Promise<{ notify: boolean } | null>
  sendWhatsApp: (userId: string, text: string) => Promise<ChannelOutcome>
  /** Record the cook for that day and move that day's pending prep alerts to them. */
  assign: (p: { householdId: string; menuId: string; day: MenuDay; cookId: string; requesterId: string }) => Promise<void>
  webUrl: string
}

const recipeIdsOf = (day: DayMenu | undefined, meal: Meal): string[] =>
  ((day?.[meal]?.dishes ?? []) as Array<{ kind: string; recipeId?: string; variant?: string }>)
    .filter((d) => d.kind === 'recipe' && d.recipeId && d.variant !== 'leftover' && !isTaperDish(d as Dish))
    .map((d) => d.recipeId!)

export async function assignCookToday(
  requesterId: string,
  input: { name: string; day?: string; meal?: Meal },
  deps: CookTodayDeps,
  now: Date = new Date(),
): Promise<CookTodayResult> {
  const household = await deps.loadHousehold(requesterId)
  const others = household?.members.filter((m) => m.userId !== requesterId) ?? []
  if (!household || others.length === 0) return { status: 'error', message: 'En tu hogar no hay nadie más: invita a esa persona primero (invite_to_household).' }
  const cook = findMember(household.members, input.name)
  if (!cook) return { status: 'error', message: `No encuentro a «${input.name}» en tu hogar. Están: ${household.members.map((m) => m.username).join(', ')}.` }
  const requester = household.members.find((m) => m.userId === requesterId)!
  if (cook.userId === requesterId) return { status: 'error', message: 'Esa persona eres tú: los avisos de ese día ya te llegan a ti.' }

  const day = resolveMenuDay({ day: input.day ?? 'hoy' }, now)
  if (isMenuDayError(day)) return { status: 'error', message: day.error }
  const today = resolveMenuDay({ day: 'hoy' }, now) as MenuDay
  const menu = await deps.loadDay(household.id, requesterId, day)
  const meal: Meal = input.meal ?? (recipeIdsOf(menu?.days[day.dayIndex], 'dinner').length ? 'dinner' : 'lunch')
  const ids = recipeIdsOf(menu?.days[day.dayIndex], meal)
  if (!menu || ids.length === 0) return { status: 'error', message: `No hay receta para ${MEAL_ES[meal]} del ${day.label}: no he mandado nada.` }
  const [recipes, preps] = await Promise.all([deps.loadRecipes(ids), deps.pendingPreps(menu.menuId, day.dayIndex)])
  const text = cookMessage({ requester: requester.username, day, isToday: day.isoDate === today.isoDate, meal, recipes, preps, webUrl: deps.webUrl })

  const wa = await deps.whatsAppOf(cook.userId)
  const notReachable = (reason: 'no_whatsapp' | 'avisos_off' | 'window'): CookTodayResult => ({
    status: 'not_reachable',
    cook: cook.username,
    reason,
    text,
    forwardUrl: forwardLink(text),
  })
  if (!wa) return notReachable('no_whatsapp')
  if (!wa.notify) return notReachable('avisos_off')
  const out = await deps.sendWhatsApp(cook.userId, text)
  if (out.status !== 'ok') return notReachable('window')
  await deps.assign({ householdId: household.id, menuId: menu.menuId, day, cookId: cook.userId, requesterId })
  return { status: 'sent', cook: cook.username, text }
}

// ─── DB-backed deps ──────────────────────────────────────────────

/** dayIndex → cook userId for a household's week (read by the prep-alert enqueue). */
export async function cooksOfWeek(householdId: string, weekStart: string): Promise<Map<number, string>> {
  const rows = await db
    .select({ day: cookOfDay.day, userId: cookOfDay.userId })
    .from(cookOfDay)
    .where(and(eq(cookOfDay.householdId, householdId), sql`${cookOfDay.day} BETWEEN ${weekStart}::date AND (${weekStart}::date + 6)`))
  const monday = new Date(`${weekStart.slice(0, 10)}T12:00:00Z`).getTime()
  return new Map(rows.map((r) => [Math.round((new Date(`${String(r.day).slice(0, 10)}T12:00:00Z`).getTime() - monday) / 86_400_000), r.userId]))
}

export function dbCookTodayDeps(): CookTodayDeps {
  return {
    loadHousehold: async (userId) => {
      const h = await loadHouseholdForUser(userId)
      return h ? { id: h.id, members: h.members.filter((m) => m.role !== 'child') } : null
    },
    loadDay: async (householdId, userId, day) => {
      const [m] = await db
        .select({ id: menus.id, days: menus.days })
        .from(menus)
        .where(and(eq(menus.weekStart, day.weekStart), sql`(${menus.householdId} = ${householdId} OR ${menus.userId} = ${userId})`))
        .orderBy(desc(menus.createdAt))
        .limit(1)
      return m ? { menuId: m.id, days: m.days as DayMenu[] } : null
    },
    loadRecipes: async (ids) => {
      const { recipes } = await import('../db/schema.js')
      const rows = await db.select({ id: recipes.id, name: recipes.name }).from(recipes).where(inArray(recipes.id, ids))
      return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is DayRecipe => Boolean(r))
    },
    pendingPreps: async (menuId, dayIndex) => {
      const rows = await db
        .select({ title: sql<string>`${notificationSchedule.payload}->>'title'`, fireAt: notificationSchedule.fireAt })
        .from(notificationSchedule)
        .where(and(eq(notificationSchedule.status, 'pending'), like(notificationSchedule.dedupKey, `menu:${menuId}:day:${dayIndex}:%`)))
        .orderBy(notificationSchedule.fireAt)
      return rows
    },
    whatsAppOf: async (userId) => {
      const store = await import('./whatsapp/store.js')
      const link = await store.getLinkByUser(userId)
      return link && !link.suspendedAt ? { notify: link.notify } : null
    },
    sendWhatsApp: async (userId, text) => {
      const [{ sendProactive }, store] = await Promise.all([import('./whatsapp/outbound.js'), import('./whatsapp/store.js')])
      const link = await store.getLinkByUser(userId)
      if (!link) return { status: 'skipped' }
      return sendProactive(link, [{ type: 'text', text }], 'cook_today')
    },
    assign: async ({ householdId, menuId, day, cookId, requesterId }) => {
      await db
        .insert(cookOfDay)
        .values({ householdId, day: day.isoDate, userId: cookId, assignedBy: requesterId })
        .onConflictDoUpdate({ target: [cookOfDay.householdId, cookOfDay.day], set: { userId: cookId, assignedBy: requesterId, createdAt: new Date() } })
      await db
        .update(notificationSchedule)
        .set({ userId: cookId })
        .where(and(eq(notificationSchedule.status, 'pending'), like(notificationSchedule.dedupKey, `menu:${menuId}:day:${day.dayIndex}:%`)))
    },
    webUrl: env.WEB_PUBLIC_URL,
  }
}
