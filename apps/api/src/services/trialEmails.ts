/**
 * «Te quedan 2 días de prueba» (PRO-135, specs/email.md, specs/billing.md).
 *
 * From launch day, on day 12 of a household's 14-day trial (2 days left), its
 * owner gets one email: when the trial ends, what the plans cost, and that
 * without a plan the account is paused (nothing charged, nothing deleted).
 * Sent once per household (`households.trial_ending_email_at`), between 09:00
 * and 21:00 Madrid, never to a household with a paid plan or a suspended
 * owner. Text for Legal to review before publishing.
 */
import { and, isNull, sql } from 'drizzle-orm'
import {
  BRAND_NAME,
  LAUNCH_DATE,
  PAID_ACCESS_STATUSES,
  TRIAL_DAYS,
  TRIAL_ENDING_NOTICE_DAYS,
  accountAccess,
  planByKey,
  trialLastDayLabel,
  type AccountAccess,
} from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { households } from '../db/schema.js'
import { renderBrandEmail, sendEmail, type EmailMessage, type EmailResult } from './email.js'
import { MIGUEL, brandAssets } from './emailBrand.js'
import { isBeta } from './billing.js'
import { madridParts } from './madridTime.js'

export function trialEndingEmail(i: { email: string; access: Pick<AccountAccess, 'trialLastDay' | 'daysLeft'>; publicUrl: string }): EmailMessage {
  const web = i.publicUrl.replace(/\/+$/, '')
  const day = trialLastDayLabel(i.access)
  const left = i.access.daysLeft ?? TRIAL_ENDING_NOTICE_DAYS
  const leftWords = left <= 0 ? 'Hoy es tu *último día*' : left === 1 ? 'Te queda *1 día*' : `Te quedan *${left} días*`
  const esencial = planByKey('esencial').prices.mensual.label
  const plus = planByKey('plus').prices.mensual.label
  const { html, text } = renderBrandEmail({
    preheader: `Tu prueba dura hasta el ${day}. Si no eliges un plan, no se te cobra nada.`,
    eyebrow: 'Tu prueba',
    heading: leftWords,
    paragraphs: [
      'Hola:',
      `Tu prueba de ${TRIAL_DAYS} días en ${BRAND_NAME} dura hasta el ${day}, incluido. Hasta entonces lo tienes todo, como hasta ahora.`,
      `Si después quieres seguir generando menús y hablando con Mimo, elige un plan antes de esa fecha. Esencial cuesta ${esencial} y Plus ${plus}, para todo tu hogar e IVA incluido.`,
      'Si no eliges ninguno, no se te cobra nada. Tu cuenta queda en pausa: tu menú, tus recetas y tu lista siguen ahí, no se borra nada, y puedes elegir un plan cuando quieras.',
    ],
    button: { label: 'Ver los planes', url: `${web}/profile/suscripcion` },
    signoff: 'Un abrazo,',
    from: MIGUEL,
    footer: [`Te escribo porque tu prueba de ${BRAND_NAME} acaba pronto.`],
    assets: brandAssets(web),
  })
  const subject = left <= 0 ? `Hoy acaba tu prueba de ${BRAND_NAME}` : `${left === 1 ? 'Te queda 1 día' : `Te quedan ${left} días`} de prueba en ${BRAND_NAME}`
  return { to: i.email, subject, html, text }
}

export interface TrialEmailCandidate {
  householdId: string
  householdCreatedAt: Date
  ownerEmail: string
}

export interface TrialEmailRepo {
  /** Households not emailed yet, without a paid plan, whose trial ends within the notice window. */
  listCandidates(now: Date): Promise<TrialEmailCandidate[]>
  /** Marks the household (only if not marked yet); false when another process got it first. */
  claim(householdId: string, at: Date): Promise<boolean>
  unclaim(householdId: string): Promise<void>
}

