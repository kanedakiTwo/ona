/**
 * PRO-205: the «Afina tu menú» notice in the app (specs/taste.md → «Aviso a
 * los hogares afectados»).
 *
 *   GET  /notices/afina          → { show, text } for the caller's household
 *   POST /notices/afina/dismiss  → «Entendido»: closed for the whole household
 *   GET  /notices/afina/stats    → aggregates for the brief (admin or metrics token)
 *
 * Per-route auth.
 */
import { Router } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { metricsAuth } from '../middleware/metricsAuth.js'
import { AFINA_NOTICE_TEXT, dismissNotice, noticeForUser, noticeStats } from '../services/afinaNotice.js'

const router = Router()

router.get('/notices/afina', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const n = await noticeForUser(req.userId!)
    res.json(n?.show ? { show: true, text: AFINA_NOTICE_TEXT } : { show: false })
  } catch (err) {
    console.error('[notices] afina error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/notices/afina/dismiss', authMiddleware, async (req: AuthRequest, res) => {
  try {
    await dismissNotice(req.userId!)
    res.json({ ok: true })
  } catch (err) {
    console.error('[notices] afina dismiss error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/notices/afina/stats', metricsAuth, async (_req, res) => {
  try {
    res.json(await noticeStats())
  } catch (err) {
    console.error('[notices] afina stats error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
