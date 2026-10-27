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
import { ALERT_KINDS, carrefourLinks, type BasketSendResult, type CarrefourLineInput } from '@ona/shared'
import { detectSocialPlatform } from './sources/social.js'
import { detectSourceType } from './sources/sourceType.js'

export const USAGE_EVENTS = [
  'signup_completed',
  'app_opened_installed',
  'onboarding_completed',
  'onboarding_whatsapp_chosen',
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
  'basket_extension_sent',
  'basket_extension_undo',
  'notifications_off',
  // PRO-120 (Legal: own events, no text; the daily cap lives on the server, never in the browser).
  'onboarding_step',
  'screen_viewed',
  'recipe_viewed',
  'taste_tuning',
  'push_opened',
  'alerts_changed',
  'whatsapp_unlinked',
  'feedback_left',
  // PRO-1022: every Mimo tool that returned data (`props.skill` = the tool's name, `props.canal`). Never text.
  'mimo_skill_used',
] as const
export type UsageEventName = (typeof USAGE_EVENTS)[number]

/**
 * Passive signals: counted as events, but they don't make a household
 * "active" in GET /admin/usage (opening the app is not using it).
 */
export const PASSIVE_USAGE_EVENTS: ReadonlySet<string> = new Set<UsageEventName>([
  'app_opened_installed',
  'notifications_off',
  // PRO-120: looking at a screen, tapping a notification or changing a switch is not using Mimoia.
  'screen_viewed',
  'push_opened',
  'alerts_changed',
  'whatsapp_unlinked',
])

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

/**
 * Puro: props de `basket_extension_sent` (spec: «Rutas»): recuentos por
 * estado y el código de error. Nunca nombres de productos.
 */
