import { Router } from 'express'
import { db } from '../db/connection.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { getSummary, askAdvisor } from '../services/advisor.js'

const router = Router()

// All routes require auth
router.use(authMiddleware)

// GET /advisor/:userId/summary
router.get('/advisor/:userId/summary', async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.userId)
    const weeks = parseInt(req.query.weeks as string, 10) || 4

    const summary = await getSummary(userId, weeks, db)

    res.json(summary)
  } catch (err) {
    console.error('Advisor summary error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /advisor/:userId/ask
router.post('/advisor/:userId/ask', async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.userId)
    const { question } = req.body

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Question is required' })
      return
    }

    const response = await askAdvisor(userId, question, db)

    res.json(response)
  } catch (err) {
    console.error('Advisor ask error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
