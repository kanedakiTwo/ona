/**
 * Mimo's ears in the app (D-023, specs/advisor.md → Voice): the browser
 * records what the user says and sends it here; the text goes to the same
 * Claude assistant as typed messages.
 *
 *   POST /stt  multipart `audio` (≤ 10 MB) → { text }
 *
 * Per-route auth (mounted before routers that apply auth to everything after them).
 */
import { Router } from 'express'
import multer from 'multer'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { requireSpendCapacity } from '../middleware/spendCap.js'
import { runWithCostUser } from '../services/costLedger.js'
import { isSttConfigured, transcribeAudio } from '../services/stt.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^audio\//.test(file.mimetype)),
})

const sttLimiter = rateLimit({
  max: 60,
  windowMs: 60_000,
  keyFn: (req) => (req as AuthRequest).userId ?? req.ip ?? 'unknown',
})

router.post('/stt', authMiddleware, sttLimiter, requireSpendCapacity(), upload.single('audio'), async (req: AuthRequest, res) => {
  if (!isSttConfigured()) {
    res.status(503).json({ error: 'La transcripción no está disponible', code: 'STT_DISABLED' })
    return
  }
  const file = req.file
  if (!file || file.size < 1000) {
    res.status(400).json({ error: 'No se ha recibido audio' })
    return
  }
  try {
    // multer's stream callbacks drop authMiddleware's cost context; re-enter it.
    const text = await runWithCostUser(req.userId ?? null, () => transcribeAudio(file.buffer, file.mimetype, { feature: 'mimo_voice_transcription' }))
    res.json({ text: text.trim() })
  } catch (err) {
    console.warn('[stt] failed:', (err as Error)?.message ?? err)
    res.status(502).json({ error: 'No te he entendido. Prueba otra vez.', code: 'STT_FAILED' })
  }
})

export default router
