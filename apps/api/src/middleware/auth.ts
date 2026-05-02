import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { users } from '../db/schema.js'

export interface AuthRequest extends Request {
  userId?: string
}

/**
 * Cache of "user id exists in DB" results so we don't pay an indexed lookup on
 * every authed request. TTL is short enough to invalidate within a minute of a
 * delete; the worst case if a user is deleted while their cache entry is fresh
 * is one extra request that fails with 500/FK — we'd surface that the same way
 * we did before this middleware learned to check existence.
 */
const userExistsCache = new Map<string, number>()
const USER_CACHE_TTL_MS = 60_000

async function userIdIsValid(userId: string): Promise<boolean> {
  const hit = userExistsCache.get(userId)
  const now = Date.now()
  if (hit && now - hit < USER_CACHE_TTL_MS) return true
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (row) {
    userExistsCache.set(userId, now)
    return true
  }
  return false
}

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

  // Reject tokens whose user has been deleted (e.g. after a reseed) so callers
  // get a clean "vuelve a iniciar sesión" path instead of a 500 from a later
  // FK violation when we try to insert with `author_id = decoded.userId`.
  const exists = await userIdIsValid(decoded.userId)
  if (!exists) {
    res.status(401).json({
      error: 'Sesión inválida. Vuelve a iniciar sesión.',
      code: 'USER_NOT_FOUND',
    })
    return
  }

  req.userId = decoded.userId
  next()
}
