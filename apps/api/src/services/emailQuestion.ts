/**
 * «Pregunta por correo» (PRO-1197; approval 2026-11-11-cs-pregunta-hogares-que-lo-dejaron,
 * option A, Miguel 2026-11-12).
 *
 * One email from Miguel to the households of the beta that left: nobody in
 * them did anything in the last `INACTIVE_DAYS` days. The subject, the sender
 * and the footer are fixed here; the body is the approved text, pasted in
 * Admin (each person's «Hola, Nombre:» goes on top). Sent with one button,
 * after the admin sees the exact count and the email, and confirms. Reuses the group rules of PRO-1091
 * (whatsapp/oneOffQuestion.ts): internal accounts and test households out.
 *
 *   - Out: the active households (and the ones created less than
 *     `INACTIVE_DAYS` ago, which haven't had time to leave), a household with
 *     an internal account or a test email, one with a suspended account and
 *     one where someone asked BAJA or said «No, gracias» on WhatsApp.
 *   - One person per household: the owner, else the earliest member.
 *   - Once per household, ever: `email_question_sends` (unique question +
 *     household), claimed BEFORE the send, so a second press (or a second
 *     admin) never sends it twice. A failed send is not retried.
 *   - One email per person (its own `to`), never CC; «Miguel de Mimoia», reply-to hola@.
 *
 * Pure rules (`planEmailQuestion`, `renderQuestionEmail`) + DB glue behind a
 * small store (tests/emailQuestion.test.ts, tests/emailQuestion.smoke.ts).
 */
import { sql } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { isEmailConfigured, sendEmail, type EmailMessage, type EmailResult } from './email.js'
import { BODY, brandAssets, emailDocument, esc, footerBand, paragraphs, row, type BrandAssets } from './emailBrand.js'
import { cleanFirstName, nameFromUsername } from './newsletterLetter.js'
import { optInDeclinedSql } from './whatsapp/optInOffer.js'
import { isInternalAccount, isTestEmail } from './whatsapp/oneOffQuestion.js'

type Db = typeof defaultDb

/** The email in `email_question_sends.question` (another email would need its own name). */
export const EMAIL_QUESTION_CAMPAIGN = 'que-te-falto-2026-11'
/** A household that did nothing in these many days «lo dejó». */
export const INACTIVE_DAYS = 14
/** Between two sends (Resend lets 2 requests a second). */
export const SEND_GAP_MS = 600

const DAY_MS = 24 * 60 * 60 * 1000

// ─── The email ────────────────────────────────────────────────────

export const QUESTION_SUBJECT = '¿Qué te faltó en Mimoia?'
export const QUESTION_FROM_NAME = 'Miguel de Mimoia'
export const QUESTION_FOOTER = 'Te escribo porque tienes cuenta en la beta de Mimoia.'
/** The body the admin pastes (the approved text, from «Soy Miguel…» to the signature). */
export const BODY_MIN_CHARS = 80
export const BODY_MAX_CHARS = 4000

export function greeting(firstName: string | null): string {
  return firstName ? `Hola, ${firstName}:` : 'Hola:'
}

/**
 * The body as it goes: line ends normalised, trimmed, and without a greeting
 * line of its own («Hola{, Nombre}:» as pasted from the approval): each
 * person's greeting is added on top.
 */
export function cleanBody(raw: string): string {
  const paras = raw
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.split('\n').map((l) => l.trim()).join('\n').trim())
    .filter(Boolean)
  if (paras.length > 0 && /^hola\b[^\n]{0,40}:$/i.test(paras[0])) paras.shift()
  return paras.join('\n\n')
}

/** The email for one person: greeting, the body, the footer. A plain letter: no logo, no button, no link. */
export function renderQuestionEmail(firstName: string | null, body: string, assets: BrandAssets = brandAssets(env.WEB_PUBLIC_URL)): { html: string; text: string } {
  const text = cleanBody(body)
  const html = emailDocument(
    QUESTION_SUBJECT,
    undefined,
    [
      row(paragraphs(`${greeting(firstName)}\n\n${text}`, BODY, 16), '36px 28px 36px'),
      // No home link: the footer says why, nothing else.
      footerBand({ ...assets, homeUrl: undefined }, [esc(QUESTION_FOOTER)]),
    ].join('\n'),
  )
  return { html, text: [greeting(firstName), '', text, '', '--', QUESTION_FOOTER].join('\n') }
}

export function questionMessage(r: Pick<EmailQuestionRecipient, 'email' | 'firstName'>, body: string): EmailMessage {
  return { to: r.email, subject: QUESTION_SUBJECT, ...renderQuestionEmail(r.firstName, body), fromName: QUESTION_FROM_NAME, replyToSender: true }
}

// ─── The group ────────────────────────────────────────────────────

