import { Router, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { normalizeReferralCode, waitlistSignupSchema, waitlistUnsubscribeSchema } from '@ona/shared'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { metricsAuth } from '../middleware/metricsAuth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import {
  createDbWaitlistRepo,
  getReferralStatus,
  inviteWaitlistEntries,
  loadWaitlistReport,
  signupToWaitlist,
  type WaitlistRepo,
} from '../services/waitlist.js'

/**
 * Pre-launch waitlist (specs/waitlist.md).
 *
 *   POST /waitlist                 public: sign up (idempotent on email)
 *   GET  /waitlist/:code           public: the owner page's referral count
 *   POST /waitlist/unsubscribe     public: opt-out with the private token
 *   GET  /admin/waitlist           admin JWT or `x-metrics-token` (agents): aggregates, ids only
 *   POST /admin/waitlist/invite    admin JWT only: mark a batch invited, get their emails
 *
 * Both routers are mounted in index.ts BEFORE the catch-all
 * `router.use(authMiddleware)` routers, after `express.json()`.
 */

const SIGNUP_FIELD_ERRORS: Record<string, string> = {
  email: 'Ese email no parece válido.',
  consent: 'Necesitamos tu permiso para apuntarte: marca la casilla de la privacidad.',
  householdSize: 'Responde las cuatro preguntas (es un toque cada una).',
  plannerRole: 'Responde las cuatro preguntas (es un toque cada una).',
  currentMethod: 'Responde las cuatro preguntas (es un toque cada una).',
  platform: 'Responde las cuatro preguntas (es un toque cada una).',
}

export interface WaitlistRouterDeps {
  repo: WaitlistRepo
  /** Origin of the referral links (`WEB_PUBLIC_URL`). */
  publicUrl: () => string
  signupLimiter: RequestHandler
  readLimiter: RequestHandler
  unsubscribeLimiter: RequestHandler
}

export function createWaitlistRouter(overrides: Partial<WaitlistRouterDeps> = {}): Router {
  const deps: WaitlistRouterDeps = {
    repo: overrides.repo ?? createDbWaitlistRepo(),
    publicUrl: overrides.publicUrl ?? (() => env.WEB_PUBLIC_URL),
    // A household often signs up from the same Wi-Fi: generous, but caps scripted floods.
    signupLimiter:
      overrides.signupLimiter ??
      rateLimit({
        max: 20,
        windowMs: 60 * 60_000,
        message: 'Demasiados intentos desde esta conexión. Prueba de nuevo dentro de un rato.',
      }),
    readLimiter: overrides.readLimiter ?? rateLimit({ max: 60, windowMs: 60_000 }),
    unsubscribeLimiter: overrides.unsubscribeLimiter ?? rateLimit({ max: 20, windowMs: 60 * 60_000 }),
  }
  const router = Router()

  router.post('/waitlist', deps.signupLimiter, async (req, res) => {
    const parsed = waitlistSignupSchema.safeParse(req.body)
    if (!parsed.success) {
      const field = String(parsed.error.issues[0]?.path[0] ?? '')
      // Honeypot or anything unexpected: a plain message, no hint for bots.
      res.status(400).json({
        error: SIGNUP_FIELD_ERRORS[field] ?? 'No hemos podido apuntarte. Revisa el formulario.',
        code: 'INVALID_WAITLIST_SIGNUP',
        field: SIGNUP_FIELD_ERRORS[field] ? field : undefined,
      })
      return
    }
    try {
      res.json(await signupToWaitlist(parsed.data, { repo: deps.repo, publicUrl: deps.publicUrl() }))
    } catch (err: any) {
      console.error('[waitlist] signup failed:', err?.message ?? err)
      res.status(500).json({ error: 'No hemos podido apuntarte. Inténtalo de nuevo en un momento.' })
    }
  })

  router.post('/waitlist/unsubscribe', deps.unsubscribeLimiter, async (req, res) => {
    const parsed = waitlistUnsubscribeSchema.safeParse(req.body)
    const notFound = () =>
      res.status(404).json({ error: 'Este enlace de baja no es válido.', code: 'WAITLIST_TOKEN_NOT_FOUND' })
    if (!parsed.success) {
      notFound()
      return
    }
    try {
      const outcome = await deps.repo.unsubscribe(parsed.data.token)
      if (outcome === 'not_found') {
        notFound()
        return
      }
      res.json({ ok: true, alreadyUnsubscribed: outcome === 'already' })
    } catch (err: any) {
      console.error('[waitlist] unsubscribe failed:', err?.message ?? err)
      res.status(500).json({ error: 'No hemos podido darte de baja. Inténtalo de nuevo en un momento.' })
    }
  })

  router.get('/waitlist/:code', deps.readLimiter, async (req, res) => {
    const notFound = () =>
      res.status(404).json({ error: 'Este enlace no existe.', code: 'WAITLIST_CODE_NOT_FOUND' })
    if (!normalizeReferralCode(req.params.code)) {
      notFound()
      return
    }
    try {
      const status = await getReferralStatus(String(req.params.code), { repo: deps.repo, publicUrl: deps.publicUrl() })
      if (!status) {
        notFound()
        return
      }
      res.json(status)
    } catch (err: any) {
      console.error('[waitlist] status failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

// ─── Admin ───────────────────────────────────────────────────────

function intParam(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

const inviteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  batch: z.number().int().min(1).max(10_000).optional(),
})

export interface AdminWaitlistDeps {
  readAuth: RequestHandler
  adminAuth: RequestHandler[]
  load: typeof loadWaitlistReport
  invite: typeof inviteWaitlistEntries
  publicUrl: () => string
}

export function createAdminWaitlistRouter(overrides: Partial<AdminWaitlistDeps> = {}): Router {
  const deps: AdminWaitlistDeps = {
    readAuth: metricsAuth,
    adminAuth: [authMiddleware as RequestHandler, requireAdmin as RequestHandler],
    load: loadWaitlistReport,
    invite: inviteWaitlistEntries,
    publicUrl: () => env.WEB_PUBLIC_URL,
    ...overrides,
  }
  const router = Router()

  // GET /admin/waitlist?days=30&batchSize=20 — no emails, names or supermarkets.
  router.get('/admin/waitlist', deps.readAuth, async (req, res) => {
    try {
      res.json(
        await deps.load({
          days: intParam(req.query.days, 30, 1, 365),
          batchSize: intParam(req.query.batchSize, 20, 1, 500),
        }),
      )
    } catch (err: any) {
      console.error('[admin/waitlist] failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // POST /admin/waitlist/invite { ids, batch? } — the only route that returns emails.
  router.post('/admin/waitlist/invite', ...deps.adminAuth, async (req: AuthRequest, res: Response) => {
    const parsed = inviteSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Pasa `ids` (uuids de la lista) y, si quieres, `batch`.', code: 'INVALID_INVITE' })
      return
    }
    try {
      res.json(await deps.invite(parsed.data.ids, parsed.data.batch, req.userId!, { publicUrl: deps.publicUrl() }))
    } catch (err: any) {
      console.error('[admin/waitlist] invite failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

export const adminWaitlistRouter = createAdminWaitlistRouter()
export default createWaitlistRouter()
