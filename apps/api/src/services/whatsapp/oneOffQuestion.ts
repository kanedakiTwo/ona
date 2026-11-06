/**
 * «Pregunta única por WhatsApp» (PRO-1091, CS-500; Miguel 2026-11-02: option A).
 *
 * Customer Success asks a group of households ONE question by WhatsApp, from
 * Admin. The admin picks the group (sign-up dates of the household and days
 * without activity), sees the count before sending, and presses one button.
 *
 *   - It goes by the approved template of kind `pregunta_unica` in
 *     `WHATSAPP_TEMPLATES` (one `{{1}}` = the question). Without it, nothing
 *     goes out.
 *   - Once per household and question: `whatsapp_question_sends` (unique
 *     question + household), claimed BEFORE the send, so two presses (or two
 *     admins) never send it twice. A failed send is not retried.
 *   - One person per household: the owner, else the earliest member, with
 *     WhatsApp linked. Never whoever asked BAJA (or said «No, gracias»), a
 *     suspended or paused account, or one outside `WHATSAPP_ALLOWED_EMAILS`.
 *   - Never a household with an internal account (role admin or in
 *     `ADMIN_EMAILS`) or a test household (an email in a reserved test
 *     domain: example.com, *.test, *.local…, or `EMAIL_SINK_DOMAINS`).
 *   - The person's next message after it lands in Opiniones (`user_feedback`,
 *     channel `whatsapp`, tag `pregunta_unica`), and still reaches Mimo.
 *
 * Pure rules (`planQuestion`) + DB glue behind a small store
 * (tests/oneOffQuestion.test.ts, tests/oneOffQuestion.smoke.ts).
 */
import { sql } from 'drizzle-orm'
import { env } from '../../config/env.js'
import { db as defaultDb } from '../../db/connection.js'
import { recordCost } from '../costLedger.js'
import { isAccountPaused } from '../accountAccess.js'
import { emailSinkDomains } from '../emailSink.js'
import { addDays, madridMidnightUtc, madridParts } from '../madridTime.js'
import { isUserAllowed, isWhatsAppConfigured } from './config.js'
import { optInDeclinedSql } from './optInOffer.js'
import { parseTemplateMap } from './proactive.js'
import * as client from './client.js'
import * as store from './store.js'

type Db = typeof defaultDb

/** Kind of the outbound rows and key in `WHATSAPP_TEMPLATES`. */
export const QUESTION_KIND = 'pregunta_unica'
/** Tag of the answers in `user_feedback`. */
export const QUESTION_FEEDBACK_TAG = 'pregunta_unica'
/** An answer counts only within this many days of the question. */
export const ANSWER_WINDOW_DAYS = 14
/** Sends per press (Meta: 250 business-initiated conversations a day, avisos included). */
export const MAX_PER_SEND = 200
export const QUESTION_MIN_CHARS = 10
export const QUESTION_MAX_CHARS = 900

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Domains reserved for tests (RFC 2606/6761) — the test households live
 * there. An entry starting with «.» matches every domain ending in it.
 */
export const RESERVED_TEST_DOMAINS: readonly string[] = ['example.com', 'example.org', 'example.net', '.test', '.example', '.invalid', '.localhost', '.local']

/** The reserved domains plus the staging mail sink's (`EMAIL_SINK_DOMAINS`). */
export function testDomains(): string[] {
  return [...RESERVED_TEST_DOMAINS, ...emailSinkDomains()]
}

export function isTestEmail(email: string, domains: readonly string[] = testDomains()): boolean {
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  if (!domain) return false
  return domains.some((d) => (d.startsWith('.') ? domain.endsWith(d) : domain === d))
}

export function isInternalAccount(m: { role: string; email: string }, adminEmails: readonly string[] = env.ADMIN_EMAILS): boolean {
  return m.role === 'admin' || adminEmails.includes(m.email.trim().toLowerCase())
}

