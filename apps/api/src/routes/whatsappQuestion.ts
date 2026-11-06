/**
 * «Pregunta única por WhatsApp», admin side (PRO-1091, specs/whatsapp.md):
 *
 *   GET  /admin/whatsapp-question            admin JWT: the questions sent, with sent / failed / answered
 *   POST /admin/whatsapp-question/preview    admin JWT: { text, signedUpFrom, signedUpTo, inactiveDays } → the count
 *   POST /admin/whatsapp-question/send       admin JWT: the same + expectedCount → sends it (audited)
 *
 * The send goes only if the count is still the one the admin saw (409 with
 * the new one otherwise). Rules in services/whatsapp/oneOffQuestion.ts.
 */
import { Router, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { record } from '../services/auditLog.js'
import {
  QUESTION_MAX_CHARS,
  QUESTION_MIN_CHARS,
  listQuestions,
  previewQuestion,
  questionParam,
  sendQuestion,
  type QuestionDeps,
} from '../services/whatsapp/oneOffQuestion.js'

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const groupSchema = z
  .object({
    text: z.string().transform(questionParam).pipe(z.string().min(QUESTION_MIN_CHARS).max(QUESTION_MAX_CHARS)),
    signedUpFrom: isoDay,
    signedUpTo: isoDay,
    inactiveDays: z.number().int().min(0).max(365),
  })
  .refine((g) => g.signedUpFrom <= g.signedUpTo, { message: 'range' })
const sendSchema = groupSchema.and(z.object({ expectedCount: z.number().int().min(0) }))

const BAD_GROUP = `Escribe la pregunta (de ${QUESTION_MIN_CHARS} a ${QUESTION_MAX_CHARS} caracteres), las fechas de alta (desde ≤ hasta) y los días sin actividad (0 a 365).`

export function createWhatsAppQuestionRouter(deps: QuestionDeps = {}): Router {
  const router = Router()
  const admin = [authMiddleware as RequestHandler, requireAdmin as RequestHandler]

  router.get('/admin/whatsapp-question', ...admin, async (_req, res: Response) => {
    try {
      res.json({ questions: await listQuestions(deps) })
    } catch (err: any) {
      console.error('[pregunta-unica] list failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.post('/admin/whatsapp-question/preview', ...admin, async (req: AuthRequest, res: Response) => {
    const parsed = groupSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: BAD_GROUP })
      return
    }
    const { text, ...filter } = parsed.data
    try {
      const p = await previewQuestion(text, filter, deps)
      res.json({ count: p.count, excluded: p.excluded, template: p.template, configured: p.configured })
    } catch (err: any) {
      console.error('[pregunta-unica] preview failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.post('/admin/whatsapp-question/send', ...admin, async (req: AuthRequest, res: Response) => {
    const parsed = sendSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: BAD_GROUP })
      return
    }
    const { text, expectedCount, ...filter } = parsed.data
    try {
      const out = await sendQuestion(text, filter, expectedCount, req.userId!, deps)
      if (out.status === 'unavailable') {
        res.status(409).json({
          error:
            out.reason === 'no_template'
              ? 'Falta la plantilla «pregunta_unica» en WHATSAPP_TEMPLATES: no se ha enviado nada.'
              : 'WhatsApp no está configurado: no se ha enviado nada.',
          reason: out.reason,
        })
        return
      }
      if (out.status === 'count_changed') {
        res.status(409).json({ error: `El recuento ha cambiado: ahora son ${out.count}. Revísalo y vuelve a enviar.`, reason: 'count_changed', count: out.count })
        return
      }
      await record({
        adminId: req.userId!,
        action: 'whatsapp_question.send',
        targetType: 'whatsapp_question',
        targetId: out.questionId,
        payload: { text, filter, sent: out.sent, failed: out.failed, skipped: out.skipped, remaining: out.remaining },
      })
      res.json({ sent: out.sent, failed: out.failed, skipped: out.skipped, remaining: out.remaining })
    } catch (err: any) {
      console.error('[pregunta-unica] send failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

export default createWhatsAppQuestionRouter()
