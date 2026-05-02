/**
 * Curator Dashboard routes.
 *
 * Surfaces the catalog gaps a curator needs to close manually:
 *   - ingredients without USDA mapping (`fdcId IS NULL`)
 *   - missing density / unitWeight on rows that should have one
 *   - aisle === 'otros' (the catch-all bucket)
 *   - allergen suggestions (heuristic > current tags)
 *   - recipes with `nutritionPerServing.kcal` falsy + which ingredients block them
 *   - recipes missing totalTime / equipment / difficulty default
 *   - LLM regen failures / skips parsed from `apps/api/scripts/output/`
 *
 * Plus two write endpoints:
 *   - PATCH /ingredients/:id            — partial update (aisle/density/unitWeight/allergenTags)
 *   - PATCH /ingredients/:id/remap      — re-fetch USDA per-100 g and refresh nutrition
 *
 * Spec: ../../../../specs/curator-dashboard.md
 */

import { Router } from 'express'
import { z } from 'zod'
import { eq, inArray } from 'drizzle-orm'
import path from 'path'
import { promises as fs } from 'fs'
import { db } from '../db/connection.js'
import { ingredients, recipes, recipeIngredients } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { AISLES } from '@ona/shared'
import {
  inferAllergenTagsFromName,
  ALLERGEN_TAGS,
} from '../services/nutrition/allergens.js'
import { createUsdaClient } from '../services/nutrition/usdaClient.js'

const router = Router()

// ─── Heuristics ────────────────────────────────────────────────

const DENSITY_KEYWORDS = [
  'aceite',
  'leche',
  'nata',
  'vinagre',
  'caldo',
  'salsa',
  'sirope',
  'crema',
  'jarabe',
  'miel',
]

// Bulk leafy/loose produce — unit weight doesn't apply.
const BULK_PRODUCE_KEYWORDS = [
  'verde',
  'espinaca',
  'lechuga',
  'rucula',
  'rúcula',
  'acelga',
  'canónigo',
  'canonigo',
  'kale',
  'berro',
  'germinado',
  'brote',
  'hierba',
  'perejil',
  'cilantro',
  'albahaca',
  'menta',
  'romero',
  'tomillo',
]

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .trim()
}

function nameContainsAny(name: string, needles: readonly string[]): boolean {
  const n = normalize(name)
  for (const needle of needles) {
    if (n.includes(normalize(needle))) return true
  }
  return false
}

// ─── GET /curator/ingredient-gaps ───────────────────────────────

