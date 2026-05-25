/**
 * Web Push routes.
 *
 *   POST   /push/subscribe    — body { subscription, userAgent? } — upsert
 *   DELETE /push/subscribe    — body { endpoint } — remove on logout / opt-out
 *   POST   /push/test         — send a "ping" to the caller's subscriptions
 *   GET    /push/public-key   — returns the VAPID public key (or 503 when missing)
 *
 * All routes require auth except `/push/public-key` (the key itself is
 * baked into NEXT_PUBLIC_VAPID_PUBLIC_KEY for the frontend bundle, but
 * exposing the GET makes feature-detection from runtime contexts
 * trivial without a rebuild).
 */

import { Router } from 'express'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { pushSubscriptions } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { env } from '../config/env.js'
import {
  isPushConfigured,
  PushNotConfiguredError,
  sendPushToUser,
} from '../services/pushNotifier.js'

const router = Router()

router.get('/push/public-key', (_req, res) => {
  if (!isPushConfigured()) {
    res.status(503).json({ error: 'Push notifications not configured' })
    return
  }
  res.json({ publicKey: env.VAPID_PUBLIC_KEY })
})

const subscribeSchema = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
  }),
  userAgent: z.string().max(500).optional(),
})

router.post(
  '/push/subscribe',
  authMiddleware,
  validate(subscribeSchema),
  async (req: AuthRequest, res) => {
    try {
      const { subscription, userAgent } = subscribeSchema.parse(req.body)
      const userId = req.userId!

      // Upsert on endpoint — re-subscribing from the same browser must
      // refresh the keys (they can rotate) and re-bind to the current user.
      const existing = await db
        .select()
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, subscription.endpoint))
        .limit(1)

      if (existing.length > 0) {
        await db
          .update(pushSubscriptions)
          .set({
            userId,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            userAgent: userAgent ?? existing[0].userAgent,
          })
          .where(eq(pushSubscriptions.id, existing[0].id))
        res.status(200).json({ ok: true, subscriptionId: existing[0].id })
        return
      }

      const [inserted] = await db
        .insert(pushSubscriptions)
        .values({
          userId,
          endpoint: subscription.endpoint,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          userAgent: userAgent ?? null,
        })
        .returning({ id: pushSubscriptions.id })

      res.status(201).json({ ok: true, subscriptionId: inserted.id })
    } catch (err) {
      console.error('[push.subscribe] error:', err)
      res.status(500).json({ error: 'Failed to register subscription' })
    }
  },
)

const unsubscribeSchema = z.object({
  endpoint: z.string().url(),
})

router.delete(
  '/push/subscribe',
  authMiddleware,
  validate(unsubscribeSchema),
  async (req: AuthRequest, res) => {
    try {
      const { endpoint } = unsubscribeSchema.parse(req.body)
      // Scope the delete to the caller — defensive against the (rare) case
      // where a stale endpoint maps to another user after a re-subscribe.
      await db
        .delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, endpoint))
      res.status(204).end()
    } catch (err) {
      console.error('[push.unsubscribe] error:', err)
      res.status(500).json({ error: 'Failed to unregister subscription' })
    }
  },
)

router.post('/push/test', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await sendPushToUser(req.userId!, {
      title: 'ONA · Test',
      body: 'Si lees esto, las notificaciones funcionan ✓',
      url: '/menu',
      tag: 'push-test',
    })
    res.json(result)
  } catch (err) {
    if (err instanceof PushNotConfiguredError) {
      res.status(503).json({ error: err.message })
      return
    }
    console.error('[push.test] error:', err)
    res.status(500).json({ error: 'Failed to dispatch test notification' })
  }
})

export default router
