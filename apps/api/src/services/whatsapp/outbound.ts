import { and, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import { isHealthMemoryKey, shouldAskRating, type DayMenu } from '@ona/shared'
import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { chatMessages, cookLogs, householdMembers, households, menus, recipes, userMemories, users, whatsappMessages } from '../../db/schema.js'
import { getRecipeNotesForUser } from '../recipeNotesStore.js'
import { madridMidnightUtc } from '../madridTime.js'
import { appApiFor } from '../assistant/appApi.js'
import { resolveScope, scopeWhere } from '../scopeResolver.js'
import { isUserAllowed, isWhatsAppConfigured } from './config.js'
import * as store from './store.js'
import * as client from './client.js'
import type { LinkWithUser } from './store.js'
import type { OutboundMessage } from './render.js'
import {
  DAILY_BRIEF_COOLDOWN_MS,
  WEEKLY_NUDGE_COOLDOWN_MS,
  anyProactiveWindow,
  chooseDelivery,
  kindEnabled,
  madridParts,
  mergeMessages,
  mondayOf,
  planProactive,
  sawTodaysMenu,
  templateParamFrom,
  templateFor,
  withText,
  parseTemplateMap,
  PROACTIVE_KINDS,
  type ChannelOutcome,
  type MadridParts,
  type PlannedMessage,
  type ProactiveKind,
  type TodayDinner,
} from './proactive.js'
import { recordCost } from '../costLedger.js'
import { recordServiceMessageCost } from './serviceCost.js'
import { budgetMicros, getMonthlySpendMicros } from '../advisorBudget.js'
import { spendCapStatus } from '../spendCap.js'
import { composeGuided, guidedMeta, type GuideSpec, type GuidedContext, type GuidedResult } from './guided.js'
import { isAccountPaused } from '../accountAccess.js'
import { logEntriesFor, noticePriority, planMoment, countsAgainstBudget, type DeliveryResult } from '../notifications/budget.js'
import { budgetKeyFor, loadFullBudgetState, recentNoticeKinds, recordNotices } from '../notifications/budgetStore.js'
import { isAwakeTime } from '../notifications/hours.js'
import { HOUSEHOLD_NOTICE_KINDS, householdNoticeRecipient, type HouseholdMember } from '../notifications/recipient.js'
import { taperTomorrow } from '../taper.js'
import { listPantryForUser } from '../pantryStore.js'
import { freezerItemsDue } from '@ona/shared'
import { quietAfterSignUp } from './signUpQuiet.js'
import { isShoppingReminderWindow } from './proactive.js'
import { loadUserAlertPrefs, mergeAlertPrefs } from '../notifications/alertPrefs.js'
import { fallbackKindsToday, pushFallbackForProactive, type WhatsAppAlertState } from '../notifications/channels.js'

/** Per-kind templates (WHATSAPP_TEMPLATES), parsed once. */
const TEMPLATES = parseTemplateMap(env.WHATSAPP_TEMPLATES)

/**
 * Messages Mimoia sends first. Free-form inside Meta's 24 h window; outside it,
 * through the approved template for that kind (`WHATSAPP_TEMPLATES`, else the
 * generic `WHATSAPP_TEMPLATE_NAME`) when configured,
 * otherwise skipped. Every send is stored as an outbound row so a reply like
 * "sí" to the Sunday nudge has the question in its chat history.
 */
export async function sendProactive(
  link: LinkWithUser,
  messages: OutboundMessage[],
  kind: string,
  now: Date = new Date(),
  opts: { meta?: ReturnType<typeof guidedMeta> } = {},
): Promise<ChannelOutcome> {
  const meta = opts.meta
  const template = templateFor(kind, TEMPLATES, env.WHATSAPP_TEMPLATE_NAME)
  const delivery = chooseDelivery(link.lastInboundAt, now, Boolean(template))
  if (delivery === 'skip') return { status: 'skipped', error: 'outside-24h-window' }
  try {
    if (delivery === 'session') {
      for (const m of messages) {
        const wamid = await client.sendMessage(link.phone, m)
        void recordServiceMessageCost(link.userId)
        await store.insertOutbound({ phone: link.phone, userId: link.userId, kind, body: m.text, status: 'sent', wamid, meta })
      }
    } else {
      const text = templateParamFrom(messages)
      const wamid = await client.sendTemplate(link.phone, template!, env.WHATSAPP_TEMPLATE_LANG, text)
      // Every template is billed, inside or outside the 24 h window.
      recordCost({ feature: 'whatsapp_template', provider: 'meta_whatsapp', model: 'utility_template', units: { messages: 1 }, userId: link.userId })
      await store.insertOutbound({ phone: link.phone, userId: link.userId, kind, body: text, status: 'sent', wamid, meta })
    }
    return { status: 'ok' }
  } catch (err: any) {
    const error = String(err?.message ?? err).slice(0, 500)
    console.error(`[whatsapp] proactive ${kind} failed:`, error)
    await store.insertOutbound({
      phone: link.phone,
      userId: link.userId,
      kind,
      body: templateParamFrom(messages),
      status: 'failed',
      errorMessage: error,
      meta,
    })
    return { status: 'error', error }
  }
}

async function notifiableLink(userId: string): Promise<LinkWithUser | null> {
  if (!isWhatsAppConfigured()) return null
  const link = await store.getLinkByUser(userId)
  if (!link || !link.notify || link.suspendedAt || !isUserAllowed(link.email)) return null
  return link
}

/**
 * A one-off message only inside the 24 h service window (never a template),
 * to a linked number that accepts proactive messages (PRO-136: the day-7
 * offer). Outside the window → skipped.
 */
export async function sendInsideServiceWindow(userId: string, text: string, kind: string, now: Date = new Date()): Promise<ChannelOutcome> {
  const link = await notifiableLink(userId)
  if (!link) return { status: 'skipped' }
  if (chooseDelivery(link.lastInboundAt, now, false) !== 'session') return { status: 'skipped', error: 'outside-24h-window' }
  return sendProactive(link, [{ type: 'text', text }], kind, now)
}

/**
 * Can WhatsApp carry this person's alerts of `kind` (PRO-234)? `kind_off`
 * when they switched that kind off: then it goes out nowhere.
 */
export async function whatsAppAlertState(userId: string, kind: ProactiveKind): Promise<WhatsAppAlertState> {
  const link = await notifiableLink(userId)
  if (!link) return 'none'
  return kindEnabled(link.prefs, kind) ? 'ready' : 'kind_off'
}

/** Prep alert from `notification_schedule` → WhatsApp (its only channel when linked; PRO-234). */
export async function deliverAlertOverWhatsApp(
  userId: string,
  payload: { title: string; body: string; url?: string },
  now: Date = new Date(),
): Promise<ChannelOutcome> {
  const link = await notifiableLink(userId)
  if (!link || !kindEnabled(link.prefs, 'prep_alerts')) return { status: 'skipped' }
  const link_ = payload.url ? `\n\nVer en la app: ${env.WEB_PUBLIC_URL}${payload.url}` : ''
  return sendProactive(link, [{ type: 'text', text: `*${payload.title}*\n${payload.body}${link_}` }], 'alert', now)
}

async function loadMealTimes(userId: string): Promise<{ breakfast: string | null; dinner: string | null }> {
  const [row] = await db
    .select({ value: userMemories.value })
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.key, 'meal_times')))
    .limit(1)
  const v = row?.value as { breakfast?: unknown; dinner?: unknown } | undefined
  return {
    breakfast: typeof v?.breakfast === 'string' ? v.breakfast : null,
    dinner: typeof v?.dinner === 'string' ? v.dinner : null,
  }
}