/** The question as it goes in the template's `{{1}}`: one line (Meta rejects newlines), trimmed. */
export function questionParam(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// ─── The group ────────────────────────────────────────────────────

export interface QuestionFilter {
  /** First and last Madrid day (YYYY-MM-DD) the household was created. */
  signedUpFrom: string
  signedUpTo: string
  /** Days without activity in the household (0 = any). */
  inactiveDays: number
}

export interface CandidateMember {
  userId: string
  email: string
  role: string
  suspended: boolean
  isOwner: boolean
  joinedAt: Date
  /** WhatsApp link, if any. `saidNo` = asked BAJA or answered «No, gracias» (and didn't ALTA since). */
  link: { phone: string; saidNo: boolean } | null
}

export interface CandidateHousehold {
  householdId: string
  createdAt: Date
  /** Last thing anyone in it did (app usage or a WhatsApp message); null = never. */
  lastActivityAt: Date | null
  members: CandidateMember[]
}

export type ExclusionReason = 'ya_enviada' | 'baja' | 'interna' | 'prueba' | 'sin_whatsapp'

export interface QuestionRecipient {
  householdId: string
  userId: string
  phone: string
}

export interface QuestionPlan {
  recipients: QuestionRecipient[]
  excluded: Record<ExclusionReason, number>
}

export interface PlanContext {
  filter: QuestionFilter
  now: Date
  /** Households that already got this question. */
  alreadySent: ReadonlySet<string>
  /** `WHATSAPP_ALLOWED_EMAILS`. */
  allowed?: (email: string) => boolean
  /** Paused accounts get nothing. */
  paused?: ReadonlySet<string>
  adminEmails?: readonly string[]
  /** Test-household domains (default `testDomains()`). */
  testDomains?: readonly string[]
}

export function inGroup(h: Pick<CandidateHousehold, 'createdAt' | 'lastActivityAt'>, filter: QuestionFilter, now: Date): boolean {
  const day = madridParts(h.createdAt).isoDate
  if (day < filter.signedUpFrom || day > filter.signedUpTo) return false
  if (filter.inactiveDays <= 0 || !h.lastActivityAt) return true
  return now.getTime() - h.lastActivityAt.getTime() >= filter.inactiveDays * DAY_MS
}

/**
 * Pure: who gets the question, one person per household, and why the rest
 * don't. The count the admin sees is `recipients.length`.
 */
export function planQuestion(households: readonly CandidateHousehold[], ctx: PlanContext): QuestionPlan {
  const excluded: Record<ExclusionReason, number> = { ya_enviada: 0, baja: 0, interna: 0, prueba: 0, sin_whatsapp: 0 }
  const recipients: QuestionRecipient[] = []
  const allowed = ctx.allowed ?? ((email: string) => isUserAllowed(email))
  for (const h of households) {
    if (!inGroup(h, ctx.filter, ctx.now)) continue
    if (h.members.some((m) => isInternalAccount(m, ctx.adminEmails))) { excluded.interna++; continue }
    if (h.members.some((m) => isTestEmail(m.email, ctx.testDomains))) { excluded.prueba++; continue }
    if (ctx.alreadySent.has(h.householdId)) { excluded.ya_enviada++; continue }
    const reachable = h.members
      .filter((m) => m.link && !m.suspended && !ctx.paused?.has(m.userId) && allowed(m.email))
      .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.joinedAt.getTime() - b.joinedAt.getTime())
    const to = reachable.find((m) => !m.link!.saidNo)
    if (to) recipients.push({ householdId: h.householdId, userId: to.userId, phone: to.link!.phone })
    else if (reachable.length > 0) excluded.baja++
    else excluded.sin_whatsapp++
  }
  return { recipients, excluded }
}

// ─── Store (DB) ───────────────────────────────────────────────────

export interface QuestionSummary {
  id: string
  text: string
  createdAt: Date
  sent: number
  failed: number
  answered: number
}

