import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm'
import { isHealthMemoryKey, shouldAskRating, type DayMenu } from '@ona/shared'
import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { activityEvents, chatMessages, cookLogs, householdMembers, households, menus, recipes, usageEvents, userFeedback, userMemories, users, whatsappMessages } from '../../db/schema.js'
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
  deliveryFor,
  templateParamFrom,
  withText,
  parseTemplateMap,
  PROACTIVE_KINDS,
  BUTTONS_NEED_MIMO,
  withoutMimoButtonAvisos,
  shoppingUseFrom,
  todayDinnerOf,
  type ShoppingUse,
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
import { isOnFreePlan } from '../accountAccess.js'
import { logEntriesFor, noticePriority, planMoment, countsAgainstBudget, type DeliveryResult } from '../notifications/budget.js'
import { budgetKeyFor, loadFullBudgetState, recentNoticeKinds, recordNotices } from '../notifications/budgetStore.js'
import { isAwakeTime } from '../notifications/hours.js'
import { HOUSEHOLD_NOTICE_KINDS, householdNoticeRecipient, type HouseholdMember } from '../notifications/recipient.js'
import { taperTomorrow } from '../taper.js'
import { listPantryForUser } from '../pantryStore.js'
import { freezerItemsDue } from '@ona/shared'
import { quietAfterSignUp } from './signUpQuiet.js'
import { isShoppingReminderWindow } from './proactive.js'
import { loadHouseholdAlertTimes, loadUserAlertPrefs, mergeAlertPrefs, setAlertPrefs } from '../notifications/alertPrefs.js'
import { ratingToSave } from './checkinButtons.js'
import { detectLanguage, type Lang } from './language.js'
import { DORMANT_SKIPPED_KINDS, FATIGUE_KINDS, FATIGUE_STREAK, PAUSE_ASK_KIND, avisoPauseState, fatigueQuestion, isDormant, type FatigueKind } from './fatigue.js'
import { OPT_OUT_REASON_TAG, type OptOutReason } from './optOutReason.js'
import { fallbackKindsToday, pushFallbackForProactive, type WhatsAppAlertState } from '../notifications/channels.js'
import { fillRecipeNames } from '../menuNames.js'
import { stripAiSignature, withAiSignature } from './aiNotice.js'

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
  opts: { meta?: ReturnType<typeof guidedMeta>; templateKind?: string } = {},
): Promise<ChannelOutcome> {
  const meta = opts.meta
  // 19-nov: the pause question goes, outside the window, by its aviso's own template.
  const { delivery, template } = deliveryFor(opts.templateKind ?? kind, link.lastInboundAt, now, TEMPLATES, env.WHATSAPP_TEMPLATE_NAME)
  if (delivery === 'skip') return { status: 'skipped', error: 'outside-24h-window' }
  try {
    if (delivery === 'session') {
      // PRO-1169: free-form, so the AI line goes in the message itself (a
      // template carries it in its footer, registered in Meta).
      for (const m of withAiSignature(messages)) {
        const wamid = await client.sendMessage(link.phone, m)
        void recordServiceMessageCost(link.userId)
        await store.insertOutbound({ phone: link.phone, userId: link.userId, kind, body: m.text, status: 'sent', wamid, meta })
      }
    } else {
      const lang: Lang = messages.some((m) => m.type === 'buttons')
        ? await languageForPhone(link.phone).catch((): Lang => 'es')
        : 'es'
      const text = templateParamFrom(messages, lang)
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
  // PRO-296: a dish saved without its name reads with its recipe's.
  return menu ? { ...menu, days: await fillRecipeNames(menu.days, db) } : null
}

async function loadTodayDay(userId: string, parts: MadridParts): Promise<DayMenu | null> {
  const menu = await latestMenuForWeek(userId, mondayOf(parts.isoDate, parts.weekday))
  const days = menu?.days as DayMenu[] | undefined
  return days?.[parts.weekday] ?? null
}

async function loadTodayDinner(userId: string, parts: MadridParts): Promise<TodayDinner | null> {
  const menu = await latestMenuForWeek(userId, mondayOf(parts.isoDate, parts.weekday))
  const day = (menu?.days as DayMenu[] | undefined)?.[parts.weekday] ?? null
  const dishes = (day?.dinner?.dishes ?? []) as Array<{ kind: string; recipeId?: string; recipeName?: string; text?: string }>
  const ids = dishes.filter((d) => d.kind === 'recipe' && d.recipeId).map((d) => d.recipeId!)
  if (ids.length === 0) return null
  const rows = await db
    .select({
      id: recipes.id,
      totalTime: recipes.totalTime,
      prepTime: recipes.prepTime,
      cookTime: recipes.cookTime,
      course: recipes.course,
      tags: recipes.tags,
      dishTypes: recipes.dishTypes,
    })
    .from(recipes)
    .where(inArray(recipes.id, ids))
  // 19-nov: desserts left out (no check-in about a flan, no minutes of one).
  return todayDinnerOf(dishes, rows, menu?.id)
}

/**
 * 18-nov: a tapped «¿hiciste la cena?» button, recorded without the model
 * (it cost a turn, and over the monthly cap the answer was lost). On the day
 * the check-in went out: «Sí» logs that dinner as cooked (once: not if
 * something was logged since the check-in), and «¡a repetir!» / «estuvo
 * bien» rate it 5 / 3, through the same app routes as `log_cooked` and
 * `update_recipe_notes`. Null when that day has no dinner recipe (the tap
 * then goes to Mimo as before).
 */
export async function recordDinnerCheckinAnswer(
  userId: string,
  answer: { cooked: boolean; rating: number | null },
  checkinAt: Date,
): Promise<{ name: string } | null> {
  const parts = madridParts(checkinAt)
  const dinner = await loadTodayDinner(userId, parts)
  const recipeId = dinner?.recipeIds?.[0]
  if (!dinner || !recipeId) return null
  if (!answer.cooked) return { name: dinner.names[0] }
  const api = appApiFor(userId, { channel: 'whatsapp' })
  const [logged] = await db
    .select({ id: cookLogs.id })
    .from(cookLogs)
    // PRO-1295: this dinner's log — an old check-in tapped days later isn't
    // «logged» by another day's dinner.
    .where(and(eq(cookLogs.userId, userId), eq(cookLogs.recipeId, recipeId), gte(cookLogs.cookedAt, checkinAt)))
    .limit(1)
  if (!logged) {
    await api('POST', '/cook-logs', {
      recipeId,
      ...(dinner.menuId ? { menuId: dinner.menuId, dayIndex: parts.weekday, meal: 'dinner' } : {}),
    })
  }
  // 19-nov: 👍 never lowers a 5 nor writes the same rating again.
  const rating = answer.rating ? ratingToSave((await getRecipeNotesForUser(userId, recipeId))?.rating ?? null, answer.rating) : null
  if (rating) await api('PUT', `/recipes/${recipeId}/notes`, { rating })
  return { name: dinner.names[0] }
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

async function pendingShopping(userId: string): Promise<Array<{ name: string; aisle?: string | null }>> {
  const list = await appApiFor(userId)<{ items?: Array<{ name: string; aisle?: string | null; checked?: boolean; inStock?: boolean; skipped?: boolean }> }>('GET', '/shopping-list')
  return (list?.items ?? []).filter((i) => !i.checked && !i.inStock && !i.skipped).map((i) => ({ name: i.name, aisle: i.aisle ?? null }))
}

/**
 * 19-nov: how this household uses the shopping list (its ticks of the last
 * 4 weeks, `shoppingUseFrom`), read once a day per person: the tick runs
 * every 5 minutes and needs it before deciding to touch the DB.
 */
const shoppingUseCache = new Map<string, { day: string; use: Promise<ShoppingUse> }>()
function shoppingUseFor(userId: string, parts: MadridParts, now: Date): Promise<ShoppingUse> {
  const hit = shoppingUseCache.get(userId)
  if (hit && hit.day === parts.isoDate) return hit.use
  const use = (async () => {
    const [u] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
    const since = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)
    const who = u?.householdId ? eq(activityEvents.householdId, u.householdId) : eq(activityEvents.userId, userId)
    const rows = await db
      .select({ at: activityEvents.createdAt })
      .from(activityEvents)
      .where(and(who, inArray(activityEvents.kind, ['shopping_check', 'shopping_stock']), gte(activityEvents.createdAt, since)))
    return shoppingUseFrom(rows.map((r) => r.at).filter((d): d is Date => d instanceof Date), now, madridParts)
  })().catch((err) => {
    console.warn('[whatsapp] shopping use not read (Saturday as before):', err?.message ?? err)
    shoppingUseCache.delete(userId)
    return { usedRecently: true, day: null, hour: null } as ShoppingUse
  })
  shoppingUseCache.set(userId, { day: parts.isoDate, use })
  return use
}

/** 19-nov: tonight's dish was cooked in the last 4 days and is already rated: leftovers, no check-in. */
async function isRatedLeftover(userId: string, recipeId: string, now: Date): Promise<boolean> {
  if (shouldAskRating(await getRecipeNotesForUser(userId, recipeId), now)) return false
  const [row] = await db
    .select({ id: cookLogs.id })
    .from(cookLogs)
    .where(and(eq(cookLogs.userId, userId), eq(cookLogs.recipeId, recipeId), gte(cookLogs.cookedAt, new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000))))
    .limit(1)
  return Boolean(row)
}

/** 19-nov: the language this number writes in (language.ts). Never throws: Spanish. */
export async function languageForPhone(phone: string): Promise<Lang> {
  try {
    return detectLanguage(await store.recentInboundTexts(phone))
  } catch {
    return 'es'
  }
}

/**
 * The answer to «¿Te sigo avisando?» (fatigue.ts). PRO-1303 (`todos`): the
 * answer itself lifts the pause; «No» also switches every aviso off. A
 * question from before (one kind): that kind on or off.
 */
export async function setAvisoKind(userId: string, kind: FatigueKind | 'todos', on: boolean): Promise<void> {
  if (kind !== 'todos') await setAlertPrefs(userId, { [kind]: on } as Record<string, boolean>)
  else if (!on) await setAlertPrefs(userId, Object.fromEntries(FATIGUE_KINDS.map((k) => [k, false])))
}

/** 19-nov (optOutReason.ts): why they wrote BAJA, as an opinion tagged `baja_avisos`. */
export async function saveOptOutReason(userId: string, reason: OptOutReason, text: string): Promise<void> {
  await db.insert(userFeedback).values({ userId, channel: 'whatsapp', text: text.slice(0, 2000), tag: OPT_OUT_REASON_TAG, answer: reason })
}

/** PRO-1303: the last time this person used the app (any usage event from the web). */
async function lastAppUseAt(userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: sql<Date | null>`max(${usageEvents.createdAt})` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), eq(usageEvents.channel, 'web')))
  return row?.at ? new Date(row.at) : null
}

