import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin } from './auth.js'

/**
 * Guard for the thirteen read-only routes the Mimoia HQ agents use: GET /admin/metrics
 * and GET /admin/usage (specs/metrics.md), GET /admin/errors (specs/errors.md),
 * GET /admin/waitlist (specs/waitlist.md), GET /admin/price-survey and GET
 * /admin/feedback (counts only), and GET
 * /admin/assistant-reviews/flags (specs/whatsapp.md), GET /admin/catalog-wishes
 * (specs/catalog-import.md), GET /admin/extension-gaps and GET /admin/extension-sends
 * (specs/shop-orders.md), GET /admin/newsletter/stats (specs/newsletter.md, PRO-191), GET
 * /admin/menu-planner/comparison (specs/smart-menu.md) and GET /notices/afina/stats
 * (specs/taste.md). Routes that hold user text answer the token through
 * services/agentView.ts (`viaMetricsToken`); the two extension routes crop the line name for
 * everyone, token and admin JWT alike, in services/basketExtension.ts (`publicLineName`), and
 * with the token also cut the date to the day and the shop's product name to 80 characters and
 * 12 words (`basketSendsForToken` / `basketGapsForToken`, PRO-322).
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

/** The request came with the read token (not an admin JWT): routes holding user text answer with counts only. */
export const viaMetricsToken = (req: Request): boolean => req.get('x-metrics-token') !== undefined
