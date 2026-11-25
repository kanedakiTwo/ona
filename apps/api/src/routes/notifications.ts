/**
 * «Avisos» in Perfil (PRO-237, D-080; specs/notifications.md «Avisos»).
 *
 *   GET   /notifications/prefs — every alert kind, where it arrives, its switch
 *   PATCH /notifications/prefs — body { prefs?: { <kind>: boolean }, times?: { daily_brief|dinner_checkin: "HH:MM" | null } }
 *
 * Mimo's `get_alerts` / `set_alerts` call these same routes (D-051).
 */
import { Router } from 'express'
import { z } from 'zod'
import { ALERT_KINDS, ALERT_TIME_KINDS, alertTimeError, normalizeAlertTime, type AlertTimeKind } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { loadAlertsOverview, setAlertPrefs, setHouseholdAlertTime } from '../services/notifications/alertPrefs.js'
import { alertChanges, trackEvent } from '../services/usageEvents.js'

const router = Router()

const patchSchema = z
  .object({
    prefs: z.object(Object.fromEntries(ALERT_KINDS.map((k) => [k, z.boolean().optional()]))).strict().optional(),
    // PRO-1301: the household's time for the morning menu / dinner question; null = back to the default.
    times: z.object(Object.fromEntries(ALERT_TIME_KINDS.map((k) => [k, z.string().nullable().optional()]))).strict().optional(),
  })
  .refine((b) => b.prefs || b.times)

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
    res.status(400).json({ error: `Body inválido: { prefs?: { <${ALERT_KINDS.join('|')}>: boolean }, times?: { <${ALERT_TIME_KINDS.join('|')}>: "HH:MM" | null } }` })
    return
  }
  // PRO-1301: every time checked before anything is saved.
  const times = Object.entries(parsed.data.times ?? {}).filter(([, v]) => v !== undefined) as Array<[AlertTimeKind, string | null]>
  for (const [kind, raw] of times) {
    const error = raw === null ? null : alertTimeError(kind, normalizeAlertTime(raw))
    if (error) {
      res.status(400).json({ error })
      return
    }
  }
  try {
    for (const [kind, raw] of times) {
      if (!(await setHouseholdAlertTime(req.userId!, kind, raw === null ? null : normalizeAlertTime(raw)))) {
        res.status(409).json({ error: 'Tu cuenta no tiene hogar; no se ha guardado la hora.' })
        return
      }
      trackEvent('alerts_changed', { userId: req.userId!, props: { kind, time: raw === null ? 'por_defecto' : 'propia' } })
    }
    const before = await loadAlertsOverview(req.userId!)
    const after = await setAlertPrefs(req.userId!, (parsed.data.prefs ?? {}) as Record<string, boolean>)
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
