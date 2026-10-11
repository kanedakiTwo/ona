/**
 * In-house error tracker ("Sentry casero", specs/errors.md). Every error a
 * user hits in the web app (POST /client-errors) and every 5xx the API
 * answers lands in `app_errors`, grouped by fingerprint, so the Mimoia HQ agents
 * can read them through GET /admin/errors without a third-party service.
 *
 * Privacy first: `scrub` runs over message, stack and path BEFORE anything is
 * stored — emails, phone numbers, IPs, JWTs, `Bearer …` credentials, query
 * strings and secret-looking tokens are replaced. Request bodies and IP
 * addresses are never stored; the user agent is reduced to "browser · OS".
 *
 * Recording never blocks or fails the request: `recordAppError` is
 * synchronous, fire-and-forget, swallows (logs) every error, and goes through
 * `ErrorWriteThrottle` so a client stuck in an error loop can't flood the DB.
 */
import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { appErrors } from '../db/schema.js'
import { record as recordAudit } from './auditLog.js'

type Db = typeof defaultDb

export type AppErrorKind = 'client' | 'server'

export const APP_ERROR_LIMITS = {
  messageChars: 500,
  stackBytes: 4096,
  pathChars: 300,
  releaseChars: 64,
  /** POST /client-errors per IP (in-memory, per process). Over it: 204, nothing recorded. */
  perIpPerMinute: 30,
  /** Upserts per minute, per kind. Over it, known fingerprints are coalesced and new ones dropped. */
  writesPerMinute: 60,
  /** Direct upserts per fingerprint per `coalesceMs`; further repeats are coalesced. */
  writesPerFingerprint: 5,
  /** Coalesced repeats are counted in memory and flushed as one UPDATE per fingerprint this often. */
  coalesceMs: 60_000,
  /** Distinct fingerprints waiting for that flush; beyond it, repeats are dropped. */
  maxPending: 500,
} as const

