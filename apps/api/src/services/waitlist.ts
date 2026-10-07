/**
 * Pre-launch waitlist (specs/waitlist.md).
 *
 * People sign up on the public landing; we let them in by batches (every
 * 2–4 weeks) and use their four answers to pick who enters first. There is
 * no visible queue position and no fake scarcity.
 *
 * Split like businessMetrics.ts:
 *   - pure rules (codes, target segment, next-batch order, the admin report),
 *     unit-tested without a database (tests/waitlist.test.ts);
 *   - `signupToWaitlist` over a small `WaitlistRepo` (in-memory in the route
 *     tests, Postgres in `createDbWaitlistRepo`);
 *   - admin loaders that never select an email — except the admin-JWT-only
 *     invite, which is the one place emails leave the database.
 */
import { randomBytes } from 'node:crypto'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_CODE_LENGTH,
  WAITLIST_CONSENT_VERSION,
  WAITLIST_CURRENT_METHODS,
  WAITLIST_HOUSEHOLD_SIZES,
  WAITLIST_NEWSLETTER_CONSENT_VERSION,
  WAITLIST_PLANNER_ROLES,
  WAITLIST_PLATFORMS,
  normalizeReferralCode,
  waitlistReferralUrl,
  waitlistStatusPath,
  waitlistUnsubscribePath,
  type WaitlistCurrentMethod,
  type WaitlistHouseholdSize,
  type WaitlistPlannerRole,
  type WaitlistPlatform,
  type WaitlistSignup,
  type WaitlistSignupResponse,
  type WaitlistStatus,
  type WaitlistStatusResponse,
} from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { waitlistEntries } from '../db/schema.js'
import { record as recordAudit } from './auditLog.js'
import { MADRID_TZ, addDays, madridParts } from './madridTime.js'

type Db = typeof defaultDb

// ─── Generators ──────────────────────────────────────────────────

const CODE_BYTES = 5 // 40 bits = 8 base32 characters

/** 8 chars of lowercase Crockford base32 (40 random bits): short, URL-safe, unguessable enough for a share link. */
export function generateReferralCode(bytes: Uint8Array = randomBytes(CODE_BYTES)): string {
  if (bytes.length !== CODE_BYTES) throw new Error(`generateReferralCode needs exactly ${CODE_BYTES} bytes`)
  let n = 0
  for (const b of bytes) n = n * 256 + b // ≤ 2^40, exact in a double
  let out = ''
  for (let i = REFERRAL_CODE_LENGTH - 1; i >= 0; i--) {
    out += REFERRAL_CODE_ALPHABET[Math.floor(n / 32 ** i) % 32]
  }
  return out
}

/** Private opt-out token (192 bits, base64url). Only ever sent to the person. */
export function generateUnsubscribeToken(): string {
  return randomBytes(24).toString('base64url')
}

// ─── Target segment + next batch ─────────────────────────────────

export interface RankableEntry {
  id: string
  householdSize: WaitlistHouseholdSize
  plannerRole: WaitlistPlannerRole
  currentMethod: WaitlistCurrentMethod
  status: WaitlistStatus
  referralCode: string
  referredByCode: string | null
  createdAt: Date
}

/** Households of 2+, where this person plans (alone or shared) and cooks at home. */
export function isTargetSegment(e: Pick<RankableEntry, 'householdSize' | 'plannerRole' | 'currentMethod'>): boolean {
  return (
    e.householdSize !== '1' &&
    (e.plannerRole === 'yo' || e.plannerRole === 'compartido') &&
    e.currentMethod !== 'no_cocino'
  )
}

export interface SuggestedBatch {
  /** Requested size. */
  size: number
  /** Entry ids, in invitation order. */
  ids: string[]
  counts: {
    waiting: number
    waitingInTarget: number
    selected: number
    selectedInTarget: number
    /** Selected entries whose link brought at least one active signup. */
    selectedReferrers: number
    /** Selected because someone they came with (their referrer, up the chain) was selected. */
    pulledInByReferrer: number
  }
}

