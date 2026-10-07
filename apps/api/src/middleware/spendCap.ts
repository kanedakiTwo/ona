import type { NextFunction, Response } from 'express'
import type { AuthRequest } from './auth.js'
import { spendCapMessage, spendCapStatus } from '../services/spendCap.js'

/**
 * Put after authMiddleware on every route that pays a provider. 429
 * `SPEND_CAP_EXCEEDED` once the user's month is spent (services/spendCap.ts).
 * Admins are exempt (they run catalogue maintenance).
 */
export function requireSpendCapacity(
  status: typeof spendCapStatus = spendCapStatus,
) {
  return async function spendCapGuard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    const userId = req.userId
    if (!userId || req.user?.role === 'admin') return next()
    const cap = await status(userId)
    if (cap.exceeded) {
      res.status(429).json({
        error: spendCapMessage(cap.capEur),
        code: 'SPEND_CAP_EXCEEDED',
        spentEur: Math.round(cap.spentEur * 100) / 100,
        capEur: cap.capEur,
      })
      return
    }
    next()
  }
}