export interface QuestionStore {
  loadCandidates(filter: QuestionFilter): Promise<CandidateHousehold[]>
  /** Households that already got the question with this text. */
  sentHouseholds(text: string): Promise<Set<string>>
  /** The question's id, created the first time this text is sent. */
  ensureQuestion(text: string, adminId: string): Promise<string>
  /** Claim the send for this household; null when it already has one (never twice). */
  claimSend(questionId: string, r: QuestionRecipient): Promise<string | null>
  markFailed(sendId: string, error: string): Promise<void>
  list(): Promise<QuestionSummary[]>
}

export function createDbQuestionStore(db: Db = defaultDb): QuestionStore {
  return {
    async loadCandidates(filter) {
      const from = madridMidnightUtc(filter.signedUpFrom)
      const to = madridMidnightUtc(addDays(filter.signedUpTo, 1))
      const res = await db.execute(sql`
        SELECT h.id::text AS household_id, h.created_at AS household_created_at,
               GREATEST(
                 (SELECT max(e.created_at) FROM usage_events e WHERE e.household_id = h.id),
                 (SELECT max(l2.last_inbound_at) FROM household_members m2
                    JOIN whatsapp_links l2 ON l2.user_id = m2.user_id WHERE m2.household_id = h.id)
               ) AS last_activity_at,
               u.id::text AS user_id, u.email, u.role, (u.suspended_at IS NOT NULL) AS suspended,
               (h.owner_id = u.id) AS is_owner, hm.joined_at,
               wl.phone, (wl.id IS NOT NULL AND NOT wl.notify AND ${optInDeclinedSql()}) AS said_no
          FROM households h
          JOIN household_members hm ON hm.household_id = h.id
          JOIN users u ON u.id = hm.user_id
          LEFT JOIN whatsapp_links wl ON wl.user_id = u.id
         WHERE h.created_at >= ${from.toISOString()}::timestamptz AND h.created_at < ${to.toISOString()}::timestamptz
      `)
      const byId = new Map<string, CandidateHousehold>()
      for (const r of res.rows as any[]) {
        let h = byId.get(r.household_id)
        if (!h) {
          h = {
            householdId: r.household_id,
            createdAt: new Date(r.household_created_at),
            lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at) : null,
            members: [],
          }
          byId.set(r.household_id, h)
        }
        h.members.push({
          userId: r.user_id,
          email: r.email,
          role: r.role,
          suspended: Boolean(r.suspended),
          isOwner: Boolean(r.is_owner),
          joinedAt: new Date(r.joined_at),
          link: r.phone ? { phone: r.phone, saidNo: Boolean(r.said_no) } : null,
        })
      }
      return [...byId.values()]
    },
    async sentHouseholds(text) {
      const res = await db.execute(sql`
        SELECT s.household_id::text AS household_id FROM whatsapp_question_sends s
          JOIN whatsapp_questions q ON q.id = s.question_id
         WHERE q.text = ${text}
      `)
      return new Set((res.rows as any[]).map((r) => r.household_id as string))
    },
    async ensureQuestion(text, adminId) {
      const res = await db.execute(sql`
        INSERT INTO whatsapp_questions (text, created_by) VALUES (${text}, ${adminId}::uuid)
        ON CONFLICT (text) DO UPDATE SET text = EXCLUDED.text
        RETURNING id::text AS id
      `)
      return (res.rows as any[])[0].id as string
    },
    async claimSend(questionId, r) {
      const res = await db.execute(sql`
        INSERT INTO whatsapp_question_sends (question_id, household_id, user_id, phone)
        VALUES (${questionId}::uuid, ${r.householdId}::uuid, ${r.userId}::uuid, ${r.phone})
        ON CONFLICT (question_id, household_id) DO NOTHING
        RETURNING id::text AS id
      `)
      return ((res.rows as any[])[0]?.id as string | undefined) ?? null
    },
    async markFailed(sendId, error) {
      await db.execute(sql`UPDATE whatsapp_question_sends SET status = 'failed', error_message = ${error} WHERE id = ${sendId}::uuid`)
    },
    async list() {
      const res = await db.execute(sql`
        SELECT q.id::text AS id, q.text, q.created_at,
               count(s.id) FILTER (WHERE s.status = 'sent')::int AS sent,
               count(s.id) FILTER (WHERE s.status = 'failed')::int AS failed,
               count(s.answered_at)::int AS answered
          FROM whatsapp_questions q
          LEFT JOIN whatsapp_question_sends s ON s.question_id = q.id
         GROUP BY q.id
         ORDER BY q.created_at DESC
         LIMIT 20
      `)
      return (res.rows as any[]).map((r) => ({ id: r.id, text: r.text, createdAt: new Date(r.created_at), sent: r.sent, failed: r.failed, answered: r.answered }))
    },
  }
}