const byTime = (a: RankableEntry, b: RankableEntry) =>
  a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Who should get in next. Only `waiting` entries. Order:
 *   1. target segment first;
 *   2. within it, people who brought someone (an active signup with their
 *      link) or whose own referrer is already invited/joined;
 *   3. earliest signup (ties by id, so the answer is deterministic).
 * Each picked person pulls in the waiting people who signed up with their
 * link (and theirs, down the chain) right after them — "invita a tu hogar y
 * entráis antes" — until the batch is full.
 */
export function suggestNextBatch(entries: RankableEntry[], size: number): SuggestedBatch {
  const cap = Math.max(0, Math.floor(size))
  const referralsByCode = new Map<string, number>()
  for (const e of entries) {
    if (e.status !== 'unsubscribed' && e.referredByCode) {
      referralsByCode.set(e.referredByCode, (referralsByCode.get(e.referredByCode) ?? 0) + 1)
    }
  }
  const statusByCode = new Map(entries.map((e) => [e.referralCode, e.status]))
  const waiting = entries.filter((e) => e.status === 'waiting')
  const refereesByCode = new Map<string, RankableEntry[]>()
  for (const e of waiting) {
    if (!e.referredByCode) continue
    const list = refereesByCode.get(e.referredByCode) ?? []
    list.push(e)
    refereesByCode.set(e.referredByCode, list)
  }
  for (const list of refereesByCode.values()) list.sort(byTime)

  const isReferrer = (e: RankableEntry) => (referralsByCode.get(e.referralCode) ?? 0) > 0
  const referrerIsIn = (e: RankableEntry) => {
    const s = e.referredByCode ? statusByCode.get(e.referredByCode) : undefined
    return s === 'invited' || s === 'joined'
  }
  const tier = (e: RankableEntry) => (isTargetSegment(e) ? 0 : 1)
  const boost = (e: RankableEntry) => (isReferrer(e) || referrerIsIn(e) ? 0 : 1)
  const ranked = [...waiting].sort((a, b) => tier(a) - tier(b) || boost(a) - boost(b) || byTime(a, b))

  const picked: RankableEntry[] = []
  const pickedIds = new Set<string>()
  let pulled = 0
  for (const head of ranked) {
    if (picked.length >= cap) break
    if (pickedIds.has(head.id)) continue
    const queue: RankableEntry[] = [head]
    while (queue.length > 0 && picked.length < cap) {
      const e = queue.shift()!
      if (pickedIds.has(e.id)) continue
      picked.push(e)
      pickedIds.add(e.id)
      if (e !== head) pulled += 1
      queue.push(...(refereesByCode.get(e.referralCode) ?? []))
    }
  }

  return {
    size: cap,
    ids: picked.map((e) => e.id),
    counts: {
      waiting: waiting.length,
      waitingInTarget: waiting.filter(isTargetSegment).length,
      selected: picked.length,
      selectedInTarget: picked.filter(isTargetSegment).length,
      selectedReferrers: picked.filter(isReferrer).length,
      pulledInByReferrer: pulled,
    },
  }
}

// ─── Admin report ────────────────────────────────────────────────

export interface WaitlistReportRow extends RankableEntry {
  platform: WaitlistPlatform
  wantsWhatsapp: boolean
  newsletterOptIn: boolean
  source: string
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  batch: number | null
}

export const WAITLIST_DEFINITIONS = {
  active: 'Entradas que no se han dado de baja.',
  last7Days: 'Altas en los últimos 7 días (24 h × 7), incluidas las que luego se dieron de baja.',
  byDay: 'Altas por día en Europe/Madrid, incluidas las que luego se dieron de baja.',
  segments: 'Respuestas de las entradas activas.',
  targetSegment:
    'Hogar de 2 o más, la persona planifica (sola o compartido) y cocina en casa (no ha respondido «casi no cocino»).',
  referredSignups: 'Entradas activas que llegaron con el enlace de otra persona (?invita=).',
  newsletterOptIns: 'Entradas activas que han marcado, aparte, recibir el menú de la semana por email.',
  suggestedNextBatch:
    'Solo entradas en espera. Orden: segmento objetivo; dentro, quien ha traído a alguien o cuya persona invitante ya está dentro; después, la más antigua. Cada persona elegida arrastra a quienes se apuntaron con su enlace (entran juntos), hasta llenar la tanda. Solo ids, sin datos personales.',
} as const

