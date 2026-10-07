import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin } from './auth.js'

/**
 * Guard for GET /admin/metrics (specs/metrics.md), GET /admin/errors
 * (specs/errors.md) and GET /admin/waitlist (specs/waitlist.md): either an
 * admin JWT, or the header `x-metrics-token` equal to `METRICS_READ_TOKEN` —
 * so the ONA HQ agents can read business metrics, the error log and the
 * waitlist aggregates without holding an admin session. The token is mounted
 * on those three read-only routes only; it grants nothing else.
 *
 *   - header present → token mode only (a wrong token is 401, no JWT fallback);
 *     with METRICS_READ_TOKEN unset, token mode is disabled (always 401);
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