async function latestMenuForWeek(userId: string, weekStart: string) {
  const [menu] = await db
    .select({ id: menus.id, days: menus.days })
    .from(menus)
    .where(and(scopeWhere(menus.userId, menus.householdId, await resolveScope(userId)), eq(menus.weekStart, weekStart)))
    .orderBy(desc(menus.createdAt))
    .limit(1)
  return menu ?? null
}

async function loadTodayDay(userId: string, parts: MadridParts): Promise<DayMenu | null> {
  const menu = await latestMenuForWeek(userId, mondayOf(parts.isoDate, parts.weekday))
  const days = menu?.days as DayMenu[] | undefined
  return days?.[parts.weekday] ?? null
}

async function loadTodayDinner(userId: string, parts: MadridParts): Promise<TodayDinner | null> {
  const day = await loadTodayDay(userId, parts)
  const dishes = (day?.dinner?.dishes ?? []) as Array<{ kind: string; recipeId?: string; recipeName?: string; text?: string }>
  const recipeDishes = dishes.filter((d) => d.kind === 'recipe' && d.recipeId)
  if (recipeDishes.length === 0) return null
  const rows = await db
    .select({ id: recipes.id, totalTime: recipes.totalTime, prepTime: recipes.prepTime, cookTime: recipes.cookTime })
    .from(recipes)
    .where(inArray(recipes.id, recipeDishes.map((d) => d.recipeId!)))
  const minutes = rows
    .map((r) => r.totalTime ?? ((r.prepTime ?? 0) + (r.cookTime ?? 0) || null))
    .filter((m): m is number => typeof m === 'number' && m > 0)
  return {
    names: recipeDishes.map((d) => d.recipeName ?? 'la cena'),
    recipeIds: recipeDishes.map((d) => d.recipeId!),
    totalMinutes: minutes.length ? Math.max(...minutes) : null,
  }
}

