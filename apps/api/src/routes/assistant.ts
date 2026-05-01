import { Router } from 'express'
import { db } from '../db/connection.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { chat } from '../services/assistant/engine.js'
import type { ChatMessage } from '../services/assistant/types.js'

const router = Router()

// All routes require auth
router.use(authMiddleware)

// POST /assistant/:userId/chat
router.post('/assistant/:userId/chat', async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.userId)
    const { message, history } = req.body

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' })
      return
    }

    const chatHistory: ChatMessage[] = Array.isArray(history) ? history : []

    const response = await chat(userId, message, chatHistory, db)

    res.json(response)
  } catch (err: any) {
    console.error('Assistant chat error:', err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
