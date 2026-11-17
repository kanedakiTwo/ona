import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin } from './auth.js'
import { tokenMatches } from './metricsAuth.js'

/**
 * Guard for the two routes Cocina (the office) uses to mark catalogue
 * ingredients (specs/cook-now.md): an admin JWT, or the header
 * `x-cocina-token` equal to `COCINA_WRITE_TOKEN`. The token is mounted on
 * those two routes only and reads nothing but catalogue recipes.
 *   - header present → token mode only (wrong or unset token → 401);
 *   - header absent  → `authMiddleware` + `requireAdmin`.
 */
export function createCocinaAuth(deps: {
  expectedToken: () => string
  adminAuth: (req: Request, res: Response, next: NextFunction) => void
}): RequestHandler {
  return (req, res, next) => {
    const provided = req.get('x-cocina-token')
    if (provided === undefined) {
      deps.adminAuth(req, res, next)
      return
    }
    const expected = deps.expectedToken()
    if (!expected || !tokenMatches(provided, expected)) {
      res.status(401).json({ error: 'Token de Cocina no válido.', code: 'COCINA_TOKEN_INVALID' })
      return
    }
    next()
  }
}

export const cocinaAuth = createCocinaAuth({
  expectedToken: () => env.COCINA_WRITE_TOKEN,
  adminAuth: (req, res, next) => {
    void authMiddleware(req, res, () => requireAdmin(req, res, next))
  },
})