function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>
}

function countBy<T>(items: T[], key: (t: T) => string): Map<string, { sample: T; count: number }> {
  const out = new Map<string, { sample: T; count: number }>()
  for (const item of items) {
    const k = key(item)
    const cur = out.get(k)
    if (cur) cur.count += 1
    else out.set(k, { sample: item, count: 1 })
  }
  return out
}

const byCountDesc = <T extends { count: number }>(a: T, b: T) => b.count - a.count

export function buildWaitlistReport(
  rows: WaitlistReportRow[],
  opts: { now: Date; days: number; batchSize: number; topReferrers?: number },
) {
  const active = rows.filter((r) => r.status !== 'unsubscribed')
  const weekAgo = opts.now.getTime() - 7 * 86_400_000

  const status = zeroCounts(['waiting', 'invited', 'joined', 'unsubscribed'] as const)
  for (const r of rows) status[r.status] += 1

  // Signups per Madrid day, zero-filled, from the later of (window start, first signup).
  const dayOf = (d: Date) => madridParts(d).isoDate
  const today = dayOf(opts.now)
  const perDay = new Map<string, number>()
  for (const r of rows) perDay.set(dayOf(r.createdAt), (perDay.get(dayOf(r.createdAt)) ?? 0) + 1)
  const byDay: Array<{ day: string; signups: number }> = []
  if (rows.length > 0) {
    const firstDay = [...perDay.keys()].sort()[0]
    const windowStart = addDays(today, -(Math.max(1, opts.days) - 1))
    for (let day = firstDay > windowStart ? firstDay : windowStart; day <= today; day = addDays(day, 1)) {
      byDay.push({ day, signups: perDay.get(day) ?? 0 })
    }
  }

  const householdSize = zeroCounts(WAITLIST_HOUSEHOLD_SIZES)
  const plannerRole = zeroCounts(WAITLIST_PLANNER_ROLES)
  const currentMethod = zeroCounts(WAITLIST_CURRENT_METHODS)
  const platform = zeroCounts(WAITLIST_PLATFORMS)
  for (const r of active) {
    householdSize[r.householdSize] += 1
    plannerRole[r.plannerRole] += 1
    currentMethod[r.currentMethod] += 1
    platform[r.platform] += 1
  }
  const cross = [...countBy(active, (r) => `${r.householdSize}|${r.plannerRole}|${r.currentMethod}`).values()]
    .map(({ sample, count }) => ({
      householdSize: sample.householdSize,
      plannerRole: sample.plannerRole,
      currentMethod: sample.currentMethod,
      count,
      target: isTargetSegment(sample),
    }))
    .sort(byCountDesc)

  const bySource = [...countBy(active, (r) => r.source).values()]
    .map(({ sample, count }) => ({ source: sample.source, count }))
    .sort(byCountDesc)
  const byUtm = [...countBy(active, (r) => JSON.stringify([r.utmSource, r.utmMedium, r.utmCampaign])).values()]
    .map(({ sample, count }) => ({
      utmSource: sample.utmSource,
      utmMedium: sample.utmMedium,
      utmCampaign: sample.utmCampaign,
      count,
    }))
    .sort(byCountDesc)

  const referred = active.filter((r) => r.referredByCode)
  const topReferrers = [...countBy(referred, (r) => r.referredByCode!).entries()]
    .map(([code, { count }]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))

  const batches = [...countBy(rows.filter((r) => r.batch != null), (r) => String(r.batch)).keys()]
    .map(Number)
    .sort((a, b) => a - b)
    .map((batch) => {
      const inBatch = rows.filter((r) => r.batch === batch)
      return {
        batch,
        size: inBatch.length,
        joined: inBatch.filter((r) => r.status === 'joined').length,
        unsubscribed: inBatch.filter((r) => r.status === 'unsubscribed').length,
      }
    })

  return {
    generatedAt: opts.now.toISOString(),
    timezone: MADRID_TZ,
    totals: {
      entries: rows.length,
      active: active.length,
      last7Days: rows.filter((r) => r.createdAt.getTime() >= weekAgo).length,
      wantsWhatsapp: active.filter((r) => r.wantsWhatsapp).length,
      newsletterOptIns: active.filter((r) => r.newsletterOptIn).length,
      inTargetSegment: active.filter(isTargetSegment).length,
      referredSignups: referred.length,
    },
    status,
    byDay,
    segments: { householdSize, plannerRole, currentMethod, platform, cross },
    sources: { bySource, byUtm },
    referrals: {
      referredSignups: referred.length,
      referrers: topReferrers.length,
      topReferrers: topReferrers.slice(0, opts.topReferrers ?? 10),
    },
    batches,
    suggestedNextBatch: suggestNextBatch(rows, opts.batchSize),
    definitions: WAITLIST_DEFINITIONS,
  }
}