export function basketSentProps(r: BasketSendResult): UsageProps {
  const count = (estado: string) => r.lineas.filter((l) => l.estado === estado).length
  return {
    lineas: r.lineas.length,
    tabla: count('tabla'),
    busqueda: count('busqueda'),
    fallidas: count('fallida') + count('no_verificada'),
    ok: r.ok,
    error: r.error ?? 'ninguno',
    bajoMinimo: r.bajoMinimo,
  }
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
  {
    // «Por WhatsApp» on the first onboarding screen (PRO-106). Perfil and /whatsapp/conectar send no `from`.
    method: 'POST',
    re: /^\/whatsapp\/link-code\/?$/,
    event: (req) => (req.body?.from === 'onboarding' ? { name: 'onboarding_whatsapp_chosen' } : null),
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
  // Opening cook mode on the web (PRO-188): the page pings this once on open.
  { method: 'POST', re: /^\/usage\/cook-mode-started\/?$/, event: () => ({ name: 'cook_mode_started' }) },
  {
    method: 'POST',
    re: /^\/assistant\/[^/]+\/chat\/?$/,
    event: (req) => ({ name: 'mimo_message', channel: channelOfMode(req.body?.mode) }),
  },
  { method: 'POST', re: /^\/shop-orders\/prepare\/?$/, event: () => ({ name: 'shop_order_prepared' }) },
  // PRO-120: an opinion left with the «Opinión» button (Mimo's own calls carry the internal header; see skillUsageEvents).
  { method: 'POST', re: /^\/feedback\/?$/, event: () => ({ name: 'feedback_left', props: { channel: 'boton' } }) },
  { method: 'DELETE', re: /^\/whatsapp\/link\/?$/, event: () => ({ name: 'whatsapp_unlinked' }) },
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

/** Where a Mimo conversation happens, for `mimo_skill_used.props.canal`: Telegram runs in the whatsapp mode (PRO-313). */
export const SKILL_CANALES = ['web', 'whatsapp', 'telegram', 'voice'] as const
export type SkillCanal = (typeof SKILL_CANALES)[number]

/** Pure: the channel plus the chat app (`surface`) → `canal`. */
export function skillCanal(channel: UsageChannel, surface?: string | null): SkillCanal {
  return channel === 'whatsapp' && surface === 'telegram' ? 'telegram' : channel
}

/**
 * Pure: the usage events a skill result represents. Skills report "not found"
 * / "nothing changed" with `data: null` — those don't count. Every tool with
 * data also leaves one `mimo_skill_used` (PRO-1022), named only if it is a
 * slug (PROP_VALUE_RE): the value is always one of the tools' own names.
 */
export function skillUsageEvents(
  skillName: string,
  result: { data?: any } | null | undefined,
  channel: UsageChannel,
  input?: any,
  surface?: string | null,
): Array<{ name: UsageEventName; props?: UsageProps }> {
  if (!result || result.data == null) return []
  const used: Array<{ name: UsageEventName; props?: UsageProps }> = PROP_VALUE_RE.test(skillName)
    ? [{ name: 'mimo_skill_used', props: { skill: skillName, canal: skillCanal(channel, surface) } }]
    : []
  return [...actionSkillEvents(skillName, result, channel, input), ...used]
}

/** Pure: the events of the tools that stand for a product action (menu, list, recipe…). */
function actionSkillEvents(
  skillName: string,
  result: { data?: any },
  channel: UsageChannel,
  input?: any,
): Array<{ name: UsageEventName; props?: UsageProps }> {
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
    // «Ya lo hemos comido» told to Mimo (PRO-188): cooked too, unless it un-marks.
    case 'mark_meal_eaten':
      return input?.eaten === true ? [{ name: 'meal_cooked', props: { via: 'eaten' } }] : []
    case 'prepare_shop_orders':
      return Array.isArray(result.data?.orderIds) && result.data.orderIds.length > 0
        ? [{ name: 'shop_order_prepared', props: { orders: result.data.orderIds.length } }]
        : []
    // PRO-120: an opinion told to Mimo, in the web chat or on WhatsApp. Never the text.
    case 'leave_feedback':
      return [{ name: 'feedback_left', props: { channel: channel === 'whatsapp' ? 'whatsapp' : 'mimo' } }]
    default:
      return []
  }
}

/** Assistant / voice tool runners call this after a skill ran. */
export function recordSkillUsage(
  skillName: string,
  ctx: { userId: string; channel?: string; surface?: string },
  result: { data?: unknown } | null | undefined,
  input?: unknown,
): void {
  try {
    const channel = channelOfMode(ctx.channel)
    for (const ev of skillUsageEvents(skillName, result, channel, input, ctx.surface)) {
      trackEvent(ev.name, { userId: ctx.userId, channel, props: ev.props })
    }
  } catch (err: any) {
    console.warn('[usage] skill record failed (ignored):', err?.message ?? err)
  }
}

// ─── Events the web sends itself (PRO-120) ─────────────────────────

/** «Primeros pasos» on the web, in the order they're shown (the WhatsApp sign-up is one conversation: see specs/metrics.md). */
export const ONBOARDING_STEPS = ['afina', 'canal', 'hogar', 'frecuencia', 'cocina', 'tiempo', 'dieta', 'prioridad'] as const
export const ONBOARDING_STEP_ACTIONS = ['visto', 'hecho'] as const
export const USAGE_SCREENS = ['menu', 'lista', 'compra', 'receta', 'recetas', 'perfil', 'despensa', 'avisos', 'casa'] as const
export const RECIPE_VIEW_FROM = ['menu', 'catalogo', 'mimo', 'lista', 'otro'] as const
export const TASTE_TUNING_ACTIONS = ['empezado', 'terminado', 'abandonado'] as const
/** A tapped notification: its alert kind (the prep reminders are `prep_alerts`) or `otro`. */
export const PUSH_OPENED_KINDS = [...ALERT_KINDS, 'otro'] as const

/** What `POST /usage/event` accepts; the rest are recorded by the API itself. */
export const CLIENT_USAGE_EVENTS = ['onboarding_step', 'screen_viewed', 'recipe_viewed', 'taste_tuning', 'push_opened'] as const
export type ClientUsageEvent = (typeof CLIENT_USAGE_EVENTS)[number]

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null

/**
 * Pure: the props a client event may carry, from closed lists only (never
 * free text); null = not a valid event, nothing is stored.
 */
export function clientEventProps(name: unknown, raw: unknown): { name: ClientUsageEvent; props: UsageProps } | null {
  const ev = oneOf(CLIENT_USAGE_EVENTS, name)
  if (!ev) return null
  const p = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  switch (ev) {
    case 'onboarding_step': {
      const step = oneOf(ONBOARDING_STEPS, p.step)
      const action = oneOf(ONBOARDING_STEP_ACTIONS, p.action)
      if (!step || !action) return null
      const via = step === 'canal' && action === 'hecho' ? oneOf(['web', 'whatsapp'] as const, p.via) : null
      return { name: ev, props: via ? { step, action, via } : { step, action } }
    }
    case 'screen_viewed': {
      const screen = oneOf(USAGE_SCREENS, p.screen)
      return screen ? { name: ev, props: { screen } } : null
    }
    case 'recipe_viewed':
      return { name: ev, props: { from: oneOf(RECIPE_VIEW_FROM, p.from) ?? 'otro' } }
    case 'taste_tuning': {
      const action = oneOf(TASTE_TUNING_ACTIONS, p.action)
      if (!action) return null
      const cards = typeof p.cards === 'number' && Number.isFinite(p.cards) ? Math.min(1000, Math.max(0, Math.round(p.cards))) : 0
      return { name: ev, props: { action, cards, where: oneOf(['alta', 'pagina'] as const, p.where) ?? 'pagina' } }
    }
    case 'push_opened':
      return { name: ev, props: { kind: oneOf(PUSH_OPENED_KINDS, p.kind) ?? 'otro' } }
  }
}

/**
 * Pure: the props that make a client event "the same one" for the cap of
 * once per person and Madrid day (Legal, PRO-120: on the server, nothing kept
 * in the browser). null = not capped (every recipe opened, every tap counts).
 */
export function dailyCapKey(ev: { name: string; props: UsageProps }): UsageProps | null {
  if (ev.name === 'screen_viewed') return { screen: ev.props.screen }
  if (ev.name === 'onboarding_step') return { step: ev.props.step, action: ev.props.action }
  return null
}

/**
 * Record an event the web sent (POST /usage/event). Capped ones are inserted
 * only if this person has none with the same key today (Europe/Madrid).
 * Resolves to whether a row was written; never throws.
 */
export async function recordClientEvent(userId: string, ev: { name: ClientUsageEvent; props: UsageProps }): Promise<boolean> {
  if (process.env.VITEST) return false
  try {
    const cap = dailyCapKey(ev)
    const res: any = await db.execute(sql`
      INSERT INTO usage_events (user_id, household_id, name, channel, props)
      SELECT u.id, u.primary_household_id, ${ev.name}, 'web', ${JSON.stringify(ev.props)}::jsonb
        FROM users u
       WHERE u.id = ${userId}::uuid
         AND (${cap === null}::boolean OR NOT EXISTS (
           SELECT 1 FROM usage_events e
            WHERE e.user_id = u.id
              AND e.name = ${ev.name}
              AND e.props @> ${JSON.stringify(cap ?? {})}::jsonb
              AND (e.created_at AT TIME ZONE 'Europe/Madrid')::date = (now() AT TIME ZONE 'Europe/Madrid')::date
         ))
    `)
    return Number(res?.rowCount ?? 0) > 0
  } catch (err: any) {
    console.warn('[usage] client event failed (ignored):', err?.message ?? err)
    return false
  }
}

/**
 * Pure (PRO-120): `alerts_changed` events for the switches that changed,
 * from the on/off state before and after (kind → on). `all` is WhatsApp's
 * master switch.
 */
export function alertChanges(before: Record<string, boolean>, after: Record<string, boolean>): UsageProps[] {
  const out: UsageProps[] = []
  for (const [kind, on] of Object.entries(after)) {
    if (kind in before && before[kind] !== on) out.push({ kind, on })
  }
  return out
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
