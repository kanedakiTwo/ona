/**
 * «Pregunta por correo», admin side (PRO-1197, specs/admin-dashboard.md):
 *
 *   GET  /admin/email-question        admin JWT: the exact count, why the rest are out, what went out
 *   POST /admin/email-question/send   admin JWT: { body, expectedCount } → sends it (audited)
 *
 * The send goes only if the count is still the one the admin saw (409 with
 * the new one otherwise). Rules in services/emailQuestion.ts.
 */
import { Router, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { record } from '../services/auditLog.js'
import {
  BODY_MAX_CHARS,
  BODY_MIN_CHARS,
  EMAIL_QUESTION_CAMPAIGN,
  INACTIVE_DAYS,
  QUESTION_FROM_NAME,
  QUESTION_SUBJECT,
  QUESTION_FOOTER,
  cleanBody,
  previewEmailQuestion,
  sendEmailQuestion,
  type EmailQuestionDeps,
} from '../services/emailQuestion.js'

const sendSchema = z.object({
  body: z.string().transform(cleanBody).pipe(z.string().min(BODY_MIN_CHARS).max(BODY_MAX_CHARS)),
  expectedCount: z.number().int().min(1),
})

export function createEmailQuestionRouter(deps: EmailQuestionDeps = {}): Router {
  const router = Router()
  const admin = [authMiddleware as RequestHandler, requireAdmin as RequestHandler]

  router.get('/admin/email-question', ...admin, async (_req, res: Response) => {
    try {
      const p = await previewEmailQuestion(deps)
      res.json({
        count: p.count,
        excluded: p.excluded,
        configured: p.configured,
        inactiveDays: INACTIVE_DAYS,
        sent: p.sent,
        failed: p.failed,
        lastSentAt: p.lastSentAt,
        // What is fixed; the body comes from the admin.
        email: { subject: QUESTION_SUBJECT, from: QUESTION_FROM_NAME, footer: QUESTION_FOOTER, minChars: BODY_MIN_CHARS, maxChars: BODY_MAX_CHARS },
      })
    } catch (err: any) {
      console.error('[pregunta-correo] preview failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.post('/admin/email-question/send', ...admin, async (req: AuthRequest, res: Response) => {
    const parsed = sendSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: `Pega el texto del correo (de ${BODY_MIN_CHARS} a ${BODY_MAX_CHARS} caracteres) y vuelve a enviar.` })
      return
    }
    try {
      const out = await sendEmailQuestion(parsed.data.body, parsed.data.expectedCount, deps)
      if (out.status === 'unavailable') {
        res.status(409).json({ error: 'El correo no está configurado (RESEND_API_KEY): no se ha enviado nada.', reason: out.reason })
        return
      }
      if (out.status === 'count_changed') {
        res.status(409).json({ error: `El recuento ha cambiado: ahora son ${out.count}. Revísalo antes de enviar.`, reason: 'count_changed', count: out.count })
        return
      }
      await record({
        adminId: req.userId!,
        action: 'email_question.send',
        targetType: 'email_question',
        targetId: EMAIL_QUESTION_CAMPAIGN,
        payload: { expectedCount: parsed.data.expectedCount, body: parsed.data.body, sent: out.sent, failed: out.failed, skipped: out.skipped },
      })
      res.json({ sent: out.sent, failed: out.failed, skipped: out.skipped })
    } catch (err: any) {
      console.error('[pregunta-correo] send failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

export default createEmailQuestionRouter()
