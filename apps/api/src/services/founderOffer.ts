/**
 * The day-7 founder-price offer (PRO-136, D-056; specs/billing.md, specs/email.md).
 *
 * From launch day, on day 7 of a household's 14-day trial and without a plan,
 * the owner gets the offer once: «Deja la tarjeta antes de que acabe tu prueba
 * y te quedas el precio de fundador para siempre». ONE message (PRO-234,
 * D-080): by Mimo on WhatsApp if they have it and wrote in the last 24 h
 * (never a template); otherwise by email. The
 * app shows it too (cards and Mimo's panel, from `GET /billing` →
 * `founder.offer`). Marked in `households.founder_offer_at`. Between 09:00 and
 * 21:00 Madrid. Texts for Legal to review.
 */
import { sql } from 'drizzle-orm'
import {
  BRAND_NAME,
  CREATOR_TRIAL_DAYS,
  FOUNDER_OFFER_DAY,
  LAUNCH_DATE,
  accountAccess,
  founderOfferStands,
  founderOfferText,
  founderPriceAmounts,
  planByKey,
  trialDaysFor,
  trialLastDayLabel,
  type AccountAccess,
} from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { LIVE_STATUSES, firstChargeInstant, formatDayEs, isBeta } from './billing.js'
import { creatorRefsSql } from './creatorTrial.js'
import { renderBrandEmail, sendEmail, type EmailMessage, type EmailResult } from './email.js'
import { MIGUEL, brandAssets } from './emailBrand.js'
import { isSendingHour } from './trialEmails.js'
import type { ChannelOutcome } from './whatsapp/proactive.js'

export interface OfferCopyInput {
  access: Pick<AccountAccess, 'trialLastDay'>
  firstCharge: Date
}

/** The short version (Mimo on WhatsApp; the same text as the app's card). */
export function founderOfferShort(i: OfferCopyInput): string {
  return founderOfferText({ trialLastDay: i.access.trialLastDay, firstChargeAt: i.firstCharge.toISOString() })
}

export function founderOfferEmail(i: OfferCopyInput & { email: string; publicUrl: string }): EmailMessage {
  const web = i.publicUrl.replace(/\/+$/, '')
  const esencial = planByKey('esencial').prices.mensual.label
  const plus = planByKey('plus').prices.mensual.label
  const { html, text } = renderBrandEmail({
    preheader: 'Deja la tarjeta antes de que acabe tu prueba y te quedas el precio de fundador para siempre.',
    eyebrow: 'Tu prueba',
    heading: 'Quédate el precio de *fundador*',
    paragraphs: [
      'Hola:',
      `Llevas una semana con ${BRAND_NAME}. Si ya sabes que te quedas, deja la tarjeta antes de que acabe tu prueba (dura hasta el ${trialLastDayLabel(i.access)}, incluido) y te quedas el precio de fundador para siempre (${founderPriceAmounts()}): no te sube mientras sigas suscrito.`,
      `No se cobra nada hasta el ${formatDayEs(i.firstCharge)}. Quince días antes te avisamos de la fecha y del importe, y puedes cancelar antes sin pagar nada.`,
      `Esencial cuesta ${esencial} y Plus ${plus}, para todo tu hogar e IVA incluido.`,
    ],
    button: { label: 'Elegir mi plan', url: `${web}/profile/suscripcion` },
    signoff: 'Un abrazo,',
    from: MIGUEL,
    footer: [`Te escribo porque estás en la prueba de ${BRAND_NAME}.`],
    assets: brandAssets(web),
  })
  return { to: i.email, subject: `Quédate el precio de fundador de ${BRAND_NAME}`, html, text }
}

export interface OfferCandidate {
  householdId: string
  householdCreatedAt: Date
  ownerId: string
  ownerEmail: string
  /** 28 with a creator's link (PRO-353); `TRIAL_DAYS` when left out. */
  trialDays?: number
}

export interface OfferRepo {
  /** Not offered yet, owner not suspended, no live subscription, trial start in the day-7 window (± a day). */
  listCandidates(now: Date): Promise<OfferCandidate[]>
  claim(householdId: string, at: Date): Promise<boolean>
  unclaim(householdId: string): Promise<void>
}

