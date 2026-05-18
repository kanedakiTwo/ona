/**
 * pantry_items REST surface (PR 11).
 *
 *   GET    /pantry             — list household pantry
 *   POST   /pantry             — add (upsert when ingredient_id given)
 *   PATCH  /pantry/:id         — partial update
 *   DELETE /pantry/:id         — remove
 *
 * Household-scoped: every operation hits the caller's primary household.
 */

import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  addPantryForUser,
  deletePantryForUser,
  listPantryForUser,
  NoHouseholdError,
  patchPantryForUser,
} from '../services/pantryStore.js'

const BUYABLE_UNITS = new Set<string>(['g', 'ml', 'u', 'cda', 'cdita', 'kg', 'l'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const addSchema = z.object({
  name: z.string().min(1).max(80),
  quantity: z.number().nonnegative().max(100_000).optional(),
  unit: z.string().refine((u) => BUYABLE_UNITS.has(u)).optional(),
  ingredientId: z.string().regex(UUID_RE).nullable().optional(),
  expiresAt: z.string().regex(DATE_RE).nullable().optional(),
})

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  quantity: z.number().nonnegative().max(100_000).optional(),
  unit: z.string().refine((u) => BUYABLE_UNITS.has(u)).optional(),
  expiresAt: z.string().regex(DATE_RE).nullable().optional(),
})

const router = Router()
router.use(authMiddleware)

router.get('/pantry', async (req: AuthRequest, res) => {
  try {
    const rows = await listPantryForUser(req.userId!)
    res.json(rows)
  } catch (err) {
    console.error('GET /pantry error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/pantry', async (req: AuthRequest, res) => {
  try {
    const parsed = addSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos invalidos', issues: parsed.error.issues })
      return
    }
    const row = await addPantryForUser(req.userId!, {
      name: parsed.data.name,
      quantity: parsed.data.quantity,
      unit: parsed.data.unit as any,
      ingredientId: parsed.data.ingredientId ?? null,
      expiresAt: parsed.data.expiresAt ?? null,
    })
    res.status(201).json(row)
  } catch (err) {
    if (err instanceof NoHouseholdError) {
      res.status(400).json({ error: err.message, code: 'NO_HOUSEHOLD' })
      return
    }
    console.error('POST /pantry error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/pantry/:id', async (req: AuthRequest, res) => {
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
    const row = await patchPantryForUser(req.userId!, id, {
      ...parsed.data,
      unit: parsed.data.unit as any,
    })
    if (!row) {
      res.status(404).json({ error: 'Pantry item not found' })
      return
    }
    res.json(row)
  } catch (err) {
    console.error('PATCH /pantry error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/pantry/:id', async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id)
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'id must be a UUID' })
      return
    }
    const ok = await deletePantryForUser(req.userId!, id)
    if (!ok) {
      res.status(404).json({ error: 'Pantry item not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    console.error('DELETE /pantry error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
