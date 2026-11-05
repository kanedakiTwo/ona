/**
 * Failed payments and why households leave (PRO-386, D-158 piece 7;
 * specs/billing.md).
 *
 * - `invoice.payment_failed` (from the Stripe webhook, `handleBillingEvent`):
 *   the payer gets ONE notice per invoice, its own kind `payment_failed`
 *   (priority 1, `notifications/budget.ts`): from Mimo on WhatsApp with the
 *   steps to change the card, if they wrote in the last 24 h; otherwise by
 *   email. Never both. Stripe retries the same invoice several times: each
 *   retry is a new `invoice.payment_failed`, and the row in `payment_failures`
 *   (unique per invoice) keeps it to one notice. If neither channel got it
 *   out, the claim is undone so the next retry tries again.
 * - The 7 days: `subscriptions.past_due_since` (`hasPaidAccess` in
 *   `@ona/shared`); after them the household loses the plan until it pays.
 * - `churnCounts`: cancellations by reason and failed payments, for the
 *   growth report (PRO-379).
 *
 * Texts for Legal to review.
 */
import { sql } from 'drizzle-orm'
import { BRAND_NAME, PAST_DUE_GRACE_DAYS, planByKey, type PlanKey } from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import type { PaymentFailure } from './billing.js'
import { renderBrandEmail, sendEmail, type EmailMessage, type EmailResult } from './email.js'
import { brandAssets } from './emailBrand.js'
import type { ChannelOutcome } from './whatsapp/proactive.js'

