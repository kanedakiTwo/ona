import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { isHealthMemoryKey, type DayMenu } from '@ona/shared'
import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { cookLogs, menus, recipes, userMemories, users } from '../../db/schema.js'
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
  mondayOf,
  planProactive,
  templateParamFrom,
  templateFor,
  withText,
  parseTemplateMap,
  PROACTIVE_KINDS,
  type ChannelOutcome,
  type MadridParts,
  type ProactiveKind,
  type TodayDinner,
} from './proactive.js'
import { recordCost } from '../costLedger.js'
import { recordServiceMessageCost } from './serviceCost.js'
import { budgetMicros, getMonthlySpendMicros } from '../advisorBudget.js'
import { spendCapStatus } from '../spendCap.js'
import { composeGuided, guidedMeta, type GuideSpec, type GuidedContext, type GuidedResult } from './guided.js'
import { isAccountPaused } from '../accountAccess.js'
import { listPantryForUser } from '../pantryStore.js'
import { freezerItemsDue } from '@ona/shared'

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

/** Prep alert from `notification_schedule` → WhatsApp (in addition to Web Push). */
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
  const links = await store.listNotifiableLinks()
  for (const link of links) {
    if (!isUserAllowed(link.email)) continue
    try {
      // PRO-135: a paused account gets no proactive message (never before launch day).
      if (await isAccountPaused(link.userId, now)) continue
      const times = await loadMealTimes(link.userId)
      // Only touch the DB for cooldowns inside a window that could fire.
      if (!anyProactiveWindow(parts, times.breakfast, times.dinner)) continue
      const recent = await store.recentOutboundKinds(link.phone, new Date(now.getTime() - WEEKLY_NUDGE_COOLDOWN_MS))
      const sentRecently: Partial<Record<ProactiveKind, boolean>> = {}
      for (const k of PROACTIVE_KINDS) {
        const at = recent.get(k)
        sentRecently[k] = Boolean(at && now.getTime() - at.getTime() < COOLDOWN_MS[k])
      }
      let dinnerCache: Promise<TodayDinner | null> | null = null
      const planned = await planProactive({
        parts,
        breakfastTime: times.breakfast,
        dinnerTime: times.dinner,
        prefs: link.prefs ?? {},
        sentRecently,
        todayDay: () => loadTodayDay(link.userId, parts),
        todayDinner: () => (dinnerCache ??= loadTodayDinner(link.userId, parts)),
        cookedToday: () => cookedToday(link.userId, parts),
        pendingShopping: () => pendingShopping(link.userId),
        hasNextWeekMenu: async () =>
          Boolean(await latestMenuForWeek(link.userId, mondayOf(parts.isoDate, parts.weekday, 1))),
        lastFreezerReviewAt: async () =>
          (await store.recentOutboundKinds(link.phone, new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000))).get('freezer_review') ?? null,
        freezerItemsDue: async () =>
          freezerItemsDue(await listPantryForUser(link.userId, undefined, { location: 'congelador' }), now),
        webUrl: env.WEB_PUBLIC_URL,
      })
      for (const p of planned) {
        const fixed = p.messages.length === 1 && (p.messages[0].type === 'text' || p.messages[0].type === 'buttons') ? p.messages[0].text : null
        if (!p.guide || fixed === null) {
          await sendProactive(link, p.messages, p.kind, now)
          continue
        }
        const written = await writeGuided(link, p.guide, fixed, now)
        await sendProactive(link, withText(p.messages, written.text), p.kind, now, { meta: guidedMeta(written) })
      }
    } catch (err: any) {
      console.error(`[whatsapp] proactive tick failed for ${link.userId}:`, err?.message ?? err)
    }
  }
}
