import { Router } from 'express'
import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { eq, like, count, asc, desc, sql } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import {
  updateIngredientSchema,
  AISLES,
  nutritionPerServingSchema,
  type Aisle,
} from '@ona/shared'
import {
  suggestIngredient,
  levenshtein,
  normalizeForDedupe,
} from '../services/ingredientAutoCreate.js'
import { createUsdaClient } from '../services/nutrition/usdaClient.js'
import { fetchBedcaNutrition } from '../services/nutrition/bedcaClient.js'
import { inferAllergenTagsFromName } from '../services/nutrition/allergens.js'
import { env } from '../config/env.js'

const router = Router()

const rawNutritionSchema = z.object({
  kcal: z.number().min(0).max(900),
  proteinG: z.number().min(0).max(100),
  carbsG: z.number().min(0).max(100),
  fatG: z.number().min(0).max(100),
  fiberG: z.number().min(0).max(100),
  saltG: z.number().min(0).max(50),
})

const autoCreateBodySchema = z.object({
  name: z.string().min(1).max(120),
  fdcId: z.number().int().positive().nullable().optional(),
  bedcaId: z.string().min(1).max(50).nullable().optional(),
  /** Raw per-100 g nutrition for the manual / estimated path. */
  nutrition: rawNutritionSchema.nullable().optional(),
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
    // Optional `query` override: curators use this to refine a poor
    // automatic translation. When present, we send it verbatim to USDA.
    const query = (req.query.query as string | undefined)?.trim() || undefined
    const suggestion = await suggestIngredient(name, { limit, query })
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
    const { name, fdcId, bedcaId, nutrition: rawNutrition, aisle, density, unitWeight } =
      parsed.data

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

    // Source priority: explicit fdcId > bedcaId > raw nutrition > stub.
    // Only one of these branches runs.
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
    } else if (typeof bedcaId === 'string' && bedcaId.length > 0) {
      try {
        const per100g = await fetchBedcaNutrition(bedcaId)
        nutrition = {
          calories: per100g.kcal,
          protein: per100g.proteinG,
          carbs: per100g.carbsG,
          fat: per100g.fatG,
          fiber: per100g.fiberG,
          salt: per100g.saltG,
        }
        // Leave resolvedFdc null — BEDCA-sourced rows are flagged by
        // `fdc_id IS NULL` plus non-zero nutrition.
      } catch (err) {
        console.warn(`[auto-create] BEDCA fetch failed for id=${bedcaId}, persisting stub:`, err)
      }
    } else if (rawNutrition) {
      nutrition = {
        calories: rawNutrition.kcal,
        protein: rawNutrition.proteinG,
        carbs: rawNutrition.carbsG,
        fat: rawNutrition.fatG,
        fiber: rawNutrition.fiberG,
        salt: rawNutrition.saltG,
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

// Shared helper: ask Claude for per-100 g values for a name.
// Returns the validated nutrition or throws an Error with a 4xx-ish message.
async function estimateNutritionForName(
  promptName: string,
): Promise<{ kcal: number; proteinG: number; carbsG: number; fatG: number; fiberG: number; saltG: number }> {
  if (!env.ANTHROPIC_API_KEY) {
    const e = new Error(
      'La estimación con ONA no está disponible (falta ANTHROPIC_API_KEY).',
    ) as Error & { status?: number }
    e.status = 503
    throw e
  }
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const prompt = `Eres un nutricionista. Dame los valores por 100g de "${promptName}". Si es producto compuesto (caldo, salsa, embutido), estima conservadoramente. Responde SOLO JSON: {"kcal": n, "proteinG": n, "carbsG": n, "fatG": n, "fiberG": n, "saltG": n}. Sin texto adicional.`
  const response = await client.messages.create({
    // Opus is overkill for a 6-number response, but the spec calls for
    // accuracy here — these values land in the catalog and influence
    // every recipe that uses the ingredient. Worth the extra cents.
    model: 'claude-opus-4-6',
    max_tokens: 200,
    messages: [{ role: 'user', content: prompt }],
  })
  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') {
    const e = new Error('Respuesta vacía del modelo.') as Error & { status?: number }
    e.status = 502
    throw e
  }
  const text = block.text.trim()
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) {
    const e = new Error('El modelo no devolvió JSON válido.') as Error & {
      status?: number
    }
    e.status = 400
    throw e
  }
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(m[0])
  } catch {
    const e = new Error('JSON inválido en la respuesta del modelo.') as Error & {
      status?: number
    }
    e.status = 400
    throw e
  }
  const valid = nutritionPerServingSchema.safeParse(parsedJson)
  if (!valid.success) {
    const e = new Error(
      'Valores fuera de rango o estructura inválida.',
    ) as Error & { status?: number }
    e.status = 400
    throw e
  }
  if (valid.data.kcal > 900 || valid.data.kcal < 0) {
    const e = new Error(`kcal fuera de rango (${valid.data.kcal}).`) as Error & {
      status?: number
    }
    e.status = 400
    throw e
  }
  return valid.data
}

