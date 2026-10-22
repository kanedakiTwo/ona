/**
 * What the read-only metrics token (`x-metrics-token`) sees of the routes that hold text written
 * by or about users: counts, categories, severity and routes in the shape of real templates — never
 * that text, never user ids, referral codes or tokens (specs/metrics.md, constraints). Some of these
 * strings come from anyone (POST /client-errors is public, the feedback page and the utm values are
 * set by the client), so every string that reaches the token is checked against a closed list.
 * The admin JWT keeps the full view. Pure (only the extra `?ref=` labels come from the
 * environment), unit-tested in tests/agentView.test.ts.
 */
import {
  FOUNDER_DECLINE_REASONS,
  FOUNDER_PLAN_IDS,
  PRICE_QUESTIONS,
  WAITLIST_CURRENT_METHODS,
  WAITLIST_HOUSEHOLD_SIZES,
  WAITLIST_PLANNER_ROLES,
  WAITLIST_PLATFORMS,
  WAITLIST_STATUSES,
} from '@ona/shared'
import { env } from '../config/env.js'
import type { HouseholdComparison } from './blindComparison.js'
import { madridParts } from './madridTime.js'
import { API_ROUTE_TEMPLATES, WEB_PAGE_TEMPLATES } from './routeTemplates.js'

// ─── Routes and pages ────────────────────────────────────────────

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const toSegments = (t: string) => t.split('/').filter(Boolean)
const API_TEMPLATES = API_ROUTE_TEMPLATES.map(toSegments)
const WEB_TEMPLATES = WEB_PAGE_TEMPLATES.map(toSegments)
const ALL_TEMPLATES = [...API_TEMPLATES, ...WEB_TEMPLATES]
/** The longest real template: a longer path cannot match any. */
const MAX_SEGMENTS = Math.max(...ALL_TEMPLATES.map((t) => t.length))

/** The template with this shape and the most fixed words in common, or null. */
function matchTemplate(segments: readonly string[], templates: ReadonlyArray<readonly string[]>): string | null {
  let best: readonly string[] | null = null
  let bestScore = -1
  for (const t of templates) {
    if (t.length !== segments.length) continue
    let score = 0
    let ok = true
    for (let i = 0; i < t.length && ok; i++) {
      if (t[i] === ':x') continue
      if (t[i] === segments[i]) score++
      else ok = false
    }
    if (ok && score > bestScore) {
      best = t
      bestScore = score
    }
  }
  return best ? `/${best.join('/')}` : null
}

