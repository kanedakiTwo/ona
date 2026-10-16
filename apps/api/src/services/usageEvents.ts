/**
 * Product analytics, own table (`usage_events`), no third party — see
 * specs/metrics.md "Usage events". One row per thing a user did, read by
 * GET /admin/usage (counts only) for the Mimoia HQ agents.
 *
 * Where events come from:
 *   - web: `trackUsageRoutes`, an app-level middleware that watches the
 *     matching routes finish with 2xx (same pattern as activityEvents.ts), plus
 *     a few inline calls where the route can't tell from the request alone
 *     (register, the shopping check toggle);
 *   - Mimo (web chat, voice, WhatsApp): the assistant tool runner reports the
 *     skills that ran (`recordSkillUsage`), with the conversation's channel.
 *     Skills that call the app's own REST API (appApi.ts) send the header
 *     `x-mimoia-internal`, and the middleware skips those calls, so nothing is
 *     counted twice;
 *   - WhatsApp: inbound.ts (one `mimo_message` per turn, photo imports) and
 *     the linking step.
 *
 * Privacy: `props` holds small enums / counts / booleans only (sanitised
 * here), never free text, names, phones or URLs.
 *
 * Fire-and-forget like the cost ledger: never throws, never blocks the request.
 */
import type { NextFunction, Request, Response } from 'express'
import { sql } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { carrefourLinks, type CarrefourLineInput } from '@ona/shared'
import { detectSocialPlatform } from './sources/social.js'
import { detectSourceType } from './sources/sourceType.js'

export const USAGE_EVENTS = [
  'signup_completed',
  'app_opened_installed',
  'onboarding_completed',
  'first_steps_completed',
  'first_steps_skipped',
  'menu_generated',
  'meal_swapped',
  'shopping_list_viewed',
  'shopping_item_checked',
  'recipe_imported',
  'recipe_created',
  'cook_mode_started',
  'meal_cooked',
  'mimo_message',
  'whatsapp_linked',
  'invite_shared',
  'shop_order_prepared',
  'carrefour_click',
] as const
export type UsageEventName = (typeof USAGE_EVENTS)[number]

/**
 * Passive signals: counted as events, but they don't make a household
 * "active" in GET /admin/usage (opening the app is not using it).
 */
export const PASSIVE_USAGE_EVENTS: ReadonlySet<string> = new Set<UsageEventName>(['app_opened_installed'])

export const USAGE_CHANNELS = ['web', 'whatsapp', 'voice'] as const
export type UsageChannel = (typeof USAGE_CHANNELS)[number]

/** Header the assistant's loopback calls (appApi.ts) carry: those requests are not counted by the middleware. */
export const INTERNAL_CALL_HEADER = 'x-mimoia-internal'

/** Days a usage event is kept (purged daily by the scheduler tick). */
export const USAGE_RETENTION_DAYS = 180

export type UsageProps = Record<string, string | number | boolean>

const PROP_MAX_KEYS = 8
const PROP_KEY_RE = /^[a-z][a-zA-Z0-9_]{0,31}$/
/** Enum-like values only: a short slug, never a sentence, URL, email or phone. */
const PROP_VALUE_RE = /^[a-z0-9_-]{1,32}$/

/** Pure: keeps only small, non-identifying props (slugs, finite numbers, booleans). */
export function sanitizeProps(props: unknown): UsageProps | null {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null
  const out: UsageProps = {}
  for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
    if (Object.keys(out).length >= PROP_MAX_KEYS) break
    if (!PROP_KEY_RE.test(k)) continue
    if (typeof v === 'boolean') out[k] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 1000) / 1000
    else if (typeof v === 'string' && PROP_VALUE_RE.test(v)) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

/** Pure: assistant mode → analytics channel. */
export function channelOfMode(mode: string | undefined | null): UsageChannel {
  if (mode === 'whatsapp') return 'whatsapp'
  if (mode === 'voice') return 'voice'
  return 'web'
}

export interface TrackOptions {
  userId?: string | null
  /** Defaults to the user's primary household at insert time. */
  householdId?: string | null
  channel?: UsageChannel | null
  props?: UsageProps | null
}

