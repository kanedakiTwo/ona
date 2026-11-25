/**
 * PRO-1290 — admin routes on a household (specs/admin-dashboard.md). Admin JWT
 * (`authMiddleware` + `requireAdmin`); every change lands in `admin_audit_log`.
 *
 *   PUT /admin/households/:id/mimo-cap   { capEur: number | null } → the household's monthly
 *                                        Mimo cap in euros, up to 3× its plan's (400 TOO_HIGH);
 *                                        null takes it back to the plan's
 */
import express, { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { setHouseholdMimoCap, type MimoCapResult } from '../services/householdMimoCap.js'

export interface AdminHouseholdsDeps {
  adminAuth: RequestHandler[]
  setMimoCap: (householdId: string, capEur: number | null, adminId: string) => Promise<MimoCapResult>
}

const uuid = z.string().uuid()
const NOT_FOUND = { error: 'Ese hogar no existe.', code: 'NOT_FOUND' }

const mimoCapSchema = z
  .object({
    capEur: z.number().positive('El tope tiene que ser mayor que 0 (o null para volver al del plan).').max(10_000).nullable(),
  })
  .strict()

export function createAdminHouseholdsRouter(overrides: Partial<AdminHouseholdsDeps> = {}): Router {
  const d: AdminHouseholdsDeps = {
    adminAuth: [authMiddleware as RequestHandler, requireAdmin as RequestHandler],
    setMimoCap: (householdId, capEur, adminId) => setHouseholdMimoCap(householdId, capEur, adminId),
    ...overrides,
  }
  const router = Router()

  router.put('/admin/households/:id/mimo-cap', ...d.adminAuth, express.json(), async (req: AuthRequest, res) => {
    if (!uuid.safeParse(req.params.id).success) return void res.status(404).json(NOT_FOUND)
    const body = mimoCapSchema.safeParse(req.body)
    if (!body.success) {
      const problems = body.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
      return void res.status(400).json({ error: problems[0], code: 'INVALID_CAP', problems })
    }
    const capEur = body.data.capEur == null ? null : Math.round(body.data.capEur * 100) / 100
    try {
      const r = await d.setMimoCap(String(req.params.id), capEur, req.userId!)
      if (r.ok) {
        return void res.json({
          householdId: r.householdId,
          capEur: r.capEur,
          previousEur: r.previousEur,
          planCapEur: r.planCapEur,
          maxEur: r.maxEur,
          changed: r.changed,
        })
      }
      if (r.code === 'TOO_HIGH') {
        return void res.status(400).json({
          error: `El tope no puede pasar de ${r.maxEur} € (3 veces los ${r.planCapEur} € de su plan).`,
          code: 'TOO_HIGH',
          maxEur: r.maxEur,
          planCapEur: r.planCapEur,
        })
      }
      res.status(404).json(NOT_FOUND)
    } catch (err) {
      console.error('[admin/households] mimo cap failed:', (err as Error)?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

export default createAdminHouseholdsRouter()
