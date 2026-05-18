/**
 * cook_logs REST surface — "esto lo cocinamos" events.
 *
 *   POST   /cook-logs                                — record a cook
 *   GET    /cook-logs                                — recent rows (limit ≤ 200)
 *   GET    /cook-logs/recipe/:recipeId               — { count, lastCookedAt } for the badge
 *   DELETE /cook-logs/:cookLogId                     — owner / household-member
 *
 * Scope: all reads run through `resolveScope` (PR 1B). See `specs/cook-log.md`.
 */

import { Router } from 'express'
import { z } from 'zod'
import { MEALS } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  recordCook,
  getRecipeCookStats,
  listRecentCookLogs,
  deleteCookLog,
} from '../services/cookLogStore.js'

const router = Router()
router.use(authMiddleware)

const MEAL_VALUES = new Set<string>(MEALS)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const recordSchema = z.object({
  recipeId: z.string().regex(UUID_RE, 'recipeId must be a UUID'),
  menuId: z.string().regex(UUID_RE).optional().nullable(),
  dayIndex: z.number().int().min(0).max(6).optional().nullable(),
  meal: z.string().refine((s) => MEAL_VALUES.has(s)).optional().nullable(),
  durationMin: z.number().int().positive().max(24 * 60).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  cookedAt: z.string().datetime().optional(),
})

router.post('/cook-logs', async (req: AuthRequest, res) => {
  try {
    const parsed = recordSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos invalidos', issues: parsed.error.issues })
      return
    }
    const cookedAt = parsed.data.cookedAt ? new Date(parsed.data.cookedAt) : undefined
    const id = await recordCook({
      userId: req.userId!,
      recipeId: parsed.data.recipeId,
      menuId: parsed.data.menuId ?? null,
      dayIndex: parsed.data.dayIndex ?? null,
      meal: parsed.data.meal ?? null,
      durationMin: parsed.data.durationMin ?? null,
      notes: parsed.data.notes ?? null,
      cookedAt,
    })
    res.status(201).json({ id })
  } catch (err) {
    console.error('POST /cook-logs error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/cook-logs', async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200)
    const rows = await listRecentCookLogs(req.userId!, limit)
    res.json(rows)
  } catch (err) {
    console.error('GET /cook-logs error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/cook-logs/recipe/:recipeId', async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.recipeId)
    if (!UUID_RE.test(recipeId)) {
      res.status(400).json({ error: 'recipeId must be a UUID' })
      return
    }
    const stats = await getRecipeCookStats(req.userId!, recipeId)
    res.json(stats)
  } catch (err) {
    console.error('GET /cook-logs/recipe/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/cook-logs/:cookLogId', async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.cookLogId)
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'cookLogId must be a UUID' })
      return
    }
    const deleted = await deleteCookLog(req.userId!, id)
    if (!deleted) {
      res.status(404).json({ error: 'Cook log not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    console.error('DELETE /cook-logs/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
