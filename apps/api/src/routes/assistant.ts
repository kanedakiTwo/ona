import { Router } from 'express'
import { db } from '../db/connection.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { chat } from '../services/assistant/engine.js'
import type { ChatMessage } from '../services/assistant/types.js'
import { checkAdvisorBudget, recordAdvisorUsage } from '../services/advisorBudget.js'

const router = Router()

// All routes require auth
router.use(authMiddleware)

// POST /assistant/:userId/chat
router.post('/assistant/:userId/chat', async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.userId)

    // A caller may only chat as themselves — the chat loads this user's
    // context and bills this user's budget, so a mismatched id is a 403.
    if (userId !== req.userId) {
      res.status(403).json({ error: 'No puedes usar el asistente de otro usuario.' })
      return
    }

    const { message, history } = req.body

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' })
      return
    }

    // Monthly spend cap: reject before spending any tokens once the user has
    // burned through their euro budget for the month. Resets next month.
    const budget = await checkAdvisorBudget(userId, db)
    if (budget.exceeded) {
      const euros = (budget.budgetMicros / 1_000_000).toFixed(0)
      res.status(429).json({
        error: `Has alcanzado tu límite mensual del asistente (€${euros}). Se renueva el mes que viene.`,
        code: 'ADVISOR_BUDGET_EXCEEDED',
      })
      return
    }

    const chatHistory: ChatMessage[] = Array.isArray(history) ? history : []

    const { usage, ...response } = await chat(userId, message, chatHistory, db)

    // Meter this turn's real token cost against the monthly budget. Awaited so
    // the next request sees the updated total, but a metering failure must not
    // fail the chat the user already paid for — swallow and log.
    try {
      await recordAdvisorUsage(userId, usage, db)
    } catch (e) {
      console.warn('[assistant] recordAdvisorUsage failed (continuing):', e)
    }

    res.json(response)
  } catch (err: any) {
    console.error('Assistant chat error:', err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
