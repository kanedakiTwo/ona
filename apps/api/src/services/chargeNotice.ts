/**
 * Legal notice 15 days before the first charge (PRO-136, D-056; specs/billing.md,
 * specs/email.md). For every subscription still in its Stripe trial and not
 * cancelled, from the Madrid day that is 15 days before the first charge, the
 * payer gets one email with the date, the amount, what happens if they don't
 * cancel and a direct link to cancel. The app shows the same while it applies
 * (`GET /billing` → `subscription.upcomingCharge`). Recorded with its date in
 * `subscriptions.charge_notice_at`, which the webhook never overwrites.
 *
 * Not tied to launch day: it follows a real charge (the beta's are on
 * 29 December, so their notice goes on 14 December). Texts for Legal to review.
 */
import { sql } from 'drizzle-orm'
import { BRAND_NAME, planByKey, type BillingPeriod, type PlanKey } from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { CHARGE_NOTICE_DAYS, chargeAmount, formatDayEs, isChargeNoticeDue } from './billing.js'
import { renderBrandEmail, sendEmail, type EmailMessage, type EmailResult } from './email.js'
import { brandAssets } from './emailBrand.js'

export interface ChargeNoticeInput {
  email: string
  plan: PlanKey
  period: BillingPeriod
  chargeAt: Date
  founderPrice: boolean
  publicUrl: string
}

/** Where «Cancelar mi suscripción» leads: the subscription page opens Stripe's cancel flow. */
export function cancelUrl(publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/profile/suscripcion?cancelar=1`
}

export function chargeNoticeEmail(i: ChargeNoticeInput): EmailMessage {
  const web = i.publicUrl.replace(/\/+$/, '')
  const day = formatDayEs(i.chargeAt)
  const amount = chargeAmount(i.plan, i.period)
  const name = `${BRAND_NAME} ${planByKey(i.plan).name}`
  const every = i.period === 'anual' ? 'cada año' : 'cada mes'
  const { html, text } = renderBrandEmail({
    preheader: `El ${day} te cobraremos ${amount}. Si no quieres seguir, cancela antes y no pagas nada.`,
    eyebrow: 'Tu suscripción',
    heading: 'Tu primer *cobro*',
    paragraphs: [
      'Hola:',
      `Te avisamos con tiempo: el ${day} te cobraremos ${amount} (IVA incluido) por ${name} (${i.period}), en la tarjeta que dejaste.`,
      `Si no cancelas, la suscripción sigue y se renueva ${every} por ${amount} hasta que la canceles.`,
      'Si no quieres seguir, cancela antes de esa fecha y no se te cobrará nada.',
      ...(i.founderPrice ? ['Tienes el precio de fundador: no te sube mientras sigas suscrito.'] : []),
    ],
    button: { label: 'Cancelar mi suscripción', url: cancelUrl(web) },
    after: [
      'Para cambiar de plan o de tarjeta, entra en Perfil → Suscripción.',
      `El cobro y el recibo los hace Link, de Stripe, que te vende la suscripción de ${BRAND_NAME}; en tu extracto aparecerá «LINK.COM* MIMOIA».`,
    ],
    footer: [`Te escribimos porque tienes una suscripción a ${BRAND_NAME} y su primer cobro es dentro de ${CHARGE_NOTICE_DAYS} días o menos.`],
    assets: brandAssets(web),
  })
  return { to: i.email, subject: `Tu primer cobro de ${BRAND_NAME}: ${day}`, html, text }
}

export interface ChargeNoticeCandidate {
  subscriptionId: string
  email: string
  plan: PlanKey
  period: BillingPeriod
  status: string
  trialEnd: Date
  cancelAtPeriodEnd: boolean
  founderPrice: boolean
}

export interface ChargeNoticeRepo {
  /** Trialing, not cancelled, not noticed, a payer with an email, first charge within 16 days. */
  listCandidates(now: Date): Promise<ChargeNoticeCandidate[]>
  claim(subscriptionId: string, at: Date): Promise<boolean>
  unclaim(subscriptionId: string): Promise<void>
}

export function createDbChargeNoticeRepo(db: typeof defaultDb = defaultDb): ChargeNoticeRepo {
  return {
    async listCandidates(now) {
      const until = new Date(now.getTime() + (CHARGE_NOTICE_DAYS + 1) * 86_400_000)
      const rows = await db.execute(sql`
        SELECT s.id AS "subscriptionId", u.email, s.plan, s.period, s.status, s.trial_end AS "trialEnd",
               s.cancel_at_period_end AS "cancelAtPeriodEnd", s.founder_price AS "founderPrice"
        FROM subscriptions s
        JOIN users u ON u.id = s.user_id
        WHERE s.status = 'trialing'
          AND s.charge_notice_at IS NULL
          AND s.cancel_at_period_end = false
          AND s.trial_end > ${now.toISOString()}::timestamptz
          AND s.trial_end <= ${until.toISOString()}::timestamptz
        LIMIT 1000
      `)
      return (rows.rows as unknown as Array<Omit<ChargeNoticeCandidate, "trialEnd"> & { trialEnd: Date | string }>).map((r) => ({ ...r, trialEnd: new Date(r.trialEnd) }))
    },
    async claim(id, at) {
      const r = await db.execute(sql`UPDATE subscriptions SET charge_notice_at = ${at.toISOString()}::timestamptz WHERE id = ${id} AND charge_notice_at IS NULL RETURNING id`)
      return r.rows.length > 0
    },
    async unclaim(id) {
      await db.execute(sql`UPDATE subscriptions SET charge_notice_at = NULL WHERE id = ${id}`)
    },
  }
}

export interface ChargeNoticeDeps {
  repo: ChargeNoticeRepo
  sendEmail: (msg: EmailMessage) => Promise<EmailResult>
  publicUrl: string
}

/** Same pattern as the other notices: claim, send; only `skipped` (no key) is unclaimed. */
export async function sendChargeNotices(now: Date, deps: ChargeNoticeDeps) {
  const out = { sent: 0, skipped: 0, failed: 0 }
  for (const c of await deps.repo.listCandidates(now)) {
    if (!isChargeNoticeDue({ status: c.status as 'trialing', trialEnd: c.trialEnd, cancelAtPeriodEnd: c.cancelAtPeriodEnd }, now)) continue
    if (!(await deps.repo.claim(c.subscriptionId, now))) continue
    const r = await deps.sendEmail(
      chargeNoticeEmail({ email: c.email, plan: c.plan, period: c.period, chargeAt: c.trialEnd, founderPrice: c.founderPrice, publicUrl: deps.publicUrl }),
    )
    if (r.status === 'skipped') {
      await deps.repo.unclaim(c.subscriptionId)
      out.skipped += 1
    } else {
      out[r.status] += 1
    }
  }
  return out
}

let lastRun = 0

/** From the scheduler tick: at most once an hour per process. */
export async function sendChargeNoticesIfDue(
  now: Date,
  deps: () => ChargeNoticeDeps = () => ({ repo: createDbChargeNoticeRepo(), sendEmail: (m) => sendEmail(m), publicUrl: env.WEB_PUBLIC_URL }),
) {
  if (now.getTime() - lastRun < 60 * 60_000) return null
  lastRun = now.getTime()
  return sendChargeNotices(now, deps())
}

/** For tests. */
export function resetChargeNoticeClock(): void {
  lastRun = 0
}
