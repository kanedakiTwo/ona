/**
 * «Te quedan 2 días de prueba» (PRO-135, specs/email.md, specs/billing.md).
 *
 * From launch day, on day 12 of a household's 14-day trial (2 days left), its
 * owner gets one email: when the trial ends, what the plans cost, and that
 * without a plan the account is paused (nothing charged, nothing deleted).
 * If the founder offer hasn't gone out yet, it goes inside this email and no
 * other message is sent (PRO-384, D-158; `households.founder_offer_at`).
 * Sent once per household (`households.trial_ending_email_at`), between 09:00
 * and 21:00 Madrid, never to a household with a paid plan or a suspended
 * owner. Text for Legal to review before publishing.
 */
import { and, isNull, sql } from 'drizzle-orm'
import {
  BRAND_NAME,
  CREATOR_TRIAL_DAYS,
  LAUNCH_DATE,
  PAID_ACCESS_STATUSES,
  TRIAL_DAYS,
  TRIAL_ENDING_NOTICE_DAYS,
  accountAccess,
  founderPriceAmounts,
  planByKey,
  trialDaysFor,
  trialLastDayLabel,
  type AccountAccess,
} from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { households } from '../db/schema.js'
import { renderBrandEmail, sendEmail, type EmailMessage, type EmailResult } from './email.js'
import { MIGUEL, brandAssets } from './emailBrand.js'
import { isBeta } from './billing.js'
import { creatorRefsSql } from './creatorTrial.js'
import { madridParts } from './madridTime.js'

export function trialEndingEmail(i: {
  email: string
  access: Pick<AccountAccess, 'trialLastDay' | 'daysLeft'> & Partial<Pick<AccountAccess, 'trialDays'>>
  publicUrl: string
  /** The founder offer goes inside (PRO-384): it hadn't gone out yet. */
  withFounderOffer?: boolean
}): EmailMessage {
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
      `Tu prueba de ${i.access.trialDays ?? TRIAL_DAYS} días en ${BRAND_NAME} dura hasta el ${day}, incluido. Hasta entonces lo tienes todo, como hasta ahora.`,
<<<<<<< 5cff180e88052c395dc7fbc8750a61032e41eeba
      `Si después quieres seguir hablando con Mimo y que os haga la semana él solo, elige un plan antes de esa fecha. Esencial cuesta ${esencial} y Plus ${plus}, para todo tu hogar e IVA incluido.`,
      'Si no eliges ninguno, no se te cobra nada y pasas al plan Gratis: sigues haciendo tu menú de la semana y tu lista en la web, sin Mimo ni avisos. Tu menú, tus recetas y tu lista siguen ahí, no se borra nada, y puedes elegir un plan cuando quieras.',
=======
      `Si después quieres seguir generando menús y hablando con Mimo, elige un plan antes de esa fecha. Esencial cuesta ${esencial} y Plus ${plus}, para todo tu hogar e IVA incluido.`,
      ...(i.withFounderOffer
        ? [`Si dejas la tarjeta antes de que acabe tu prueba, te quedas el precio de fundador para siempre (${founderPriceAmounts()}): no te sube mientras sigas suscrito.`]
        : []),
      'Si no eliges ninguno, no se te cobra nada. Tu cuenta queda en pausa: tu menú, tus recetas y tu lista siguen ahí, no se borra nada, y puedes elegir un plan cuando quieras.',
>>>>>>> 7ae5e8da4b0d964fee8745bf0d11f1e34598e22a
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
  /** 28 with a creator's link (PRO-353); `TRIAL_DAYS` when left out. */
  trialDays?: number
  /** `households.founder_offer_at`: null while the founder offer is pending (PRO-384). */
  founderOfferAt?: Date | null
}

export interface TrialEmailRepo {
  /** Households not emailed yet, without a paid plan, whose trial ends within the notice window. */
  listCandidates(now: Date): Promise<TrialEmailCandidate[]>
  /** Marks the household (only if not marked yet); false when another process got it first. */
  claim(householdId: string, at: Date): Promise<boolean>
  unclaim(householdId: string): Promise<void>
  /** Marks the founder offer as sent with this email (only if not marked yet). */
  claimFounderOffer?(householdId: string, at: Date): Promise<boolean>
  unclaimFounderOffer?(householdId: string): Promise<void>
}

export function createDbTrialEmailRepo(db: typeof defaultDb = defaultDb): TrialEmailRepo {
  return {
    async listCandidates(now) {
      // Trial start = max(created, launch); the window opens 14 − 2 days after it
      // (28 − 2 with a creator's link, PRO-353), with a day of margin on each
      // side: the exact rule is re-checked in JS.
      const launch = new Date(`${LAUNCH_DATE}T00:00:00+01:00`)
      const from = new Date(now.getTime() - (CREATOR_TRIAL_DAYS + 1) * 86_400_000)
      const to = new Date(now.getTime() - (TRIAL_DAYS - TRIAL_ENDING_NOTICE_DAYS - 1) * 86_400_000)
      const paid = sql.join(PAID_ACCESS_STATUSES.map((s) => sql`${s}`), sql`, `)
      const rows = await db.execute(sql`
        SELECT h.id AS "householdId", h.created_at AS "householdCreatedAt", u.email AS "ownerEmail", h.founder_offer_at AS "founderOfferAt",
          ${creatorRefsSql('h')} AS "creatorRefs"
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
      return (
        rows.rows as Array<{ householdId: string; householdCreatedAt: Date | string; ownerEmail: string; founderOfferAt: Date | string | null; creatorRefs: string[] | null }>
      ).map((r) => ({
        householdId: r.householdId,
        householdCreatedAt: new Date(r.householdCreatedAt),
        ownerEmail: r.ownerEmail,
        trialDays: trialDaysFor(r.creatorRefs),
        founderOfferAt: r.founderOfferAt ? new Date(r.founderOfferAt) : null,
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
    async claimFounderOffer(householdId, at) {
      const rows = await db
        .update(households)
        .set({ founderOfferAt: at })
        .where(and(sql`${households.id} = ${householdId}`, isNull(households.founderOfferAt)))
        .returning({ id: households.id })
      return rows.length > 0
    },
    async unclaimFounderOffer(householdId) {
      await db.update(households).set({ founderOfferAt: null }).where(sql`${households.id} = ${householdId}`)
    },
  }
}

export interface TrialEmailDeps {
  repo: TrialEmailRepo
  sendEmail: (msg: EmailMessage) => Promise<EmailResult>
  publicUrl: string
}

/** Due = in trial (from launch day) with at most 2 days left after today. */
export function isTrialEndingEmailDue(householdCreatedAt: Date, now: Date, trialDays?: number): AccountAccess | null {
  const access = accountAccess({ householdCreatedAt, paid: false, now, trialDays })
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
    const access = isTrialEndingEmailDue(c.householdCreatedAt, now, c.trialDays)
    if (!access || !c.ownerEmail) continue
    if (!(await deps.repo.claim(c.householdId, now))) continue
    // PRO-384: the founder offer still pending → it goes inside, and only this email.
    const withFounderOffer = c.founderOfferAt == null && !!deps.repo.claimFounderOffer && (await deps.repo.claimFounderOffer(c.householdId, now))
    const r = await deps.sendEmail(trialEndingEmail({ email: c.ownerEmail, access, publicUrl: deps.publicUrl, withFounderOffer }))
    if (r.status === 'skipped') {
      await deps.repo.unclaim(c.householdId)
      if (withFounderOffer) await deps.repo.unclaimFounderOffer?.(c.householdId)
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
