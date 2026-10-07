import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import type { DayMenu } from '@ona/shared'
import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { cookLogs, menus, recipes, userMemories } from '../../db/schema.js'
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
  PROACTIVE_KINDS,
  type ChannelOutcome,
  type MadridParts,
  type ProactiveKind,
  type TodayDinner,
} from './proactive.js'
import { recordCost } from '../costLedger.js'

/**
 * Messages ONA sends first. Free-form inside Meta's 24 h window; outside it,
 * through the approved template (`WHATSAPP_TEMPLATE_NAME`) when configured,
 * otherwise skipped. Every send is stored as an outbound row so a reply like
 * "sí" to the Sunday nudge has the question in its chat history.
 */
export async function sendProactive(
  link: LinkWithUser,
  messages: OutboundMessage[],
  kind: string,
  now: Date = new Date(),
): Promise<ChannelOutcome> {
  const delivery = chooseDelivery(link.lastInboundAt, now, Boolean(env.WHATSAPP_TEMPLATE_NAME))
  if (delivery === 'skip') return { status: 'skipped', error: 'outside-24h-window' }
  try {
    if (delivery === 'session') {
      for (const m of messages) {
        const wamid = await client.sendMessage(link.phone, m)
        await store.insertOutbound({ phone: link.phone, userId: link.userId, kind, body: m.text, status: 'sent', wamid })
      }
    } else {
      const text = templateParamFrom(messages)
      const wamid = await client.sendTemplate(link.phone, env.WHATSAPP_TEMPLATE_NAME, env.WHATSAPP_TEMPLATE_LANG, text)
      // Templates are the one WhatsApp message Meta bills (session replies are free).
      recordCost({ feature: 'whatsapp_template', provider: 'meta_whatsapp', model: 'utility_template', units: { messages: 1 }, userId: link.userId })
      await store.insertOutbound({ phone: link.phone, userId: link.userId, kind, body: text, status: 'sent', wamid })
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

/** Cooldown per kind: the Sunday nudge every 3 days, everything else daily. */
const COOLDOWN_MS: Record<ProactiveKind, number> = {
  daily_brief: DAILY_BRIEF_COOLDOWN_MS,
  weekly_nudge: WEEKLY_NUDGE_COOLDOWN_MS,
  prep_alerts: 0,
  cooking_reminder: DAILY_BRIEF_COOLDOWN_MS,
  dinner_checkin: DAILY_BRIEF_COOLDOWN_MS,
  shopping_reminder: 3 * 24 * 60 * 60 * 1000,
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
        webUrl: env.WEB_PUBLIC_URL,
      })
      for (const p of planned) await sendProactive(link, p.messages, p.kind, now)
    } catch (err: any) {
      console.error(`[whatsapp] proactive tick failed for ${link.userId}:`, err?.message ?? err)
    }
  }
}
