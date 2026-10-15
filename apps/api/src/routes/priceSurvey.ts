import { Router, type RequestHandler } from 'express'
import { PRICE_QUESTIONS, PRICE_SURVEY_INTRO, PRICE_SURVEY_TITLE, priceSurveySchema } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { metricsAuth } from '../middleware/metricsAuth.js'
import {
  buildPriceSurveyReport,
  createDbPriceSurveyRepo,
  shouldShowPriceSurvey,
  type PriceSurveyRepo,
} from '../services/priceSurvey.js'

/**
 * Beta price survey (specs/billing.md).
 *
 *   GET  /price-survey            auth: { show } (+ the copy and questions when show)
 *   POST /price-survey            auth: the four answers (€/month, each optional)
 *   POST /price-survey/dismiss    auth: «Ahora no» — never shown again
 *   GET  /admin/price-survey      admin JWT or x-metrics-token: distributions, no personal data
 *
 * Per-route auth (no catch-all): mounted before the `router.use(authMiddleware)` routers.
 */
export interface PriceSurveyDeps {
  repo: PriceSurveyRepo
  now: () => Date
  auth: RequestHandler
  readAuth: RequestHandler
}

export function createPriceSurveyRouter(overrides: Partial<PriceSurveyDeps> = {}): Router {
  const d: PriceSurveyDeps = {
    repo: createDbPriceSurveyRepo(),
    now: () => new Date(),
    auth: authMiddleware as RequestHandler,
    readAuth: metricsAuth,
    ...overrides,
  }
  const router = Router()

  router.get('/price-survey', d.auth, async (req: AuthRequest, res) => {
    const [createdAt, record] = await Promise.all([d.repo.userCreatedAt(req.userId!), d.repo.get(req.userId!)])
    const show = shouldShowPriceSurvey({ userCreatedAt: createdAt, record, now: d.now() })
    res.json(show ? { show, title: PRICE_SURVEY_TITLE, intro: PRICE_SURVEY_INTRO, questions: PRICE_QUESTIONS } : { show })
  })

  router.post('/price-survey', d.auth, async (req: AuthRequest, res) => {
    const parsed = priceSurveySchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Escribe cada precio en euros al mes (por ejemplo, 5 o 4,50).' })
      return
    }
    await d.repo.answer(req.userId!, parsed.data, d.now())
    res.json({ ok: true })
  })

  router.post('/price-survey/dismiss', d.auth, async (req: AuthRequest, res) => {
    await d.repo.dismiss(req.userId!, d.now())
    res.json({ ok: true })
  })

  router.get('/admin/price-survey', d.readAuth, async (_req, res) => {
    res.json(buildPriceSurveyReport(await d.repo.answered()))
  })

  return router
}

export default createPriceSurveyRouter()
