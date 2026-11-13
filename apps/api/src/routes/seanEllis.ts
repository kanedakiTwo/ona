import { Router, type RequestHandler } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  SEAN_ELLIS_ANSWERS,
  SEAN_ELLIS_OPTIONS,
  SEAN_ELLIS_QUESTION,
  SEAN_ELLIS_WHY,
  createDbSeanEllisStore,
  seanEllisChannel,
  seanEllisDue,
  type SeanEllisAnswer,
  type SeanEllisStore,
} from '../services/seanEllisSurvey.js'

/**
 * The Sean Ellis survey (PRO-334, specs/feedback.md).
 *
 *   GET  /sean-ellis           auth: { show } (+ question, options and «¿Por qué?» when the /menu card is due)
 *   POST /sean-ellis           auth: { answer, why?, channel? } → one opinion tagged `sean_ellis`, once
 *   POST /sean-ellis/dismiss   auth: «Ahora no» — never shown again
 *
 * Per-route auth (no catch-all): mounted before the `router.use(authMiddleware)` routers.
 */
export interface SeanEllisRouteDeps {
  store: SeanEllisStore
  now: () => Date
  auth: RequestHandler
  adminEmails?: readonly string[]
  testDomains?: readonly string[]
}

const CHANNELS = ['app', 'chat', 'whatsapp'] as const

export function createSeanEllisRouter(overrides: Partial<SeanEllisRouteDeps> = {}): Router {
  const d: SeanEllisRouteDeps = {
    store: createDbSeanEllisStore(),
    now: () => new Date(),
    auth: authMiddleware as RequestHandler,
    ...overrides,
  }
  const rules = (now: Date) => ({ now, adminEmails: d.adminEmails, testDomains: d.testDomains })
  const router = Router()

  router.get('/sean-ellis', d.auth, async (req: AuthRequest, res) => {
    const now = d.now()
    const state = await d.store.load(req.userId!, now)
    const show = !!state && seanEllisChannel(state, rules(now)) === 'web'
    res.json(show ? { show, question: SEAN_ELLIS_QUESTION, options: SEAN_ELLIS_OPTIONS, why: SEAN_ELLIS_WHY } : { show })
  })

  router.post('/sean-ellis', d.auth, async (req: AuthRequest, res) => {
    const body = req.body ?? {}
    const answer = body.answer as SeanEllisAnswer
    if (!(SEAN_ELLIS_ANSWERS as readonly string[]).includes(answer)) {
      res.status(400).json({ error: 'Elige una de las cuatro respuestas.' })
      return
    }
    const channel = (CHANNELS as readonly string[]).includes(body.channel) ? (body.channel as (typeof CHANNELS)[number]) : 'app'
    const why = typeof body.why === 'string' ? body.why.trim().slice(0, 2000) : ''
    const now = d.now()
    const state = await d.store.load(req.userId!, now)
    // Only whoever was asked (WhatsApp, the card) or is due: the counts stay the survey's.
    if (!state || !(state.askedAt || seanEllisDue(state, rules(now)))) {
      res.status(409).json({ error: 'NOT_ASKED' })
      return
    }
    const label = SEAN_ELLIS_OPTIONS.find((o) => o.key === answer)!.label
    const saved = await d.store.saveAnswer(req.userId!, { channel, answer, text: why ? `${label}. ${why}` : label }, now)
    res.json({ ok: true, saved })
  })

  router.post('/sean-ellis/dismiss', d.auth, async (req: AuthRequest, res) => {
    await d.store.claim(req.userId!, d.now())
    res.json({ ok: true })
  })

  return router
}

export default createSeanEllisRouter()