export function createDbTrialEmailRepo(db: typeof defaultDb = defaultDb): TrialEmailRepo {
  return {
    async listCandidates(now) {
      // Trial start = max(created, launch); the window opens 14 − 2 days after it
      // (a day of margin on each side: the exact rule is re-checked in JS).
      const launch = new Date(`${LAUNCH_DATE}T00:00:00+01:00`)
      const from = new Date(now.getTime() - (TRIAL_DAYS + 1) * 86_400_000)
      const to = new Date(now.getTime() - (TRIAL_DAYS - TRIAL_ENDING_NOTICE_DAYS - 1) * 86_400_000)
      const paid = sql.join(PAID_ACCESS_STATUSES.map((s) => sql`${s}`), sql`, `)
      const rows = await db.execute(sql`
        SELECT h.id AS "householdId", h.created_at AS "householdCreatedAt", u.email AS "ownerEmail"
        FROM households h
        JOIN users u ON u.id = h.owner_id
        WHERE h.trial_ending_email_at IS NULL
          AND u.suspended_at IS NULL
          AND GREATEST(h.created_at, ${launch.toISOString()}::timestamptz) BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM subscriptions s WHERE s.household_id = h.id AND s.status IN (${paid})
          )
        LIMIT 1000
      `)
      return (rows.rows as Array<{ householdId: string; householdCreatedAt: Date | string; ownerEmail: string }>).map((r) => ({
        householdId: r.householdId,
        householdCreatedAt: new Date(r.householdCreatedAt),
        ownerEmail: r.ownerEmail,
      }))
    },
    async claim(householdId, at) {
      const rows = await db
        .update(households)
        .set({ trialEndingEmailAt: at })
        .where(and(sql`${households.id} = ${householdId}`, isNull(households.trialEndingEmailAt)))
        .returning({ id: households.id })
      return rows.length > 0
    },
    async unclaim(householdId) {
      await db.update(households).set({ trialEndingEmailAt: null }).where(sql`${households.id} = ${householdId}`)
    },
  }
}

export interface TrialEmailDeps {
  repo: TrialEmailRepo
  sendEmail: (msg: EmailMessage) => Promise<EmailResult>
  publicUrl: string
}

/** Due = in trial (from launch day) with at most 2 days left after today. */
export function isTrialEndingEmailDue(householdCreatedAt: Date, now: Date): AccountAccess | null {
  const access = accountAccess({ householdCreatedAt, paid: false, now })
  return access.state === 'trial' && access.daysLeft !== null && access.daysLeft <= TRIAL_ENDING_NOTICE_DAYS ? access : null
}

/** Daytime only, so 27 December's batch for the beta doesn't land at midnight. */
export function isSendingHour(now: Date): boolean {
  const { hour } = madridParts(now)
  return hour >= 9 && hour < 21
}

/**
 * Send the due emails. Same pattern as the waitlist reminder: marked BEFORE
 * sending (two processes never send it twice); a `failed` send stays marked
 * (no retry); only `skipped` (no Resend key) is unmarked.
 */
export async function sendTrialEndingEmails(now: Date, deps: TrialEmailDeps) {
  const out = { sent: 0, skipped: 0, failed: 0 }
  if (isBeta(now) || !isSendingHour(now)) return out
  for (const c of await deps.repo.listCandidates(now)) {
    const access = isTrialEndingEmailDue(c.householdCreatedAt, now)
    if (!access || !c.ownerEmail) continue
    if (!(await deps.repo.claim(c.householdId, now))) continue
    const r = await deps.sendEmail(trialEndingEmail({ email: c.ownerEmail, access, publicUrl: deps.publicUrl }))
    if (r.status === 'skipped') {
      await deps.repo.unclaim(c.householdId)
      out.skipped += 1
    } else {
      out[r.status] += 1
    }
  }
  return out
}

let lastRun = 0

/** From the scheduler tick: at most once an hour per process; nothing before launch day. */
export async function sendTrialEndingEmailsIfDue(
  now: Date,
  deps: () => TrialEmailDeps = () => ({ repo: createDbTrialEmailRepo(), sendEmail: (m) => sendEmail(m), publicUrl: env.WEB_PUBLIC_URL }),
): Promise<{ sent: number; skipped: number; failed: number } | null> {
  if (isBeta(now)) return null
  if (now.getTime() - lastRun < 60 * 60_000) return null
  lastRun = now.getTime()
  return sendTrialEndingEmails(now, deps())
}

/** For tests. */
export function resetTrialEmailClock(): void {
  lastRun = 0
}