function normaliseAgainst(raw: unknown, templates: ReadonlyArray<readonly string[]>, allowMethod: boolean): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let path = raw.trim()
  let method = ''
  const m = /^([A-Za-z]+) (.*)$/.exec(path)
  if (m) {
    if (!allowMethod || !METHODS.has(m[1].toUpperCase())) return 'otra'
    method = `${m[1].toUpperCase()} `
    path = m[2]
  }
  path = path.split(/[?#]/)[0]
  if (!path.startsWith('/')) return 'otra'
  const segments = toSegments(path.toLowerCase())
  if (segments.length > MAX_SEGMENTS) return 'otra'
  const template = matchTemplate(segments, templates)
  return template ? `${method}${template}` : 'otra'
}

/**
 * An API route (`GET /menu/:userId/:weekId`, `/memory/<key>`) in the shape of a real Express
 * template (services/routeTemplates.ts), lowercased, every parameter as `:x`, no query; anything
 * that matches no template is 'otra'.
 */
export const normaliseApiRoute = (raw: unknown): string | null => normaliseAgainst(raw, API_TEMPLATES, true)

/** A page of the web (`/recipes/<id>?x=1`) in the shape of a real page template; else 'otra'. */
export const normalisePage = (raw: unknown): string | null => normaliseAgainst(raw, WEB_TEMPLATES, false)

/** Either: for a path whose origin is unknown. */
export const normalisePath = (raw: unknown): string | null => normaliseAgainst(raw, ALL_TEMPLATES, true)

// ─── Errors ──────────────────────────────────────────────────────

/** Error classes the token may name: JavaScript, the browser, the libraries we use and our own. ≤ 32 characters each. */
export const KNOWN_ERROR_CLASSES: ReadonlySet<string> = new Set([
  // JavaScript and Node
  'Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError',
  'InternalError', 'AbortError', 'TimeoutError', 'SystemError',
  // Browser (DOMException names)
  'DOMException', 'NetworkError', 'NotAllowedError', 'NotFoundError', 'NotSupportedError', 'NotReadableError',
  'InvalidStateError', 'InvalidAccessError', 'InvalidCharacterError', 'SecurityError', 'QuotaExceededError',
  'DataCloneError', 'DataError', 'EncodingError', 'OperationError', 'UnknownError', 'ConstraintError',
  'TransactionInactiveError', 'ReadOnlyError', 'VersionError', 'OverconstrainedError',
  // Next.js / React
  'ChunkLoadError',
  // Libraries
  'ZodError', 'DrizzleError', 'DrizzleQueryError', 'TransactionRollbackError', 'PostgresError', 'DatabaseError',
  'FetchError', 'PayloadTooLargeError', 'UnsupportedMediaTypeError', 'BadRequestError', 'UnauthorizedError',
  'ForbiddenError', 'ConflictError', 'InternalServerError', 'JsonWebTokenError', 'TokenExpiredError',
  'NotBeforeError', 'MulterError', 'APIError', 'APIConnectionError', 'APIConnectionTimeoutError',
  'APIUserAbortError', 'AuthenticationError', 'PermissionDeniedError', 'RateLimitError',
  'UnprocessableEntityError', 'AnthropicError', 'OpenAIError', 'StripeError', 'StripeCardError',
  'StripeInvalidRequestError', 'StripeAPIError', 'StripeAuthenticationError', 'StripeConnectionError',
  'StripeRateLimitError', 'WebPushError',
  // Ours (apps/api, apps/web)
  'AdminAccountDeletionError', 'ApiError', 'AppApiError', 'CookbookNotFoundError', 'GraphApiError',
  'HealthConsentRequiredError', 'HouseholdNotFoundError', 'InviteExpiredError', 'LintFailureError',
  'MemoryValueValidationError', 'NewsletterTestAddressError', 'NoExtractableContentError', 'NoHouseholdError',
  'NotARecipeError', 'NotASchoolMenuError', 'NotHouseholdMemberError', 'NotHouseholdOwnerError',
  'NotRecipeAuthorError', 'PageFetchError', 'PhotoNotFoundError', 'PushNotConfiguredError', 'ShopOrderError',
  'SocialCaptionUnavailableError', 'SttNotConfiguredError', 'TtsError', 'UnknownMemoryKeyError',
  'UnreadableImageError', 'UnsafeUrlError', 'UnsupportedImageTypeError', 'UsdaError',
])

const ERROR_PREFIX = /^(?:unhandled rejection:\s*|uncaught\s+(?:\(in promise\)\s*)?)+/i
const ERROR_LIKE = /^(?:[A-Za-z_$][\w$]*\.)?((?:[A-Za-z_$][\w$]*)?(?:Error|Exception))(?=$|[\s:(\[,.;!])/
/**
 * The web's own report of a failed or slow API call (`buildApiProblemMessage` in @ona/shared,
 * numbers stored as `<n>`): method, route, and one of three fixed endings.
 */
const API_PROBLEM = /^API ([A-Za-z]+) (\/\S*?)(?: → HTTP (<n>|\d{3})|(: sin respuesta \(red\))|: más de (?:<n>|\d+) s sin respuesta)$/

function apiProblemType(text: string): string | null {
  const m = API_PROBLEM.exec(text)
  if (!m || !METHODS.has(m[1].toUpperCase())) return null
  const head = `API ${m[1].toUpperCase()} ${normaliseApiRoute(m[2])}`
  if (m[3]) return `${head} → HTTP ${m[3]}`
  return m[4] ? `${head}: sin respuesta (red)` : `${head}: más de <n> s sin respuesta`
}

/**
 * What kind of error, never what it said: a known class ('TypeError', 'ZodError'…), the web's
 * report of a failed API call rebuilt from closed parts ('API GET /menu/:x/:x → HTTP <n>', or
 * 'API GET otra → …' when the route matches no template),
 * 'Error' for any other class and 'other' when the message names none.
 */
export function errorType(message: unknown): string {
  const text = String(message ?? '').trim().replace(ERROR_PREFIX, '')
  const api = apiProblemType(text)
  if (api) return api
  const m = ERROR_LIKE.exec(text)
  if (!m) return 'other'
  return KNOWN_ERROR_CLASSES.has(m[1]) ? m[1] : 'Error'
}

const RELEASE = /^(?:[0-9a-f]{7,40}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/** The server's own release (a commit or a deployment id); a client's is whatever the browser sent. */
export function releaseForAgents(kind: unknown, release: unknown): string | null {
  return kind === 'server' && typeof release === 'string' && RELEASE.test(release) ? release : null
}

const UA_FAMILY = /^(?:Samsung Internet|Edge|Opera|Firefox|Chrome|Safari|Otro) · (?:iOS|Android|Windows|ChromeOS|macOS|Linux|Otro)$/

type Loose = Record<string, unknown>
const asLoose = (o: unknown): Loose => (o && typeof o === 'object' ? (o as Loose) : {})
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isoDay = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null)

/** Only the listed keys that hold numbers. */
function pickNumbers(o: unknown, keys: readonly string[]): Record<string, number> {
  const src = asLoose(o)
  const out: Record<string, number> = {}
  for (const k of keys) if (num(src[k]) !== null) out[k] = src[k] as number
  return out
}

const ERROR_TOTALS = ['groups', 'newGroups', 'clientGroups', 'serverGroups', 'events'] as const

export function errorsForAgents(report: object) {
  const r = asLoose(report)
  return {
    generatedAt: str(r.generatedAt) ?? undefined,
    days: num(r.days) ?? undefined,
    includeResolved: typeof r.includeResolved === 'boolean' ? r.includeResolved : undefined,
    kind: oneOf(r.kind, ['client', 'server'] as const),
    totals: pickNumbers(r.totals, ERROR_TOTALS),
    groups: (Array.isArray(r.groups) ? r.groups : []).map((raw) => {
      const g = asLoose(raw)
      return {
        id: typeof g.id === 'string' && /^[0-9A-Za-z-]{1,64}$/.test(g.id) ? g.id : null,
        kind: oneOf(g.kind, ['client', 'server'] as const),
        type: errorType(g.message),
        // Client groups carry the page; server groups, `METHOD /route`.
        path: g.kind === 'server' ? normaliseApiRoute(g.path) : g.kind === 'client' ? normalisePage(g.path) : normalisePath(g.path),
        release: releaseForAgents(g.kind, g.release),
        userAgentFamily: typeof g.userAgentFamily === 'string' && UA_FAMILY.test(g.userAgentFamily) ? g.userAgentFamily : null,
        count: num(g.count),
        firstSeen: str(g.firstSeen),
        lastSeen: str(g.lastSeen),
        resolvedAt: str(g.resolvedAt),
      }
    }),
    // The server's own constant (ERROR_DEFINITIONS), not data.
    definitions: r.definitions,
  }
}

// ─── Feedback ────────────────────────────────────────────────────

const ALLERGY = /al[eé]rg|cel[ií]a(?:c|qu)|intoleran|anafil|gluten|lactosa/i
/** Cyrillic and Greek letters that look like Latin ones («сeliaca» with a Cyrillic «с»). */
const LOOKALIKES: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i',
  ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ӏ: 'l', ɡ: 'g', α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o',
  ρ: 'p', τ: 't', υ: 'u', χ: 'x', ς: 's',
}

/** NFKC (full-width letters), no invisible characters, lowercase, no accents, look-alikes as Latin. */
export function normaliseForSearch(text: string): string {
  const t = text.normalize('NFKC').replace(/\p{Cf}/gu, '').toLowerCase()
  return Array.from(t.normalize('NFKD').replace(/\p{Mn}/gu, ''), (c) => LOOKALIKES[c] ?? c).join('')
}

/** The text mentions an allergy, an allergen, coeliac disease, an intolerance, anaphylaxis, gluten or lactose. */
export function possibleAllergy(text: unknown): boolean {
  return typeof text === 'string' && ALLERGY.test(normaliseForSearch(text))
}

export interface FeedbackLike {
  channel: string
  page: string | null
  text: string
  createdAt: Date
}

const FEEDBACK_CHANNELS = ['app', 'chat', 'whatsapp'] as const

export function feedbackForAgents(days: number, rows: ReadonlyArray<FeedbackLike>) {
  const byChannel: Record<string, number> = {}
  const byPage: Record<string, number> = {}
  const possibleAllergies: Array<{ date: string; channel: string }> = []
  for (const r of rows) {
    const channel = oneOf(r.channel, FEEDBACK_CHANNELS) ?? 'otro'
    byChannel[channel] = (byChannel[channel] ?? 0) + 1
    const page = normalisePage(r.page) ?? 'none'
    byPage[page] = (byPage[page] ?? 0) + 1
    if (possibleAllergy(r.text)) possibleAllergies.push({ date: madridParts(r.createdAt).isoDate, channel })
  }
  return { days, count: rows.length, byChannel, byPage, possibleAllergies }
}

// ─── Mimo's conversation flags ───────────────────────────────────

/** services/assistantFlags.ts FLAG_CATEGORIES (a test keeps them equal). */
export const FLAG_CATEGORY_LIST = ['health_talk', 'health_claim', 'unverified_done', 'error_refusal', 'other'] as const
/** services/whatsapp/reviewer.ts REVIEW_SCHEMA, `category` and `severity` (a test keeps them equal). */
export const REVIEWER_CATEGORY_LIST = [
  'accion_no_hecha', 'afirmacion_falsa', 'cambio_no_pedido', 'pregunta_innecesaria', 'promesa_incumplida',
  'herramienta_incorrecta', 'falta_herramienta', 'lentitud', 'error_tecnico', 'transcripcion', 'respuesta_larga',
  'respuesta_poco_util', 'rechazo_indebido', 'proactividad', 'otro',
] as const
export const REVIEWER_SEVERITY_LIST = ['alta', 'media', 'baja'] as const
const FLAG_SOURCES = ['detector', 'reviewer', 'both'] as const

/** Counts by the reviewer's category; anything outside the schema is counted as 'otro'. */
function reviewerCategoryCounts(o: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(asLoose(o))) {
    if (num(v) === null) continue
    const key = oneOf(k, REVIEWER_CATEGORY_LIST) ?? 'otro'
    out[key] = (out[key] ?? 0) + (v as number)
  }
  return out
}

export function flagsForAgents(report: object) {
  const r = asLoose(report)
  const counts = asLoose(r.counts)
  return {
    generatedAt: str(r.generatedAt) ?? undefined,
    windowDays: num(r.windowDays) ?? undefined,
    from: isoDay(r.from) ?? undefined,
    to: isoDay(r.to) ?? undefined,
    channels: (Array.isArray(r.channels) ? r.channels : []).filter((c) => c === 'whatsapp'),
    turns: num(r.turns) ?? undefined,
    reviews: pickNumbers(r.reviews, ['ok', 'empty', 'failed']),
    counts: {
      byCategory: pickNumbers(counts.byCategory, FLAG_CATEGORY_LIST),
      reviewerByCategory: reviewerCategoryCounts(counts.reviewerByCategory),
      reviewerBySeverity: pickNumbers(counts.reviewerBySeverity, REVIEWER_SEVERITY_LIST),
    },
    items: (Array.isArray(r.items) ? r.items : []).map((raw) => {
      const i = asLoose(raw)
      return {
        date: isoDay(i.date),
        channel: i.channel === 'whatsapp' ? 'whatsapp' : null,
        category: oneOf(i.category, FLAG_CATEGORY_LIST) ?? 'other',
        source: oneOf(i.source, FLAG_SOURCES),
        reviewerCategory: i.reviewerCategory == null ? null : (oneOf(i.reviewerCategory, REVIEWER_CATEGORY_LIST) ?? 'otro'),
        severity: oneOf(i.severity, REVIEWER_SEVERITY_LIST),
      }
    }),
  }
}

// ─── Waitlist ────────────────────────────────────────────────────

/** utm_source as people write it → one channel. Unknown → 'otro'; empty → 'ninguna'. */
const UTM_SOURCES: Record<string, string> = {
  instagram: 'instagram', ig: 'instagram', insta: 'instagram', 'instagram.com': 'instagram', 'l.instagram.com': 'instagram',
  facebook: 'facebook', fb: 'facebook', 'facebook.com': 'facebook', 'm.facebook.com': 'facebook', 'l.facebook.com': 'facebook', 'lm.facebook.com': 'facebook',
  whatsapp: 'whatsapp', wa: 'whatsapp', 'wa.me': 'whatsapp', 'whatsapp.com': 'whatsapp',
  telegram: 'telegram', tg: 'telegram', 't.me': 'telegram',
  linkedin: 'linkedin', 'linkedin.com': 'linkedin', 'lnkd.in': 'linkedin',
  tiktok: 'tiktok', 'tiktok.com': 'tiktok',
  youtube: 'youtube', yt: 'youtube', 'youtube.com': 'youtube', 'youtu.be': 'youtube',
  x: 'x', twitter: 'x', 't.co': 'x', 'x.com': 'x', 'twitter.com': 'x',
  threads: 'threads', 'threads.net': 'threads',
  pinterest: 'pinterest', 'pinterest.com': 'pinterest',
  reddit: 'reddit', 'reddit.com': 'reddit',
  google: 'google', 'google.com': 'google',
  bing: 'bing',
  newsletter: 'newsletter',
  email: 'email', 'e-mail': 'email', mail: 'email', correo: 'email',
}

export function utmSourceForAgents(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'ninguna'
  const s = normaliseForSearch(raw.trim()).replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  return UTM_SOURCES[s] ?? 'otro'
}

/**
 * `?ref=` labels the token may name, from the code: every label the code puts in a link (links,
 * `openRef`, the share footers; tests/agentView.test.ts collects them and fails if one is missing)
 * plus the two fallbacks. Campaign labels that only live in links outside the code are added on the
 * API with `METRICS_EXTRA_REF_SOURCES` (`knownRefSources`). `POST /waitlist` is public, so any
 * other label is 'otro'.
 */
export const CODE_REF_SOURCES: ReadonlySet<string> = new Set([
  'directo', 'invita',
  'articulo-refugio', 'blog', 'como-funciona', 'lista', 'menu', 'precios', 'receta', 'recetas',
])

const EXTRA_REF_LABEL = /^[a-z0-9-]{1,32}$/
const MAX_EXTRA_REF_SOURCES = 50

/**
 * `METRICS_EXTRA_REF_SOURCES`: comma-separated exact labels (no patterns). Kept: the first 50 that
 * match `^[a-z0-9-]{1,32}$`; `dropped` counts the rest (bad format or over the cap).
 */
export function readExtraRefSources(raw: string | null | undefined): { labels: string[]; dropped: number } {
  const values = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const labels = values.filter((s) => EXTRA_REF_LABEL.test(s)).slice(0, MAX_EXTRA_REF_SOURCES)
  return { labels, dropped: values.length - labels.length }
}

export function parseExtraRefSources(raw: string | null | undefined): string[] {
  return readExtraRefSources(raw).labels
}

/** At boot (index.ts): how many extra labels were dropped, in the log — never the values. */
export function warnDroppedExtraRefSources(
  raw: string = env.METRICS_EXTRA_REF_SOURCES,
  warn: (message: string) => void = console.warn,
): number {
  const { dropped } = readExtraRefSources(raw)
  if (dropped > 0) {
    warn(`[metrics] METRICS_EXTRA_REF_SOURCES: ${dropped} label(s) dropped (not ^[a-z0-9-]{1,32}$, or over the cap of ${MAX_EXTRA_REF_SOURCES})`)
  }
  return dropped
}

export function knownRefSources(extra: string = env.METRICS_EXTRA_REF_SOURCES): ReadonlySet<string> {
  return new Set([...CODE_REF_SOURCES, ...parseExtraRefSources(extra)])
}

export function refSourceForAgents(raw: unknown, known: ReadonlySet<string> = knownRefSources()): string {
  return typeof raw === 'string' && known.has(raw) ? raw : 'otro'
}

/**
 * Rows `{ <key>, count, inTarget }` re-counted under a closed label: `count` and how many of them
 * are in the target segment (`inTarget`, PRO-189) are summed per label.
 */
function recount(rows: unknown, key: string, label: (raw: unknown) => string): Array<Record<string, string | number>> {
  const by = new Map<string, { count: number; inTarget: number }>()
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = asLoose(raw)
    const k = label(r[key])
    const cur = by.get(k) ?? { count: 0, inTarget: 0 }
    cur.count += num(r.count) ?? 0
    cur.inTarget += num(r.inTarget) ?? 0
    by.set(k, cur)
  }
  return [...by.entries()]
    .map(([k, { count, inTarget }]) => ({ [key]: k, count, inTarget }))
    .sort((a, b) => (b.count as number) - (a.count as number) || String(a[key]).localeCompare(String(b[key])))
}