export type WaitlistReport = ReturnType<typeof buildWaitlistReport>

// ─── Signup (repo-backed) ────────────────────────────────────────

export interface NewWaitlistEntry {
  email: string
  firstName: string | null
  householdSize: WaitlistHouseholdSize
  plannerRole: WaitlistPlannerRole
  currentMethod: WaitlistCurrentMethod
  supermarket: string | null
  platform: WaitlistPlatform
  wantsWhatsapp: boolean
  referralCode: string
  referredByCode: string | null
  source: string
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  consentVersion: string
  consentAt: Date
  newsletterOptIn: boolean
  newsletterConsentAt: Date | null
  newsletterConsentVersion: string | null
  unsubscribeToken: string
}

export type UnsubscribeOutcome = 'unsubscribed' | 'already' | 'not_found'

export interface WaitlistRepo {
  /** Referral code of the entry with this (normalised) email, if any. */
  findCodeByEmail(email: string): Promise<string | null>
  /** True when an entry that hasn't unsubscribed owns this code. */
  isActiveCode(code: string): Promise<boolean>
  /** Insert; false when a unique index (email, code or token) is already taken. */
  insert(entry: NewWaitlistEntry): Promise<boolean>
  /** Active entries that signed up with this code. */
  countReferred(code: string): Promise<number>
  /** Anonymise the entry (status, email, name, supermarket, newsletter off). */
  unsubscribe(token: string): Promise<UnsubscribeOutcome>
}

export interface SignupDeps {
  repo: WaitlistRepo
  /** Origin the referral links point to (no trailing slash needed). */
  publicUrl: string
  now?: () => Date
  newCode?: () => string
  newToken?: () => string
}

const MAX_CODE_ATTEMPTS = 5

async function existingResponse(code: string, deps: SignupDeps): Promise<WaitlistSignupResponse> {
  return {
    code,
    referralUrl: waitlistReferralUrl(deps.publicUrl, code),
    referredCount: await deps.repo.countReferred(code),
  }
}

/**
 * Idempotent on email: a repeat submission (any answers) changes nothing and
 * gets the same referral link back — but never the opt-out token, so knowing
 * someone's email is not enough to take them off the list.
 */
export async function signupToWaitlist(input: WaitlistSignup, deps: SignupDeps): Promise<WaitlistSignupResponse> {
  const existing = await deps.repo.findCodeByEmail(input.email)
  if (existing) return existingResponse(existing, deps)

  const referredByCode =
    input.referredByCode && (await deps.repo.isActiveCode(input.referredByCode)) ? input.referredByCode : null
  const now = deps.now?.() ?? new Date()
  const newCode = deps.newCode ?? (() => generateReferralCode())
  const newToken = deps.newToken ?? generateUnsubscribeToken

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = newCode()
    const token = newToken()
    const inserted = await deps.repo.insert({
      email: input.email,
      firstName: input.firstName,
      householdSize: input.householdSize,
      plannerRole: input.plannerRole,
      currentMethod: input.currentMethod,
      supermarket: input.supermarket,
      platform: input.platform,
      wantsWhatsapp: input.wantsWhatsapp,
      referralCode: code,
      referredByCode,
      source: input.source,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      consentVersion: WAITLIST_CONSENT_VERSION,
      consentAt: now,
      newsletterOptIn: input.newsletterOptIn,
      newsletterConsentAt: input.newsletterOptIn ? now : null,
      newsletterConsentVersion: input.newsletterOptIn ? WAITLIST_NEWSLETTER_CONSENT_VERSION : null,
      unsubscribeToken: token,
    })
    if (inserted) {
      return { code, referralUrl: waitlistReferralUrl(deps.publicUrl, code), referredCount: 0, unsubscribeToken: token }
    }
    // Lost a race on the same email (double click, two tabs)? Answer like a repeat.
    const raced = await deps.repo.findCodeByEmail(input.email)
    if (raced) return existingResponse(raced, deps)
    // Otherwise the random code/token collided: try fresh ones.
  }
  throw new Error('waitlist: could not allocate a unique referral code')
}

