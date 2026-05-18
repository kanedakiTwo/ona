/**
 * household_staples REST surface (PR 10B).
 *
 *   GET    /staples                   — list (active + paused, in order)
 *   POST   /staples                   — add a staple
 *   PATCH  /staples/:id               — partial update (name/qty/unit/aisle/price/active)
 *   DELETE /staples/:id               — hard delete
 *
 * Scope: every operation hits the caller's primary household. Any
 * household member can add / edit / delete — same model as the cook log.
 */

import { Router } from 'express'
import { z } from 'zod'
import { AISLES } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  addStapleForUser,
  deleteStapleForUser,
  listStaplesForUser,
  NoHouseholdError,
  patchStapleForUser,
} from '../services/staplesStore.js'

const BUYABLE_UNITS = new Set<string>(['g', 'ml', 'u', 'cda', 'cdita'])
const AISLE_SET = new Set<string>(AISLES)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const addSchema = z.object({
  name: z.string().min(1).max(80),
  quantity: z.number().positive().max(10_000).optional(),
  unit: z.string().refine((u) => BUYABLE_UNITS.has(u)).optional(),
  aisle: z.string().refine((a) => AISLE_SET.has(a)).optional(),
  pricePerUnit: z.number().nonnegative().max(10_000).nullable().optional(),
})

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  quantity: z.number().positive().max(10_000).optional(),
  unit: z.string().refine((u) => BUYABLE_UNITS.has(u)).optional(),
  aisle: z.string().refine((a) => AISLE_SET.has(a)).optional(),
  pricePerUnit: z.number().nonnegative().max(10_000).nullable().optional(),
  active: z.boolean().optional(),
})

const router = Router()
router.use(authMiddleware)

router.get('/staples', async (req: AuthRequest, res) => {
  try {
    const rows = await listStaplesForUser(req.userId!)
    res.json(rows)
  } catch (err) {
    console.error('GET /staples error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/staples', async (req: AuthRequest, res) => {
  try {
    const parsed = addSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos invalidos', issues: parsed.error.issues })
      return
    }
    const row = await addStapleForUser(req.userId!, {
      name: parsed.data.name,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit as any,
      aisle: parsed.data.aisle as any,
      pricePerUnit: parsed.data.pricePerUnit ?? null,
    })
    res.status(201).json(row)
  } catch (err) {
    if (err instanceof NoHouseholdError) {
      res.status(400).json({ error: err.message, code: 'NO_HOUSEHOLD' })
      return
    }
    console.error('POST /staples error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/staples/:id', async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id)
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'id must be a UUID' })
      return
    }
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos invalidos', issues: parsed.error.issues })
      return
    }
    const row = await patchStapleForUser(req.userId!, id, {
      ...parsed.data,
      unit: parsed.data.unit as any,
      aisle: parsed.data.aisle as any,
    })
    if (!row) {
      res.status(404).json({ error: 'Staple not found' })
      return
    }
    res.json(row)
  } catch (err) {
    console.error('PATCH /staples error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/staples/:id', async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id)
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'id must be a UUID' })
      return
    }
    const ok = await deleteStapleForUser(req.userId!, id)
    if (!ok) {
      res.status(404).json({ error: 'Staple not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    console.error('DELETE /staples error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