/**
 * utm_campaign for the token (PRO-189): written by whoever builds the link, so it goes through the
 * same closed list as the `?ref=` labels (`knownRefSources`: the code's labels plus
 * `METRICS_EXTRA_REF_SOURCES`), lowercased; empty → 'ninguna'; anything else → 'otro'.
 */
export function utmCampaignForAgents(raw: unknown, known: ReadonlySet<string> = knownRefSources()): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'ninguna'
  const c = raw.trim().toLowerCase()
  return known.has(c) ? c : 'otro'
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
/** Only the listed keys that hold strings (the server's own definitions). */
function pickStrings(o: unknown, keys: readonly string[]): Record<string, string> {
  const src = asLoose(o)
  const out: Record<string, string> = {}
  for (const k of keys) if (typeof src[k] === 'string') out[k] = src[k] as string
  return out
}

const WAITLIST_TOTALS = ['entries', 'active', 'last7Days', 'wantsWhatsapp', 'newsletterOptIns', 'inTargetSegment', 'referredSignups'] as const
const BATCH_COUNTS = ['waiting', 'waitingInTarget', 'selected', 'selectedInTarget', 'selectedReferrers', 'pulledInByReferrer'] as const
const WAITLIST_DEFINITION_KEYS = ['active', 'last7Days', 'byDay', 'segments', 'sources', 'targetSegment', 'referredSignups', 'newsletterOptIns', 'suggestedNextBatch'] as const