router.get('/curator/ingredient-gaps', authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const all = await db.select().from(ingredients)

    const missingFdcId: Array<{
      id: string
      name: string
      aisle: string | null
      allergenTags: string[] | null
    }> = []
    const missingDensity: Array<{ id: string; name: string; aisle: string | null }> = []
    const missingUnitWeight: Array<{ id: string; name: string; aisle: string | null }> = []
    const aisleOtros: Array<{ id: string; name: string }> = []
    const allergenSuggestions: Array<{
      id: string
      name: string
      currentTags: string[]
      suggestedTags: string[]
    }> = []

    for (const row of all) {
      if (row.fdcId == null) {
        missingFdcId.push({
          id: row.id,
          name: row.name,
          aisle: row.aisle,
          allergenTags: row.allergenTags ?? [],
        })
      }

      if (row.density == null && nameContainsAny(row.name, DENSITY_KEYWORDS)) {
        missingDensity.push({ id: row.id, name: row.name, aisle: row.aisle })
      }

      if (
        row.unitWeight == null &&
        row.aisle === 'produce' &&
        !nameContainsAny(row.name, BULK_PRODUCE_KEYWORDS)
      ) {
        missingUnitWeight.push({ id: row.id, name: row.name, aisle: row.aisle })
      }

      if (row.aisle === 'otros' || row.aisle == null) {
        aisleOtros.push({ id: row.id, name: row.name })
      }

      const current = (row.allergenTags ?? []) as string[]
      const suggested = inferAllergenTagsFromName(row.name)
      const currentSet = new Set(current)
      const newOnes = suggested.filter((t) => !currentSet.has(t))
      if (newOnes.length > 0) {
        allergenSuggestions.push({
          id: row.id,
          name: row.name,
          currentTags: current,
          suggestedTags: suggested,
        })
      }
    }

    res.json({
      missingFdcId,
      missingDensity,
      missingUnitWeight,
      aisleOtros,
      allergenSuggestions,
    })
  } catch (err) {
    console.error('curator/ingredient-gaps error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── GET /curator/recipe-gaps ──────────────────────────────────

router.get('/curator/recipe-gaps', authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const allRecipes = await db.select().from(recipes)

    const missingNutritionRecipes = allRecipes.filter((r) => {
      const npp = r.nutritionPerServing as { kcal?: number | null } | null
      return !npp || !npp.kcal
    })

    // For each recipe with missing nutrition, find which of its ingredients
    // are missing fdcId (those are the bottleneck).
    const recipeIds = missingNutritionRecipes.map((r) => r.id)
    const ingredientLinks = recipeIds.length
      ? await db
          .select({
            recipeId: recipeIngredients.recipeId,
            ingredientId: recipeIngredients.ingredientId,
            ingredientFdcId: ingredients.fdcId,
          })
          .from(recipeIngredients)
          .leftJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
          .where(inArray(recipeIngredients.recipeId, recipeIds))
      : []

    const blockersByRecipe = new Map<string, string[]>()
    for (const link of ingredientLinks) {
      if (link.ingredientFdcId == null) {
        const arr = blockersByRecipe.get(link.recipeId) ?? []
        arr.push(link.ingredientId)
        blockersByRecipe.set(link.recipeId, arr)
      }
    }

    const missingNutrition = missingNutritionRecipes.map((r) => {
      const npp = r.nutritionPerServing as { kcal?: number | null } | null
      return {
        id: r.id,
        name: r.name,
        kcal: npp?.kcal ?? 0,
        missingIngredientIds: blockersByRecipe.get(r.id) ?? [],
      }
    })

    const missingTotalTime = allRecipes
      .filter((r) => r.totalTime == null || r.totalTime === 0)
      .map((r) => ({ id: r.id, name: r.name }))

    const missingEquipment = allRecipes
      .filter((r) => !r.equipment || (r.equipment as string[]).length === 0)
      .map((r) => ({ id: r.id, name: r.name }))

    // Heuristic: difficulty defaulted to 'medium' is the schema default;
    // we surface it for review. (We can't tell "explicitly set to medium"
    // from "default medium" — list every 'medium' so the curator can audit.)
    const missingDifficulty = allRecipes
      .filter((r) => r.difficulty === 'medium')
      .map((r) => ({
        id: r.id,
        name: r.name,
        difficulty: r.difficulty ?? 'medium',
      }))

    res.json({
      missingNutrition,
      missingTotalTime,
      missingEquipment,
      missingDifficulty,
    })
  } catch (err) {
    console.error('curator/recipe-gaps error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── GET /curator/regen-output ─────────────────────────────────

interface RegenEntry {
  source: 'failed' | 'skipped'
  recipeName: string
  errors: Array<{ code?: string; message?: string; path?: string }>
  warnings: Array<{ code?: string; message?: string; path?: string }>
}

async function readJsonl(filePath: string, source: 'failed' | 'skipped'): Promise<RegenEntry[]> {
  let raw: string
  try {
    raw = await fs.readFile(filePath, 'utf8')
  } catch {
    return []
  }
  const out: RegenEntry[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as {
        recipe?: { name?: string; _source?: { name?: string } }
        errors?: Array<{ code?: string; message?: string; path?: string }>
        warnings?: Array<{ code?: string; message?: string; path?: string }>
      }
      const recipeName =
        parsed.recipe?._source?.name ??
        parsed.recipe?.name ??
        '(sin nombre)'
      out.push({
        source,
        recipeName,
        errors: parsed.errors ?? [],
        warnings: parsed.warnings ?? [],
      })
    } catch {
      // skip malformed lines silently
    }
  }
  return out
}

router.get('/curator/regen-output', authMiddleware, async (_req: AuthRequest, res) => {
  try {
    const baseDir =
      process.env.REGEN_OUTPUT_DIR ??
      path.join(process.cwd(), 'apps/api/scripts/output')
    const failed = await readJsonl(path.join(baseDir, 'regen-failed.jsonl'), 'failed')
    const skipped = await readJsonl(path.join(baseDir, 'regen-skipped.jsonl'), 'skipped')
    res.json([...failed, ...skipped])
  } catch (err) {
    console.error('curator/regen-output error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── PATCH /ingredients/:id ────────────────────────────────────
// Whitelisted partial update for the curator dashboard.
// Other fields go through PUT /ingredients/:id (covered by updateIngredientSchema).

const patchBodySchema = z.object({
  aisle: z.enum(AISLES).nullable().optional(),
  density: z.number().positive().nullable().optional(),
  unitWeight: z.number().positive().nullable().optional(),
  allergenTags: z.array(z.enum(ALLERGEN_TAGS)).optional(),
})

router.patch('/ingredients/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const parsed = patchBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues })
      return
    }
    const update: Record<string, unknown> = { updatedAt: new Date() }
    if ('aisle' in parsed.data) update.aisle = parsed.data.aisle
    if ('density' in parsed.data) update.density = parsed.data.density
    if ('unitWeight' in parsed.data) update.unitWeight = parsed.data.unitWeight
    if ('allergenTags' in parsed.data) update.allergenTags = parsed.data.allergenTags

    const [updated] = await db
      .update(ingredients)
      .set(update)
      .where(eq(ingredients.id, String(req.params.id)))
      .returning()

    if (!updated) {
      res.status(404).json({ error: 'Ingredient not found' })
      return
    }
    res.json(updated)
  } catch (err) {
    console.error('PATCH /ingredients/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── PATCH /ingredients/:id/remap ──────────────────────────────
// Re-map an existing ingredient to a USDA fdcId and refresh per-100 g nutrition.
// Body: { fdcId: number }. Used by the "Re-mapear a USDA" action on the dashboard.

const remapBodySchema = z.object({
  fdcId: z.number().int().positive(),
})

router.patch('/ingredients/:id/remap', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const parsed = remapBodySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', issues: parsed.error.issues })
      return
    }
    const id = String(req.params.id)
    const [existing] = await db
      .select()
      .from(ingredients)
      .where(eq(ingredients.id, id))
      .limit(1)
    if (!existing) {
      res.status(404).json({ error: 'Ingredient not found' })
      return
    }

    const client = createUsdaClient()
    const profile = await client.fetchByFdcId(parsed.data.fdcId)

    const [updated] = await db
      .update(ingredients)
      .set({
        fdcId: parsed.data.fdcId,
        calories: profile.per100g.kcal,
        protein: profile.per100g.proteinG,
        carbs: profile.per100g.carbsG,
        fat: profile.per100g.fatG,
        fiber: profile.per100g.fiberG,
        salt: profile.per100g.saltG,
        updatedAt: new Date(),
      })
      .where(eq(ingredients.id, id))
      .returning()

    res.json(updated)
  } catch (err) {
    console.error('PATCH /ingredients/:id/remap error:', err)
    const status = (err as { status?: number })?.status === 429 ? 429 : 500
    res.status(status).json({
      error:
        status === 429
          ? 'USDA rate limit exceeded; try again shortly.'
          : 'Internal server error',
    })
  }
})

export default router