async function cookedToday(userId: string, parts: MadridParts): Promise<boolean> {
  // Madrid midnight expressed in UTC (good enough at hour resolution).
  const since = new Date(Date.now() - (parts.hour * 60 + parts.minute) * 60_000)
  const [row] = await db
    .select({ id: cookLogs.id })
    .from(cookLogs)
    .where(and(eq(cookLogs.userId, userId), gte(cookLogs.cookedAt, since)))
    .limit(1)
  return Boolean(row)
}

async function pendingShopping(userId: string): Promise<string[]> {
  const list = await appApiFor(userId)<{ items?: Array<{ name: string; checked?: boolean; inStock?: boolean }> }>('GET', '/shopping-list')
  return (list?.items ?? []).filter((i) => !i.checked && !i.inStock).map((i) => i.name)
}

/** PRO-235: did today's menu come up in a conversation (WhatsApp or the web chat) since midnight? */
async function sawMenuThisMorning(userId: string, parts: MadridParts, now: Date): Promise<boolean> {
  const since = madridMidnightUtc(parts.isoDate)
  const [wa, web] = await Promise.all([
    db
      .select({ meta: whatsappMessages.meta })
      .from(whatsappMessages)
      .where(and(eq(whatsappMessages.userId, userId), eq(whatsappMessages.direction, 'in'), gte(whatsappMessages.createdAt, since), lte(whatsappMessages.createdAt, now))),
    db
      .select({ meta: chatMessages.meta })
      .from(chatMessages)
      .where(and(eq(chatMessages.userId, userId), eq(chatMessages.role, 'assistant'), gte(chatMessages.createdAt, since), lte(chatMessages.createdAt, now))),
  ])
  return sawTodaysMenu([...wa, ...web].map((r) => ({ tools: r.meta?.tools ?? [] })))
}

// ─── Guided messages (PRO-156) ───────────────────────────────────

/**
 * Has this user used up the month's AI allowance? The chat's € budget or the
 * monthly cap on all paid AI work (admins exempt from the cap), as a WhatsApp
 * turn checks it. Then the fixed text goes out instead of a guided one.
 */
export async function guidedOverBudget(userId: string): Promise<boolean> {
  if ((await getMonthlySpendMicros(userId, db)) >= budgetMicros()) return true
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  if (row?.role === 'admin') return false
  return (await spendCapStatus(userId)).exceeded
}

const NOT_CONVERSATION = new Set(['system', 'link', 'ack', 'review', 'optout', 'optin', 'optin_prompt', 'image_failed'])
const GUIDE_MEMORY_SKIP = new Set(['meal_times', 'time_available'])

