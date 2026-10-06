import { and, desc, eq } from 'drizzle-orm'
import type { DayMenu } from '@ona/shared'
import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { menus, userMemories } from '../../db/schema.js'
import { resolveScope, scopeWhere } from '../scopeResolver.js'
import { isUserAllowed, isWhatsAppConfigured } from './config.js'
import * as store from './store.js'
import * as client from './client.js'
import type { LinkWithUser } from './store.js'
import type { OutboundMessage } from './render.js'
import {
  DAILY_BRIEF_COOLDOWN_MS,
  WEEKLY_NUDGE_COOLDOWN_MS,
  chooseDelivery,
  isDailyBriefWindow,
  isWeeklyNudgeWindow,
  madridParts,
  mondayOf,
  planProactive,
  templateParamFrom,
  type ChannelOutcome,
  type MadridParts,
} from './proactive.js'

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
  if (!link) return { status: 'skipped' }
  const link_ = payload.url ? `\n\nVer en la app: ${env.WEB_PUBLIC_URL}${payload.url}` : ''
  return sendProactive(link, [{ type: 'text', text: `*${payload.title}*\n${payload.body}${link_}` }], 'alert', now)
}

async function loadBreakfastTime(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ value: userMemories.value })
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), eq(userMemories.key, 'meal_times')))
    .limit(1)
  const v = row?.value as { breakfast?: unknown } | undefined
  return typeof v?.breakfast === 'string' ? v.breakfast : null
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

/**
 * Daily brief + Sunday nudge for every linked user who opted in. Called from
 * the notification scheduler tick (every 5 min); cooldowns stored as
 * outbound rows make it idempotent across ticks.
 */
export async function runProactiveTick(now: Date = new Date()): Promise<void> {
  if (!isWhatsAppConfigured()) return
  const parts = madridParts(now)
  const links = await store.listNotifiableLinks()
  for (const link of links) {
    if (!isUserAllowed(link.email)) continue
    try {
      const breakfastTime = await loadBreakfastTime(link.userId)
      // Only touch the DB for cooldowns inside a window that could fire.
      if (!isDailyBriefWindow(parts, breakfastTime) && !isWeeklyNudgeWindow(parts)) continue
      const since = (ms: number) => new Date(now.getTime() - ms)
      const planned = await planProactive({
        parts,
        breakfastTime,
        briefedRecently: await store.hasRecentOutbound(link.phone, ['daily_brief'], since(DAILY_BRIEF_COOLDOWN_MS)),
        nudgedRecently: await store.hasRecentOutbound(link.phone, ['weekly_nudge'], since(WEEKLY_NUDGE_COOLDOWN_MS)),
        todayDay: () => loadTodayDay(link.userId, parts),
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
