/**
 * What the read-only metrics token (`x-metrics-token`) sees of the routes that hold text written
 * by or about users: counts, categories, severity and route words from a fixed vocabulary — never
 * that text, never user ids, referral codes or tokens (specs/metrics.md, constraints). Some of these
 * strings come from anyone (POST /client-errors is public, the feedback page and the utm values are
 * set by the client), so every string that reaches the token is checked against a closed list.
 * The admin JWT keeps the full view. Pure, unit-tested in tests/agentView.test.ts.
 */
import type { HouseholdComparison } from './blindComparison.js'
import { madridParts } from './madridTime.js'

// ─── Routes and pages ────────────────────────────────────────────

/**
 * Every static word of a real route: the Express path literals in apps/api/src and the page
 * folders in apps/web/src/app. tests/agentView.test.ts recomputes it from the code and fails when
 * they differ, so a new route means adding its words here.
 */
export const ROUTE_WORDS: ReadonlySet<string> = new Set([
  'a-ciegas', 'accept', 'admin', 'advisor', 'afina', 'afinar', 'app-opened', 'approve', 'ask',
  'assistant', 'assistant-reviews', 'audit-log', 'auth', 'auto-create', 'aviso-legal', 'avisos',
  'baja', 'ban', 'billing', 'blog', 'c', 'cancel', 'carrefour-click', 'casa', 'catalog-wishes',
  'chat', 'check', 'checkout', 'click', 'client-errors', 'close', 'cole', 'como-funciona',
  'comparison', 'compra', 'conectar', 'config', 'cook', 'cook-logs', 'cook-mode-started',
  'cook-today', 'cookbooks', 'copy', 'creencias', 'curator', 'custom-tags', 'day', 'debug-advisor',
  'dish', 'dismiss', 'edit', 'edits', 'email-sink', 'entrar', 'errors', 'estimate-nutrition',
  'extension-gaps', 'extension-result', 'extension-undo', 'extract-from-image', 'extract-from-url',
  'family-offer', 'favorite', 'feedback', 'first-steps', 'flags', 'forgot', 'gaps', 'generate',
  'have', 'health', 'health-consent', 'history', 'households', 'i', 'images', 'imprimir',
  'ingredient-gaps', 'ingredients', 'invite', 'invite-campaigns', 'invite-shared', 'invites', 'item',
  'items', 'leave', 'leftover', 'link', 'link-code', 'lista', 'lock', 'login', 'match-pantry', 'me',
  'meal', 'members', 'memoria', 'memory', 'menu', 'menu-planner', 'metrics', 'move-slot', 'n', 'new',
  'newsletter', 'next', 'next-batch', 'notes', 'notices', 'notifications', 'nudge', 'offers',
  'offline', 'onboarding', 'onboarding-draft', 'pantry', 'photos', 'portal', 'precios', 'prefs',
  'prepare', 'price-survey', 'pricing', 'privacidad', 'profile', 'public', 'public-key', 'push',
  'quote', 'random', 'read', 'recipe', 'recipe-gaps', 'recipes', 'recipes-curator', 'recuperar',
  'referrals', 'regen-output', 'regenerate', 'regenerate-image', 'register', 'remap', 'remove',
  'reservation', 'reset', 'reset-password-token', 'resolve', 'revoke', 'run', 'school-menu',
  'sections', 'seen', 'send', 'sent', 'sessions', 'settings', 'shared', 'shop-extension',
  'shop-orders', 'shopping', 'shopping-list', 'shops', 'skip', 'staples', 'stats', 'status', 'stock',
  'stt', 'subscribe', 'suggest', 'summary', 'suscripcion', 'suspend', 'taper', 'taste', 'terminos',
  'test', 'tiendas', 'totals', 'tts', 'units', 'unsubscribe', 'unsuspend', 'upload-image', 'usage',
  'use-as-recipe-image', 'user', 'users', 'verdicts', 'voice-transcripts', 'voices', 'voz',
  'waitlist', 'webhook', 'whatsapp', 'with-what-i-have'
])

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const MAX_SEGMENTS = 12

/**
 * A route (`GET /menu/:userId`) or page (`/recipes/<id>?x=1`) with every segment that isn't a
 * route word as `:x` (ids, codes, tokens, anything typed by someone), lowercased, without the
 * query. Anything that isn't a path becomes 'otra'.
 */
export function normalisePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let path = raw.trim()
  let method = ''
  const m = /^([A-Za-z]+) (.*)$/.exec(path)
  if (m) {
    if (!METHODS.has(m[1].toUpperCase())) return 'otra'
    method = `${m[1].toUpperCase()} `
    path = m[2]
  }
  path = path.split(/[?#]/)[0]
  if (!path.startsWith('/')) return 'otra'
  const segments = path.split('/').filter(Boolean)
  const kept = segments.slice(0, MAX_SEGMENTS).map((s) => (ROUTE_WORDS.has(s.toLowerCase()) ? s.toLowerCase() : ':x'))
  return `${method}/${kept.join('/')}${segments.length > MAX_SEGMENTS ? '/…' : ''}`
}

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
  const head = `API ${m[1].toUpperCase()} ${normalisePath(m[2])}`
  if (m[3]) return `${head} → HTTP ${m[3]}`
  return m[4] ? `${head}: sin respuesta (red)` : `${head}: más de <n> s sin respuesta`
}

/**
 * What kind of error, never what it said: a known class ('TypeError', 'ZodError'…), the web's
 * report of a failed API call rebuilt from closed parts ('API GET /menu/:x/:x → HTTP <n>'),
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
        path: normalisePath(g.path),
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
    const page = normalisePath(r.page) ?? 'none'
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

function utmCounts(rows: unknown): Array<{ utmSource: string; count: number }> {
  const by = new Map<string, number>()
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = asLoose(raw)
    const k = utmSourceForAgents(r.utmSource)
    by.set(k, (by.get(k) ?? 0) + (num(r.count) ?? 0))
  }
  return [...by.entries()]
    .map(([utmSource, count]) => ({ utmSource, count }))
    .sort((a, b) => b.count - a.count || a.utmSource.localeCompare(b.utmSource))
}

/**
 * GET /admin/waitlist for the token: everything the report counts, with the utm values as counts
 * by channel (they are free text), and without referral codes or entry ids (they point at people).
 */
export function waitlistForAgents(report: object) {
  const r = asLoose(report)
  const sources = r.sources == null ? undefined : asLoose(r.sources)
  const referrals = r.referrals == null ? undefined : asLoose(r.referrals)
  const batch = r.suggestedNextBatch == null ? undefined : asLoose(r.suggestedNextBatch)
  return {
    generatedAt: r.generatedAt,
    timezone: r.timezone,
    totals: r.totals,
    status: r.status,
    byDay: r.byDay,
    segments: r.segments,
    sources: sources && { bySource: sources.bySource, byUtm: utmCounts(sources.byUtm) },
    referrals: referrals && {
      referredSignups: num(referrals.referredSignups) ?? undefined,
      referrers: num(referrals.referrers) ?? undefined,
      topReferrers: (Array.isArray(referrals.topReferrers) ? referrals.topReferrers : []).map((t) => ({ count: num(asLoose(t).count) })),
    },
    batches: r.batches,
    suggestedNextBatch: batch && { size: num(batch.size) ?? undefined, counts: batch.counts },
    pricing: r.pricing,
    definitions: r.definitions,
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
