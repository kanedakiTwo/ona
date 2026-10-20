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
  parseNewsletterToken,
  sendNewsletter,
  type NewsletterDeps,
  type NewsletterRepo,
} from '../services/newsletter.js'
import {
  NEWSLETTER_STATS_DEFINITIONS,
  countsAsClick,
  createDbNewsletterStatsRepo,
  type NewsletterStatsRepo,
} from '../services/newsletterStats.js'
import { metricsAuth } from '../middleware/metricsAuth.js'

/**
 * Newsletter «El menú de los viernes» (PRO-94, specs/newsletter.md).
 *
 *   POST /admin/newsletter/send    admin JWT: dryRun (count) | testTo (one proof to an admin) | send
 *   GET  /newsletter/me            JWT: { optIn } — the profile switch (PRO-95)
 *   PUT  /newsletter/me { optIn }  JWT: on (consent date + version) / off (also the waitlist entry)
 *   POST /newsletter/unsubscribe   public: newsletter off, the place on the list stays.
 *                                  JSON `{ token, issueId? }` from /newsletter/baja, or the RFC 8058
 *                                  one-click POST to `?t=<token>&i=<issue>` from the inbox.
 *   GET  /newsletter/click/:issueId/:n  public, for the web's /n/<issue>/<n> (PRO-191):
 *                                  `{ url }` = the destination saved at send (+1 click
 *                                  unless HEAD, a proof or a scanner); unknown → 404.
 *   GET  /admin/newsletter/stats   admin JWT or x-metrics-token: per issue sent, clicks
 *                                  per link and opt-outs. Counts only.
 */

const ISSUE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const unsubscribeSchema = z.object({ token: z.string().trim().min(3).max(200) })
const optInSchema = z.object({ optIn: z.boolean() })

/** The API's own origin, for the one-click URL (behind Railway: `trust proxy` is on). */
function apiOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host')}`
}

export interface NewsletterRouterDeps {
  repo: NewsletterRepo
  adminAuth: RequestHandler[]
  userAuth: RequestHandler
  unsubscribeLimiter: RequestHandler
  send: typeof sendNewsletter
  makeDeps: (urls: { publicUrl: string; apiUrl: string }) => NewsletterDeps
  audit: typeof recordAudit
  publicUrl: () => string
  /** PRO-191: clicks and opt-outs per issue. */
  stats: NewsletterStatsRepo
  /** Admin JWT or the agents' x-metrics-token. */
  statsAuth: RequestHandler
}

export function createNewsletterRouter(overrides: Partial<NewsletterRouterDeps> = {}): Router {
  const repo = overrides.repo ?? createDbNewsletterRepo()
  const stats = overrides.stats ?? createDbNewsletterStatsRepo()
  const deps: NewsletterRouterDeps = {
    repo,
    stats,
    statsAuth: metricsAuth as RequestHandler,
    adminAuth: [authMiddleware as RequestHandler, requireAdmin as RequestHandler],
    userAuth: authMiddleware as RequestHandler,
    unsubscribeLimiter: rateLimit({ max: 30, windowMs: 60 * 60_000 }),
    send: sendNewsletter,
    makeDeps: (urls) => ({ ...defaultNewsletterDeps(urls), repo, stats }),
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

  router.get('/newsletter/me', deps.userAuth, async (req: AuthRequest, res: Response) => {
    try {
      const on = await deps.repo.getUserOptIn(req.userId!)
      if (on === null) {
        res.status(404).json({ error: 'User not found' })
        return
      }
      res.json({ optIn: on })
    } catch (err: any) {
      console.error('[newsletter] read opt-in failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.put('/newsletter/me', deps.userAuth, async (req: AuthRequest, res: Response) => {
    const parsed = optInSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Pasa `optIn` (true o false).', code: 'INVALID_NEWSLETTER_OPT_IN' })
      return
    }
    try {
      const on = await deps.repo.setUserOptIn(req.userId!, parsed.data.optIn)
      if (on === null) {
        res.status(404).json({ error: 'User not found' })
        return
      }
      res.json({ optIn: on })
    } catch (err: any) {
      console.error('[newsletter] set opt-in failed:', err?.message ?? err)
      res.status(500).json({ error: 'No hemos podido guardarlo. Inténtalo de nuevo en un momento.' })
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
      // PRO-191: count the opt-out under the issue it came from (counts only).
      if (outcome === 'ok') {
        const rawIssue = typeof req.query.i === 'string' ? req.query.i : req.body?.issueId
        const issueId = typeof rawIssue === 'string' && ISSUE_ID_RE.test(rawIssue) ? rawIssue : null
        const ref = parseNewsletterToken(parsed.data.token)
        await deps.stats
          .recordUnsubscribe(issueId, ref?.kind === 'user' ? 'user' : 'waitlist')
          .catch((err) => console.warn('[newsletter] opt-out not counted:', err?.message ?? err))
      }
      res.json({ ok: true, alreadyUnsubscribed: outcome === 'already' })
    } catch (err: any) {
      console.error('[newsletter] unsubscribe failed:', err?.message ?? err)
      res.status(500).json({ error: 'No hemos podido darte de baja. Inténtalo de nuevo en un momento.' })
    }
  })

  router.get('/newsletter/click/:issueId/:n', async (req: Request, res: Response) => {
    const issueId = String(req.params.issueId)
    const n = Number(req.params.n)
    if (!ISSUE_ID_RE.test(issueId) || !Number.isInteger(n) || n < 1 || n > 50) {
      res.status(404).json({ error: 'Este enlace no existe.', code: 'NEWSLETTER_LINK_NOT_FOUND' })
      return
    }
    try {
      // The web route passes a HEAD on as `x-newsletter-head` (its fetch is a GET).
      const method = req.get('x-newsletter-head') === '1' ? 'HEAD' : req.method
      const count = countsAsClick({ method, userAgent: req.get('user-agent'), proof: req.query.prueba === '1' })
      const url = await deps.stats.click(issueId, n, count)
      if (!url) {
        res.status(404).json({ error: 'Este enlace no existe.', code: 'NEWSLETTER_LINK_NOT_FOUND' })
        return
      }
      res.set('Cache-Control', 'no-store').json({ url })
    } catch (err: any) {
      console.error('[newsletter] click failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.get('/admin/newsletter/stats', deps.statsAuth, async (_req: Request, res: Response) => {
    try {
      res.json({ ...(await deps.stats.stats()), definitions: NEWSLETTER_STATS_DEFINITIONS })
    } catch (err: any) {
      console.error('[newsletter] stats failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

export default createNewsletterRouter()