/** What the writer knows of the house: memory (never health keys), the last 12 h of chat, earlier messages of the kind. */
export async function guidedContextFor(link: Pick<LinkWithUser, 'userId' | 'phone'>, kind: string, now: Date = new Date()): Promise<GuidedContext> {
  const [memRows, history, previous] = await Promise.all([
    db.select({ key: userMemories.key, value: userMemories.value }).from(userMemories).where(eq(userMemories.userId, link.userId)),
    store.loadHistoryRows(link.phone, new Date(now.getTime() - 12 * 60 * 60 * 1000), link.userId),
    store.recentOutboundBodies(link.phone, kind, 5),
  ])
  const memory = memRows
    .filter((r) => !isHealthMemoryKey(r.key) && !GUIDE_MEMORY_SKIP.has(r.key) && !r.key.startsWith('physical.'))
    .map((r) => `${r.key}: ${typeof r.value === 'string' ? r.value : JSON.stringify(r.value)}`)
    .slice(0, 20)
  const recent = history
    .filter((r) => r.body && !NOT_CONVERSATION.has(r.kind ?? '') && (r.direction === 'in' ? r.status === 'processed' : r.status === 'sent'))
    .slice(-8)
    .map((r) => ({ who: r.direction === 'in' ? ('usuario' as const) : ('mimo' as const), text: r.body! }))
  return { memory, recent, previous }
}

/** Write one message from its guide for this link, or the fixed text. Never throws. */
export function writeGuided(link: Pick<LinkWithUser, 'userId' | 'phone'>, spec: GuideSpec, fallback: string, now: Date = new Date()): Promise<GuidedResult> {
  return composeGuided(spec, fallback, {
    userId: link.userId,
    overBudget: () => guidedOverBudget(link.userId),
    context: () => guidedContextFor(link, spec.kind, now),
  })
}

/**
 * PRO-215: the avisos planned for one person in one tick are one moment.
 * The weekly budget decides which go (`planMoment`); those go out as ONE
 * message (each written from its guide, then merged) that spends at most
 * one unit; every candidate is logged with its outcome.
 */
async function sendMoment(link: LinkWithUser, planned: PlannedMessage[], isoDate: string, now: Date): Promise<void> {
  const budgetKey = await budgetKeyFor(link.userId)
  const needReserve = !planned.some((p) => countsAgainstBudget(p.kind) && noticePriority(p.kind) === 1)
  const plan = planMoment(planned, await loadFullBudgetState(budgetKey, now, needReserve))
  let delivery: DeliveryResult | null = null
  let channel: 'whatsapp' | 'push' | null = null
  if (plan.send.length > 0) {
    const written: OutboundMessage[][] = []
    let meta: ReturnType<typeof guidedMeta> | undefined
    for (const p of plan.send) {
      const fixed = p.messages.length === 1 && (p.messages[0].type === 'text' || p.messages[0].type === 'buttons') ? p.messages[0].text : null
      if (!p.guide || fixed === null) {
        written.push(p.messages)
        continue
      }
      const w = await writeGuided(link, p.guide, fixed, now)
      written.push(withText(p.messages, w.text))
      meta ??= guidedMeta(w)
    }
    const merged = mergeMessages(written)
    const outcome = await sendProactive(link, merged, plan.send[0].kind, now, { meta })
    // PRO-234 (D-080): WhatsApp couldn't (outside the 24 h window without a
    // template, or a Meta error) → the same merged message as a phone
    // notification, once a day per kind. Still ONE message: one unit at most.
    const fallback =
      outcome.status === 'ok'
        ? null
        : await pushFallbackForProactive(link.userId, plan.send[0].kind, merged.map((m) => m.text).join('\n'), isoDate, now)
    ;({ delivery, channel } = momentDelivery(outcome, fallback))
  }
  await recordNotices({ budgetKey, userId: link.userId, entries: logEntriesFor(plan, delivery), channel, now })
}