/** The owner page: how many people signed up with this link. Null for unknown / unsubscribed codes. */
export async function getReferralStatus(
  rawCode: string,
  deps: Pick<SignupDeps, 'repo' | 'publicUrl'>,
): Promise<WaitlistStatusResponse | null> {
  const code = normalizeReferralCode(rawCode)
  if (!code || !(await deps.repo.isActiveCode(code))) return null
  return {
    code,
    referralUrl: waitlistReferralUrl(deps.publicUrl, code),
    referredCount: await deps.repo.countReferred(code),
  }
}

export function createDbWaitlistRepo(db: Db = defaultDb): WaitlistRepo {
  return {
    async findCodeByEmail(email) {
      const [row] = await db
        .select({ code: waitlistEntries.referralCode })
        .from(waitlistEntries)
        .where(eq(waitlistEntries.email, email))
        .limit(1)
      return row?.code ?? null
    },
    async isActiveCode(code) {
      const [row] = await db
        .select({ id: waitlistEntries.id })
        .from(waitlistEntries)
        .where(and(eq(waitlistEntries.referralCode, code), ne(waitlistEntries.status, 'unsubscribed')))
        .limit(1)
      return !!row
    },
    async insert(entry) {
      const rows = await db
        .insert(waitlistEntries)
        .values(entry)
        .onConflictDoNothing()
        .returning({ id: waitlistEntries.id })
      return rows.length > 0
    },
    async countReferred(code) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(waitlistEntries)
        .where(and(eq(waitlistEntries.referredByCode, code), ne(waitlistEntries.status, 'unsubscribed')))
      return Number(row?.n ?? 0)
    },
    async unsubscribe(token) {
      const [row] = await db
        .select({ id: waitlistEntries.id, status: waitlistEntries.status })
        .from(waitlistEntries)
        .where(eq(waitlistEntries.unsubscribeToken, token))
        .limit(1)
      if (!row) return 'not_found'
      if (row.status === 'unsubscribed') return 'already'
      await db
        .update(waitlistEntries)
        .set({ status: 'unsubscribed', email: null, firstName: null, supermarket: null, newsletterOptIn: false })
        .where(eq(waitlistEntries.id, row.id))
      return 'unsubscribed'
    },
  }
}

// ─── Admin (GET /admin/waitlist, POST /admin/waitlist/invite) ────

/** The full report. Selects no email, name or supermarket. */
export async function loadWaitlistReport(
  opts: { days: number; batchSize: number; now?: Date },
  db: Db = defaultDb,
): Promise<WaitlistReport> {
  const rows = await db
    .select({
      id: waitlistEntries.id,
      createdAt: waitlistEntries.createdAt,
      householdSize: waitlistEntries.householdSize,
      plannerRole: waitlistEntries.plannerRole,
      currentMethod: waitlistEntries.currentMethod,
      platform: waitlistEntries.platform,
      wantsWhatsapp: waitlistEntries.wantsWhatsapp,
      newsletterOptIn: waitlistEntries.newsletterOptIn,
      source: waitlistEntries.source,
      utmSource: waitlistEntries.utmSource,
      utmMedium: waitlistEntries.utmMedium,
      utmCampaign: waitlistEntries.utmCampaign,
      referralCode: waitlistEntries.referralCode,
      referredByCode: waitlistEntries.referredByCode,
      status: waitlistEntries.status,
      batch: waitlistEntries.batch,
    })
    .from(waitlistEntries)
  return buildWaitlistReport(rows as WaitlistReportRow[], {
    now: opts.now ?? new Date(),
    days: opts.days,
    batchSize: opts.batchSize,
  })
}