/** Where the notice leads: Suscripción with «Cambiar la tarjeta», which opens Stripe's portal. */
export function changeCardUrl(publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, '')}/profile/suscripcion?tarjeta=1`
}

/** Mimo on WhatsApp, with the steps («con guía»). */
export function paymentFailedWhatsApp(i: { plan: PlanKey; publicUrl: string }): string {
  const name = planByKey(i.plan).name
  return [
    `El último pago de tu suscripción a ${BRAND_NAME} ${name} no ha pasado. Suele ser la tarjeta: caducada, sin saldo o bloqueada por el banco.`,
    '',
    'Para cambiarla:',
    `1. Entra aquí: ${changeCardUrl(i.publicUrl)}`,
    '2. Toca «Cambiar la tarjeta».',
    '3. Añade la nueva tarjeta en la página de Stripe.',
    '',
    `Stripe lo vuelve a intentar solo. Si en ${PAST_DUE_GRACE_DAYS} días sigue sin pagarse, tu hogar se queda sin ${name} hasta que se pague. No se borra nada.`,
  ].join('\n')
}

export function paymentFailedEmail(i: { email: string; plan: PlanKey; publicUrl: string }): EmailMessage {
  const web = i.publicUrl.replace(/\/+$/, '')
  const name = planByKey(i.plan).name
  const { html, text } = renderBrandEmail({
    preheader: 'El último pago de tu suscripción no ha pasado. Aquí puedes cambiar la tarjeta.',
    eyebrow: 'Tu suscripción',
    heading: 'El pago no ha *pasado*',
    paragraphs: [
      'Hola:',
      `No hemos podido cobrar el último pago de ${BRAND_NAME} ${name}. Suele ser la tarjeta: caducada, sin saldo o bloqueada por el banco.`,
      'Aquí puedes cambiarla: en Suscripción toca «Cambiar la tarjeta» y añade la nueva en la página de Stripe.',
      `Stripe lo vuelve a intentar solo. Si en ${PAST_DUE_GRACE_DAYS} días sigue sin pagarse, tu hogar se queda sin ${name} hasta que se pague. No se borra nada.`,
    ],
    button: { label: 'Cambiar la tarjeta', url: changeCardUrl(web) },
    after: [`El cobro lo hace Link, de Stripe, que te vende la suscripción de ${BRAND_NAME}.`],
    footer: [`Te escribimos porque tienes una suscripción a ${BRAND_NAME} y su último pago no ha pasado.`],
    assets: brandAssets(web),
  })
  return { to: i.email, subject: `El pago de ${BRAND_NAME} no ha pasado`, html, text }
}

export interface PaymentFailureRepo {
  /** Keeps the failure (once per invoice) and claims its notice: false when it already went out. */
  claim(f: { invoiceId: string; subscriptionId: string; householdId: string }, at: Date): Promise<boolean>
  /** How it went out. */
  mark(invoiceId: string, channel: 'whatsapp' | 'email'): Promise<void>
  /** Neither channel got it out: the next retry of the invoice tries again. */
  unclaim(invoiceId: string): Promise<void>
  /** The payer's email. */
  emailOf(userId: string): Promise<string | null>
}

export function createDbPaymentFailureRepo(db: typeof defaultDb = defaultDb): PaymentFailureRepo {
  return {
    async claim(f, at) {
      await db.execute(sql`
        INSERT INTO payment_failures (stripe_invoice_id, stripe_subscription_id, household_id)
        VALUES (${f.invoiceId}, ${f.subscriptionId}, (SELECT id FROM households WHERE id = ${f.householdId}::uuid))
        ON CONFLICT (stripe_invoice_id) DO NOTHING
      `)
      const r = await db.execute(sql`
        UPDATE payment_failures SET notice_at = ${at.toISOString()}::timestamptz
        WHERE stripe_invoice_id = ${f.invoiceId} AND notice_at IS NULL
        RETURNING id
      `)
      return r.rows.length > 0
    },
    async mark(invoiceId, channel) {
      await db.execute(sql`UPDATE payment_failures SET notice_channel = ${channel} WHERE stripe_invoice_id = ${invoiceId}`)
    },
    async unclaim(invoiceId) {
      await db.execute(sql`UPDATE payment_failures SET notice_at = NULL, notice_channel = NULL WHERE stripe_invoice_id = ${invoiceId}`)
    },
    async emailOf(userId) {
      const r = await db.execute(sql`SELECT email FROM users WHERE id = ${userId}::uuid AND suspended_at IS NULL`)
      return ((r.rows[0] as { email?: string } | undefined)?.email) ?? null
    },
  }
}

export interface PaymentFailureDeps {
  repo: PaymentFailureRepo
  sendEmail: (msg: EmailMessage) => Promise<EmailResult>
  /** Mimo on WhatsApp, inside the 24 h window only. */
  sendWhatsApp: (userId: string, text: string, now: Date) => Promise<ChannelOutcome>
  publicUrl: string
  now: () => Date
}

export type PaymentFailureOutcome = 'whatsapp' | 'email' | 'already' | 'no-payer' | 'not-sent'

/** One notice per invoice: WhatsApp if it gets through, otherwise email. Never both. */
export async function notifyPaymentFailed(f: PaymentFailure, deps: PaymentFailureDeps): Promise<PaymentFailureOutcome> {
  const { row } = f
  const now = deps.now()
  if (!(await deps.repo.claim({ invoiceId: f.invoiceId, subscriptionId: row.stripeSubscriptionId, householdId: row.householdId }, now))) return 'already'
  if (!row.userId) return 'no-payer'
  let wa: ChannelOutcome = { status: 'skipped' }
  try {
    wa = await deps.sendWhatsApp(row.userId, paymentFailedWhatsApp({ plan: row.plan, publicUrl: deps.publicUrl }), now)
  } catch (err) {
    console.error('[payment-failed] whatsapp failed:', err)
  }
  if (wa.status === 'ok') {
    await deps.repo.mark(f.invoiceId, 'whatsapp')
    return 'whatsapp'
  }
  const email = await deps.repo.emailOf(row.userId)
  const mail = email ? await deps.sendEmail(paymentFailedEmail({ email, plan: row.plan, publicUrl: deps.publicUrl })) : null
  if (mail?.status === 'sent') {
    await deps.repo.mark(f.invoiceId, 'email')
    return 'email'
  }
  await deps.repo.unclaim(f.invoiceId)
  return 'not-sent'
}

/** What the webhook calls (`routes/billing.ts`). */
export function createPaymentFailedNotifier(deps?: Partial<PaymentFailureDeps>): (f: PaymentFailure) => Promise<PaymentFailureOutcome> {
  const d: PaymentFailureDeps = {
    repo: createDbPaymentFailureRepo(),
    sendEmail: (m) => sendEmail(m),
    sendWhatsApp: async (userId, text, at) => (await import('./whatsapp/outbound.js')).sendInsideServiceWindow(userId, text, 'payment_failed', at),
    publicUrl: env.WEB_PUBLIC_URL,
    now: () => new Date(),
    ...deps,
  }
  return (f) => notifyPaymentFailed(f, d)
}

// ─── Counts (PRO-379) ─────────────────────────────────────────

export interface ChurnCounts {
  /** Subscriptions cancelled in the range (`canceled_at`), by the portal's category and by Stripe's reason. */
  cancellations: { total: number; byFeedback: Record<string, number>; byReason: Record<string, number> }
  /** Invoices whose payment failed in the range, households behind them, and how many of those are paid again (active or in trial now). */
  paymentFailures: { invoices: number; households: number; recovered: number }
}

/** `null` category → `sin_motivo` (cancelled without picking one, or by us). */
export const NO_REASON = 'sin_motivo'

export function tallyBy(rows: ReadonlyArray<{ key: string | null; n: number }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) out[r.key ?? NO_REASON] = (out[r.key ?? NO_REASON] ?? 0) + Number(r.n)
  return out
}

export async function churnCounts(range: { from: Date; to: Date }, db: typeof defaultDb = defaultDb): Promise<ChurnCounts> {
  const from = range.from.toISOString()
  const to = range.to.toISOString()
  const grouped = await db.execute(sql`
    SELECT cancel_feedback AS feedback, cancel_reason AS reason, count(*)::int AS n
    FROM subscriptions
    WHERE canceled_at >= ${from}::timestamptz AND canceled_at < ${to}::timestamptz
    GROUP BY 1, 2
  `)
  const rows = grouped.rows as Array<{ feedback: string | null; reason: string | null; n: number }>
  const failures = await db.execute(sql`
    SELECT count(*)::int AS invoices,
      count(DISTINCT f.household_id)::int AS households,
      count(DISTINCT f.household_id) FILTER (WHERE s.status IN ('active', 'trialing'))::int AS recovered
    FROM payment_failures f
    LEFT JOIN subscriptions s ON s.stripe_subscription_id = f.stripe_subscription_id
    WHERE f.created_at >= ${from}::timestamptz AND f.created_at < ${to}::timestamptz
  `)
  const f = (failures.rows[0] ?? {}) as { invoices?: number; households?: number; recovered?: number }
  return {
    cancellations: {
      total: rows.reduce((a, r) => a + Number(r.n), 0),
      byFeedback: tallyBy(rows.map((r) => ({ key: r.feedback, n: r.n }))),
      byReason: tallyBy(rows.map((r) => ({ key: r.reason, n: r.n }))),
    },
    paymentFailures: { invoices: Number(f.invoices ?? 0), households: Number(f.households ?? 0), recovered: Number(f.recovered ?? 0) },
  }
}