// POST /ingredients/estimate-nutrition (auth) — preview-only, no DB write.
//   Body: { name }. Used by the create-ingredient modal where the row
//   doesn't yet exist. Curator confirms in the modal, then we POST to
//   /auto-create with the values.
router.post(
  '/ingredients/estimate-nutrition',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const name = (req.body?.name as string | undefined)?.trim()
      if (!name) {
        res.status(400).json({ error: 'Falta el campo "name".' })
        return
      }
      const nutrition = await estimateNutritionForName(name)
      res.json({ nutrition, source: 'estimated' })
    } catch (err) {
      const e = err as Error & { status?: number }
      const status = e.status ?? 500
      console.error('Preview estimate error:', err)
      res.status(status).json({ error: e.message ?? 'Internal server error' })
    }
  },
)

// POST /ingredients/:id/estimate-nutrition (auth)
//   Last-resort estimate when both USDA and BEDCA miss. Asks Claude for
//   per-100 g values for the ingredient's name, validates the response,
//   and updates the row with the estimated values (fdc_id stays null).
//   Curator-only: behind authMiddleware. Returns 400 on out-of-band values
//   (e.g. kcal > 900) so the UI can show the issue.
//
//   IMPORTANT: registered BEFORE /ingredients/:id so Express doesn't try to
//   route the slug through the catch-all PUT/DELETE handlers below.
const estimateBodySchema = z
  .object({
    /** Optional override for the prompt — defaults to the row's name. */
    name: z.string().min(1).max(120).optional(),
  })
  .optional()

router.post(
  '/ingredients/:id/estimate-nutrition',
  authMiddleware,
  async (req: AuthRequest, res) => {
    try {
      const id = String(req.params.id)
      const [row] = await db
        .select()
        .from(ingredients)
        .where(eq(ingredients.id, id))
        .limit(1)
      if (!row) {
        res.status(404).json({ error: 'Ingredient not found' })
        return
      }

      const parsed = estimateBodySchema.safeParse(req.body ?? {})
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues })
        return
      }
      const promptName = parsed.data?.name?.trim() || row.name

      const valid = await estimateNutritionForName(promptName)

      const [updated] = await db
        .update(ingredients)
        .set({
          calories: valid.kcal,
          protein: valid.proteinG,
          carbs: valid.carbsG,
          fat: valid.fatG,
          fiber: valid.fiberG,
          salt: valid.saltG,
          // Leave fdcId untouched — null means "manual / estimated".
          updatedAt: new Date(),
        })
        .where(eq(ingredients.id, id))
        .returning()

      res.json({ ingredient: updated, source: 'estimated' })
    } catch (err) {
      const e = err as Error & { status?: number }
      const status = e.status ?? 500
      console.error('Estimate nutrition error:', err)
      res.status(status).json({ error: e.message ?? 'Internal server error' })
    }
  },
)

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
