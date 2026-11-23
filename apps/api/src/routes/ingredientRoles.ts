/**
 * Cocina marks catalogue ingredients (specs/cook-now.md):
 *   GET /admin/recipes/ingredient-roles/pending?limit=N  catalogue recipes (drafts included)
 *       with any ingredient unmarked, with their ingredients, oldest first.
 *   PUT /admin/recipes/:id/ingredient-roles  [{ recipeIngredientId, role, substituteIngredientIds }]
 * Only catalogue recipes (author_id IS NULL): households' own recipes never
 * go through the office (privacy) and keep the automatic rule.
 */
import { Router } from 'express'
import { and, asc, eq, inArray, isNull, type SQL } from 'drizzle-orm'
import { ingredientRolesUpdateSchema } from '@ona/shared'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes } from '../db/schema.js'
import { cocinaAuth } from '../middleware/cocinaAuth.js'

const router = Router()

/** Pure: ids in the body that aren't rows of the recipe. */
export function foreignRowIds(ids: readonly string[], recipeRowIds: ReadonlySet<string>): string[] {
  return ids.filter((id) => !recipeRowIds.has(id))
}

/**
 * Catalogue recipes only: no author, and not a household's copy. Account
 * deletion removes own recipes before the author goes (accountDeletion.ts),
 * so a null author is always the catalogue.
 */
export const CATALOGUE_RECIPE: SQL = and(isNull(recipes.authorId), isNull(recipes.copiedFromRecipeId)) as SQL

router.get('/admin/recipes/ingredient-roles/pending', cocinaAuth, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10))
    const pending = await db
      .selectDistinct({ id: recipes.id, name: recipes.name, createdAt: recipes.createdAt })
      .from(recipes)
      .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
      .where(and(CATALOGUE_RECIPE, isNull(recipeIngredients.role)))
      .orderBy(asc(recipes.createdAt))
      .limit(limit)
    if (pending.length === 0) {
      res.json([])
      return
    }
    const rows = await db
      .select({
        recipeId: recipeIngredients.recipeId,
        recipeIngredientId: recipeIngredients.id,
        name: ingredients.name,
        category: ingredients.category,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        optional: recipeIngredients.optional,
        note: recipeIngredients.note,
        section: recipeIngredients.section,
        role: recipeIngredients.role,
        substituteIngredientIds: recipeIngredients.substituteIngredientIds,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(inArray(recipeIngredients.recipeId, pending.map((p) => p.id)))
      .orderBy(asc(recipeIngredients.displayOrder))
    res.json(
      pending.map((p) => ({
        id: p.id,
        name: p.name,
        ingredients: rows.filter((r) => r.recipeId === p.id).map(({ recipeId: _r, ...r }) => r),
      })),
    )
  } catch (err) {
    console.error('GET /admin/recipes/ingredient-roles/pending error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/admin/recipes/:id/ingredient-roles', cocinaAuth, async (req, res) => {
  try {
    const parsed = ingredientRolesUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Marcado no válido', issues: parsed.error.issues })
      return
    }
    const recipeId = String(req.params.id)
    const [recipe] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(and(eq(recipes.id, recipeId), CATALOGUE_RECIPE))
      .limit(1)
    if (!recipe) {
      res.status(404).json({ error: 'Receta del catálogo no encontrada' })
      return
    }
    const own = await db.select({ id: recipeIngredients.id }).from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId))
    const foreign = foreignRowIds(parsed.data.map((m) => m.recipeIngredientId), new Set(own.map((r) => r.id)))
    if (foreign.length > 0) {
      res.status(400).json({ error: 'Hay ingredientes que no son de esta receta', ids: foreign })
      return
    }
    await db.transaction(async (tx) => {
      for (const m of parsed.data) {
        await tx
          .update(recipeIngredients)
          .set({ role: m.role, substituteIngredientIds: m.substituteIngredientIds })
          .where(eq(recipeIngredients.id, m.recipeIngredientId))
      }
    })
    res.json({ updated: parsed.data.length })
  } catch (err) {
    console.error('PUT /admin/recipes/:id/ingredient-roles error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
