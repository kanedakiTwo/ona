import { Router } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { deviceFromUserAgent, recordInstalledOpen } from '../services/appInstalls.js'
import { clientEventProps, recordClientEvent, trackEvent } from '../services/usageEvents.js'

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
 *   POST /usage/invite-shared — a tap on «Invitar a otro hogar» (WhatsApp or
 *   «Copiar»), or Mimo handing out the link (PRO-163). Counted as
 *   `invite_shared`, only the number: no props. Body `{ channel? }`
 *   (`web` by default, `whatsapp` from Mimo there). 204 always.
 *   POST /usage/event — what the web sees and the API can't (PRO-120):
 *   `{ name, props }` with `name` one of CLIENT_USAGE_EVENTS (onboarding_step,
 *   screen_viewed, recipe_viewed, taste_tuning, push_opened) and props from
 *   closed lists only (`clientEventProps`; anything else is dropped). The
 *   once-per-day cap of screens and sign-up steps is applied here, per person
 *   and Madrid day: the browser keeps nothing. 200 `{ counted }` always
 *   (false = invalid or already counted today).
 */
const router = Router()

router.post('/usage/app-opened', authMiddleware, async (req: AuthRequest, res) => {
  await recordInstalledOpen(req.userId!, deviceFromUserAgent(req.get('user-agent')))
  res.status(204).end()
})

router.post('/usage/cook-mode-started', authMiddleware, (_req: AuthRequest, res) => {
  res.status(204).end()
})

router.post('/usage/invite-shared', authMiddleware, (req: AuthRequest, res) => {
  trackEvent('invite_shared', { userId: req.userId!, channel: req.body?.channel === 'whatsapp' ? 'whatsapp' : 'web' })
  res.status(204).end()
})

router.post('/usage/event', authMiddleware, async (req: AuthRequest, res) => {
  const ev = clientEventProps(req.body?.name, req.body?.props)
  res.json({ counted: ev ? await recordClientEvent(req.userId!, ev) : false })
})

export default router