/** Record one usage event. Never throws, never awaits the DB. */
export function trackEvent(name: UsageEventName, opts: TrackOptions = {}): void {
  try {
    if (!(USAGE_EVENTS as readonly string[]).includes(name)) return
    // Unit tests run without a migrated DB; never write to the developer's DB from vitest.
    if (process.env.VITEST) return
    const userId = opts.userId ?? null
    const channel = opts.channel && (USAGE_CHANNELS as readonly string[]).includes(opts.channel) ? opts.channel : null
    const props = sanitizeProps(opts.props)
    const household = opts.householdId
      ? sql`${opts.householdId}::uuid`
      : userId
        ? sql`(SELECT primary_household_id FROM users WHERE id = ${userId}::uuid)`
        : sql`NULL`
    db.execute(sql`
      INSERT INTO usage_events (user_id, household_id, name, channel, props)
      VALUES (${userId}::uuid, ${household}, ${name}, ${channel}, ${props ? JSON.stringify(props) : null}::jsonb)
    `).catch((err: any) => console.warn('[usage] record failed (ignored):', err?.message ?? err))
  } catch (err: any) {
    console.warn('[usage] record failed (ignored):', err?.message ?? err)
  }
}

/** Pure: where a recipe link comes from, for `recipe_imported.props`. */
export function urlImportProps(url: unknown, channel: UsageChannel): UsageProps {
  let kind = 'article'
  try {
    const u = String(url ?? '')
    kind = detectSocialPlatform(u) ?? detectSourceType(u)
  } catch {
    kind = 'unknown'
  }
  const social = kind === 'instagram' || kind === 'tiktok'
  return { source: social ? 'social' : channel === 'whatsapp' ? 'whatsapp_url' : 'url', kind }
}

/**
 * Pure: `carrefour_click` props for a click on «Hacer este pedido en
 * Carrefour.es» (PRO-84): only how many lines the card had, nothing else.
 */
export function carrefourClickProps(lines: CarrefourLineInput[]): UsageProps {
  return { items: carrefourLinks(lines).length }
}

// ─── Web routes (middleware) ───────────────────────────────────────

interface RouteEvent {
  method: string
  re: RegExp
  event: (req: Request) => { name: UsageEventName; props?: UsageProps; channel?: UsageChannel } | null
}

const ROUTE_EVENTS: RouteEvent[] = [
  { method: 'POST', re: /^\/user\/[^/]+\/onboarding\/?$/, event: () => ({ name: 'onboarding_completed' }) },
  {
    method: 'POST',
    re: /^\/user\/[^/]+\/first-steps\/?$/,
    event: (req) => {
      const outcome = req.body?.outcome
      if (outcome === 'completed') return { name: 'first_steps_completed' }
      if (outcome === 'skipped') return { name: 'first_steps_skipped' }
      return null
    },
  },
  { method: 'POST', re: /^\/menu\/generate\/?$/, event: () => ({ name: 'menu_generated' }) },
  {
    method: 'PUT',
    re: /^\/menu\/[^/]+\/day\/[^/]+\/meal\/[^/]+\/?$/,
    event: (req) => ({ name: 'meal_swapped', props: { target: 'meal', how: req.body?.recipeId ? 'picked' : 'auto' } }),
  },
  {
    method: 'POST',
    re: /^\/menu\/[^/]+\/day\/[^/]+\/meal\/[^/]+\/dish\/[^/]+\/regenerate\/?$/,
    event: () => ({ name: 'meal_swapped', props: { target: 'dish', how: 'auto' } }),
  },
  { method: 'GET', re: /^\/shopping-list\/?$/, event: () => ({ name: 'shopping_list_viewed' }) },
  { method: 'GET', re: /^\/shopping-list\/[^/]+\/?$/, event: () => ({ name: 'shopping_list_viewed' }) },
  { method: 'POST', re: /^\/recipes\/extract-from-image\/?$/, event: () => ({ name: 'recipe_imported', props: { source: 'photo' } }) },
  {
    method: 'POST',
    re: /^\/recipes\/extract-from-url\/?$/,
    event: (req) => ({ name: 'recipe_imported', props: urlImportProps(req.body?.url, 'web') }),
  },
  { method: 'POST', re: /^\/recipes\/?$/, event: (req) => ({ name: 'recipe_created', props: { withSource: Boolean(req.body?.sourceUrl) } }) },
  { method: 'POST', re: /^\/cook-logs\/?$/, event: () => ({ name: 'meal_cooked' }) },
  {
    method: 'POST',
    re: /^\/assistant\/[^/]+\/chat\/?$/,
    event: (req) => ({ name: 'mimo_message', channel: channelOfMode(req.body?.mode) }),
  },
  { method: 'POST', re: /^\/shop-orders\/prepare\/?$/, event: () => ({ name: 'shop_order_prepared' }) },
]