// ─── Preview and send ─────────────────────────────────────────────

/** The approved template of kind `pregunta_unica`, or null (then nothing goes out). */
export function questionTemplate(raw: string = env.WHATSAPP_TEMPLATES): string | null {
  const name = parseTemplateMap(raw)[QUESTION_KIND]
  return name?.trim() || null
}

export interface QuestionDeps {
  store?: QuestionStore
  now?: Date
  template?: string | null
  configured?: boolean
  isPaused?: (userId: string, now: Date) => Promise<boolean>
  adminEmails?: readonly string[]
  testDomains?: readonly string[]
  sendTemplate?: (phone: string, template: string, lang: string, text: string) => Promise<string | null>
  /** Outbound row + cost, so the question is in the chat history and the ledger. */
  recordOutbound?: (row: { phone: string; userId: string; body: string; status: 'sent' | 'failed'; wamid?: string | null; errorMessage?: string }) => Promise<void>
}

export interface QuestionPreview extends QuestionPlan {
  count: number
  template: string | null
  configured: boolean
}

async function pausedAmong(households: readonly CandidateHousehold[], now: Date, isPaused: QuestionDeps['isPaused']): Promise<Set<string>> {
  const paused = new Set<string>()
  const check = isPaused ?? ((id: string, at: Date) => isAccountPaused(id, at))
  for (const h of households) for (const m of h.members) if (m.link && (await check(m.userId, now))) paused.add(m.userId)
  return paused
}

export async function previewQuestion(text: string, filter: QuestionFilter, deps: QuestionDeps = {}): Promise<QuestionPreview> {
  const s = deps.store ?? createDbQuestionStore()
  const now = deps.now ?? new Date()
  const candidates = (await s.loadCandidates(filter)).filter((h) => inGroup(h, filter, now))
  const [alreadySent, paused] = await Promise.all([s.sentHouseholds(questionParam(text)), pausedAmong(candidates, now, deps.isPaused)])
  const plan = planQuestion(candidates, { filter, now, alreadySent, paused, adminEmails: deps.adminEmails, testDomains: deps.testDomains })
  return {
    ...plan,
    count: plan.recipients.length,
    template: deps.template !== undefined ? deps.template : questionTemplate(),
    configured: deps.configured ?? isWhatsAppConfigured(),
  }
}

export type SendOutcome =
  | { status: 'sent'; questionId: string; sent: number; failed: number; skipped: number; remaining: number }
  | { status: 'count_changed'; count: number }
  | { status: 'unavailable'; reason: 'no_template' | 'not_configured' }

/**
 * Sends the question to the group, if the count is still the one the admin
 * saw. Sequential; each household claimed before its send. At most
 * `MAX_PER_SEND` per call (`remaining` = what a second press would send).
 */
