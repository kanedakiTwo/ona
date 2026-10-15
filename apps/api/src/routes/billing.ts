import express, { Router, type RequestHandler } from 'express'
import { eq } from 'drizzle-orm'
import { checkoutRequestSchema } from '@ona/shared'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { households, users } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  LIVE_STATUSES,
  billingStateFor,
  buildCheckoutParams,
  createDbSubscriptionRepo,
  createStripeGateway,
  handleBillingEvent,
  isBillingConfigured,
  type BillingGateway,
  type SubscriptionRepo,
} from '../services/billing.js'

/**
 * Subscriptions (specs/billing.md).
 *
 *   GET  /billing            auth: plan state of the caller's household
 *   POST /billing/checkout   auth, household owner: Stripe Checkout URL for a plan + period
 *   POST /billing/portal     auth, household owner: Stripe customer portal URL (change card, cancel)
 *   POST /billing/webhook    Stripe → us, signed; mounted BEFORE express.json() (raw body)
 */

export interface Payer {
  householdId: string
  email: string
  isOwner: boolean
}

export interface BillingDeps {
  repo: SubscriptionRepo
  gateway: BillingGateway
  /** Payments switched on (Stripe keys set). */
  enabled: () => boolean
  payer: (userId: string) => Promise<Payer | null>
  now: () => Date
  webUrl: string
  auth: RequestHandler
}

async function loadPayer(userId: string): Promise<Payer | null> {
  const [u] = await db
    .select({ email: users.email, householdId: users.primaryHouseholdId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!u?.householdId) return null
  const [h] = await db.select({ ownerId: households.ownerId }).from(households).where(eq(households.id, u.householdId)).limit(1)
  return { householdId: u.householdId, email: u.email, isOwner: h?.ownerId === userId }
}

function defaults(): BillingDeps {
  return {
    repo: createDbSubscriptionRepo(),
    gateway: createStripeGateway(),
    enabled: isBillingConfigured,
    payer: loadPayer,
    now: () => new Date(),
    webUrl: env.WEB_PUBLIC_URL,
    auth: authMiddleware as RequestHandler,
  }
}

const NOT_OWNER = 'Solo quien gestiona el hogar puede suscribirlo. Pídeselo a esa persona desde Mi casa.'
const DISABLED = 'Los pagos aún no están abiertos.'
const STRIPE_DOWN = 'No hemos podido conectar con la pasarela de pago. Inténtalo en un momento.'

export function createBillingRouter(overrides: Partial<BillingDeps> = {}): Router {
  const d = { ...defaults(), ...overrides }
  const router = Router()

  router.get('/billing', d.auth, async (req: AuthRequest, res) => {
    const payer = await d.payer(req.userId!)
    const row = payer ? await d.repo.latestForHousehold(payer.householdId) : null
    res.json(billingStateFor(row, { enabled: d.enabled(), canManage: !!payer?.isOwner, now: d.now() }))
  })

  router.post('/billing/checkout', d.auth, async (req: AuthRequest, res) => {
    if (!d.enabled()) {
      res.status(503).json({ error: DISABLED, code: 'BILLING_DISABLED' })
      return
    }
    const parsed = checkoutRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Elige un plan y si lo pagas al mes o al año.' })
      return
    }
    const payer = await d.payer(req.userId!)
    if (!payer?.isOwner) {
      res.status(403).json({ error: NOT_OWNER, code: 'NOT_HOUSEHOLD_OWNER' })
      return
    }
    const latest = await d.repo.latestForHousehold(payer.householdId)
    if (latest && LIVE_STATUSES.includes(latest.status)) {
      res.status(409).json({ error: 'Tu hogar ya tiene una suscripción. Puedes cambiarla desde «Gestionar mi suscripción».', code: 'ALREADY_SUBSCRIBED' })
      return
    }
    try {
      const priceId = await d.gateway.priceId(parsed.data.plan, parsed.data.period)
      const { url } = await d.gateway.createCheckout(
        buildCheckoutParams({
          ...parsed.data,
          priceId,
          email: payer.email,
          userId: req.userId!,
          householdId: payer.householdId,
          now: d.now(),
          webUrl: d.webUrl,
          customerId: latest?.stripeCustomerId ?? null,
        }),
      )
      res.json({ url })
    } catch (err) {
      console.error('[billing] checkout failed', err)
      res.status(502).json({ error: STRIPE_DOWN })
    }
  })

  router.post('/billing/portal', d.auth, async (req: AuthRequest, res) => {
    if (!d.enabled()) {
      res.status(503).json({ error: DISABLED, code: 'BILLING_DISABLED' })
      return
    }
    const payer = await d.payer(req.userId!)
    if (!payer?.isOwner) {
      res.status(403).json({ error: NOT_OWNER, code: 'NOT_HOUSEHOLD_OWNER' })
      return
    }
    const latest = await d.repo.latestForHousehold(payer.householdId)
    if (!latest) {
      res.status(404).json({ error: 'Tu hogar no tiene ninguna suscripción.', code: 'NO_SUBSCRIPTION' })
      return
    }
    try {
      res.json(await d.gateway.createPortal(latest.stripeCustomerId, `${d.webUrl}/profile/suscripcion`))
    } catch (err) {
      console.error('[billing] portal failed', err)
      res.status(502).json({ error: STRIPE_DOWN })
    }
  })

  return router
}

/** Mounted in index.ts BEFORE `express.json()`: Stripe signs the raw bytes. */
export function createBillingWebhookRouter(overrides: Partial<Pick<BillingDeps, 'repo' | 'gateway' | 'enabled'>> = {}): Router {
  const d = { ...defaults(), ...overrides }
  const router = Router()
  router.post('/billing/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    if (!d.enabled()) {
      res.sendStatus(503)
      return
    }
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    let event
    try {
      event = d.gateway.parseWebhook(raw, req.get('stripe-signature'))
    } catch {
      res.sendStatus(400)
      return
    }
    try {
      const outcome = await handleBillingEvent(event, d)
      res.json({ received: true, outcome })
    } catch (err) {
      // 500 → Stripe retries the event later.
      console.error('[billing] webhook failed', event.type, err)
      res.sendStatus(500)
    }
  })
  return router
}

export const billingWebhookRouter = createBillingWebhookRouter()
export default createBillingRouter()