/** Pure mapper for the `waitlist` block of GET /admin/metrics (pg returns counts as numbers or strings). */
export function toWaitlistSummary(r: Record<string, unknown>) {
  const n = (k: string) => Number(r[k] ?? 0)
  return {
    entries: n('entries'),
    waiting: n('waiting'),
    invited: n('invited'),
    joined: n('joined'),
    unsubscribed: n('unsubscribed'),
    last7Days: n('last7_days'),
    referredSignups: n('referred'),
    newsletterOptIns: n('newsletter'),
  }
}

export async function loadWaitlistSummary(db: Db = defaultDb, now: Date = new Date()) {
  const since = new Date(now.getTime() - 7 * 86_400_000)
  const res = await db.execute(sql`
    SELECT count(*)::int AS entries,
           count(*) FILTER (WHERE status = 'waiting')::int AS waiting,
           count(*) FILTER (WHERE status = 'invited')::int AS invited,
           count(*) FILTER (WHERE status = 'joined')::int AS joined,
           count(*) FILTER (WHERE status = 'unsubscribed')::int AS unsubscribed,
           count(*) FILTER (WHERE created_at >= ${since})::int AS last7_days,
           count(*) FILTER (WHERE referred_by_code IS NOT NULL AND status <> 'unsubscribed')::int AS referred,
           count(*) FILTER (WHERE newsletter_opt_in AND status <> 'unsubscribed')::int AS newsletter
      FROM waitlist_entries
  `)
  return toWaitlistSummary((res.rows[0] ?? {}) as Record<string, unknown>)
}

/**
 * Admin JWT only: mark waiting entries invited in a batch (next number when
 * omitted) and return what Miguel needs to write to them — email, name and
 * their personal links. Audited as `waitlist.invite` (ids, never emails).
 * Entries that are not `waiting` are skipped.
 */
export async function inviteWaitlistEntries(
  ids: string[],
  batch: number | undefined,
  adminId: string,
  opts: { publicUrl: string },
  db: Db = defaultDb,
) {
  return db.transaction(async (tx) => {
    let batchNo = batch
    if (batchNo == null) {
      const [row] = await tx.select({ max: sql<number | null>`max(${waitlistEntries.batch})` }).from(waitlistEntries)
      batchNo = (Number(row?.max) || 0) + 1
    }
    const rows = await tx
      .update(waitlistEntries)
      .set({ status: 'invited', batch: batchNo, invitedAt: new Date() })
      .where(and(inArray(waitlistEntries.id, ids), eq(waitlistEntries.status, 'waiting')))
      .returning({
        id: waitlistEntries.id,
        email: waitlistEntries.email,
        firstName: waitlistEntries.firstName,
        platform: waitlistEntries.platform,
        wantsWhatsapp: waitlistEntries.wantsWhatsapp,
        referralCode: waitlistEntries.referralCode,
        unsubscribeToken: waitlistEntries.unsubscribeToken,
      })
    if (rows.length > 0) {
      await recordAudit(
        {
          adminId,
          action: 'waitlist.invite',
          targetType: 'waitlist_entry',
          payload: { batch: batchNo, count: rows.length, ids: rows.map((r) => r.id) },
        },
        tx,
      )
    }
    const base = opts.publicUrl.replace(/\/+$/, '')
    return {
      batch: batchNo,
      skipped: ids.length - rows.length,
      invited: rows.map((r) => ({
        id: r.id,
        email: r.email,
        firstName: r.firstName,
        platform: r.platform,
        wantsWhatsapp: r.wantsWhatsapp,
        statusUrl: `${base}${waitlistStatusPath(r.referralCode)}`,
        unsubscribeUrl: `${base}${waitlistUnsubscribePath(r.unsubscribeToken)}`,
      })),
    }
  })
}

/** On registration: an entry with that email (still waiting or invited) becomes `joined`. Never throws. */
export async function markWaitlistJoined(email: string, db: Db = defaultDb): Promise<void> {
  try {
    await db
      .update(waitlistEntries)
      .set({ status: 'joined' })
      .where(
        and(
          eq(waitlistEntries.email, email.trim().toLowerCase()),
          inArray(waitlistEntries.status, ['waiting', 'invited']),
        ),
      )
  } catch (err: any) {
    console.error('[waitlist] mark joined failed (continuing):', err?.message ?? err)
  }
}
