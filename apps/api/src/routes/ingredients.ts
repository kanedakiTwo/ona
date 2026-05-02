import { Router } from 'express'
import { z } from 'zod'
import { eq, like, count, asc, desc, sql } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { updateIngredientSchema, AISLES, type Aisle } from '@ona/shared'
import {
  suggestIngredient,
  levenshtein,
  normalizeForDedupe,
} from '../services/ingredientAutoCreate.js'
import { createUsdaClient } from '../services/nutrition/usdaClient.js'
import { inferAllergenTagsFromName } from '../services/nutrition/allergens.js'

const router = Router()

const autoCreateBodySchema = z.object({
  name: z.string().min(1).max(120),
  fdcId: z.number().int().positive().nullable().optional(),
  aisle: z.enum(AISLES).nullable().optional(),
  density: z.number().positive().nullable().optional(),
  unitWeight: z.number().positive().nullable().optional(),
})

// GET /ingredients - list with pagination, sort, search
router.get('/ingredients', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage as string) || 20))
    const sort = (req.query.sort as string) || 'name'
    const search = req.query.search as string | undefined
    const offset = (page - 1) * perPage

    const where = search ? like(ingredients.name, `%${search}%`) : undefined

    // Total count
    const [{ total }] = await db
      .select({ total: count() })
      .from(ingredients)
      .where(where)

    // Determine sort column and direction
    const sortDesc = sort.startsWith('-')
    const sortField = sortDesc ? sort.slice(1) : sort
    const sortColumn = sortField in ingredients
      ? (ingredients as Record<string, any>)[sortField]
      : ingredients.name
    const orderFn = sortDesc ? desc(sortColumn) : asc(sortColumn)

    const rows = await db
      .select()
      .from(ingredients)
      .where(where)
      .orderBy(orderFn)
      .limit(perPage)
      .offset(offset)

    res.set('X-Total-Count', String(total))
    res.json(rows)
  } catch (err) {
    console.error('List ingredients error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /ingredients/suggest?name=alcaparras
//   Returns USDA candidates + suggested aisle/allergens for a (Spanish) name.
//   IMPORTANT: registered BEFORE `/ingredients/:id` so Express doesn't try to
//   parse "suggest" as a UUID.
router.get('/ingredients/suggest', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const name = (req.query.name as string | undefined)?.trim()
    if (!name) {
      res.status(400).json({ error: 'Missing required query param: name' })
      return
    }
    const limit = Math.max(1, Math.min(10, parseInt(req.query.limit as string) || 5))
    const suggestion = await suggestIngredient(name, { limit })
    res.json(suggestion)
  } catch (err) {
    console.error('Suggest ingredient error:', err)
    const status = (err as { status?: number })?.status === 429 ? 429 : 500
    res.status(status).json({
      error:
        status === 429
          ? 'USDA rate limit exceeded; try again shortly.'
          : 'Internal server error',
    })
  }
})

// POST /ingredients/auto-create
//   Body: { name, fdcId?, aisle?, density?, unitWeight? }
//   - If `fdcId` provided: fetch USDA profile, persist with full per-100 g
//     nutrition + inferred allergens.
//   - Else: persist as a stub row (all-zero nutrition, allergens inferred,
//     fdcId NULL).
//   - Fuzzy dedupe (Levenshtein ≤ 2 on normalized name) against existing rows;
//     if it hits, return the existing row + `dedupedFrom`.
router.post('/ingredients/auto-create', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const parsed = autoCreateBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues })
      return
    }
    const { name, fdcId, aisle, density, unitWeight } = parsed.data

    // ── Fuzzy dedupe ─────────────────────────────────────────
    const inputNorm = normalizeForDedupe(name)
    const existing = await db.select().from(ingredients)
    for (const row of existing) {
      const rowNorm = normalizeForDedupe(row.name)
      if (rowNorm === inputNorm) {
        res.json({ ingredient: row, dedupedFrom: name })
        return
      }
      if (Math.abs(rowNorm.length - inputNorm.length) > 3) continue
      if (levenshtein(rowNorm, inputNorm) <= 2) {
        res.json({ ingredient: row, dedupedFrom: name })
        return
      }
    }

    // ── Build the row ────────────────────────────────────────
    const allergens = inferAllergenTagsFromName(name)
    let nutrition = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
      salt: 0,
    }
    let resolvedFdc: number | null = null

    if (typeof fdcId === 'number') {
      try {
        const client = createUsdaClient()
        const profile = await client.fetchByFdcId(fdcId)
        nutrition = {
          calories: profile.per100g.kcal,
          protein: profile.per100g.proteinG,
          carbs: profile.per100g.carbsG,
          fat: profile.per100g.fatG,
          fiber: profile.per100g.fiberG,
          salt: profile.per100g.saltG,
        }
        resolvedFdc = fdcId
      } catch (err) {
        console.warn(`[auto-create] USDA fetch failed for fdc=${fdcId}, persisting stub:`, err)
      }
    }

    const [inserted] = await db
      .insert(ingredients)
      .values({
        name: name.trim(),
        fdcId: resolvedFdc,
        aisle: (aisle ?? null) as Aisle | null,
        density: density ?? null,
        unitWeight: unitWeight ?? null,
        allergenTags: allergens,
        calories: nutrition.calories,
        protein: nutrition.protein,
        carbs: nutrition.carbs,
        fat: nutrition.fat,
        fiber: nutrition.fiber,
        salt: nutrition.salt,
      })
      .returning()

    res.status(201).json({ ingredient: inserted })
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === '23505') {
      try {
        const inputName = (req.body?.name as string | undefined)?.trim() ?? ''
        const [hit] = await db
          .select()
          .from(ingredients)
          .where(eq(ingredients.name, inputName))
          .limit(1)
        if (hit) {
          res.json({ ingredient: hit, dedupedFrom: inputName })
          return
        }
      } catch {
        /* fall through */
      }
    }
    console.error('Auto-create ingredient error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /ingredients/:id - single ingredient with all nutritional data
router.get('/ingredients/:id', async (req, res) => {
  try {
    const [ingredient] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, String(req.params.id)))
      .limit(1)

    if (!ingredient) {
      res.status(404).json({ error: 'Ingredient not found' })
      return
    }

    res.json(ingredient)
  } catch (err) {
    console.error('Get ingredient error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /ingredients/:id - update ingredient (auth required)
router.put('/ingredients/:id', authMiddleware, validate(updateIngredientSchema), async (req: AuthRequest, res) => {
  try {
    const [updated] = await db
      .update(ingredients)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(ingredients.id, String(req.params.id)))
      .returning()

    if (!updated) {
      res.status(404).json({ error: 'Ingredient not found' })
      return
    }

    res.json(updated)
  } catch (err) {
    console.error('Update ingredient error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /ingredients/:id - delete ingredient (auth required, fail if used in recipes)
router.delete('/ingredients/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    // Check if ingredient is used in any recipe
    const [usage] = await db
      .select({ total: count() })
      .from(recipeIngredients)
      .where(eq(recipeIngredients.ingredientId, String(req.params.id)))

    if (usage.total > 0) {
      res.status(409).json({
        error: 'Cannot delete ingredient: it is used in recipes',
        recipeCount: usage.total,
      })
      return
    }

    const [deleted] = await db
      .delete(ingredients)
      .where(eq(ingredients.id, String(req.params.id)))
      .returning({ id: ingredients.id })

    if (!deleted) {
      res.status(404).json({ error: 'Ingredient not found' })
      return
    }

    res.status(204).send()
  } catch (err) {
    console.error('Delete ingredient error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