function pricingForAgents(raw: unknown) {
  const p = asLoose(raw)
  const questions = asLoose(p.questions)
  const reservations = asLoose(p.reservations)
  const none = asLoose(p.none)
  return {
    answeredPriceQuestions: num(p.answeredPriceQuestions),
    questions: Object.fromEntries(
      PRICE_QUESTIONS.filter((q) => questions[q.key] != null).map((q) => {
        const d = asLoose(questions[q.key])
        return [
          q.key,
          {
            text: q.text,
            answers: num(d.answers),
            min: num(d.min),
            p25: num(d.p25),
            median: num(d.median),
            p75: num(d.p75),
            max: num(d.max),
            histogram: arr(d.histogram).map((h) => ({ eur: num(asLoose(h).eur), count: num(asLoose(h).count) })),
          },
        ]
      }),
    ),
    reservations: { total: num(reservations.total), byPlan: pickNumbers(reservations.byPlan, FOUNDER_PLAN_IDS) },
    none: { total: num(none.total), byReason: pickNumbers(none.byReason, FOUNDER_DECLINE_REASONS) },
    definitions: pickStrings(p.definitions, ['questions', 'reservations', 'none']),
  }
}

/**
 * GET /admin/waitlist for the token: what the report counts, every object an explicit list of
 * fields with values from their enums; the `?ref=` labels, utm_source and utm_campaign (set by
 * whoever signs up) as counts — total and in the target segment — under closed lists; no referral codes or entry ids (they point at people).
 */
