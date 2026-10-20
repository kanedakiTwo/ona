import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin } from './auth.js'

/**
 * Guard for the read-only routes the Mimoia HQ agents use: GET /admin/metrics
 * and GET /admin/usage (specs/metrics.md), GET /admin/errors (specs/errors.md),
 * GET /admin/waitlist (specs/waitlist.md), GET /admin/price-survey and GET
 * /admin/feedback (without identity), and GET
 * /admin/assistant-reviews/flags (specs/whatsapp.md), GET /admin/catalog-wishes
 * (specs/catalog-import.md), GET /admin/extension-gaps and GET /admin/extension-sends
 * (specs/shop-orders.md), GET /admin/newsletter/stats (specs/newsletter.md, PRO-191), GET
 * /admin/menu-planner/comparison (specs/smart-menu.md) and GET /notices/afina/stats
 * (specs/taste.md).
 * Either an admin JWT, or
 * the header `x-metrics-token` equal to `METRICS_READ_TOKEN`, so the agents
 * read aggregates without holding an admin session. The token is mounted on
 * those read-only routes only and grants nothing else.
 *
 *   - header present → token mode only (a wrong token is 401, no JWT fallback);
 *     with METRICS_READ_TOKEN unset, token mode is disabled (always 401);
 *     only GET/HEAD: the token never writes, even if mounted by mistake on a
 *     writing route (405 `METRICS_TOKEN_READ_ONLY`);
 *   - header absent  → the usual `authMiddleware` + `requireAdmin`.
 */

/** Constant-time comparison; hashing first makes the lengths equal. */
export function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash('sha256').update(provided).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export function createMetricsAuth(deps: {
  expectedToken: () => string
  adminAuth: (req: Request, res: Response, next: NextFunction) => void
}): RequestHandler {
  return (req, res, next) => {
    const provided = req.get('x-metrics-token')
    if (provided === undefined) {
      deps.adminAuth(req, res, next)
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).json({ error: 'El token de métricas solo sirve para leer.', code: 'METRICS_TOKEN_READ_ONLY' })
      return
    }
    const expected = deps.expectedToken()
    if (!expected) {
      res.status(401).json({ error: 'El acceso por token a las métricas no está activado.', code: 'METRICS_TOKEN_DISABLED' })
      return
    }
    if (!tokenMatches(provided, expected)) {
      res.status(401).json({ error: 'Token de métricas no válido.', code: 'METRICS_TOKEN_INVALID' })
      return
    }
    next()
  }
}

export const metricsAuth = createMetricsAuth({
  expectedToken: () => env.METRICS_READ_TOKEN,
  adminAuth: (req, res, next) => {
    void authMiddleware(req, res, () => requireAdmin(req, res, next))
  },
})
