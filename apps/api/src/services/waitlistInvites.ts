/**
 * One-time invitation links for the waitlist (PRO-97, specs/waitlist.md).
 *
 * When a batch is invited, each person gets `<WEB_PUBLIC_URL>/entrar/<token>`.
 * The link opens `/register` with their email fixed, and during the closed
 * beta an account that comes from the list can only be created with it.
 *
 *   - The token is an HMAC of the entry id (keyed with `JWT_SECRET`), so the
 *     reminder 3 days later rebuilds the same link; only its SHA-256 is
 *     stored (`invite_token_hash`), so the database alone can't produce it.
 *   - Opening the link never uses it up (mail scanners open links); creating
 *     the account does (`invite_token_used_at`). A second use is rejected.
 *   - Entries invited before PRO-97 have no hash and keep the old way in
 *     (their email is enough), so nobody already invited is locked out.
 *
 * Plus the single reminder (`sendWaitlistInviteReminders`), run from the
 * notification scheduler: 3 days after the invitation, only to people who
 * haven't registered, never twice.
 */
import { createHash, createHmac } from 'node:crypto'
import { and, eq, isNotNull, isNull, lte } from 'drizzle-orm'
import { waitlistUnsubscribePath } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { waitlistEntries } from '../db/schema.js'
import { env } from '../config/env.js'
import { sendEmail, type EmailMessage, type EmailResult } from './email.js'
import { waitlistInviteReminderEmail } from './waitlistEmails.js'

type Db = typeof defaultDb

// ─── Tokens ──────────────────────────────────────────────────────

/** 43 base64url chars (an HMAC-SHA256). */
export const INVITE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

/** The personal token of an entry. Deterministic: same entry, same link (first email and reminder). */
export function waitlistInviteToken(entryId: string, secret: string = env.JWT_SECRET): string {
  return createHmac('sha256', secret).update(`waitlist-invite:v1:${entryId}`).digest('base64url')
}

/** What the database stores: never the token itself. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function waitlistEntryPath(token: string): string {
  return `/entrar/${token}`
}

export function waitlistEntryUrl(publicUrl: string, token: string): string {
  return `${publicUrl.replace(/\/+$/, '')}${waitlistEntryPath(token)}`
}

// ─── Link state (pure) ───────────────────────────────────────────

export interface InviteRow {
  id: string
  email: string | null
  firstName: string | null
  status: string
  inviteTokenUsedAt: Date | null
}

export type InviteLinkState = 'ok' | 'used' | 'not_found'

/** What a link means today. An unsubscribed (anonymised) entry is gone; a registered one is used. */
export function inviteLinkState(row: InviteRow | null | undefined): InviteLinkState {
  if (!row || !row.email || row.status === 'unsubscribed') return 'not_found'
  if (row.inviteTokenUsedAt || row.status === 'joined') return 'used'
  return row.status === 'invited' ? 'ok' : 'not_found'
}

export const WAITLIST_INVITE_ERRORS = {
  not_found: {
    code: 'WAITLIST_INVITE_NOT_FOUND',
    error: 'Este enlace de invitación no es válido. Ábrelo desde el botón «Crear mi cuenta» del correo que te enviamos.',
  },
  used: {
    code: 'WAITLIST_INVITE_USED',
    error: 'Este enlace de invitación ya se ha usado. Si ya creaste tu cuenta, inicia sesión.',
  },
  email_mismatch: {
    code: 'WAITLIST_INVITE_EMAIL_MISMATCH',
    error: 'Esta invitación es para otro correo: crea la cuenta con el correo al que te llegó.',
  },
  link_required: {
    code: 'WAITLIST_INVITE_LINK_REQUIRED',
    error:
      'Este correo tiene una invitación de la lista de espera. Crea tu cuenta desde el botón «Crear mi cuenta» del correo que te enviamos: el enlace es personal.',
  },
} as const

// ─── DB access ───────────────────────────────────────────────────

const inviteCols = {
  id: waitlistEntries.id,
  email: waitlistEntries.email,
  firstName: waitlistEntries.firstName,
  status: waitlistEntries.status,
  inviteTokenUsedAt: waitlistEntries.inviteTokenUsedAt,
}

