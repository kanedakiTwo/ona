/**
 * Chat read-aloud with ElevenLabs (services/tts.ts, specs/advisor.md → Voice).
 *
 *   GET  /tts/voices  → { enabled, voices: [{ key, name }], defaultVoice }
 *   POST /tts { text, voice? } → audio/mpeg (streamed)
 *
 * Per-route auth: this router is mounted before routers that apply auth to
 * everything after them.
 */
import { Readable } from 'node:stream'
import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { requireSpendCapacity } from '../middleware/spendCap.js'
import { speakableText, synthesize, TtsError, ttsVoices } from '../services/tts.js'

const router = Router()

// A reply read aloud is one request; 60 a minute per user is generous.
const ttsLimiter = rateLimit({
  max: 60,
  windowMs: 60_000,
  keyFn: (req) => (req as AuthRequest).userId ?? req.ip ?? 'unknown',
})

router.get('/tts/voices', authMiddleware, (_req, res) => {
  const voices = ttsVoices()
  res.json({ enabled: voices.length > 0, voices: voices.map(({ key, name }) => ({ key, name })), defaultVoice: voices[0]?.key ?? null })
})

const bodySchema = z.object({ text: z.string().min(1).max(20_000), voice: z.string().max(64).optional() })

router.post('/tts', authMiddleware, ttsLimiter, requireSpendCapacity(), async (req: AuthRequest, res) => {
  const voices = ttsVoices()
  if (!voices.length) {
    res.status(503).json({ error: 'La voz no está disponible', code: 'TTS_DISABLED' })
    return
  }
  const parsed = bodySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Texto no válido' })
    return
  }
  const voice = voices.find((v) => v.key === parsed.data.voice) ?? voices[0]
  const text = speakableText(parsed.data.text)
  if (!text) {
    res.status(204).end()
    return
  }
  try {
    const body = await synthesize(text, voice)
    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    Readable.fromWeb(body as any).pipe(res)
  } catch (err) {
    console.warn('[tts] failed:', (err as Error)?.message ?? err)
    res.status(err instanceof TtsError && err.status === 401 ? 503 : 502).json({ error: 'La voz ha fallado', code: 'TTS_FAILED' })
  }
})

export default router
