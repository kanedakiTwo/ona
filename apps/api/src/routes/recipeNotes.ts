/**
 * Recipe notes REST surface (PR 7).
 *
 *   GET /recipes/:recipeId/notes  — load the caller's household notes
 *   PUT /recipes/:recipeId/notes  — upsert partial body { notes?, rating?, substitutions? }
 *
 * Household-scoped (one row per (household, recipe)). 200 / null for the
 * "never written" state so the client can render an empty form. Any
 * household member can read or write.
 */

import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  getRecipeNotesForUser,
  listCustomTagsForHousehold,
  NoHouseholdError,
  upsertRecipeNotes,
  validateRating,
} from '../services/recipeNotesStore.js'
import { ingredientOverrideSchema } from '@ona/shared'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const router = Router()
router.use(authMiddleware)

const patchSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  rating: z.number().nullable().optional(),
  substitutions: z.string().max(2000).nullable().optional(),
  /** Free-form household tags ("vegano", "para Sara", "rápido"). The store
   *  sanitizes (lowercase + trim + dedupe + cap). Accepts up to 32 raw
   *  entries; the sanitizer caps the persisted result at 10. */
  customTags: z.array(z.string().max(60)).max(32).nullable().optional(),
  /** Structured ingredient overrides — see `IngredientOverride` in
   *  `@ona/shared`. The store sanitizes (dedup, drop invalid, cap at 50). */
  ingredientOverrides: z.array(ingredientOverrideSchema).max(100).nullable().optional(),
})

router.get('/custom-tags', async (req: AuthRequest, res) => {
  try {
    const rows = await listCustomTagsForHousehold(req.userId!)
    res.json(rows)
  } catch (err) {
    console.error('GET /custom-tags error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/recipes/:recipeId/notes', async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.recipeId)
    if (!UUID_RE.test(recipeId)) {
      res.status(400).json({ error: 'recipeId must be a UUID' })
      return
    }
    const row = await getRecipeNotesForUser(req.userId!, recipeId)
    // Always 200 — null body means "no notes yet". Saves the client a
    // 404-branch when rendering an empty form.
    res.json(row)
  } catch (err) {
    console.error('GET /recipes/:id/notes error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/recipes/:recipeId/notes', async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.recipeId)
    if (!UUID_RE.test(recipeId)) {
      res.status(400).json({ error: 'recipeId must be a UUID' })
      return
    }
    const parsed = patchSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos invalidos', issues: parsed.error.issues })
      return
    }
    if (parsed.data.rating !== undefined) {
      const r = validateRating(parsed.data.rating)
      if (!r.ok) {
        res.status(400).json({ error: r.reason })
        return
      }
    }
    const row = await upsertRecipeNotes(req.userId!, recipeId, parsed.data)
    res.json(row)
  } catch (err) {
    if (err instanceof NoHouseholdError) {
      res.status(400).json({ error: err.message, code: 'NO_HOUSEHOLD' })
      return
    }
    console.error('PUT /recipes/:id/notes error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
