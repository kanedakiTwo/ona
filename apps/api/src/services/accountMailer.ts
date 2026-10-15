import { and, eq, gt, sql } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { passwordResetTokens, users, waitlistEntries } from '../db/schema.js'
import { SELF_RESET_TTL_MS, passwordResetEmail, welcomeEmail, type WelcomeKind } from './accountEmails.js'
import { maskEmail, sendEmail, type EmailMessage, type EmailResult } from './email.js'
import { mintToken } from './passwordReset.js'

/**
 * Sending the account emails (specs/email.md). Neither ever blocks or fails
 * the request that triggers it: the caller fires and forgets.
 */

type Db = typeof defaultDb

export interface AccountMailerDeps {
  send: (msg: EmailMessage) => Promise<EmailResult>
  publicUrl: string
  /** The account with this email (case-insensitive), or null. */
  findUser: (email: string) => Promise<{ id: string; email: string; suspendedAt: Date | null } | null>
  /** Reset links created for this user since `since`. */
  recentResets: (userId: string, since: Date) => Promise<number>
  mint: (userId: string) => Promise<{ token: string }>
  /** First name they gave on the waitlist, if any. */
  firstName: (email: string) => Promise<string | null>
  now: () => Date
}

export function defaultAccountMailerDeps(db: Db = defaultDb): AccountMailerDeps {
  return {
    send: (m) => sendEmail(m),
    publicUrl: env.WEB_PUBLIC_URL,
    async findUser(email) {
      const [u] = await db
        .select({ id: users.id, email: users.email, suspendedAt: users.suspendedAt })
        .from(users)
        .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
        .limit(1)
      return u ?? null
    },
    async recentResets(userId, since) {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(passwordResetTokens)
        .where(and(eq(passwordResetTokens.userId, userId), gt(passwordResetTokens.createdAt, since)))
      return r?.n ?? 0
    },
    mint: (userId) => mintToken(userId, db, SELF_RESET_TTL_MS),
    async firstName(email) {
      const [w] = await db
        .select({ firstName: waitlistEntries.firstName })
        .from(waitlistEntries)
        .where(eq(waitlistEntries.email, email.trim().toLowerCase()))
        .limit(1)
      return w?.firstName?.trim() || null
    },
    now: () => new Date(),
  }
}

/** At most this many reset emails per account per hour. */
export const RESET_EMAILS_PER_HOUR = 3

export type ResetRequestOutcome = 'sent' | 'skipped' | 'failed' | 'no_account' | 'suspended' | 'throttled'

/**
 * «¿Has olvidado la contraseña?»: email a one-time link valid for 1 hour.
 * The route always answers the same, so nobody learns whether an email has
 * an account; the outcome is for logs and tests only.
 */
export async function requestPasswordReset(email: string, deps: AccountMailerDeps): Promise<ResetRequestOutcome> {
  const user = await deps.findUser(email)
  if (!user) return 'no_account'
  if (user.suspendedAt) return 'suspended'
  const since = new Date(deps.now().getTime() - 60 * 60 * 1000)
  if ((await deps.recentResets(user.id, since)) >= RESET_EMAILS_PER_HOUR) return 'throttled'
  const { token } = await deps.mint(user.id)
  const web = deps.publicUrl.replace(/\/+$/, '')
  const r = await deps.send(passwordResetEmail({ email: user.email, resetUrl: `${web}/reset?token=${token}` }))
  console.log(`[account-mail] reset link to ${maskEmail(user.email)}: ${r.status}`)
  return r.status
}

export async function sendWelcomeEmail(
  i: { email: string; kind: WelcomeKind },
  deps: AccountMailerDeps,
): Promise<EmailResult['status']> {
  const firstName = await deps.firstName(i.email).catch(() => null)
  const r = await deps.send(welcomeEmail({ email: i.email, firstName, kind: i.kind, publicUrl: deps.publicUrl }))
  console.log(`[account-mail] welcome (${i.kind}) to ${maskEmail(i.email)}: ${r.status}`)
  return r.status
}
