import express, { Router } from 'express'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { users } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { isUserAllowed, isWhatsAppConfigured } from '../services/whatsapp/config.js'
import { verifySignature } from '../services/whatsapp/signature.js'
import { parseWebhookPayload } from '../services/whatsapp/webhookParser.js'
import { enqueueInbound } from '../services/whatsapp/inbound.js'
import { buildInboundDeps, initialInboundBody } from '../services/whatsapp/wiring.js'
import * as store from '../services/whatsapp/store.js'
import { buildWaLink, linkMessageText, maskPhone } from '../services/whatsapp/linking.js'

// ─── Public webhook (Meta → ONA) ─────────────────────────────────
//
// Mounted in index.ts BEFORE `express.json()`: the signature is an HMAC of
// the raw bytes, so this router reads the body itself with `express.raw`.
export const whatsappWebhookRouter = Router()

// GET handshake when the webhook URL is saved in the Meta dashboard.
whatsappWebhookRouter.get('/whatsapp/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  if (
    env.WHATSAPP_VERIFY_TOKEN &&
    mode === 'subscribe' &&
    token === env.WHATSAPP_VERIFY_TOKEN &&
    typeof challenge === 'string'
  ) {
    res.status(200).type('text/plain').send(challenge)
    return
  }
  res.sendStatus(403)
})

whatsappWebhookRouter.post(
  '/whatsapp/webhook',
  express.raw({ type: '*/*', limit: '2mb' }),
  async (req, res) => {
    if (!isWhatsAppConfigured()) {
      res.sendStatus(503)
      return
    }
    const raw: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (!verifySignature(raw, req.get('x-hub-signature-256'), env.WHATSAPP_APP_SECRET)) {
      res.sendStatus(401)
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(raw.toString('utf8'))
    } catch {
      res.sendStatus(400)
      return
    }

    try {
      // Persist first: the unique wamid drops Meta's retries, and a crash
      // after the 200 leaves a trace ('received') instead of nothing.
      const fresh = []
      for (const msg of parseWebhookPayload(payload)) {
        if (await store.insertInbound(msg, initialInboundBody(msg))) fresh.push(msg)
      }
      // Ack immediately — Meta expects a fast 200 and retries otherwise. The
      // assistant (which can take several seconds) runs after the response.
      res.sendStatus(200)
      if (fresh.length > 0) {
        const deps = buildInboundDeps()
        for (const msg of fresh) void enqueueInbound(msg, deps)
      }
    } catch (err: any) {
      console.error('[whatsapp] webhook persist failed:', err?.message ?? err)
      if (!res.headersSent) res.sendStatus(500)
    }
  },
)

// ─── Authed management endpoints (/profile card) ────────────────
const router = Router()

async function loadEmail(userId: string): Promise<string | null> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  return row?.email ?? null
}

async function isAvailableFor(userId: string): Promise<boolean> {
  return isWhatsAppConfigured() && isUserAllowed(await loadEmail(userId))
}

// GET /whatsapp/status — what the profile card renders.
router.get('/whatsapp/status', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const available = await isAvailableFor(req.userId!)
    const link = await store.getLinkByUser(req.userId!)
    const botNumber = env.WHATSAPP_DISPLAY_NUMBER || null
    res.json({
      available,
      linked: Boolean(link),
      phone: link ? maskPhone(link.phone) : null,
      notify: link?.notify ?? false,
      chatLink: available && link && botNumber ? buildWaLink(botNumber) : null,
    })
  } catch (err: any) {
    console.error('[whatsapp] status error:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /whatsapp/link-code — one-time code + wa.me deep link with it prefilled.
router.post('/whatsapp/link-code', authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!(await isAvailableFor(req.userId!))) {
      res.status(403).json({ error: 'WhatsApp no está disponible para tu cuenta.', code: 'WHATSAPP_UNAVAILABLE' })
      return
    }
    const { code, expiresAt } = await store.createLinkCode(req.userId!)
    const botNumber = env.WHATSAPP_DISPLAY_NUMBER
    res.status(201).json({
      code,
      expiresAt: expiresAt.toISOString(),
      message: linkMessageText(code),
      waLink: botNumber ? buildWaLink(botNumber, linkMessageText(code)) : null,
    })
  } catch (err: any) {
    console.error('[whatsapp] link-code error:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const patchLinkSchema = z.object({ notify: z.boolean() })

// PATCH /whatsapp/link — toggle proactive messages.
router.patch('/whatsapp/link', authMiddleware, async (req: AuthRequest, res) => {
  const parsed = patchLinkSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Body inválido: { notify: boolean }' })
    return
  }
  try {
    const ok = await store.setNotify(req.userId!, parsed.data.notify)
    if (!ok) {
      res.status(404).json({ error: 'No tienes WhatsApp conectado.' })
      return
    }
    res.json({ notify: parsed.data.notify })
  } catch (err: any) {
    console.error('[whatsapp] patch link error:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /whatsapp/link — disconnect this account's phone.
router.delete('/whatsapp/link', authMiddleware, async (req: AuthRequest, res) => {
  try {
    await store.unlink(req.userId!)
    res.sendStatus(204)
  } catch (err: any) {
    console.error('[whatsapp] unlink error:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
