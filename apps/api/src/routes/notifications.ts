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
import { alertChanges, trackEvent } from '../services/usageEvents.js'

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
    const before = await loadAlertsOverview(req.userId!)
    const after = await setAlertPrefs(req.userId!, parsed.data.prefs as Record<string, boolean>)
    // PRO-216: kinds switched off here count in the weekly review too.
    const wasOn = new Set(before.kinds.filter((k) => k.on).map((k) => k.kind))
    for (const k of after.kinds) if (!k.on && wasOn.has(k.kind)) trackEvent('notifications_off', { userId: req.userId!, props: { kind: k.kind } })
    // PRO-120: every switch that changed, on or off.
    const onMap = (o: typeof before) => Object.fromEntries(o.kinds.map((k) => [k.kind, k.on]))
    for (const props of alertChanges(onMap(before), onMap(after))) trackEvent('alerts_changed', { userId: req.userId!, props })
    res.json(after)
  } catch (err: any) {
    console.error('[notifications] prefs write error:', err?.message ?? err)
    res.status(500).json({ error: 'No se pudieron guardar los avisos' })
  }
})

export default router
