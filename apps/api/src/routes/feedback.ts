import { Router, type RequestHandler } from 'express'
import { desc, eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/connection.js'
import { userFeedback, users } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { metricsAuth, viaMetricsToken } from '../middleware/metricsAuth.js'
import { feedbackForAgents, feedbackTagCounts } from '../services/agentView.js'

/**
 * Beta feedback (specs/feedback.md).
 *
 *   POST /feedback          auth: { text, page?, channel? } → saved verbatim
 *   GET  /admin/feedback    admin JWT (with who sent it) or x-metrics-token
 *                           (agents: counts by channel, page and tag, and
 *                           possible allergies; no text, no identity)
 *
 * Per-route auth (no catch-all): mounted before the `router.use(authMiddleware)` routers.
 */

export const FEEDBACK_CHANNELS = ['app', 'chat', 'whatsapp'] as const
export type FeedbackChannel = (typeof FEEDBACK_CHANNELS)[number]

export const feedbackSchema = z.object({
  text: z.string().trim().min(2).max(2000),
  page: z.string().trim().max(200).nullish(),
  channel: z.enum(FEEDBACK_CHANNELS).default('app'),
})

export interface FeedbackRow {
  id: string
  channel: FeedbackChannel
  text: string
  page: string | null
  /** What it answers ('sobras', PRO-285), or null. */
  tag?: string | null
  createdAt: Date
  username?: string
  email?: string
}

export interface FeedbackRepo {
  save(userId: string, f: { text: string; page: string | null; channel: FeedbackChannel }): Promise<void>
  list(since: Date, limit: number): Promise<FeedbackRow[]>
}

export function createDbFeedbackRepo(): FeedbackRepo {
  return {
    async save(userId, f) {
      await db.insert(userFeedback).values({ userId, ...f })
    },
    async list(since, limit) {
      const rows = await db
        .select({
          id: userFeedback.id,
          channel: userFeedback.channel,
          text: userFeedback.text,
          page: userFeedback.page,
          tag: userFeedback.tag,
          createdAt: userFeedback.createdAt,
          username: users.username,
          email: users.email,
        })
        .from(userFeedback)
        .innerJoin(users, eq(users.id, userFeedback.userId))
        .where(gte(userFeedback.createdAt, since))
        .orderBy(desc(userFeedback.createdAt))
        .limit(limit)
      return rows.map((r) => ({ ...r, channel: r.channel as FeedbackChannel }))
    },
  }
}

export function createFeedbackRouter(
  overrides: Partial<{ repo: FeedbackRepo; auth: RequestHandler; readAuth: RequestHandler; now: () => Date }> = {},
): Router {
  const d = {
    repo: createDbFeedbackRepo(),
    auth: authMiddleware as RequestHandler,
    readAuth: metricsAuth,
    now: () => new Date(),
    ...overrides,
  }
  const router = Router()

  router.post('/feedback', d.auth, async (req: AuthRequest, res) => {
    const parsed = feedbackSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Cuéntanos algo (hasta 2000 caracteres).' })
      return
    }
    await d.repo.save(req.userId!, { text: parsed.data.text, page: parsed.data.page ?? null, channel: parsed.data.channel })
    res.status(201).json({ ok: true })
  })

  // ?days=N (default 30, max 365) &limit=N (default 200, max 1000)
  router.get('/admin/feedback', d.readAuth, async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365)
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000)
    const rows = await d.repo.list(new Date(d.now().getTime() - days * 86_400_000), limit)
    // The agents' read token gets counts only: no text, no identity (specs/feedback.md).
    if (viaMetricsToken(req)) {
      res.json(feedbackForAgents(days, rows))
      return
    }
    // byTag: the answers to Mimo's questions, e.g. { sobras: 3 } (PRO-285).
    res.json({ days, count: rows.length, byTag: feedbackTagCounts(rows), items: rows })
  })

  return router
}

export default createFeedbackRouter()