// ─── Scrubbing & normalisation (pure) ────────────────────────────

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const UUID_EXACT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ordered: credentials first (a JWT contains dots an email/IP rule could bite into). */
const SCRUB_RULES: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer <redacted>'],
  // Drizzle's "Failed query: …\nparams: …" — the bound values can be any user
  // text (names, notes, addresses). Keep the SQL, drop the values.
  [/\bparams: .*/g, 'params: <redacted>'],
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, '<jwt>'],
  // Query strings / fragments carrying values (`?token=…`, `#access_token=…`).
  // A bare "?" (a Spanish question) has no `=` and is left alone.
  [/[?#][^\s"'<>()?#]*=[^\s"'<>()]*/g, ''],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, '<email>'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>'],
  // 9–15 digits, optionally "+", spaces or dashes in between. Not glued to
  // words, `:line:col`, dots or dashes (keeps UUID groups and versions intact).
  [/(?<![\w.:/#=%-])\+?\d(?:[ -]?\d){8,14}(?![\w.:-])/g, '<phone>'],
  // Long hex runs that aren't a dashed UUID (invite / reset tokens, hashes).
  [/(?<![0-9a-f-])[0-9a-f]{20,}(?![0-9a-f-])/gi, '<token>'],
  // Mixed-case base64url-ish runs (API keys, opaque tokens): upper + lower + digit, 16+.
  [/(?<![A-Za-z0-9_-])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/g, '<token>'],
]

/** Remove personal data and credentials from free text. */
export function scrub(text: string): string {
  let out = text
  for (const [re, replacement] of SCRUB_RULES) out = out.replace(re, replacement)
  return out
}

/**
 * Scrub, then replace what varies between occurrences of the same bug (ids,
 * hex ids, numbers) so they share one fingerprint. ≤ 500 chars, never empty.
 */
export function normalizeMessage(message: string): string {
  const out = scrub(message)
    .replace(UUID_RE, '<uuid>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/(?<![A-Za-z0-9_])(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}(?![A-Za-z0-9_])/gi, '<hex>')
    .replace(/(?<![A-Za-z_\d])\d+(?:\.\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
  return out ? out.slice(0, APP_ERROR_LIMITS.messageChars) : '(sin mensaje)'
}

/** A stack frame minus what changes between builds: origin, `:line:col`, chunk hashes. */
function normalizeFrame(frame: string): string {
  return scrub(frame)
    .replace(/https?:\/\/[^/\s)]+/g, '')
    .replace(/:\d+(?::\d+)?(?=\)?$)/, '')
    .replace(/(?<![A-Za-z0-9])(?=[0-9a-f]*\d)[0-9a-f]{8,}(?![A-Za-z0-9])/gi, '<hash>')
}

/** First frame of a V8 (`at …`) or Firefox/Safari (`fn@url:line:col`) stack, normalised; '' if none. */
export function topStackFrame(stack?: string | null): string {
  if (!stack) return ''
  for (const line of stack.split('\n')) {
    const t = line.trim()
    if (/^at\s/.test(t) || /@.*:\d+(?::\d+)?$/.test(t)) return normalizeFrame(t)
  }
  return ''
}

/** Group key: same kind + normalised message + where it happened. */
export function fingerprint(kind: AppErrorKind, normalizedMessage: string, topFrame: string): string {
  return createHash('sha256').update(`${kind}\u0000${normalizedMessage}\u0000${topFrame}`).digest('hex')
}

/** "Chrome · Android" — browser and OS family only; never versions or devices. */
export function userAgentFamily(ua?: string | null): string | null {
  if (!ua) return null
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Otro'
  const browser = /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /Edg(?:A|iOS)?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /FxiOS\/|Firefox\//.test(ua) ? 'Firefox'
    : /CriOS\/|Chrome\/|Chromium\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) && /Version\//.test(ua) ? 'Safari'
    : /AppleWebKit\//.test(ua) && /Mobile\//.test(ua) ? 'Safari' // iOS in-app web views
    : 'Otro'
  return `${browser} · ${os}`
}

/** Raw API path → route-like pattern (`/menu/:id/day/:n`), for errors raised before a route matched. */
export function normalizeRoutePath(path: string): string {
  const bare = path.split(/[?#]/)[0] || '/'
  const pattern = bare
    .split('/')
    .map((seg) => {
      if (!seg) return seg
      if (UUID_EXACT.test(seg)) return ':id'
      if (/^\d+$/.test(seg)) return ':n'
      if (/^[0-9a-f]{16,}$/i.test(seg) || (seg.length >= 16 && /^[A-Za-z0-9_-]+$/.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg))) {
        return ':token'
      }
      return seg
    })
    .join('/')
  return scrub(pattern).slice(0, APP_ERROR_LIMITS.pathChars)
}

/** Page path or route label without origin, query string or fragment; scrubbed and capped. */
export function cleanPath(path?: string | null): string | null {
  if (!path) return null
  const bare = path.trim().replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').split(/[?#]/)[0]
  const out = scrub(bare).slice(0, APP_ERROR_LIMITS.pathChars)
  return out || null
}

function capStack(stack?: string | null): string | null {
  if (!stack) return null
  const clean = scrub(stack)
  const buf = Buffer.from(clean, 'utf8')
  if (buf.length <= APP_ERROR_LIMITS.stackBytes) return clean
  // Room for the "…" (3 bytes); drop a multi-byte char cut in half.
  return buf.subarray(0, APP_ERROR_LIMITS.stackBytes - 3).toString('utf8').replace(/�+$/, '') + '…'
}

function cleanRelease(release?: string | null): string | null {
  if (!release) return null
  return release.replace(/[^A-Za-z0-9._-]/g, '').slice(0, APP_ERROR_LIMITS.releaseChars) || null
}

export interface AppErrorInput {
  kind: AppErrorKind
  message: string
  stack?: string | null
  /** Page path (client) or `METHOD /route/:pattern` (server). */
  path?: string | null
  release?: string | null
  /** Raw User-Agent header; only its family is stored. */
  userAgent?: string | null
  userId?: string | null
}

export interface AppErrorRow {
  fingerprint: string
  kind: AppErrorKind
  message: string
  sampleStack: string | null
  samplePath: string | null
  release: string | null
  userAgentFamily: string | null
  lastUserId: string | null
}

/** Everything that will be stored for one occurrence — already scrubbed and capped. */
export function buildAppErrorRow(input: AppErrorInput): AppErrorRow {
  const message = normalizeMessage(input.message)
  const samplePath = cleanPath(input.path)
  // Server errors with no stack ("HTTP 500: Internal server error") group by
  // route; otherwise every handler that swallows its error would share a group.
  const where = topStackFrame(input.stack) || (input.kind === 'server' ? samplePath ?? '' : '')
  return {
    fingerprint: fingerprint(input.kind, message, where),
    kind: input.kind,
    message,
    sampleStack: capStack(input.stack),
    samplePath,
    release: cleanRelease(input.release),
    userAgentFamily: userAgentFamily(input.userAgent),
    lastUserId: input.userId && UUID_EXACT.test(input.userId) ? input.userId : null,
  }
}

// ─── Write throttle (pure, injectable clock) ─────────────────────

export type ThrottleDecision =
  | { action: 'write'; extra: number }
  | { action: 'coalesce' }
  | { action: 'drop' }

interface Pending { count: number; lastSeen: number }

/**
 * Keeps DB writes bounded whatever the clients do:
 *   - each fingerprint is written directly (upsert, exact count) up to
 *     `writesPerFingerprint` times per `coalesceMs`;
 *   - further repeats in that window are only counted in memory and flushed
 *     later as one `count = count + n` UPDATE (`drain`), or folded into the
 *     next write once the window is over;
 *   - at most `maxWritesPerWindow` upserts per window: past that, a known
 *     fingerprint is still counted (coalesced) but a NEW one is dropped;
 *   - the pending map holds at most `maxPending` fingerprints.
 */
export class ErrorWriteThrottle {
  private windowStart = Number.NEGATIVE_INFINITY
  private writesInWindow = 0
  /** Per fingerprint: start of its coalesce window and direct writes in it. */
  private seen = new Map<string, { since: number; writes: number }>()
  private pending = new Map<string, Pending>()
  /** Occurrences discarded since boot (diagnostics). */
  dropped = 0

  constructor(
    private readonly opts: {
      maxWritesPerWindow: number
      windowMs: number
      coalesceMs: number
      maxPending: number
      writesPerFingerprint: number
    },
  ) {}

  decide(fp: string, now: number): ThrottleDecision {
    if (now - this.windowStart >= this.opts.windowMs) {
      this.windowStart = now
      this.writesInWindow = 0
      for (const [key, s] of this.seen) {
        if (now - s.since >= this.opts.coalesceMs && !this.pending.has(key)) this.seen.delete(key)
      }
    }
    let seen = this.seen.get(fp)
    if (seen && now - seen.since >= this.opts.coalesceMs) {
      seen = { since: now, writes: 0 }
      this.seen.set(fp, seen)
    }
    if (seen && seen.writes >= this.opts.writesPerFingerprint) return this.coalesce(fp, now)
    if (this.writesInWindow >= this.opts.maxWritesPerWindow) {
      if (seen) return this.coalesce(fp, now)
      this.dropped += 1
      return { action: 'drop' }
    }
    this.writesInWindow += 1
    if (!seen) {
      seen = { since: now, writes: 0 }
      this.seen.set(fp, seen)
    }
    seen.writes += 1
    const extra = this.pending.get(fp)?.count ?? 0
    this.pending.delete(fp)
    return { action: 'write', extra }
  }

  private coalesce(fp: string, now: number): ThrottleDecision {
    const p = this.pending.get(fp)
    if (p) {
      p.count += 1
      p.lastSeen = now
      return { action: 'coalesce' }
    }
    if (this.pending.size >= this.opts.maxPending) {
      this.dropped += 1
      return { action: 'drop' }
    }
    this.pending.set(fp, { count: 1, lastSeen: now })
    return { action: 'coalesce' }
  }

  /** Counted-but-unwritten occurrences, to flush as UPDATEs. Clears them. */
  drain(): Array<{ fingerprint: string; count: number; lastSeen: number }> {
    const out = [...this.pending].map(([fp, p]) => ({ fingerprint: fp, count: p.count, lastSeen: p.lastSeen }))
    this.pending.clear()
    return out
  }
}

// ─── Recording (fire-and-forget) ─────────────────────────────────

export interface AppErrorSink {
  /** Insert the group or bump it: count + n, last_seen = now, refresh samples, reopen if resolved. */
  upsert(row: AppErrorRow, occurrences: number): Promise<void>
  /** Add coalesced occurrences to an existing group. */
  bump(fingerprint: string, count: number, lastSeen: Date): Promise<void>
}

const dbSink: AppErrorSink = {
  async upsert(row, occurrences) {
    // Unit tests run without a migrated DB; never write to the developer's DB from vitest.
    if (process.env.VITEST) return
    await defaultDb.execute(sql`
      INSERT INTO app_errors (fingerprint, kind, message, sample_stack, sample_path, release, user_agent_family, last_user_id, count)
      VALUES (
        ${row.fingerprint}, ${row.kind}, ${row.message}, ${row.sampleStack}, ${row.samplePath},
        ${row.release}, ${row.userAgentFamily}, ${row.lastUserId}::uuid, ${occurrences}
      )
      ON CONFLICT (fingerprint) DO UPDATE SET
        count = app_errors.count + EXCLUDED.count,
        last_seen = now(),
        message = EXCLUDED.message,
        sample_stack = COALESCE(EXCLUDED.sample_stack, app_errors.sample_stack),
        sample_path = COALESCE(EXCLUDED.sample_path, app_errors.sample_path),
        release = COALESCE(EXCLUDED.release, app_errors.release),
        user_agent_family = COALESCE(EXCLUDED.user_agent_family, app_errors.user_agent_family),
        last_user_id = COALESCE(EXCLUDED.last_user_id, app_errors.last_user_id),
        resolved_at = NULL
    `)
  },
  async bump(fp, count, lastSeen) {
    if (process.env.VITEST) return
    const at = lastSeen.toISOString()
    await defaultDb.execute(sql`
      UPDATE app_errors
         SET count = count + ${count},
             last_seen = GREATEST(last_seen, ${at}::timestamptz),
             resolved_at = CASE WHEN resolved_at < ${at}::timestamptz THEN NULL ELSE resolved_at END
       WHERE fingerprint = ${fp}
    `)
  },
}

let sink: AppErrorSink = dbSink

const newThrottle = () =>
  new ErrorWriteThrottle({
    maxWritesPerWindow: APP_ERROR_LIMITS.writesPerMinute,
    windowMs: 60_000,
    coalesceMs: APP_ERROR_LIMITS.coalesceMs,
    maxPending: APP_ERROR_LIMITS.maxPending,
    writesPerFingerprint: APP_ERROR_LIMITS.writesPerFingerprint,
  })

// One budget per kind, so a client flood can't starve the API's own errors.
let throttles: Record<AppErrorKind, ErrorWriteThrottle> = { client: newThrottle(), server: newThrottle() }
let flushTimer: ReturnType<typeof setInterval> | null = null

/** Test seam: capture writes instead of hitting the DB. `null` restores the DB sink. */
export function setAppErrorSinkForTests(fake: AppErrorSink | null): void {
  sink = fake ?? dbSink
}

/** Test seam: fresh throttles (module state otherwise leaks between tests). */
export function resetAppErrorThrottlesForTests(): void {
  throttles = { client: newThrottle(), server: newThrottle() }
}

const warn = (err: any) => console.warn('[appErrors] record failed (ignored):', err?.message ?? err)

/** Write the coalesced counts. Called every `coalesceMs` once something was recorded. */
export async function flushCoalescedErrors(): Promise<void> {
  for (const throttle of Object.values(throttles)) {
    for (const p of throttle.drain()) {
      await sink.bump(p.fingerprint, p.count, new Date(p.lastSeen)).catch(warn)
    }
  }
}

function ensureFlushTimer(): void {
  if (flushTimer) return
  flushTimer = setInterval(() => void flushCoalescedErrors(), APP_ERROR_LIMITS.coalesceMs)
  if (typeof flushTimer.unref === 'function') flushTimer.unref()
}

/** Record one occurrence. Synchronous and never throws; the write runs in the background. */
export function recordAppError(input: AppErrorInput, now: number = Date.now()): void {
  try {
    const row = buildAppErrorRow(input)
    const decision = throttles[input.kind].decide(row.fingerprint, now)
    if (decision.action === 'drop') return
    ensureFlushTimer()
    if (decision.action === 'write') sink.upsert(row, 1 + decision.extra).catch(warn)
  } catch (err) {
    warn(err)
  }
}

/** Build id of the running API: commit SHA when Railway knows it, else the deployment id. */
export function serverRelease(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.RAILWAY_GIT_COMMIT_SHA || env.RAILWAY_DEPLOYMENT_ID || null
}

// ─── Reads (GET /admin/errors, metrics summary) ──────────────────

/** Plain-language definitions shipped in every response (and in specs/errors.md). */
export const ERROR_DEFINITIONS = {
  group: 'One row per fingerprint = kind + normalised message (ids, numbers, emails… replaced) + top stack frame (or the API route when there is no stack).',
  count: 'Occurrences since firstSeen (all time, not only the window). Beyond 5 occurrences of a group per minute, repeats are counted in memory and written up to a minute later.',
  window: 'Groups whose lastSeen falls in the last `days` days. Resolved groups are hidden unless includeResolved=1; a new occurrence reopens a resolved group.',
  newGroups: 'Groups first seen inside the window.',
  events: 'Sum of `count` over the groups in the window — an upper bound of the events in the window (counts are cumulative).',
  kind: 'client = reported by the web app (window.onerror, unhandled rejections, error boundaries); server = an API response with status ≥ 500 or an unhandled promise rejection.',
} as const

export interface AppErrorQuery {
  days: number
  includeResolved: boolean
  kind?: AppErrorKind
  limit: number
  now?: Date
}

const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null)

export async function loadAppErrors(q: AppErrorQuery, db: Db = defaultDb) {
  const now = q.now ?? new Date()
  const since = new Date(now.getTime() - q.days * 86_400_000)
  const kind = q.kind ?? null
  const where = sql`last_seen >= ${since}
    AND (${q.includeResolved}::boolean OR resolved_at IS NULL)
    AND (${kind}::text IS NULL OR kind = ${kind}::text)`

  const [groups, totals] = await Promise.all([
    db.execute(sql`
      SELECT id, kind, message, sample_path, sample_stack, release, user_agent_family, last_user_id,
             count, first_seen, last_seen, resolved_at
        FROM app_errors
       WHERE ${where}
       ORDER BY last_seen DESC
       LIMIT ${q.limit}
    `),
    db.execute(sql`
      SELECT count(*)::int AS groups,
             count(*) FILTER (WHERE first_seen >= ${since})::int AS new_groups,
             count(*) FILTER (WHERE kind = 'client')::int AS client_groups,
             count(*) FILTER (WHERE kind = 'server')::int AS server_groups,
             COALESCE(sum(count), 0)::bigint AS events
        FROM app_errors
       WHERE ${where}
    `),
  ])

  const t = (totals.rows[0] ?? {}) as Record<string, unknown>
  return {
    generatedAt: now.toISOString(),
    days: q.days,
    includeResolved: q.includeResolved,
    kind,
    totals: {
      groups: Number(t.groups ?? 0),
      newGroups: Number(t.new_groups ?? 0),
      clientGroups: Number(t.client_groups ?? 0),
      serverGroups: Number(t.server_groups ?? 0),
      events: Number(t.events ?? 0),
    },
    groups: (groups.rows as any[]).map((r) => ({
      id: r.id,
      kind: r.kind,
      message: r.message,
      path: r.sample_path,
      release: r.release,
      userAgentFamily: r.user_agent_family,
      lastUserId: r.last_user_id,
      count: Number(r.count),
      firstSeen: iso(r.first_seen),
      lastSeen: iso(r.last_seen),
      resolvedAt: iso(r.resolved_at),
      sampleStack: r.sample_stack,
    })),
    definitions: ERROR_DEFINITIONS,
  }
}

/** Small block for GET /admin/metrics: error groups and events over the last `days` days. */
export async function loadErrorSummary(days = 7, db: Db = defaultDb, now: Date = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000)
  const res = await db.execute(sql`
    SELECT count(*) FILTER (WHERE first_seen >= ${since})::int AS new_groups,
           count(*)::int AS active_groups,
           count(*) FILTER (WHERE resolved_at IS NULL)::int AS open_groups,
           COALESCE(sum(count), 0)::bigint AS events
      FROM app_errors
     WHERE last_seen >= ${since}
  `)
  const r = (res.rows[0] ?? {}) as Record<string, unknown>
  return {
    windowDays: days,
    newGroups: Number(r.new_groups ?? 0),
    activeGroups: Number(r.active_groups ?? 0),
    openGroups: Number(r.open_groups ?? 0),
    events: Number(r.events ?? 0),
  }
}

/** Mark a group resolved (admin), with its audit row in the same transaction. Null when not found. */
export async function resolveAppError(id: string, adminId: string, db: Db = defaultDb) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(appErrors)
      .set({ resolvedAt: new Date() })
      .where(eq(appErrors.id, id))
      .returning({ id: appErrors.id, kind: appErrors.kind, message: appErrors.message, resolvedAt: appErrors.resolvedAt })
    if (!row) return null
    await recordAudit(
      {
        adminId,
        action: 'app_error.resolve',
        targetType: 'app_error',
        targetId: row.id,
        payload: { kind: row.kind, message: row.message, resolvedAt: iso(row.resolvedAt) },
      },
      tx,
    )
    return { id: row.id, resolvedAt: iso(row.resolvedAt) }
  })
}
