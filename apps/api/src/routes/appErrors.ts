import express, { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { CLIENT_ERROR_LIMITS, clientErrorReportSchema, type ClientErrorReport } from '@ona/shared'
import { authMiddleware, optionalAuthMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { metricsAuth } from '../middleware/metricsAuth.js'
import { FixedWindowCounter, isRateLimitDisabled } from '../middleware/rateLimit.js'
import {
  APP_ERROR_LIMITS,
  loadAppErrors,
  recordAppError,
  resolveAppError,
  type AppErrorKind,
} from '../services/appErrors.js'

/**
 * In-house error tracker (specs/errors.md).
 *
 *   POST /client-errors                public; the web app's error reports
 *   GET  /admin/errors                 admin JWT or `x-metrics-token` (read-only agents)
 *   POST /admin/errors/:id/resolve     admin JWT only
 */

// ─── POST /client-errors ─────────────────────────────────────────

/** Parse + validate a raw report body (the browser sends JSON as text/plain so a beacon needs no preflight). */
export function parseClientErrorBody(body: unknown): ClientErrorReport | null {
  if (typeof body !== 'string' || !body) return null
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  const parsed = clientErrorReportSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

export interface ClientErrorsDeps {
  record: typeof recordAppError
  optionalAuth: RequestHandler
  perIpMax: number
  windowMs: number
  rateLimitDisabled: boolean
}

/**
 * Mounted in index.ts BEFORE `express.json()`: it reads the body itself with
 * a hard 8 KB cap (any content type), so the global 100 KB JSON parser never
 * sees it. Valid reports get 204 and are recorded fire-and-forget; so are
 * reports over the per-IP limit (204, not recorded — the client has nothing
 * to retry). Malformed → 400, oversized → 413.
 */
export function createClientErrorsRouter(overrides: Partial<ClientErrorsDeps> = {}): Router {
  const deps: ClientErrorsDeps = {
    record: recordAppError,
    optionalAuth: optionalAuthMiddleware as RequestHandler,
    perIpMax: APP_ERROR_LIMITS.perIpPerMinute,
    windowMs: 60_000,
    rateLimitDisabled: isRateLimitDisabled(),
    ...overrides,
  }
  const perIp = new FixedWindowCounter(deps.perIpMax, deps.windowMs)
  const pruneTimer = setInterval(() => perIp.prune(Date.now()), deps.windowMs)
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref()

  const router = Router()

  router.post(
    '/client-errors',
    (req, res, next) => {
      if (!deps.rateLimitDisabled && !perIp.hit(req.ip ?? 'unknown', Date.now()).allowed) {
        res.status(204).end()
        return
      }
      next()
    },
    express.text({ type: () => true, limit: CLIENT_ERROR_LIMITS.maxBodyBytes }),
    (req, res, next) => {
      const report = parseClientErrorBody(req.body)
      if (!report) {
        res.status(400).json({ error: 'Informe de error no válido.', code: 'INVALID_ERROR_REPORT' })
        return
      }
      res.locals.clientErrorReport = report
      next()
    },
    // Attribute the report when a valid session token comes along; a DB
    // hiccup here must not stop the 204, so failures continue anonymously.
    (req, res, next) => {
      Promise.resolve(deps.optionalAuth(req, res, next)).catch(() => next())
    },
    (req, res) => {
      res.status(204).end()
      const report = res.locals.clientErrorReport as ClientErrorReport
      deps.record({
        kind: 'client',
        message: report.message,
        stack: report.stack,
        path: report.path,
        release: report.release,
        userAgent: req.get('user-agent'),
        userId: (req as AuthRequest).userId,
      })
    },
  )

  // Body-parser failures on this route only (too large, bad encoding, aborted).
  router.use('/client-errors', (err: any, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large') {
      res.status(413).json({ error: 'Informe de error demasiado grande.', code: 'ERROR_REPORT_TOO_LARGE' })
      return
    }
    if (typeof err?.type === 'string') {
      res.status(400).json({ error: 'Informe de error no válido.', code: 'INVALID_ERROR_REPORT' })
      return
    }
    next(err)
  })

  return router
}

export const clientErrorsRouter = createClientErrorsRouter()

// ─── Admin ───────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function intParam(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback
}

export interface AdminErrorsDeps {
  readAuth: RequestHandler
  adminAuth: RequestHandler[]
  load: typeof loadAppErrors
  resolve: typeof resolveAppError
}

/**
 * Own router, mounted in index.ts next to metricsRoutes — BEFORE the routers
 * that `router.use(authMiddleware)` as a catch-all, otherwise a token-only
 * request would be 401'd before it got here.
 */
export function createAdminErrorsRouter(overrides: Partial<AdminErrorsDeps> = {}): Router {
  const deps: AdminErrorsDeps = {
    readAuth: metricsAuth,
    adminAuth: [authMiddleware as RequestHandler, requireAdmin as RequestHandler],
    load: loadAppErrors,
    resolve: resolveAppError,
    ...overrides,
  }
  const router = Router()

  // GET /admin/errors?days=7&includeResolved=0[&kind=client|server][&limit=100]
  router.get('/admin/errors', deps.readAuth, async (req, res) => {
    try {
      const kind = req.query.kind === 'client' || req.query.kind === 'server' ? (req.query.kind as AppErrorKind) : undefined
      res.json(
        await deps.load({
          days: intParam(req.query.days, 7, 1, 90),
          includeResolved: req.query.includeResolved === '1' || req.query.includeResolved === 'true',
          kind,
          limit: intParam(req.query.limit, 100, 1, 500),
        }),
      )
    } catch (err: any) {
      console.error('[admin/errors] failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.post('/admin/errors/:id/resolve', ...deps.adminAuth, async (req: AuthRequest, res: Response) => {
    const id = String(req.params.id)
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'Id de error no válido.' })
      return
    }
    try {
      const resolved = await deps.resolve(id, req.userId!)
      if (!resolved) {
        res.status(404).json({ error: 'Error no encontrado.' })
        return
      }
      res.json(resolved)
    } catch (err: any) {
      console.error('[admin/errors] resolve failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

export default createAdminErrorsRouter()
