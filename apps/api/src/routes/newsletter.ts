import { Router, type Request, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { record as recordAudit } from '../services/auditLog.js'
import {
  NewsletterTestAddressError,
  createDbNewsletterRepo,
  defaultNewsletterDeps,
  newsletterSendSchema,
  sendNewsletter,
  type NewsletterDeps,
  type NewsletterRepo,
} from '../services/newsletter.js'

/**
 * Newsletter «El menú de los viernes» (PRO-94, specs/newsletter.md).
 *
 *   POST /admin/newsletter/send    admin JWT: dryRun (count) | testTo (one proof to an admin) | send
 *   POST /newsletter/unsubscribe   public: newsletter off, the place on the list stays.
 *                                  JSON `{ token }` from /newsletter/baja, or the RFC 8058
 *                                  one-click POST to `?t=<token>` from the inbox.
 */

const unsubscribeSchema = z.object({ token: z.string().trim().min(3).max(200) })

/** The API's own origin, for the one-click URL (behind Railway: `trust proxy` is on). */
function apiOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host')}`
}

export interface NewsletterRouterDeps {
  repo: NewsletterRepo
  adminAuth: RequestHandler[]
  unsubscribeLimiter: RequestHandler
  send: typeof sendNewsletter
  makeDeps: (urls: { publicUrl: string; apiUrl: string }) => NewsletterDeps
  audit: typeof recordAudit
  publicUrl: () => string
}

export function createNewsletterRouter(overrides: Partial<NewsletterRouterDeps> = {}): Router {
  const repo = overrides.repo ?? createDbNewsletterRepo()
  const deps: NewsletterRouterDeps = {
    repo,
    adminAuth: [authMiddleware as RequestHandler, requireAdmin as RequestHandler],
    unsubscribeLimiter: rateLimit({ max: 30, windowMs: 60 * 60_000 }),
    send: sendNewsletter,
    makeDeps: (urls) => ({ ...defaultNewsletterDeps(urls), repo }),
    audit: recordAudit,
    publicUrl: () => env.WEB_PUBLIC_URL,
    ...overrides,
  }
  const router = Router()

  router.post('/admin/newsletter/send', ...deps.adminAuth, async (req: AuthRequest, res: Response) => {
    const parsed = newsletterSendSchema.safeParse(req.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      res.status(400).json({
        error: `Revisa el número: ${issue?.path.join('.') || 'cuerpo'} — ${issue?.message ?? 'no válido'}`,
        code: 'INVALID_NEWSLETTER',
      })
      return
    }
    try {
      const outcome = await deps.send(parsed.data, deps.makeDeps({ publicUrl: deps.publicUrl(), apiUrl: apiOrigin(req) }))
      if (outcome.mode === 'send') {
        await deps.audit({
          adminId: req.userId!,
          action: 'newsletter.send',
          targetType: 'newsletter_issue',
          payload: { issueId: outcome.issueId, sent: outcome.sent, failed: outcome.failed, skipped: outcome.skipped },
        })
      }
      res.json(outcome)
    } catch (err: any) {
      if (err instanceof NewsletterTestAddressError) {
        res.status(400).json({ error: 'La prueba solo se manda al email de un admin.', code: 'NEWSLETTER_TEST_NOT_ADMIN' })
        return
      }
      console.error('[newsletter] send failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.post('/newsletter/unsubscribe', deps.unsubscribeLimiter, async (req: Request, res: Response) => {
    // One-click from the inbox: `?t=` in the URL, `List-Unsubscribe=One-Click` in the form body.
    const raw = typeof req.query.t === 'string' ? req.query.t : req.body?.token
    const parsed = unsubscribeSchema.safeParse({ token: raw })
    const notFound = () =>
      res.status(404).json({ error: 'Este enlace de baja no es válido.', code: 'NEWSLETTER_TOKEN_NOT_FOUND' })
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
      console.error('[newsletter] unsubscribe failed:', err?.message ?? err)
      res.status(500).json({ error: 'No hemos podido darte de baja. Inténtalo de nuevo en un momento.' })
    }
  })

  return router
}

export default createNewsletterRouter()