export interface EmailCandidateMember {
  userId: string
  email: string
  username: string
  /** The name they gave on the waitlist, if any. */
  waitlistName: string | null
  role: string
  suspended: boolean
  isOwner: boolean
  joinedAt: Date
  /** Asked BAJA or answered «No, gracias» on WhatsApp. */
  saidNo: boolean
}

export interface EmailCandidateHousehold {
  householdId: string
  createdAt: Date
  /** Last thing anyone in it did (app usage or a WhatsApp message); null = never. */
  lastActivityAt: Date | null
  members: EmailCandidateMember[]
}

export type EmailExclusionReason = 'activo' | 'interna' | 'prueba' | 'suspendida' | 'baja' | 'ya_enviada'

export interface EmailQuestionRecipient {
  householdId: string
  userId: string
  email: string
  firstName: string | null
}

export interface EmailQuestionPlan {
  recipients: EmailQuestionRecipient[]
  excluded: Record<EmailExclusionReason, number>
}

export interface EmailPlanContext {
  now: Date
  /** Households that already got it. */
  alreadySent: ReadonlySet<string>
  adminEmails?: readonly string[]
  /** Test-household domains (default `testDomains()`). */
  testDomains?: readonly string[]
}

/** Nobody did anything in `INACTIVE_DAYS`, and the household is at least that old. */
export function leftTheBeta(h: Pick<EmailCandidateHousehold, 'createdAt' | 'lastActivityAt'>, now: Date): boolean {
  const since = now.getTime() - INACTIVE_DAYS * DAY_MS
  if (h.createdAt.getTime() > since) return false
  return !h.lastActivityAt || h.lastActivityAt.getTime() <= since
}

/**
 * Pure: who gets the email, one person per household, and why the rest
 * don't. The count the admin sees is `recipients.length`. Each household is
 * counted under the first reason that applies, in this order.
 */
export function planEmailQuestion(households: readonly EmailCandidateHousehold[], ctx: EmailPlanContext): EmailQuestionPlan {
  const excluded: Record<EmailExclusionReason, number> = { activo: 0, interna: 0, prueba: 0, suspendida: 0, baja: 0, ya_enviada: 0 }
  const recipients: EmailQuestionRecipient[] = []
  for (const h of households) {
    if (h.members.length === 0) continue
    let reason: EmailExclusionReason | null = null
    if (!leftTheBeta(h, ctx.now)) reason = 'activo'
    else if (h.members.some((m) => isInternalAccount(m, ctx.adminEmails))) reason = 'interna'
    else if (h.members.some((m) => isTestEmail(m.email, ctx.testDomains))) reason = 'prueba'
    else if (h.members.some((m) => m.suspended)) reason = 'suspendida'
    else if (h.members.some((m) => m.saidNo)) reason = 'baja'
    else if (ctx.alreadySent.has(h.householdId)) reason = 'ya_enviada'
    if (reason) {
      excluded[reason]++
      continue
    }
    const to = [...h.members].sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.joinedAt.getTime() - b.joinedAt.getTime())[0]
    recipients.push({
      householdId: h.householdId,
      userId: to.userId,
      email: to.email.trim(),
      firstName: cleanFirstName(to.waitlistName) ?? nameFromUsername(to.username),
    })
  }
  return { recipients, excluded }
}

// ─── Store (DB) ───────────────────────────────────────────────────

export interface EmailQuestionStore {
  loadCandidates(): Promise<EmailCandidateHousehold[]>
  /** Households that already have a row (sent, failed or half-way). */
  sentHouseholds(): Promise<Set<string>>
  /** Claim the send for this household; null when it already has one (never twice). */
  claimSend(r: EmailQuestionRecipient): Promise<string | null>
  markSent(sendId: string): Promise<void>
  markFailed(sendId: string, error: string): Promise<void>
  /** What went out so far. */
  totals(): Promise<{ sent: number; failed: number; lastSentAt: Date | null }>
}