/**
 * PRO-1303 (fatigue.ts): may avisos go to this number now? False when every
 * aviso is paused — and, when 3 in a row went unanswered, the single
 * «¿Te sigo avisando?» goes out now (by `templateKind`'s template outside the
 * 24 h window) and starts the pause. Never throws: true (as before).
 */
export async function avisosMayGo(link: LinkWithUser, templateKind: string, now: Date): Promise<boolean> {
  try {
    const [rows, appSeenAt] = await Promise.all([
      store.avisoActivity(link.phone, new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)),
      lastAppUseAt(link.userId),
    ])
    const state = avisoPauseState(rows, appSeenAt, now)
    if (state === 'send') return true
    if (state === 'ask') {
      console.info(`[whatsapp] avisos paused for ${link.userId}: ${FATIGUE_STREAK}+ unanswered in a row`)
      await sendProactive(link, [fatigueQuestion(await languageForPhone(link.phone))], PAUSE_ASK_KIND, now, { templateKind })
    }
    return false
  } catch (err: any) {
    console.warn('[whatsapp] aviso pause not read (sending):', err?.message ?? err)
    return true
  }
}

/** PRO-1303: the prep alerts' tick asks the same (by the user's WhatsApp, when linked). */
export async function prepAlertsMayGo(userId: string, now: Date = new Date()): Promise<boolean> {
  const link = await notifiableLink(userId)
  return link ? avisosMayGo(link, 'prep_alerts', now) : true
}