export function createDbOfferRepo(db: typeof defaultDb = defaultDb): OfferRepo {
  return {
    async listCandidates(now) {
      const launch = new Date(`${LAUNCH_DATE}T00:00:00+01:00`)
      // Up to the end of a creator's-link trial (PRO-353); the exact rule is re-checked in JS.
      const from = new Date(now.getTime() - (CREATOR_TRIAL_DAYS + 1) * 86_400_000)
      const to = new Date(now.getTime() - (FOUNDER_OFFER_DAY - 1) * 86_400_000)
      const live = sql.join(LIVE_STATUSES.map((s) => sql`${s}`), sql`, `)
      const rows = await db.execute(sql`
        SELECT h.id AS "householdId", h.created_at AS "householdCreatedAt", u.id AS "ownerId", u.email AS "ownerEmail",
          ${creatorRefsSql('h')} AS "creatorRefs"
        FROM households h
        JOIN users u ON u.id = h.owner_id
        WHERE h.founder_offer_at IS NULL
          AND u.suspended_at IS NULL
          AND GREATEST(h.created_at, ${launch.toISOString()}::timestamptz) BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.household_id = h.id AND s.status IN (${live}))
        LIMIT 1000
      `)
      return (
        rows.rows as Array<{ householdId: string; householdCreatedAt: Date | string; ownerId: string; ownerEmail: string; creatorRefs: string[] | null }>
      ).map(({ creatorRefs, ...r }) => ({
        ...r,
        householdCreatedAt: new Date(r.householdCreatedAt),
        trialDays: trialDaysFor(creatorRefs),
      }))
    },
    async claim(householdId, at) {
      const r = await db.execute(sql`UPDATE households SET founder_offer_at = ${at.toISOString()}::timestamptz WHERE id = ${householdId} AND founder_offer_at IS NULL RETURNING id`)
      return r.rows.length > 0
    },
    async unclaim(householdId) {
      await db.execute(sql`UPDATE households SET founder_offer_at = NULL WHERE id = ${householdId}`)
    },
  }
}

export interface OfferDeps {
  repo: OfferRepo
  sendEmail: (msg: EmailMessage) => Promise<EmailResult>
  /** Mimo on WhatsApp, inside the 24 h window only. */
  sendWhatsApp: (userId: string, text: string, now: Date) => Promise<ChannelOutcome>
  publicUrl: string
}

/** The offer is due: in trial from day 7, no plan (the repo already left out households with one). */
export function isFounderOfferDue(householdCreatedAt: Date, now: Date, trialDays?: number): AccountAccess | null {
  const access = accountAccess({ householdCreatedAt, paid: false, now, trialDays })
  return founderOfferStands(access) ? access : null
}

/**
 * Claim first (two processes never send it twice). If neither channel got it
 * out (no email key and no open WhatsApp window), unclaim so it goes later.
 */
export async function sendFounderOffers(now: Date, deps: OfferDeps) {
  const out = { offered: 0, email: { sent: 0, skipped: 0, failed: 0 }, whatsapp: 0 }
  if (isBeta(now) || !isSendingHour(now)) return out
  for (const c of await deps.repo.listCandidates(now)) {
    const access = isFounderOfferDue(c.householdCreatedAt, now, c.trialDays)
    if (!access) continue
    if (!(await deps.repo.claim(c.householdId, now))) continue
    const copy = { access, firstCharge: firstChargeInstant({ userCreatedAt: c.householdCreatedAt, now, trialDays: c.trialDays }) }
    // PRO-234 (D-080): ONE message — Mimo on WhatsApp if it gets through,
    // otherwise the email. Never both.
    let wa: ChannelOutcome = { status: 'skipped' }
    try {
      wa = await deps.sendWhatsApp(c.ownerId, `${founderOfferShort(copy)}\n\n${deps.publicUrl.replace(/\/+$/, '')}/profile/suscripcion`, now)
    } catch (err) {
      console.error('[founder-offer] whatsapp failed:', err)
    }
    if (wa.status === 'ok') out.whatsapp += 1
    const mail = wa.status !== 'ok' && c.ownerEmail ? await deps.sendEmail(founderOfferEmail({ ...copy, email: c.ownerEmail, publicUrl: deps.publicUrl })) : null
    if (mail) out.email[mail.status] += 1
    if (mail?.status !== 'sent' && mail?.status !== 'failed' && wa.status !== 'ok') {
      await deps.repo.unclaim(c.householdId)
      continue
    }
    out.offered += 1
  }
  return out
}

let lastRun = 0

/** From the scheduler tick: at most once an hour per process; nothing before launch day. */
export async function sendFounderOffersIfDue(now: Date, deps?: () => OfferDeps) {
  if (isBeta(now)) return null
  if (now.getTime() - lastRun < 60 * 60_000) return null
  lastRun = now.getTime()
  const d = deps
    ? deps()
    : {
        repo: createDbOfferRepo(),
        sendEmail: (m: EmailMessage) => sendEmail(m),
        sendWhatsApp: async (userId: string, text: string, at: Date) =>
          (await import('./whatsapp/outbound.js')).sendInsideServiceWindow(userId, text, 'founder_offer', at),
        publicUrl: env.WEB_PUBLIC_URL,
      }
  return sendFounderOffers(now, d)
}

/** For tests. */
export function resetFounderOfferClock(): void {
  lastRun = 0
}