/**
 * Pure: how one moment went out (PRO-215 + PRO-234). WhatsApp first; the
 * phone notification only as its fallback. Either way it is the same single
 * message, so the budget log gets one `enviado` (one unit) at most.
 */
export function momentDelivery(
  whatsapp: ChannelOutcome,
  fallback: ChannelOutcome | null,
): { delivery: DeliveryResult; channel: 'whatsapp' | 'push' | null } {
  if (whatsapp.status === 'ok') return { delivery: 'ok', channel: 'whatsapp' }
  if (fallback?.status === 'ok') return { delivery: 'ok', channel: 'push' }
  return { delivery: whatsapp.error === 'outside-24h-window' ? 'outside-window' : 'error', channel: null }
}

/**
 * PRO-236: the household avisos (shopping, Sunday) go to one person per
 * household — only when the household shares its menu and list
 * (`SHARED_HOUSEHOLD_SCOPE`). `offFor(userId)` = the household kinds that
 * person doesn't get (to merge into their prefs for this tick).
 */
async function householdNoticeRecipients(links: LinkWithUser[]): Promise<{ offFor: (userId: string) => Record<string, boolean> }> {
  const none = { offFor: () => ({}) }
  if (!env.SHARED_HOUSEHOLD_SCOPE || links.length < 2) return none
  const rows = await db
    .select({ userId: users.id, householdId: users.primaryHouseholdId, ownerId: households.ownerId, joinedAt: householdMembers.joinedAt })
    .from(users)
    .leftJoin(households, eq(households.id, users.primaryHouseholdId))
    .leftJoin(householdMembers, and(eq(householdMembers.householdId, users.primaryHouseholdId), eq(householdMembers.userId, users.id)))
    .where(inArray(users.id, links.map((l) => l.userId)))
  const byHousehold = new Map<string, HouseholdMember[]>()
  const householdOf = new Map<string, string>()
  for (const r of rows) {
    if (!r.householdId) continue
    householdOf.set(r.userId, r.householdId)
    byHousehold.set(r.householdId, [...(byHousehold.get(r.householdId) ?? []), { userId: r.userId, isOwner: r.ownerId === r.userId, joinedAt: r.joinedAt }])
  }
  const prefsOf = new Map(links.map((l) => [l.userId, l.prefs ?? {}]))
  return {
    offFor(userId) {
      const hh = householdOf.get(userId)
      const members = hh ? byHousehold.get(hh) : undefined
      if (!members || members.length < 2) return {}
      const off: Record<string, boolean> = {}
      for (const kind of HOUSEHOLD_NOTICE_KINDS) {
        const to = householdNoticeRecipient(members, (id) => kindEnabled(prefsOf.get(id), kind as ProactiveKind))
        if (to !== userId) off[kind] = false
      }
      return off
    },
  }
}

/** Cooldown per kind: the Sunday nudge every 3 days, everything else daily. */
const COOLDOWN_MS: Record<ProactiveKind, number> = {
  daily_brief: DAILY_BRIEF_COOLDOWN_MS,
  weekly_nudge: WEEKLY_NUDGE_COOLDOWN_MS,
  prep_alerts: 0,
  cooking_reminder: DAILY_BRIEF_COOLDOWN_MS,
  dinner_checkin: DAILY_BRIEF_COOLDOWN_MS,
  shopping_reminder: 3 * 24 * 60 * 60 * 1000,
  // PRO-228: «once a month» is checked by calendar month in planProactive.
  freezer_review: 0,
}

/**
 * Proactive messages for every linked user who opted in: daily brief,
 * cooking reminder for long dinners, "¿hiciste la cena?", Saturday shopping
 * reminder, Sunday menu nudge. Called from the notification scheduler tick
 * (every 5 min); per-kind cooldowns (stored as outbound rows) make it
 * idempotent across ticks. Per-kind switches live in `whatsapp_links.prefs`.
 */
