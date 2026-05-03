import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import type { Role } from '@ona/shared'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { users } from '../db/schema.js'

export interface AuthRequest extends Request {
  userId?: string
  /** Set by `authMiddleware` from a fresh per-request DB read. */
  user?: { id: string; role: Role; suspendedAt: Date | null }
}

/**
 * Authenticate the JWT, fetch fresh role + suspension state from DB, and
 * reject suspended users with `code: 'SUSPENDED'`.
 *
 * Per spec: privileged routes are low-volume; freshness > caching, so each
 * request pays one indexed lookup. The cache from the prior implementation
 * was removed because role / suspended_at must be live (admin demotions and
 * suspensions take effect on the next request).
 */
export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' })
    return
  }

  const token = authHeader.slice(7)
  let decoded: { userId: string }
  try {
    decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string }
  } catch {
    res.status(401).json({ error: 'Invalid token' })
    return
  }

  const [row] = await db
    .select({
      id: users.id,
      role: users.role,
      suspendedAt: users.suspendedAt,
    })
    .from(users)
    .where(eq(users.id, decoded.userId))
    .limit(1)

  if (!row) {
    res.status(401).json({
      error: 'Sesión inválida. Vuelve a iniciar sesión.',
      code: 'USER_NOT_FOUND',
    })
    return
  }

  if (row.suspendedAt) {
    res.status(401).json({
      error:
        'Tu cuenta está suspendida. Contacta con el equipo de ONA si crees que es un error.',
      code: 'SUSPENDED',
    })
    return
  }

  req.userId = row.id
  req.user = {
    id: row.id,
    role: row.role as Role,
    suspendedAt: row.suspendedAt,
  }
  next()
}

/**
 * Admin-only gate. Must run AFTER `authMiddleware` — it relies on
 * `req.user.role` already being set.
 */
export function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({
      error: 'Acceso restringido al equipo de ONA.',
      code: 'NOT_ADMIN',
    })
    return
  }
  next()
}