export async function sendQuestion(
  text: string,
  filter: QuestionFilter,
  expectedCount: number,
  adminId: string,
  deps: QuestionDeps = {},
): Promise<SendOutcome> {
  const s = deps.store ?? createDbQuestionStore()
  const param = questionParam(text)
  const preview = await previewQuestion(param, filter, { ...deps, store: s })
  if (!preview.configured) return { status: 'unavailable', reason: 'not_configured' }
  if (!preview.template) return { status: 'unavailable', reason: 'no_template' }
  if (preview.count !== expectedCount) return { status: 'count_changed', count: preview.count }
  const questionId = await s.ensureQuestion(param, adminId)
  const send = deps.sendTemplate ?? client.sendTemplate
  const recordOutbound = deps.recordOutbound ?? defaultRecordOutbound
  const batch = preview.recipients.slice(0, MAX_PER_SEND)
  let sent = 0
  let failed = 0
  let skipped = 0
  for (const r of batch) {
    const sendId = await s.claimSend(questionId, r)
    if (!sendId) { skipped++; continue }
    try {
      const wamid = await send(r.phone, preview.template, env.WHATSAPP_TEMPLATE_LANG, param)
      sent++
      await recordOutbound({ phone: r.phone, userId: r.userId, body: param, status: 'sent', wamid })
    } catch (err: any) {
      const error = String(err?.message ?? err).slice(0, 500)
      console.error('[pregunta-unica] send failed:', error)
      failed++
      await s.markFailed(sendId, error)
      await recordOutbound({ phone: r.phone, userId: r.userId, body: param, status: 'failed', errorMessage: error }).catch(() => {})
    }
  }
  return { status: 'sent', questionId, sent, failed, skipped, remaining: preview.recipients.length - batch.length }
}

async function defaultRecordOutbound(row: { phone: string; userId: string; body: string; status: 'sent' | 'failed'; wamid?: string | null; errorMessage?: string }): Promise<void> {
  if (row.status === 'sent') {
    recordCost({ feature: 'whatsapp_template', provider: 'meta_whatsapp', model: 'utility_template', units: { messages: 1 }, userId: row.userId })
  }
  await store.insertOutbound({ ...row, kind: QUESTION_KIND })
}

export function listQuestions(deps: { store?: QuestionStore } = {}): Promise<QuestionSummary[]> {
  return (deps.store ?? createDbQuestionStore()).list()
}

// ─── The answer → Opiniones ───────────────────────────────────────

/**
 * The person's next WhatsApp message after the question (within
 * `ANSWER_WINDOW_DAYS`, with nothing else from Mimo in between) is saved
 * verbatim in `user_feedback`, tag `pregunta_unica`, once per send. Never throws.
 */
export async function recordQuestionAnswer(userId: string, message: string, db: Db = defaultDb, now: Date = new Date()): Promise<boolean> {
  const text = message.trim().slice(0, 2000)
  if (text.length < 2) return false
  try {
    const since = new Date(now.getTime() - ANSWER_WINDOW_DAYS * DAY_MS)
    const res = await db.execute(sql`
      WITH pending AS (
        SELECT s.id FROM whatsapp_question_sends s
         WHERE s.user_id = ${userId}::uuid AND s.status = 'sent' AND s.answered_at IS NULL
           AND s.sent_at >= ${since.toISOString()}::timestamptz
           AND NOT EXISTS (
             SELECT 1 FROM whatsapp_messages m
              WHERE m.phone = s.phone AND m.direction = 'out' AND m.created_at > s.sent_at
                AND m.kind NOT IN (${QUESTION_KIND}, 'ack', 'system')
           )
         ORDER BY s.sent_at DESC
         LIMIT 1
      ), answered AS (
        UPDATE whatsapp_question_sends SET answered_at = ${now.toISOString()}::timestamptz
         WHERE id IN (SELECT id FROM pending) AND answered_at IS NULL
        RETURNING user_id
      )
      INSERT INTO user_feedback (user_id, channel, text, tag)
      SELECT user_id, 'whatsapp', ${text}, ${QUESTION_FEEDBACK_TAG} FROM answered
      RETURNING id
    `)
    return res.rows.length > 0
  } catch (err) {
    console.warn('[pregunta-unica] answer not recorded:', (err as Error)?.message ?? err)
    return false
  }
}