export async function runProactiveTick(now: Date = new Date()): Promise<void> {
  if (!isWhatsAppConfigured()) return
  const parts = madridParts(now)
  // PRO-236: never before 08:00 nor after 22:30 (Madrid).
  if (!isAwakeTime(parts)) return
  const links = (await store.listNotifiableLinks()).filter((l) => isUserAllowed(l.email))
  const household = await householdNoticeRecipients(links)
  for (const link of links) {
    try {
      // PRO-135: a paused account gets no proactive message (never before launch day).
      if (await isAccountPaused(link.userId, now)) continue
      const times = await loadMealTimes(link.userId)
      // Only touch the DB for cooldowns inside a window that could fire.
      if (!anyProactiveWindow(parts, times.breakfast, times.dinner)) continue
      const since = new Date(now.getTime() - WEEKLY_NUDGE_COOLDOWN_MS)
      const [recent, noticed, fellBack, userPrefs] = await Promise.all([
        store.recentOutboundKinds(link.phone, since),
        recentNoticeKinds(link.userId, since),
        // PRO-234: a kind that already went out today as a phone notification
        // (WhatsApp couldn't) counts as sent too.
        fallbackKindsToday(link.userId, parts.isoDate),
        // PRO-237: the «Avisos» switches (users.alert_prefs).
        loadUserAlertPrefs(link.userId),
      ])
      const sentRecently: Partial<Record<ProactiveKind, boolean>> = {}
      for (const k of PROACTIVE_KINDS) {
        // PRO-215: an aviso merged into another message or dropped by the
        // weekly budget is in its cooldown too (logged in notice_candidates).
        const at = [recent.get(k), noticed.get(k)].filter((d): d is Date => Boolean(d)).sort((a, b) => b.getTime() - a.getTime())[0]
        sentRecently[k] = Boolean(at && now.getTime() - at.getTime() < COOLDOWN_MS[k]) || fellBack.has(k)
      }
      // PRO-244: no shopping reminder in the first hours after the sign-up.
      if (isShoppingReminderWindow(parts) && !sentRecently.shopping_reminder) {
        const [u] = await db.select({ at: users.onboardingCompletedAt }).from(users).where(eq(users.id, link.userId)).limit(1)
        if (quietAfterSignUp('shopping_reminder', u?.at ?? null, now)) sentRecently.shopping_reminder = true
      }
      let dinnerCache: Promise<TodayDinner | null> | null = null
      const planned = await planProactive({
        parts,
        breakfastTime: times.breakfast,
        dinnerTime: times.dinner,
        // A kind is off if WhatsApp's prefs, «Avisos» (PRO-237) or the household
        // recipient rule (PRO-236: shopping/Sunday to one person) say so.
        prefs: mergeAlertPrefs(link.prefs, userPrefs, household.offFor(link.userId)),
        sentRecently,
        todayDay: () => loadTodayDay(link.userId, parts),
        todayDinner: () => (dinnerCache ??= loadTodayDinner(link.userId, parts)),
        cookedToday: () => cookedToday(link.userId, parts),
        pendingShopping: () => pendingShopping(link.userId),
        hasNextWeekMenu: async () =>
          Boolean(await latestMenuForWeek(link.userId, mondayOf(parts.isoDate, parts.weekday, 1))),
        sawTodaysMenu: () => sawMenuThisMorning(link.userId, parts, now),
        askRating: async (recipeId) => shouldAskRating(await getRecipeNotesForUser(link.userId, recipeId)),
        taperTonight: async () => {
          const menu = await latestMenuForWeek(link.userId, mondayOf(parts.isoDate, parts.weekday))
          return menu ? taperTomorrow(menu.days as DayMenu[], parts.weekday) : null
        },
        lastFreezerReviewAt: async () =>
          (await store.recentOutboundKinds(link.phone, new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000))).get('freezer_review') ?? null,
        freezerItemsDue: async () =>
          freezerItemsDue(await listPantryForUser(link.userId, undefined, { location: 'congelador' }), now),
        webUrl: env.WEB_PUBLIC_URL,
      })
      if (planned.length === 0) continue
      await sendMoment(link, planned, parts.isoDate, now)
    } catch (err: any) {
      console.error(`[whatsapp] proactive tick failed for ${link.userId}:`, err?.message ?? err)
    }
  }
}