export function waitlistForAgents(report: object) {
  const r = asLoose(report)
  const present = (k: string) => r[k] != null
  const segments = asLoose(r.segments)
  const sources = asLoose(r.sources)
  const referrals = asLoose(r.referrals)
  const batch = asLoose(r.suggestedNextBatch)
  const refs = knownRefSources()
  return {
    generatedAt: str(r.generatedAt) ?? undefined,
    timezone: str(r.timezone) ?? undefined,
    totals: present('totals') ? pickNumbers(r.totals, WAITLIST_TOTALS) : undefined,
    status: present('status') ? pickNumbers(r.status, WAITLIST_STATUSES) : undefined,
    byDay: present('byDay') ? arr(r.byDay).map((d) => ({ day: isoDay(asLoose(d).day), signups: num(asLoose(d).signups) })) : undefined,
    segments: present('segments')
      ? {
          householdSize: pickNumbers(segments.householdSize, WAITLIST_HOUSEHOLD_SIZES),
          plannerRole: pickNumbers(segments.plannerRole, WAITLIST_PLANNER_ROLES),
          currentMethod: pickNumbers(segments.currentMethod, WAITLIST_CURRENT_METHODS),
          platform: pickNumbers(segments.platform, WAITLIST_PLATFORMS),
          cross: arr(segments.cross).map((raw) => {
            const c = asLoose(raw)
            return {
              householdSize: oneOf(c.householdSize, WAITLIST_HOUSEHOLD_SIZES),
              plannerRole: oneOf(c.plannerRole, WAITLIST_PLANNER_ROLES),
              currentMethod: oneOf(c.currentMethod, WAITLIST_CURRENT_METHODS),
              count: num(c.count),
              target: c.target === true,
            }
          }),
        }
      : undefined,
    sources: present('sources')
      ? {
          bySource: recount(sources.bySource, 'source', (raw) => refSourceForAgents(raw, refs)),
          byUtm: recount(sources.byUtm, 'utmSource', utmSourceForAgents),
          byCampaign: recount(sources.byCampaign, 'utmCampaign', (raw) => utmCampaignForAgents(raw, refs)),
        }
      : undefined,
    referrals: present('referrals')
      ? {
          referredSignups: num(referrals.referredSignups) ?? undefined,
          referrers: num(referrals.referrers) ?? undefined,
          topReferrers: arr(referrals.topReferrers).map((t) => ({ count: num(asLoose(t).count) })),
        }
      : undefined,
    batches: present('batches')
      ? arr(r.batches).map((raw) => {
          const b = asLoose(raw)
          return { batch: num(b.batch), size: num(b.size), joined: num(b.joined), unsubscribed: num(b.unsubscribed) }
        })
      : undefined,
    suggestedNextBatch: present('suggestedNextBatch') ? { size: num(batch.size) ?? undefined, counts: pickNumbers(batch.counts, BATCH_COUNTS) } : undefined,
    pricing: present('pricing') ? pricingForAgents(r.pricing) : undefined,
    definitions: present('definitions') ? pickStrings(r.definitions, WAITLIST_DEFINITION_KEYS) : undefined,
  }
}

// ─── Blind menu comparison ───────────────────────────────────────

/** GET /admin/menu-planner/comparison for the token: no household id and no reasons, only how many per week chosen. */
export function comparisonForAgents(households: ReadonlyArray<HouseholdComparison>) {
  return households.map((h) => {
    const reasonCounts = { planner: 0, generator: 0, tie: 0 }
    for (const r of h.reasons ?? []) {
      if (r.preferred === 'planner' || r.preferred === 'generator' || r.preferred === 'tie') reasonCounts[r.preferred]++
    }
    return {
      plans: h.plans,
      byStatus: h.byStatus,
      problems: h.problems,
      plannerRules: h.plannerRules,
      generatorRules: h.generatorRules,
      votes: { planner: h.votes.planner, generator: h.votes.generator, tie: h.votes.tie },
      reasonCounts,
      prefersPlanner: h.prefersPlanner,
    }
  })
}
