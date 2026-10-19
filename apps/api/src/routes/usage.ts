import { Router } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { deviceFromUserAgent, recordInstalledOpen } from '../services/appInstalls.js'

/**
 * Usage signals the web sends itself (specs/metrics.md "App instalada y avisos"):
 *   POST /usage/app-opened — the app was opened installed (display-mode
 *   standalone). No body; the device (android / ios / desktop) is deduced
 *   from the request's browser and only that word is stored. One event per
 *   household and Madrid day, however many times it is called. 204 always
 *   (analytics never fails the app).
 *   POST /usage/cook-mode-started — cook mode was opened on the web
 *   (PRO-188). No body; the `trackUsageRoutes` middleware records
 *   `cook_mode_started` (channel web) on the 204. Nothing else is stored.
 */
const router = Router()

router.post('/usage/app-opened', authMiddleware, async (req: AuthRequest, res) => {
  await recordInstalledOpen(req.userId!, deviceFromUserAgent(req.get('user-agent')))
  res.status(204).end()
})

router.post('/usage/cook-mode-started', authMiddleware, (_req: AuthRequest, res) => {
  res.status(204).end()
})

export default router