export function createDbEmailQuestionStore(db: Db = defaultDb): EmailQuestionStore {
  return {
    async loadCandidates() {
      const res = await db.execute(sql`
        SELECT h.id::text AS household_id, h.created_at AS household_created_at,
               GREATEST(
                 (SELECT max(e.created_at) FROM usage_events e WHERE e.household_id = h.id),
                 (SELECT max(l2.last_inbound_at) FROM household_members m2
                    JOIN whatsapp_links l2 ON l2.user_id = m2.user_id WHERE m2.household_id = h.id)
               ) AS last_activity_at,
               u.id::text AS user_id, u.email, u.username, u.role, (u.suspended_at IS NOT NULL) AS suspended,
               (h.owner_id = u.id) AS is_owner, hm.joined_at,
               (SELECT w.first_name FROM waitlist_entries w WHERE w.email = lower(trim(u.email)) LIMIT 1) AS waitlist_name,
               (wl.id IS NOT NULL AND NOT wl.notify AND ${optInDeclinedSql()}) AS said_no
          FROM households h
          JOIN household_members hm ON hm.household_id = h.id
          JOIN users u ON u.id = hm.user_id
          LEFT JOIN whatsapp_links wl ON wl.user_id = u.id
      `)
      const byId = new Map<string, EmailCandidateHousehold>()
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
          username: r.username,
          waitlistName: r.waitlist_name ?? null,
          role: r.role,
          suspended: Boolean(r.suspended),
          isOwner: Boolean(r.is_owner),
          joinedAt: new Date(r.joined_at),
          saidNo: Boolean(r.said_no),
        })
      }
      return [...byId.values()]
    },
    async sentHouseholds() {
      const res = await db.execute(sql`SELECT household_id::text AS household_id FROM email_question_sends WHERE question = ${EMAIL_QUESTION_CAMPAIGN}`)
      return new Set((res.rows as any[]).map((r) => r.household_id as string))
    },
    async claimSend(r) {
      const res = await db.execute(sql`
        INSERT INTO email_question_sends (question, household_id, user_id)
        VALUES (${EMAIL_QUESTION_CAMPAIGN}, ${r.householdId}::uuid, ${r.userId}::uuid)
        ON CONFLICT (question, household_id) DO NOTHING
        RETURNING id::text AS id
      `)
      return ((res.rows as any[])[0]?.id as string | undefined) ?? null
    },
    async markSent(sendId) {
      await db.execute(sql`UPDATE email_question_sends SET status = 'sent' WHERE id = ${sendId}::uuid`)
    },
    async markFailed(sendId, error) {
      await db.execute(sql`UPDATE email_question_sends SET status = 'failed', error_message = ${error} WHERE id = ${sendId}::uuid`)
    },
    async totals() {
      const res = await db.execute(sql`
        SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent,
               count(*) FILTER (WHERE status <> 'sent')::int AS failed,
               max(sent_at) AS last_sent_at
          FROM email_question_sends WHERE question = ${EMAIL_QUESTION_CAMPAIGN}
      `)
      const r = (res.rows as any[])[0] ?? {}
      return { sent: r.sent ?? 0, failed: r.failed ?? 0, lastSentAt: r.last_sent_at ? new Date(r.last_sent_at) : null }
    },
  }
}

// ─── Preview and send ─────────────────────────────────────────────

export interface EmailQuestionDeps {
  store?: EmailQuestionStore
  now?: Date
  configured?: boolean
  adminEmails?: readonly string[]
  testDomains?: readonly string[]
  send?: (msg: EmailMessage) => Promise<EmailResult>
  /** Wait between two sends (tests pass a no-op). */
  pause?: (ms: number) => Promise<void>
}

export interface EmailQuestionPreview extends EmailQuestionPlan {
  count: number
  configured: boolean
  sent: number
  failed: number
  lastSentAt: Date | null
}

export async function previewEmailQuestion(deps: EmailQuestionDeps = {}): Promise<EmailQuestionPreview> {
  const s = deps.store ?? createDbEmailQuestionStore()
  const now = deps.now ?? new Date()
  const [candidates, alreadySent, totals] = await Promise.all([s.loadCandidates(), s.sentHouseholds(), s.totals()])
  const plan = planEmailQuestion(candidates, { now, alreadySent, adminEmails: deps.adminEmails, testDomains: deps.testDomains })
  return { ...plan, count: plan.recipients.length, configured: deps.configured ?? isEmailConfigured(), ...totals }
}

export type EmailSendOutcome =
  | { status: 'sent'; sent: number; failed: number; skipped: number }
  | { status: 'count_changed'; count: number }
  | { status: 'unavailable'; reason: 'not_configured' }

/**
 * Sends the email to the group, if the count is still the one the admin saw
 * (after a first send it is 0, so a second press sends nothing). One by one,
 * each household claimed before its send.
 */
export async function sendEmailQuestion(body: string, expectedCount: number, deps: EmailQuestionDeps = {}): Promise<EmailSendOutcome> {
  const s = deps.store ?? createDbEmailQuestionStore()
  const preview = await previewEmailQuestion({ ...deps, store: s })
  if (!preview.configured) return { status: 'unavailable', reason: 'not_configured' }
  if (preview.count !== expectedCount || expectedCount === 0) return { status: 'count_changed', count: preview.count }
  const send = deps.send ?? ((msg: EmailMessage) => sendEmail(msg))
  const pause = deps.pause ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let sent = 0
  let failed = 0
  let skipped = 0
  for (const [k, r] of preview.recipients.entries()) {
    const sendId = await s.claimSend(r)
    if (!sendId) { skipped++; continue }
    if (k > 0) await pause(SEND_GAP_MS)
    const out = await send(questionMessage(r, body)).catch((err): EmailResult => ({ status: 'failed', error: String(err?.message ?? err) }))
    if (out.status === 'sent') {
      sent++
      await s.markSent(sendId)
    } else {
      failed++
      await s.markFailed(sendId, (out.status === 'failed' ? out.error : out.reason).slice(0, 500))
    }
  }
  return { status: 'sent', sent, failed, skipped }
}
