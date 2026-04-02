import { Router } from 'express'
import { eq, like, count, asc, desc, sql } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { updateIngredientSchema } from '@ona/shared'

const router = Router()

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