/** The entry behind a link, or null (malformed or unknown token). */
export async function findWaitlistInvite(token: string, db: Db = defaultDb): Promise<InviteRow | null> {
  if (!INVITE_TOKEN_RE.test(token)) return null
  const [row] = await db
    .select(inviteCols)
    .from(waitlistEntries)
    .where(eq(waitlistEntries.inviteTokenHash, hashInviteToken(token)))
    .limit(1)
  return row ?? null
}

/** Check a link against the email typed on /register (nothing is written). */
export async function checkWaitlistInvite(
  token: string,
  email: string,
  db: Db = defaultDb,
): Promise<InviteLinkState | 'email_mismatch'> {
  const row = await findWaitlistInvite(token, db)
  const state = inviteLinkState(row)
  if (state !== 'ok') return state
  return row!.email!.toLowerCase() === email.trim().toLowerCase() ? 'ok' : 'email_mismatch'
}

/** Use the link up, atomically: false when someone used it meanwhile. */
export async function consumeWaitlistInvite(token: string, db: Db = defaultDb): Promise<boolean> {
  const rows = await db
    .update(waitlistEntries)
    .set({ inviteTokenUsedAt: new Date() })
    .where(
      and(
        eq(waitlistEntries.inviteTokenHash, hashInviteToken(token)),
        isNull(waitlistEntries.inviteTokenUsedAt),
        eq(waitlistEntries.status, 'invited'),
      ),
    )
    .returning({ id: waitlistEntries.id })
  return rows.length > 0
}

/** Give the link back when the account could not be created after all. Never throws. */
export async function releaseWaitlistInvite(token: string, db: Db = defaultDb): Promise<void> {
  try {
    await db
      .update(waitlistEntries)
      .set({ inviteTokenUsedAt: null })
      .where(and(eq(waitlistEntries.inviteTokenHash, hashInviteToken(token)), eq(waitlistEntries.status, 'invited')))
  } catch (err: any) {
    console.error('[waitlist] release invite failed:', err?.message ?? err)
  }
}

/**
 * Without a link: is this email invited from the list?
 *   - `needs_link`: invited with a personal link (PRO-97) → the link is required;
 *   - `legacy`: invited before PRO-97 (no link) → the email is enough, as before;
 *   - null: not an invited entry.
 */
export async function waitlistInviteForEmail(email: string, db: Db = defaultDb): Promise<'needs_link' | 'legacy' | null> {
  const [row] = await db
    .select({ hash: waitlistEntries.inviteTokenHash })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.email, email.trim().toLowerCase()), eq(waitlistEntries.status, 'invited')))
    .limit(1)
  if (!row) return null
  return row.hash ? 'needs_link' : 'legacy'
}

// ─── Reminder (3 days after, once) ───────────────────────────────

export const INVITE_REMINDER_AFTER_MS = 3 * 86_400_000

export interface ReminderCandidate {
  id: string
  email: string | null
  firstName: string | null
  wantsWhatsapp: boolean
  status: string
  invitedAt: Date | null
  inviteTokenHash: string | null
  inviteTokenUsedAt: Date | null
  inviteReminderSentAt: Date | null
  unsubscribeToken: string
}

/** Pure rule: invited with a link ≥ 3 days ago, not registered, not reminded yet, still on the list. */
export function isInviteReminderDue(e: ReminderCandidate, now: Date): boolean {
  return (
    e.status === 'invited' &&
    !!e.email &&
    !!e.inviteTokenHash &&
    !e.inviteTokenUsedAt &&
    !e.inviteReminderSentAt &&
    !!e.invitedAt &&
    now.getTime() - e.invitedAt.getTime() >= INVITE_REMINDER_AFTER_MS
  )
}

export interface ReminderRepo {
  /** Entries that may be due (the pure rule decides). */
  listCandidates(cutoff: Date): Promise<ReminderCandidate[]>
  /** Mark reminded, only if not already: false = another run took it. */
  claim(id: string, at: Date): Promise<boolean>
  /** Undo the mark (email not configured: try again once it is). */
  unclaim(id: string): Promise<void>
}

