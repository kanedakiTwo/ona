import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin } from './auth.js'
import { tokenMatches } from './metricsAuth.js'

/**
 * Guard for `PUT /admin/newsletter/drafts/:issueId/recommendation` only
 * (PRO-1198, specs/newsletter.md): an admin JWT, or the header
 * `x-newsletter-token` equal to `NEWSLETTER_RECOMMENDATION_TOKEN`, so
 * Marketing (the office) leaves its proposal without Miguel's session. The
 * token is mounted on that route only: never the template, the proof or the
 * schedule.
 *   - header present → token mode only (wrong or unset token → 401, no JWT fallback);
 *   - header absent  → `authMiddleware` + `requireAdmin`.
 */
export function createNewsletterRecommendationAuth(deps: {
  expectedToken: () => string
  adminAuth: (req: Request, res: Response, next: NextFunction) => void
}): RequestHandler {
  return (req, res, next) => {
    const provided = req.get('x-newsletter-token')
    if (provided === undefined) {
      deps.adminAuth(req, res, next)
      return
    }
    const expected = deps.expectedToken()
    if (!expected || !tokenMatches(provided, expected)) {
      res.status(401).json({ error: 'Token de la newsletter no válido.', code: 'NEWSLETTER_TOKEN_INVALID' })
      return
    }
    next()
  }
}

export const newsletterRecommendationAuth = createNewsletterRecommendationAuth({
  expectedToken: () => env.NEWSLETTER_RECOMMENDATION_TOKEN,
  adminAuth: (req, res, next) => {
    void authMiddleware(req, res, () => requireAdmin(req, res, next))
  },
})

/** The request came with Marketing's token (it got past the guard, so the token was good). */
export const viaNewsletterToken = (req: Request): boolean => req.get('x-newsletter-token') !== undefined