/** Pure: the usage event a finished web request represents, or null. */
export function routeUsageEvent(
  req: Pick<Request, 'method' | 'path' | 'body'> & { get?: (h: string) => string | undefined },
): { name: UsageEventName; props?: UsageProps; channel: UsageChannel } | null {
  if (req.get?.(INTERNAL_CALL_HEADER)) return null
  const route = ROUTE_EVENTS.find((r) => r.method === req.method && r.re.test(req.path))
  if (!route) return null
  const ev = route.event(req as Request)
  return ev ? { ...ev, channel: ev.channel ?? 'web' } : null
}

/**
 * App-level middleware (index.ts, before the routers): once a tracked route
 * finishes with 2xx, record the event for the user `authMiddleware` attached.
 */
export function trackUsageRoutes(req: Request, res: Response, next: NextFunction): void {
  try {
    const ev = routeUsageEvent(req)
    if (ev) {
      res.on('finish', () => {
        const userId = (req as Request & { userId?: string }).userId
        if (userId && res.statusCode >= 200 && res.statusCode < 300) {
          trackEvent(ev.name, { userId, channel: ev.channel, props: ev.props })
        }
      })
    }
  } catch (err: any) {
    console.warn('[usage] middleware failed (ignored):', err?.message ?? err)
  }
  next()
}

// ─── Mimo skills ───────────────────────────────────────────────────

/**
 * Pure: the usage events a skill result represents. Skills report "not found"
 * / "nothing changed" with `data: null` — those don't count.
 */
export function skillUsageEvents(
  skillName: string,
  result: { data?: any } | null | undefined,
  channel: UsageChannel,
  input?: any,
): Array<{ name: UsageEventName; props?: UsageProps }> {
  if (!result || result.data == null) return []
  switch (skillName) {
    case 'generate_weekly_menu':
      return [{ name: 'menu_generated' }]
    case 'complete_onboarding':
      return [{ name: 'onboarding_completed' }, { name: 'menu_generated' }]
    case 'swap_meal':
      return [{ name: 'meal_swapped', props: { target: 'meal', how: input?.recipeId || input?.recipeName ? 'picked' : 'auto' } }]
    case 'get_shopping_list':
      return [{ name: 'shopping_list_viewed' }]
    case 'check_shopping_item':
      return [{ name: 'shopping_item_checked' }]
    case 'import_recipe_from_url':
      return [{ name: 'recipe_imported', props: urlImportProps(input?.url, channel) }]
    case 'create_recipe':
      return [{ name: 'recipe_created', props: { withSource: false } }]
    case 'start_cooking_mode':
      return [{ name: 'cook_mode_started' }]
    case 'log_cooked':
      return [{ name: 'meal_cooked' }]
    case 'prepare_shop_orders':
      return Array.isArray(result.data?.orderIds) && result.data.orderIds.length > 0
        ? [{ name: 'shop_order_prepared', props: { orders: result.data.orderIds.length } }]
        : []
    default:
      return []
  }
}

/** Assistant / voice tool runners call this after a skill ran. */
export function recordSkillUsage(
  skillName: string,
  ctx: { userId: string; channel?: string },
  result: { data?: unknown } | null | undefined,
  input?: unknown,
): void {
  try {
    const channel = channelOfMode(ctx.channel)
    for (const ev of skillUsageEvents(skillName, result, channel, input)) {
      trackEvent(ev.name, { userId: ctx.userId, channel, props: ev.props })
    }
  } catch (err: any) {
    console.warn('[usage] skill record failed (ignored):', err?.message ?? err)
  }
}

// ─── Retention ─────────────────────────────────────────────────────

let lastPurgeDay: string | null = null

/** Called from the scheduler tick: delete events older than 180 days, once per day per process. */
export async function purgeOldUsageEventsIfDue(now: Date = new Date()): Promise<number | null> {
  const day = now.toISOString().slice(0, 10)
  if (lastPurgeDay === day) return null
  lastPurgeDay = day
  const res: any = await db.execute(sql`
    DELETE FROM usage_events WHERE created_at < now() - make_interval(days => ${USAGE_RETENTION_DAYS})
  `)
  return typeof res?.rowCount === 'number' ? res.rowCount : null
}
