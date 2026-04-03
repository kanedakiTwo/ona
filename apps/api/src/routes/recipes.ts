import { Router } from 'express'
import { eq, and, sql, count, arrayContains } from 'drizzle-orm'
import multer from 'multer'
import { db } from '../db/connection.js'
import { recipes, recipeIngredients, ingredients, userFavorites } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { createRecipeSchema, updateRecipeSchema } from '@ona/shared'
import { extractRecipeFromImage } from '../services/recipeExtractor.js'
import { AnthropicProvider } from '../services/providers/anthropic.js'

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    cb(null, allowed.includes(file.mimetype))
  },
})

// GET /recipes - list with optional filters
router.get('/recipes', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.perPage as string) || 20))
    const meal = req.query.meal as string | undefined
    const season = req.query.season as string | undefined
    const offset = (page - 1) * perPage

    // Build conditions
    const conditions = []
    if (meal) conditions.push(arrayContains(recipes.meals, [meal]))
    if (season) conditions.push(arrayContains(recipes.seasons, [season]))

    const where = conditions.length > 0 ? and(...conditions) : undefined

    // Get total count
    const [{ total }] = await db
      .select({ total: count() })
      .from(recipes)
      .where(where)

    // Get recipes with ingredients
    const recipeRows = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        authorId: recipes.authorId,
        imageUrl: recipes.imageUrl,
        prepTime: recipes.prepTime,
        meals: recipes.meals,
        seasons: recipes.seasons,
        tags: recipes.tags,
        steps: recipes.steps,
        createdAt: recipes.createdAt,
        updatedAt: recipes.updatedAt,
      })
      .from(recipes)
      .where(where)
      .limit(perPage)
      .offset(offset)
      .orderBy(recipes.createdAt)

    // Fetch ingredients for these recipes
    const recipeIds = recipeRows.map((r) => r.id)
    let ingredientMap: Record<string, { ingredientId: string; ingredientName: string; quantity: number; unit: string | null }[]> = {}

    if (recipeIds.length > 0) {
      const riRows = await db
        .select({
          recipeId: recipeIngredients.recipeId,
          ingredientId: recipeIngredients.ingredientId,
          ingredientName: ingredients.name,
          quantity: recipeIngredients.quantity,
          unit: recipeIngredients.unit,
        })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
        .where(sql`${recipeIngredients.recipeId} IN ${recipeIds}`)

      for (const row of riRows) {
        if (!ingredientMap[row.recipeId]) ingredientMap[row.recipeId] = []
        ingredientMap[row.recipeId].push({
          ingredientId: row.ingredientId,
          ingredientName: row.ingredientName,
          quantity: row.quantity,
          unit: row.unit,
        })
      }
    }

    const result = recipeRows.map((r) => ({
      ...r,
      ingredients: ingredientMap[r.id] ?? [],
    }))

    res.set('X-Total-Count', String(total))
    res.json(result)
  } catch (err) {
    console.error('List recipes error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /recipes/:id - single recipe with full ingredients
router.get('/recipes/:id', async (req, res) => {
  try {
    const [recipe] = await db
      .select()
      .from(recipes)
      .where(eq(recipes.id, String(req.params.id)))
      .limit(1)

    if (!recipe) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }

    const riRows = await db
      .select({
        ingredientId: recipeIngredients.ingredientId,
        ingredientName: ingredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, recipe.id))

    res.json({ ...recipe, ingredients: riRows })
  } catch (err) {
    console.error('Get recipe error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /recipes/extract-from-image - extract recipe from photo (auth required)
router.post('/recipes/extract-from-image', authMiddleware, upload.single('image'), async (req: AuthRequest, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No se ha proporcionado ninguna imagen' })
      return
    }

    const provider = new AnthropicProvider()
    const result = await extractRecipeFromImage(provider, req.file.buffer, req.file.mimetype)

    res.json(result)
  } catch (err: any) {
    console.error('Extract recipe from image error:', err)

    if (err.message?.includes('No se pudo identificar')) {
      res.status(422).json({ error: err.message })
      return
    }
    if (err.status === 429) {
      res.status(429).json({ error: 'Demasiadas peticiones. Intenta en un momento.' })
      return
    }
    if (err.message?.includes('ANTHROPIC_API_KEY')) {
      res.status(503).json({ error: 'Servicio de IA no disponible' })
      return
    }

    res.status(500).json({ error: 'Error al analizar la imagen' })
  }
})

// POST /recipes - create recipe (auth required)
router.post('/recipes', authMiddleware, validate(createRecipeSchema), async (req: AuthRequest, res) => {
  try {
    const { ingredients: recipeIngs, ...recipeData } = req.body

    const [recipe] = await db
      .insert(recipes)
      .values({ ...recipeData, authorId: req.userId! })
      .returning()

    if (recipeIngs && recipeIngs.length > 0) {
      await db.insert(recipeIngredients).values(
        recipeIngs.map((ri: { ingredientId: string; quantity: number; unit?: string }) => ({
          recipeId: recipe.id,
          ingredientId: ri.ingredientId,
          quantity: ri.quantity,
          unit: ri.unit ?? 'g',
        }))
      )
    }

    // Fetch the inserted ingredients to return
    const riRows = await db
      .select({
        ingredientId: recipeIngredients.ingredientId,
        ingredientName: ingredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, recipe.id))

    res.status(201).json({ ...recipe, ingredients: riRows })
  } catch (err) {
    console.error('Create recipe error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /recipes/:id - update recipe (auth required, must be author)
router.put('/recipes/:id', authMiddleware, validate(updateRecipeSchema), async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.id)

    const [existing] = await db
      .select({ authorId: recipes.authorId })
      .from(recipes)
      .where(eq(recipes.id, recipeId))
      .limit(1)

    if (!existing) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }

    if (existing.authorId !== req.userId) {
      res.status(403).json({ error: 'Forbidden: not the author' })
      return
    }

    const { ingredients: recipeIngs, ...recipeData } = req.body

    const [updated] = await db
      .update(recipes)
      .set({ ...recipeData, updatedAt: new Date() })
      .where(eq(recipes.id, recipeId))
      .returning()

    // If ingredients provided, replace them
    if (recipeIngs) {
      await db
        .delete(recipeIngredients)
        .where(eq(recipeIngredients.recipeId, recipeId))

      if (recipeIngs.length > 0) {
        await db.insert(recipeIngredients).values(
          recipeIngs.map((ri: { ingredientId: string; quantity: number; unit?: string }) => ({
            recipeId: recipeId,
            ingredientId: ri.ingredientId,
            quantity: ri.quantity,
            unit: ri.unit ?? 'g',
          }))
        )
      }
    }

    const riRows = await db
      .select({
        ingredientId: recipeIngredients.ingredientId,
        ingredientName: ingredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, recipeId))

    res.json({ ...updated, ingredients: riRows })
  } catch (err) {
    console.error('Update recipe error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /recipes/:id - delete recipe (auth required, must be author)
router.delete('/recipes/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.id)

    const [existing] = await db
      .select({ authorId: recipes.authorId })
      .from(recipes)
      .where(eq(recipes.id, recipeId))
      .limit(1)

    if (!existing) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }

    if (existing.authorId !== req.userId) {
      res.status(403).json({ error: 'Forbidden: not the author' })
      return
    }

    await db.delete(recipes).where(eq(recipes.id, recipeId))

    res.status(204).send()
  } catch (err) {
    console.error('Delete recipe error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /user/:id/recipes - user's own recipes + favorited recipes
router.get('/user/:id/recipes', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.id)

    // User's own recipes
    const ownRecipes = await db
      .select()
      .from(recipes)
      .where(eq(recipes.authorId, userId))
      .orderBy(recipes.createdAt)

    // User's favorited recipes
    const favRows = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        authorId: recipes.authorId,
        imageUrl: recipes.imageUrl,
        prepTime: recipes.prepTime,
        meals: recipes.meals,
        seasons: recipes.seasons,
        tags: recipes.tags,
        steps: recipes.steps,
        createdAt: recipes.createdAt,
        updatedAt: recipes.updatedAt,
      })
      .from(userFavorites)
      .innerJoin(recipes, eq(userFavorites.recipeId, recipes.id))
      .where(eq(userFavorites.userId, userId))

    res.json({ own: ownRecipes, favorites: favRows })
  } catch (err) {
    console.error('Get user recipes error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /user/:id/recipes/:recipeId/favorite - toggle favorite
router.post('/user/:id/recipes/:recipeId/favorite', authMiddleware, async (req: AuthRequest, res) => {
  try {
    if (req.userId !== String(req.params.id)) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const userId = String(req.params.id)
    const recipeId = String(req.params.recipeId)

    // Check if recipe exists
    const [recipe] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.id, recipeId))
      .limit(1)

    if (!recipe) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }

    // Check if already favorited
    const [existing] = await db
      .select({ id: userFavorites.id })
      .from(userFavorites)
      .where(and(eq(userFavorites.userId, userId), eq(userFavorites.recipeId, recipeId)))
      .limit(1)

    if (existing) {
      // Remove favorite
      await db
        .delete(userFavorites)
        .where(and(eq(userFavorites.userId, userId), eq(userFavorites.recipeId, recipeId)))

      res.json({ favorited: false })
    } else {
      // Add favorite
      await db
        .insert(userFavorites)
        .values({ userId, recipeId })

      res.json({ favorited: true })
    }
  } catch (err) {
    console.error('Toggle favorite error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