/**
 * PRO-1303: a household that hasn't opened this week's menu in the app nor
 * written to Mimo in 14 days (fatigue.ts `isDormant`). Never throws: false.
 */
async function isDormantHousehold(link: LinkWithUser, parts: MadridParts, now: Date): Promise<boolean> {
  try {
    const [u] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, link.userId)).limit(1)
    const who = u?.householdId ? eq(usageEvents.householdId, u.householdId) : eq(usageEvents.userId, link.userId)
    const monday = madridMidnightUtc(mondayOf(parts.isoDate, parts.weekday))
    const [opened] = await db
      .select({ id: usageEvents.id })
      .from(usageEvents)
      .where(
        and(
          who,
          gte(usageEvents.createdAt, monday),
          or(and(eq(usageEvents.name, 'screen_viewed'), sql`${usageEvents.props}->>'screen' = 'menu'`), eq(usageEvents.name, 'autoplan_viewed')),
        ),
      )
      .limit(1)
    if (opened) return false
    const [wrote] = await db
      .select({ at: sql<Date | null>`max(${usageEvents.createdAt})` })
      .from(usageEvents)
      .where(and(who, eq(usageEvents.name, 'mimo_message')))
    const lastWroteAt = [link.lastInboundAt, wrote?.at ? new Date(wrote.at) : null]
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
    return isDormant({ openedWeekMenu: false, lastWroteAt }, now)
  } catch (err: any) {
    console.warn('[whatsapp] dormant check failed (sending):', err?.message ?? err)
    return false
  }
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
  if ((await getMonthlySpendMicros(userId, db)) >= budgetMicros(userId)) return true
  const [row] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1)
  if (row?.role === 'admin') return false
  return (await spendCapStatus(userId)).exceeded
}

