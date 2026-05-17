import { Router } from 'express'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { authMiddleware } from '../middleware/auth.js'
import { resolveUnit } from '../services/unitResolver.js'
import { db } from '../db/connection.js'
import { ingredients } from '../db/schema.js'

const router = Router()

const schema = z.object({
  displayQuantity: z.number().min(0),
  displayUnit: z.string().min(1).max(40),
  // Accept both `null` and omission — older clients may send either.
  ingredientId: z.string().uuid().nullable().optional(),
})

// POST /units/resolve — return canonical (g/ml/u) for a display (display_unit, qty)
// pair. Used by the /recipes/new form when the user types a free-form unit.
router.post('/units/resolve', authMiddleware, async (req, res) => {
  try {
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues })
      return
    }
    const { displayQuantity, displayUnit, ingredientId } = parsed.data

    // Pre-load ingredient row so the resolver can apply density/unitWeight
    // for ingredient-specific conversions (e.g. ml→g for liquids).
    let ingredient:
      | { id: string; name?: string; density?: number | null; unitWeight?: number | null }
      | undefined
    if (ingredientId) {
      const [row] = await db
        .select({
          id: ingredients.id,
          name: ingredients.name,
          density: ingredients.density,
          unitWeight: ingredients.unitWeight,
        })
        .from(ingredients)
        .where(eq(ingredients.id, ingredientId))
        .limit(1)
      if (row) {
        ingredient = {
          id: row.id,
          name: row.name,
          density: row.density,
          unitWeight: row.unitWeight,
        }
      }
    }

    const result = await resolveUnit({ displayQuantity, displayUnit, ingredient })
    res.json(result)
  } catch (err) {
    console.error('POST /units/resolve error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
