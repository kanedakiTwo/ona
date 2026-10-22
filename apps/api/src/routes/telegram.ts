import { Router } from 'express'
import { env } from '../config/env.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { runWithCostUser } from '../services/costLedger.js'
import { isTelegramConfigured } from '../services/telegram/config.js'
import { enqueueTelegramUpdate } from '../services/telegram/inbound.js'
import { telegramStartLink } from '../services/telegram/linking.js'
import { TELEGRAM_SECRET_HEADER, verifyWebhookSecret } from '../services/telegram/secret.js'
import { parseTelegramUpdate } from '../services/telegram/updateParser.js'
import { buildTelegramDeps } from '../services/telegram/wiring.js'
import * as store from '../services/telegram/store.js'

/**
 * Mimo on Telegram (PRO-313, piece 1; specs/telegram.md). Off — every route
 * answers 404 — unless TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and
 * TELEGRAM_BOT_USERNAME are set. Nothing in the web offers it yet.
 */
const router = Router()

// POST /telegram/webhook — Telegram → Mimoia. Public; the shared secret
// header is the only proof the call comes from Telegram.
router.post('/telegram/webhook', (req, res) => {
  if (!isTelegramConfigured()) {
    res.sendStatus(404)
    return
  }
  if (!verifyWebhookSecret(req.get(TELEGRAM_SECRET_HEADER), env.TELEGRAM_WEBHOOK_SECRET)) {
    res.sendStatus(401)
    return
  }
  const msg = parseTelegramUpdate(req.body)
  // A fast 200 always (Telegram retries anything else); the turn runs after.
  res.sendStatus(200)
  if (!msg) return
  void runWithCostUser(null, () => enqueueTelegramUpdate(msg, buildTelegramDeps()), 'telegram')
})

// POST /telegram/link-code — one-time code + the t.me link that sends it.
// Off → 404 before auth: while off, the route doesn't exist for anyone.
router.post('/telegram/link-code', (req, res, next) => {
  if (!isTelegramConfigured()) {
    res.status(404).json({ error: 'Telegram no está disponible.', code: 'TELEGRAM_DISABLED' })
    return
  }
  next()
}, authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { code, expiresAt } = await store.createLinkCode(req.userId!)
    res.status(201).json({ expiresAt: expiresAt.toISOString(), url: telegramStartLink(env.TELEGRAM_BOT_USERNAME, code) })
  } catch (err: any) {
    console.error('[telegram] link-code error:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /telegram/link — disconnect this account's chat (works even with the channel off).
router.delete('/telegram/link', authMiddleware, async (req: AuthRequest, res) => {
  try {
    await store.unlink(req.userId!)
    res.sendStatus(204)
  } catch (err: any) {
    console.error('[telegram] unlink error:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
