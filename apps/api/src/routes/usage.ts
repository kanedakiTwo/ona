import { Router } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { deviceFromUserAgent, recordInstalledOpen } from '../services/appInstalls.js'
import { trackEvent } from '../services/usageEvents.js'

/**
 * Usage signals the web sends itself (specs/metrics.md "App instalada y avisos"):
 *   POST /usage/app-opened — the app was opened installed (display-mode
 *   standalone). No body; the device (android / ios / desktop) is deduced
 *   from the request's browser and only that word is stored. One event per
 *   household and Madrid day, however many times it is called. 204 always
 *   (analytics never fails the app).
 *   POST /usage/invite-shared — a tap on «Invitar a otro hogar» (WhatsApp or
 *   «Copiar»), or Mimo handing out the link (PRO-163). Counted as
 *   `invite_shared`, only the number: no props. Body `{ channel? }`
 *   (`web` by default, `whatsapp` from Mimo there). 204 always.
 */
const router = Router()

router.post('/usage/app-opened', authMiddleware, async (req: AuthRequest, res) => {
  await recordInstalledOpen(req.userId!, deviceFromUserAgent(req.get('user-agent')))
  res.status(204).end()
})

router.post('/usage/invite-shared', authMiddleware, (req: AuthRequest, res) => {
  trackEvent('invite_shared', { userId: req.userId!, channel: req.body?.channel === 'whatsapp' ? 'whatsapp' : 'web' })
  res.status(204).end()
})

export default router
