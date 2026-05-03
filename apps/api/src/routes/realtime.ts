import { Router } from 'express'
import { db } from '../db/connection.js'
import { env } from '../config/env.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { loadUserContext } from '../services/assistant/contextLoader.js'
import { buildSystemPrompt } from '../services/assistant/systemPrompt.js'
import { getRealtimeTools, executeTool } from '../services/realtime/tools.js'
import { checkQuota, recordSessionMinutes } from '../services/realtime/quota.js'
import { voiceTranscripts } from '../db/schema.js'

const router = Router()

router.use(authMiddleware)

// POST /realtime/:userId/session — issue an ephemeral OpenAI Realtime token
router.post('/realtime/:userId/session', async (req: AuthRequest, res) => {
  const userId = String(req.params.userId)

  if (req.userId && req.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const quota = checkQuota(userId)
  if (!quota.ok) {
    res.status(429).json({
      error: 'Has llegado al limite de voz por hoy. Vuelve manana o usa el chat de texto.',
      usedMinutes: quota.usedMinutes,
      limitMinutes: quota.limitMinutes,
    })
    return
  }

  if (!env.OPENAI_API_KEY) {
    res.status(503).json({ error: 'Realtime no esta configurado en el servidor (falta OPENAI_API_KEY).' })
    return
  }

  try {
    const userContext = await loadUserContext(userId, db)
    // mode='voice' layers in Spain Spanish register + voice-grade brevity.
    const instructions = buildSystemPrompt(userContext, 'voice')
    const tools = getRealtimeTools()

    const upstream = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_REALTIME_MODEL,
        voice: env.OPENAI_REALTIME_VOICE,
        instructions,
        tools,
        modalities: ['audio', 'text'],
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
      }),
    })

    if (!upstream.ok) {
      const text = await upstream.text()
      console.error('[realtime] OpenAI session creation failed:', upstream.status, text)
      res.status(502).json({ error: 'No se pudo iniciar la sesion de voz.' })
      return
    }

    const session: any = await upstream.json()
    res.json({
      client_secret: session.client_secret,
      expires_at: session.client_secret?.expires_at,
      model: env.OPENAI_REALTIME_MODEL,
      voice: env.OPENAI_REALTIME_VOICE,
      tools,
    })
  } catch (err: any) {
    console.error('[realtime] session error:', err.message)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /realtime/:userId/tool — execute a skill called by the Realtime model
router.post('/realtime/:userId/tool', async (req: AuthRequest, res) => {
  const userId = String(req.params.userId)

  if (req.userId && req.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const { name, params } = req.body ?? {}
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'name is required' })
    return
  }

  try {
    const result = await executeTool(name, params, { userId, db })
    res.json(result)
  } catch (err: any) {
    console.error('[realtime] tool execution error:', err.message)
    res.status(500).json({ error: 'Tool execution failed', summary: 'No pude ejecutar esa accion ahora.' })
  }
})

// POST /realtime/:userId/transcript — append-only log of a single voice turn
// (user or assistant). Called by the client after each turn completes. Failures
// are non-fatal; the client fires-and-forgets so a network blip doesn't break
// the conversation.
router.post('/realtime/:userId/transcript', async (req: AuthRequest, res) => {
  const userId = String(req.params.userId)

  if (req.userId && req.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const { sessionId, role, content, skillUsed, metadata } = req.body ?? {}

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'sessionId is required' })
    return
  }
  if (role !== 'user' && role !== 'assistant') {
    res.status(400).json({ error: "role must be 'user' or 'assistant'" })
    return
  }
  if (!content || typeof content !== 'string') {
    res.status(400).json({ error: 'content is required' })
    return
  }

  try {
    await db.insert(voiceTranscripts).values({
      userId,
      sessionId,
      role,
      content,
      skillUsed: typeof skillUsed === 'string' ? skillUsed : null,
      metadata: metadata && typeof metadata === 'object' ? metadata : {},
    })
    res.json({ ok: true })
  } catch (err: any) {
    console.error('[realtime] transcript log error:', err.message)
    // Don't 500 the client over a logging failure.
    res.status(202).json({ ok: false, warning: 'transcript_not_logged' })
  }
})

// POST /realtime/:userId/usage — client reports the duration of a finished session
router.post('/realtime/:userId/usage', async (req: AuthRequest, res) => {
  const userId = String(req.params.userId)

  if (req.userId && req.userId !== userId) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }

  const minutes = Number(req.body?.minutes)
  if (!Number.isFinite(minutes) || minutes < 0) {
    res.status(400).json({ error: 'minutes must be a non-negative number' })
    return
  }

  recordSessionMinutes(userId, minutes)
  res.json({ ok: true })
})

export default router
