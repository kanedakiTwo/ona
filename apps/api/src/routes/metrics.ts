import { Router } from 'express'
import { metricsAuth, viaMetricsToken } from '../middleware/metricsAuth.js'
import { loadBusinessMetrics } from '../services/businessMetrics.js'
import { loadUsageReport } from '../services/usageReport.js'
import { loadAssistantFlags } from '../services/assistantFlags.js'
import { loadBasketGaps, loadBasketSends } from '../services/basketExtension.js'
import { flagsForAgents } from '../services/agentView.js'

/**
 * Read-only aggregates for Miguel and the Mimoia HQ agents. Admin JWT or
 * `x-metrics-token` (GET only):
 *   - GET /admin/metrics?weeks=8[&includeInternal=1] — weekly business metrics
 *     and cost per active household (specs/metrics.md);
 *   - GET /admin/usage?days=28[&includeInternal=1] — product analytics from
 *     `usage_events`: counts per day and event, active households, activation
 *     funnel (specs/metrics.md "Usage events");
 *   - GET /admin/assistant-reviews/flags?days=7 — anonymised conversation flags
 *     (health talk, health claims, unverified "hecho", errors) plus the daily
 *     reviewer's findings (specs/whatsapp.md); with the token, categories and
 *     severity only, no reply or note;
 *   - GET /admin/extension-gaps?days=7 — lo que la extensión del navegador no
 *     tenía en su tabla (búsqueda o fallo), sin usuarios (specs/shop-orders.md);
 *   - GET /admin/extension-sends?days=1 — un registro por envío a la extensión
 *     guardado esos días, sin hogar, usuario, envioId ni texto tecleado
 *     (specs/shop-orders.md). Las dos, con el nombre recortado (`publicLineName`).
 *
 * Own router, mounted in index.ts BEFORE the routers that `router.use(authMiddleware)`
 * as a catch-all — otherwise a token-only request would be 401'd before it
 * got here.
 */
const router = Router()

const intParam = (raw: unknown, def: number, min: number, max: number) => {
  const n = Number.parseInt(String(raw ?? def), 10)
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def
}
const flag = (raw: unknown) => raw === '1' || raw === 'true'

router.get('/admin/metrics', metricsAuth, async (req, res) => {
  try {
    const weeks = intParam(req.query.weeks, 8, 1, 52)
    res.json(await loadBusinessMetrics({ weeks, includeInternal: flag(req.query.includeInternal) }))
  } catch (err: any) {
    console.error('[metrics] failed:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/admin/usage', metricsAuth, async (req, res) => {
  try {
    const days = intParam(req.query.days, 28, 1, 180)
    res.json(await loadUsageReport({ days, includeInternal: flag(req.query.includeInternal) }))
  } catch (err: any) {
    console.error('[usage] report failed:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/admin/assistant-reviews/flags', metricsAuth, async (req, res) => {
  try {
    const days = intParam(req.query.days, 7, 1, 31)
    const report = await loadAssistantFlags({ days })
    // The agents' read token: categories and severity, no reply or note.
    res.json(viaMetricsToken(req) ? flagsForAgents(report) : report)
  } catch (err: any) {
    console.error('[assistant-flags] failed:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/admin/extension-gaps', metricsAuth, async (req, res) => {
  try {
    const days = intParam(req.query.days, 7, 1, 90)
    res.json({ days, gaps: await loadBasketGaps(days) })
  } catch (err: any) {
    console.error('[extension-gaps] failed:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/admin/extension-sends', metricsAuth, async (req, res) => {
  try {
    const days = intParam(req.query.days, 1, 1, 90)
    res.json({ days, sends: await loadBasketSends(days) })
  } catch (err: any) {
    console.error('[extension-sends] failed:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
