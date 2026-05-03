import { Router } from 'express'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { menus, menuLogs, users } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { generateMenuSchema, lockMealSchema } from '@ona/shared'
import type { DayMenu, LockedSlots, Meal } from '@ona/shared'
import { generateMenu } from '../services/menuGenerator.js'
import { calculateMenuCaloriesFromDB } from '../services/calorieCalculator.js'
import { calculateMenuNutrientsFromDB } from '../services/nutrientCalculator.js'
import { updateBalance } from '../services/nutrientBalance.js'
import { findRecipeForSlot, type RecipeWithIngredients } from '../services/recipeMatcher.js'
import { detectSeason } from '@ona/shared'
import { recipeIngredients, ingredients, recipes, userFavorites } from '../db/schema.js'

const router = Router()

// POST /menu/generate - does NOT require auth (as specified)
router.post('/menu/generate', validate(generateMenuSchema), async (req, res) => {
  try {
    const { userId, weekStart, customTemplate } = req.body

    // Generate the menu
    const days = await generateMenu(userId, weekStart, customTemplate, db)

    // Save to menus table
    const [menu] = await db
      .insert(menus)
      .values({
        userId,
        weekStart,
        days,
        locked: {},
      })
      .returning()

    // Calculate calories and nutrients for the menu log
    const caloriesTotal = await calculateMenuCaloriesFromDB(days, db)
    const aggregatedNutrients = await calculateMenuNutrientsFromDB(days, db)

    // Create menu_log entry
    await db.insert(menuLogs).values({
      userId,
      menuId: menu.id,
      weekStart,
      aggregatedNutrients,
      caloriesTotal,
    })

    // Update nutrient balance
    await updateBalance(userId, aggregatedNutrients, db)

    res.status(201).json(menu)
  } catch (err) {
    console.error('Generate menu error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// All remaining routes require auth
router.use(authMiddleware)

// GET /menu/:userId/history - list past menus
router.get('/menu/:userId/history', async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.userId)

    const results = await db
      .select({
        id: menus.id,
        weekStart: menus.weekStart,
        createdAt: menus.createdAt,
      })
      .from(menus)
      .where(eq(menus.userId, userId))
      .orderBy(menus.createdAt)

    res.json(results.reverse())
  } catch (err) {
    console.error('Menu history error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /menu/:userId/:weekId
router.get('/menu/:userId/:weekId', async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.userId)
    const weekId = String(req.params.weekId)

    const [menu] = await db
      .select()
      .from(menus)
      .where(and(eq(menus.userId, userId), eq(menus.weekStart, weekId)))
      .orderBy(desc(menus.createdAt))
      .limit(1)

    if (!menu) {
      res.status(404).json({ error: 'Menu not found' })
      return
    }

    res.json(menu)
  } catch (err) {
    console.error('Get menu error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /menu/:menuId/day/:day/meal/:meal - regenerate one specific meal slot
router.put('/menu/:menuId/day/:day/meal/:meal', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = String(req.params.day)
    const meal = String(req.params.meal)
    const dayIndex = parseInt(day, 10)

    // Fetch existing menu
    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menuId))
      .limit(1)

    if (!menu) {
      res.status(404).json({ error: 'Menu not found' })
      return
    }

    const days = menu.days as DayMenu[]
    const locked = (menu.locked as LockedSlots) ?? {}

    if (dayIndex < 0 || dayIndex >= days.length) {
      res.status(400).json({ error: 'Invalid day index' })
      return
    }

    // Check if slot is locked
    if (locked[String(dayIndex)]?.[meal]) {
      res.status(400).json({ error: 'Meal slot is locked' })
      return
    }

    // Manual override: if the body carries a `recipeId`, skip the matcher and
    // pin that recipe directly. This is the path used by the menu UI's
    // "cambiar plato" picker and by the assistant's swap_meal skill when the
    // user names a specific recipe.
    const manualRecipeId = typeof req.body?.recipeId === 'string' ? req.body.recipeId : null
    if (manualRecipeId) {
      const [chosen] = await db
        .select({ id: recipes.id, name: recipes.name })
        .from(recipes)
        .where(eq(recipes.id, manualRecipeId))
        .limit(1)
      if (!chosen) {
        res.status(404).json({ error: 'Recipe not found' })
        return
      }
      days[dayIndex][meal] = { recipeId: chosen.id, recipeName: chosen.name }
      const [updated] = await db
        .update(menus)
        .set({ days })
        .where(eq(menus.id, menuId))
        .returning()
      res.json(updated)
      return
    }

    // Collect used recipe IDs (excluding the one being replaced)
    const usedRecipeIds = new Set<string>()
    for (let d = 0; d < days.length; d++) {
      for (const m of Object.keys(days[d])) {
        const slot = days[d][m]
        if (slot?.recipeId && !(d === dayIndex && m === meal)) {
          usedRecipeIds.add(slot.recipeId)
        }
      }
    }

    // Fetch user for restrictions
    const [user] = await db
      .select({ restrictions: users.restrictions })
      .from(users)
      .where(eq(users.id, menu.userId))
      .limit(1)

    const restrictions: string[] = user?.restrictions ?? []

    // Fetch favorites
    const favRows = await db
      .select({ recipeId: userFavorites.recipeId })
      .from(userFavorites)
      .where(eq(userFavorites.userId, menu.userId))

    const favoriteRecipeIds = new Set<string>(favRows.map((f: any) => f.recipeId))

    // Load all recipes with ingredients for matching
    const allRecipes = await db.select().from(recipes)
    const riRows = await db
      .select({
        recipeId: recipeIngredients.recipeId,
        ingredientId: recipeIngredients.ingredientId,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        ingredientName: ingredients.name,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))

    const ingredientsByRecipe = new Map<string, any[]>()
    for (const row of riRows) {
      const list = ingredientsByRecipe.get(row.recipeId) ?? []
      list.push({
        ingredientId: row.ingredientId,
        ingredientName: row.ingredientName,
        quantity: row.quantity,
        unit: row.unit ?? 'g',
      })
      ingredientsByRecipe.set(row.recipeId, list)
    }

    const recipesWithIngredients: RecipeWithIngredients[] = allRecipes.map((r: any) => ({
      id: r.id,
      name: r.name,
      meals: r.meals ?? [],
      seasons: r.seasons ?? [],
      tags: r.tags ?? [],
      ingredients: ingredientsByRecipe.get(r.id) ?? [],
    }))

    const season = detectSeason()

    // Find a new recipe for this slot
    const newRecipe = findRecipeForSlot(recipesWithIngredients, {
      meal: meal as Meal,
      season,
      usedRecipeIds,
      restrictions,
      favoriteRecipeIds,
    })

    if (!newRecipe) {
      res.status(404).json({ error: 'No matching recipe found for this slot' })
      return
    }

    // Update the menu
    days[dayIndex][meal] = { recipeId: newRecipe.id, recipeName: newRecipe.name }

    const [updated] = await db
      .update(menus)
      .set({ days })
      .where(eq(menus.id, menuId))
      .returning()

    res.json(updated)
  } catch (err) {
    console.error('Regenerate meal error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /menu/:menuId/day/:day/meal/:meal/lock - toggle locked status
router.put(
  '/menu/:menuId/day/:day/meal/:meal/lock',
  validate(lockMealSchema),
  async (req: AuthRequest, res) => {
    try {
      const menuId = String(req.params.menuId)
      const day = String(req.params.day)
      const meal = String(req.params.meal)
      const { locked: isLocked } = req.body

      // Fetch existing menu
      const [menu] = await db
        .select()
        .from(menus)
        .where(eq(menus.id, menuId))
        .limit(1)

      if (!menu) {
        res.status(404).json({ error: 'Menu not found' })
        return
      }

      const locked = (menu.locked as LockedSlots) ?? {}

      // Ensure day entry exists
      if (!locked[day]) {
        locked[day] = {}
      }

      locked[day][meal] = isLocked

      const [updated] = await db
        .update(menus)
        .set({ locked })
        .where(eq(menus.id, menuId))
        .returning()

      res.json(updated)
    } catch (err) {
      console.error('Lock meal error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

export default router