const NOT_CONVERSATION = new Set(['system', 'link', 'ack', 'review', 'optout', 'optin', 'optin_prompt', 'image_failed'])
const GUIDE_MEMORY_SKIP = new Set(['meal_times', 'time_available'])

/** What the writer knows of the house: memory (never health keys), the last 12 h of chat, earlier messages of the kind. */
export async function guidedContextFor(link: Pick<LinkWithUser, 'userId' | 'phone'>, kind: string, now: Date = new Date()): Promise<GuidedContext> {
  const [memRows, history, previous, lastAvisos] = await Promise.all([
    db.select({ key: userMemories.key, value: userMemories.value }).from(userMemories).where(eq(userMemories.userId, link.userId)),
    store.loadHistoryRows(link.phone, new Date(now.getTime() - 12 * 60 * 60 * 1000), link.userId),
    store.recentOutboundBodies(link.phone, kind, 5),
    // PRO-274: the last avisos of any kind, so two in a row don't open the same.
    store.recentOutboundBodiesOfKinds(link.phone, [...PROACTIVE_KINDS, 'alert'], 3),
  ])
  // PRO-1169: the AI line is the code's, not something for the writer to copy.
  const unsigned = (bodies: string[]) => bodies.map(stripAiSignature)
  const memory = memRows
    .filter((r) => !isHealthMemoryKey(r.key) && !GUIDE_MEMORY_SKIP.has(r.key) && !r.key.startsWith('physical.'))
    .map((r) => `${r.key}: ${typeof r.value === 'string' ? r.value : JSON.stringify(r.value)}`)
    .slice(0, 20)
  const recent = history
    .filter((r) => r.body && !NOT_CONVERSATION.has(r.kind ?? '') && (r.direction === 'in' ? r.status === 'processed' : r.status === 'sent'))
    .slice(-8)
    .map((r) => ({ who: r.direction === 'in' ? ('usuario' as const) : ('mimo' as const), text: stripAiSignature(r.body!) }))
  return { memory, recent, previous: unsigned(previous), lastAvisos: unsigned(lastAvisos) }
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
      // PRO-385 (D-158): Mimo writing first isn't in the Gratis plan (never before launch day).
      if (await isOnFreePlan(link.userId, now)) continue
      const times = await loadMealTimes(link.userId)
      // PRO-1301: the household's own time for the morning menu and the dinner question.
      const alertTimes = await loadHouseholdAlertTimes(link.userId)
      const shoppingUse = await shoppingUseFor(link.userId, parts, now)
      // Only touch the DB for cooldowns inside a window that could fire.
      if (!anyProactiveWindow(parts, times.breakfast, times.dinner, shoppingUse, alertTimes)) continue
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
      if (isShoppingReminderWindow(parts, shoppingUse) && !sentRecently.shopping_reminder) {
        const [u] = await db.select({ at: users.onboardingCompletedAt }).from(users).where(eq(users.id, link.userId)).limit(1)
        if (quietAfterSignUp('shopping_reminder', u?.at ?? null, now)) sentRecently.shopping_reminder = true
      }
      let dinnerCache: Promise<TodayDinner | null> | null = null
      const planned = await planProactive({
        parts,
        breakfastTime: times.breakfast,
        dinnerTime: times.dinner,
        alertTimes,
        // A kind is off if WhatsApp's prefs, «Avisos» (PRO-237) or the household
        // recipient rule (PRO-236: shopping/Sunday to one person) say so.
        prefs: mergeAlertPrefs(link.prefs, userPrefs, household.offFor(link.userId)),
        sentRecently,
        todayDay: () => loadTodayDay(link.userId, parts),
        todayDinner: () => (dinnerCache ??= loadTodayDinner(link.userId, parts)),
        cookedToday: () => cookedToday(link.userId, parts),
        pendingShopping: () => pendingShopping(link.userId),
        shoppingUse,
        hasNextWeekMenu: async () =>
          Boolean(await latestMenuForWeek(link.userId, mondayOf(parts.isoDate, parts.weekday, 1))),
        sawTodaysMenu: () => sawMenuThisMorning(link.userId, parts, now),
        ratedLeftover: (recipeId) => isRatedLeftover(link.userId, recipeId, now),
        language: () => languageForPhone(link.phone),
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
      // 18-nov: over the monthly cap, no avisos whose buttons need Mimo.
      const capped = planned.some((p) => BUTTONS_NEED_MIMO.has(p.kind) || p.kind === 'cooking_reminder')
        ? withoutMimoButtonAvisos(planned, await guidedOverBudget(link.userId))
        : planned
      if (capped.length === 0) continue
      // PRO-1303: no «hora de cocinar» nor «¿qué tal la cena?» to a household
      // that hasn't opened this week's menu nor written in 14 days.
      const toSend = capped.some((p) => DORMANT_SKIPPED_KINDS.has(p.kind)) && (await isDormantHousehold(link, parts, now))
        ? capped.filter((p) => !DORMANT_SKIPPED_KINDS.has(p.kind))
        : capped
      if (toSend.length === 0) continue
      // PRO-1303: 3 avisos of any kind unanswered → one question, and all wait.
      if (!(await avisosMayGo(link, toSend[0].kind, now))) continue
      await sendMoment(link, toSend, parts.isoDate, now)
    } catch (err: any) {
      console.error(`[whatsapp] proactive tick failed for ${link.userId}:`, err?.message ?? err)
    }
  }
}
