/**
 * «Tu ficha» (PRO-317, D-064, D-110; specs/household-profile.md → «Tu ficha»).
 * Everything on the caller's primary household, filtered with the ficha's
 * visibility (a member's health only to that member; a `child` member: 403).
 *
 *   GET    /household/profile                       → FichaView
 *   GET    /household/profile/facts/:id/why         → FichaWhyView
 *   POST   /household/profile/facts/:id/confirm     «Así es»
 *   POST   /household/profile/facts/:id/correct     { text, validUntil? } → { kind: 'value' | 'note' }
 *   DELETE /household/profile/facts/:id             «Olvidar»
 *   GET    /household/profile/changes?days=60       → FichaChangeView[]
 *   POST   /household/profile/changes/:id/undo      «Deshacer» (what Mimo did)
 *   POST   /household/profile/questions/:id         { answer: 'yes' | 'no' | 'later' }
 *   PUT    /household/profile/learning              { paused } «Aprender de lo que hago»
 *   POST   /household/profile/persons               { alias, ageBand }
 *   PATCH  /household/profile/persons/:id           { alias, ageBand }
 *   DELETE /household/profile/persons/:id
 *   GET    /household/profile/export                «Descargar mi ficha»
 *
 * Per-route auth, mounted before the catch-all routers. Mimo's tools reach the
 * same actions over loopback (PRO-319, D-051).
 */
import { Router, type Response } from 'express'
import { z } from 'zod'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { interpretCorrection } from '../services/profile/correction.js'
import {
  FichaError,
  addPerson,
  answerQuestion,
  confirmFact,
  correctFact,
  correctFactWithNote,
  exportFicha,
  factForCorrection,
  forgetFact,
  loadFichaChanges,
  loadFichaView,
  loadFichaWhy,
  removePerson,
  setLearningPaused,
  undoChange,
  updatePerson,
} from '../services/profile/fichaStore.js'

const router = Router()

function fail(res: Response, err: unknown, what: string) {
  if (err instanceof FichaError) {
    res.status(err.status).json({ error: err.message, code: err.code })
    return
  }
  console.error(`[ficha] ${what} failed:`, err)
  res.status(500).json({ error: 'Internal server error' })
}

const correctSchema = z.object({
  text: z.string().trim().min(2).max(600),
  validUntil: z.string().datetime({ offset: true }).nullable().optional(),
})
const answerSchema = z.object({ answer: z.enum(['yes', 'no', 'later']) })
const learningSchema = z.object({ paused: z.boolean() })
const personSchema = z.object({ alias: z.string().trim().min(1).max(40), ageBand: z.string() })

router.get('/household/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json(await loadFichaView(req.userId!))
  } catch (err) {
    fail(res, err, 'view')
  }
})

router.get('/household/profile/facts/:id/why', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json(await loadFichaWhy(req.userId!, String(req.params.id)))
  } catch (err) {
    fail(res, err, 'why')
  }
})

router.post('/household/profile/facts/:id/confirm', authMiddleware, async (req: AuthRequest, res) => {
  try {
    await confirmFact(req.userId!, String(req.params.id))
    res.json({ ok: true })
  } catch (err) {
    fail(res, err, 'confirm')
  }
})

router.post('/household/profile/facts/:id/correct', authMiddleware, validate(correctSchema), async (req: AuthRequest, res) => {
  try {
    const factId = String(req.params.id)
    const current = await factForCorrection(req.userId!, factId)
    const text = String(req.body.text)
    const out = await interpretCorrection({ type: current.type, currentValue: current.value, currentSentence: current.sentence, text, userId: req.userId! })
    const validUntil = req.body.validUntil === undefined ? undefined : req.body.validUntil ? new Date(req.body.validUntil) : null
    if (out.kind === 'value') await correctFact(req.userId!, factId, { value: out.value, validUntil, text })
    else await correctFactWithNote(req.userId!, factId, { note: out.note, text })
    res.json({ kind: out.kind })
  } catch (err) {
    fail(res, err, 'correct')
  }
})

router.delete('/household/profile/facts/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    await forgetFact(req.userId!, String(req.params.id))
    res.status(204).end()
  } catch (err) {
    fail(res, err, 'forget')
  }
})

router.get('/household/profile/changes', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 60))
    res.json(await loadFichaChanges(req.userId!, { days }))
  } catch (err) {
    fail(res, err, 'changes')
  }
})

router.post('/household/profile/changes/:id/undo', authMiddleware, async (req: AuthRequest, res) => {
  try {
    await undoChange(req.userId!, String(req.params.id))
    res.json({ ok: true })
  } catch (err) {
    fail(res, err, 'undo')
  }
})

router.post('/household/profile/questions/:id', authMiddleware, validate(answerSchema), async (req: AuthRequest, res) => {
  try {
    await answerQuestion(req.userId!, String(req.params.id), req.body.answer)
    res.json({ ok: true })
  } catch (err) {
    fail(res, err, 'answer')
  }
})

router.put('/household/profile/learning', authMiddleware, validate(learningSchema), async (req: AuthRequest, res) => {
  try {
    res.json({ paused: await setLearningPaused(req.userId!, req.body.paused) })
  } catch (err) {
    fail(res, err, 'learning')
  }
})

router.post('/household/profile/persons', authMiddleware, validate(personSchema), async (req: AuthRequest, res) => {
  try {
    res.status(201).json(await addPerson(req.userId!, req.body))
  } catch (err) {
    fail(res, err, 'add person')
  }
})

router.patch('/household/profile/persons/:id', authMiddleware, validate(personSchema), async (req: AuthRequest, res) => {
  try {
    res.json(await updatePerson(req.userId!, String(req.params.id), req.body))
  } catch (err) {
    fail(res, err, 'update person')
  }
})

router.delete('/household/profile/persons/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    await removePerson(req.userId!, String(req.params.id))
    res.status(204).end()
  } catch (err) {
    fail(res, err, 'remove person')
  }
})

router.get('/household/profile/export', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const data = await exportFicha(req.userId!)
    res.setHeader('Content-Disposition', `attachment; filename="mi-ficha-mimoia-${data.exportedAt.slice(0, 10)}.json"`)
    res.json(data)
  } catch (err) {
    fail(res, err, 'export')
  }
})

export default router