export function createDbReminderRepo(db: Db = defaultDb): ReminderRepo {
  return {
    async listCandidates(cutoff) {
      return db
        .select({
          id: waitlistEntries.id,
          email: waitlistEntries.email,
          firstName: waitlistEntries.firstName,
          wantsWhatsapp: waitlistEntries.wantsWhatsapp,
          status: waitlistEntries.status,
          invitedAt: waitlistEntries.invitedAt,
          inviteTokenHash: waitlistEntries.inviteTokenHash,
          inviteTokenUsedAt: waitlistEntries.inviteTokenUsedAt,
          inviteReminderSentAt: waitlistEntries.inviteReminderSentAt,
          unsubscribeToken: waitlistEntries.unsubscribeToken,
        })
        .from(waitlistEntries)
        .where(
          and(
            eq(waitlistEntries.status, 'invited'),
            isNotNull(waitlistEntries.inviteTokenHash),
            isNull(waitlistEntries.inviteTokenUsedAt),
            isNull(waitlistEntries.inviteReminderSentAt),
            lte(waitlistEntries.invitedAt, cutoff),
          ),
        )
        .limit(500)
    },
    async claim(id, at) {
      const rows = await db
        .update(waitlistEntries)
        .set({ inviteReminderSentAt: at })
        .where(and(eq(waitlistEntries.id, id), isNull(waitlistEntries.inviteReminderSentAt)))
        .returning({ id: waitlistEntries.id })
      return rows.length > 0
    },
    async unclaim(id) {
      await db.update(waitlistEntries).set({ inviteReminderSentAt: null }).where(eq(waitlistEntries.id, id))
    },
  }
}

export interface ReminderDeps {
  repo: ReminderRepo
  sendEmail: (msg: EmailMessage) => Promise<EmailResult>
  buildEmail: (c: ReminderCandidate & { email: string }, links: { entryUrl: string; unsubscribeUrl: string }) => EmailMessage
  publicUrl: string
  secret?: string
}

/**
 * Send the due reminders. The mark goes on BEFORE sending (claim), so two
 * processes or two ticks never send it twice; a `failed` send stays marked
 * (no second try, Miguel sees it in the logs). Only `skipped` (no Resend key)
 * is unmarked, so it goes out once email is configured.
 */
export async function sendWaitlistInviteReminders(now: Date, deps: ReminderDeps) {
  const out = { sent: 0, skipped: 0, failed: 0 }
  const cutoff = new Date(now.getTime() - INVITE_REMINDER_AFTER_MS)
  const base = deps.publicUrl.replace(/\/+$/, '')
  for (const c of await deps.repo.listCandidates(cutoff)) {
    if (!isInviteReminderDue(c, now) || !c.email) continue
    if (!(await deps.repo.claim(c.id, now))) continue
    const token = waitlistInviteToken(c.id, deps.secret)
    const r = await deps.sendEmail(
      deps.buildEmail(
        { ...c, email: c.email },
        { entryUrl: waitlistEntryUrl(base, token), unsubscribeUrl: `${base}${waitlistUnsubscribePath(c.unsubscribeToken)}` },
      ),
    )
    if (r.status === 'skipped') {
      await deps.repo.unclaim(c.id)
      out.skipped += 1
    } else {
      out[r.status] += 1
    }
  }
  return out
}

export function defaultReminderDeps(): ReminderDeps {
  return {
    repo: createDbReminderRepo(),
    sendEmail: (msg) => sendEmail(msg),
    buildEmail: (c, links) => waitlistInviteReminderEmail({ ...c, ...links }),
    publicUrl: env.WEB_PUBLIC_URL,
  }
}

let lastReminderRun = 0

/** From the scheduler tick: at most once an hour per process. */
export async function sendWaitlistInviteRemindersIfDue(
  now: Date,
  deps: () => ReminderDeps = defaultReminderDeps,
): Promise<{ sent: number; skipped: number; failed: number } | null> {
  if (now.getTime() - lastReminderRun < 60 * 60_000) return null
  lastReminderRun = now.getTime()
  return sendWaitlistInviteReminders(now, deps())
}

/** For tests. */
export function resetReminderClock(): void {
  lastReminderRun = 0
}
