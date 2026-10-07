import { Router } from 'express'
import { metricsAuth } from '../middleware/metricsAuth.js'
import { loadBusinessMetrics } from '../services/businessMetrics.js'

/**
 * GET /admin/metrics?weeks=8[&includeInternal=1] — weekly business metrics and
 * cost per active household (specs/metrics.md). Admin JWT or `x-metrics-token`.
 *
 * Own router, mounted in index.ts BEFORE the routers that `router.use(authMiddleware)`
 * as a catch-all — otherwise a token-only request would be 401'd before it
 * got here.
 */
const router = Router()

router.get('/admin/metrics', metricsAuth, async (req, res) => {
  try {
    const raw = Number.parseInt(String(req.query.weeks ?? '8'), 10)
    const weeks = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 52) : 8
    const includeInternal = req.query.includeInternal === '1' || req.query.includeInternal === 'true'
    res.json(await loadBusinessMetrics({ weeks, includeInternal }))
  } catch (err: any) {
    console.error('[metrics] failed:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
