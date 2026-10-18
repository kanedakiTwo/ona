/**
 * «Avisos» in Perfil (PRO-237, D-080; specs/notifications.md «Avisos»).
 *
 *   GET   /notifications/prefs — every alert kind, where it arrives, its switch
 *   PATCH /notifications/prefs — body { prefs: { <kind>: boolean } }
 *
 * Mimo's `get_alerts` / `set_alerts` call these same routes (D-051).
 */
import { Router } from 'express'
import { z } from 'zod'
import { ALERT_KINDS } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { loadAlertsOverview, setAlertPrefs } from '../services/notifications/alertPrefs.js'

const router = Router()

const patchSchema = z.object({
  prefs: z.object(Object.fromEntries(ALERT_KINDS.map((k) => [k, z.boolean().optional()]))).strict(),
})

router.get('/notifications/prefs', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json(await loadAlertsOverview(req.userId!))
  } catch (err: any) {
    console.error('[notifications] prefs read error:', err?.message ?? err)
    res.status(500).json({ error: 'No se pudieron cargar los avisos' })
  }
})

router.patch('/notifications/prefs', authMiddleware, async (req: AuthRequest, res) => {
  const parsed = patchSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: `Body inválido: { prefs: { <${ALERT_KINDS.join('|')}>: boolean } }` })
    return
  }
  try {
    res.json(await setAlertPrefs(req.userId!, parsed.data.prefs as Record<string, boolean>))
  } catch (err: any) {
    console.error('[notifications] prefs write error:', err?.message ?? err)
    res.status(500).json({ error: 'No se pudieron guardar los avisos' })
  }
})

export default router
