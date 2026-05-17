import { Router } from 'express'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { menus, menuLogs, users } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { generateMenuSchema, lockMealSchema, MEALS } from '@ona/shared'
import type { DayMenu, LockedSlots, Meal, MealSlot } from '@ona/shared'
import { generateMenu } from '../services/menuGenerator.js'
import { calculateMenuCaloriesFromDB } from '../services/calorieCalculator.js'
import { calculateMenuNutrientsFromDB } from '../services/nutrientCalculator.js'
import { updateBalance } from '../services/nutrientBalance.js'
import { findRecipeForSlot, type RecipeWithIngredients } from '../services/recipeMatcher.js'
import { detectSeason } from '@ona/shared'
import { recipeIngredients, ingredients, recipes, userFavorites } from '../db/schema.js'

const router = Router()

/**
 * Allow only the canonical meal types in the slot-mutation routes. Without
 * this, a malicious caller could persist `meal: 'foo'` in the menu jsonb and
 * the shopping list aggregator would skip it silently. PUT keeps its current
 * lenient behavior to avoid breaking clients that already rely on it.
 */
const MEAL_VALUES = new Set<string>(MEALS)
function isValidMeal(meal: string): meal is Meal {
  return MEAL_VALUES.has(meal)
}

/**
 * Resolve `image_url` for every recipe referenced by the menu and attach it
 * to each slot. The JSONB only stores recipeId/name — keeping the URL
 * persisted there would go stale on regenerate-image. Single SELECT for the
 * whole week.
 */
async function hydrateMenuImages<T extends { days: unknown }>(menu: T): Promise<T> {
  const days = (menu.days as DayMenu[] | null | undefined) ?? []
  const ids = new Set<string>()
  for (const day of days) {
    for (const meal of Object.keys(day)) {
      const slot = day[meal] as MealSlot | undefined
      if (slot?.recipeId) ids.add(slot.recipeId)
    }
  }
  if (ids.size === 0) return menu
  const rows = await db
    .select({ id: recipes.id, imageUrl: recipes.imageUrl })
    .from(recipes)
    .where(inArray(recipes.id, [...ids]))
  const imageById = new Map(rows.map((r) => [r.id, r.imageUrl]))
  const hydratedDays = days.map((day) => {
    const next: DayMenu = {}
    for (const meal of Object.keys(day)) {
      const slot = day[meal] as MealSlot | undefined
      if (slot?.recipeId) {
        next[meal] = { ...slot, imageUrl: imageById.get(slot.recipeId) ?? null }
      } else if (slot) {
        next[meal] = slot
      }
    }
    return next
  })
  return { ...menu, days: hydratedDays }
}

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

    res.status(201).json(await hydrateMenuImages(menu))
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

    res.json(await hydrateMenuImages(menu))
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
      res.json(await hydrateMenuImages(updated))
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

    res.json(await hydrateMenuImages(updated))
  } catch (err) {
    console.error('Regenerate meal error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /menu/:menuId/day/:day/meal/:meal — add a brand-new slot to a day.
//
// Unlike PUT (which regenerates an existing slot), POST creates a slot that
// the user's template didn't include. Use case: user removed `breakfast`
// from their weekly preferences but wants to add one specifically for
// Saturday. Scoped to THIS menu only — does not touch userSettings.template.
//
// Body shape mirrors PUT: optional `{ recipeId }` to pin a specific recipe,
// otherwise the matcher picks one. Returns 409 if the slot already exists
// (use PUT to replace it).
router.post('/menu/:menuId/day/:day/meal/:meal', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = String(req.params.day)
    const meal = String(req.params.meal)
    const dayIndex = parseInt(day, 10)

    if (!isValidMeal(meal)) {
      res.status(400).json({ error: 'Invalid meal type' })
      return
    }

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
    if (dayIndex < 0 || dayIndex >= days.length) {
      res.status(400).json({ error: 'Invalid day index' })
      return
    }
    if (days[dayIndex]?.[meal]?.recipeId) {
      res.status(409).json({ error: 'Slot already exists; use PUT to replace it' })
      return
    }

    const manualRecipeId = typeof req.body?.recipeId === 'string' ? req.body.recipeId : null
    let chosenId: string
    let chosenName: string

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
      chosenId = chosen.id
      chosenName = chosen.name
    } else {
      // Run the matcher, same shape as PUT but with a fresh `usedRecipeIds`
      // built from every other slot in the week (so we don't repeat).
      const usedRecipeIds = new Set<string>()
      for (let d = 0; d < days.length; d++) {
        for (const m of Object.keys(days[d])) {
          const slot = days[d][m]
          if (slot?.recipeId) usedRecipeIds.add(slot.recipeId)
        }
      }

      const [user] = await db
        .select({ restrictions: users.restrictions })
        .from(users)
        .where(eq(users.id, menu.userId))
        .limit(1)
      const restrictions: string[] = user?.restrictions ?? []

      const favRows = await db
        .select({ recipeId: userFavorites.recipeId })
        .from(userFavorites)
        .where(eq(userFavorites.userId, menu.userId))
      const favoriteRecipeIds = new Set<string>(favRows.map((f: any) => f.recipeId))

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

      const newRecipe = findRecipeForSlot(recipesWithIngredients, {
        meal: meal as Meal,
        season: detectSeason(),
        usedRecipeIds,
        restrictions,
        favoriteRecipeIds,
      })
      if (!newRecipe) {
        res.status(404).json({ error: 'No matching recipe found for this slot' })
        return
      }
      chosenId = newRecipe.id
      chosenName = newRecipe.name
    }

    days[dayIndex][meal] = { recipeId: chosenId, recipeName: chosenName }
    const [updated] = await db.update(menus).set({ days }).where(eq(menus.id, menuId)).returning()
    res.status(201).json(await hydrateMenuImages(updated))
  } catch (err) {
    console.error('Add meal slot error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /menu/:menuId/day/:day/meal/:meal — remove a slot for this week only.
//
// The user's profile template is untouched; only the current menu's `days`
// jsonb loses the slot. Re-running the matcher (or POST above) would bring
// the slot back per the user's saved preferences.
router.delete('/menu/:menuId/day/:day/meal/:meal', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = String(req.params.day)
    const meal = String(req.params.meal)
    const dayIndex = parseInt(day, 10)

    if (!isValidMeal(meal)) {
      res.status(400).json({ error: 'Invalid meal type' })
      return
    }

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
    if (locked[String(dayIndex)]?.[meal]) {
      res.status(400).json({ error: 'Meal slot is locked' })
      return
    }
    if (!days[dayIndex]?.[meal]) {
      res.status(404).json({ error: 'Slot does not exist' })
      return
    }

    delete days[dayIndex][meal]
    const [updated] = await db.update(menus).set({ days }).where(eq(menus.id, menuId)).returning()
    res.json(await hydrateMenuImages(updated))
  } catch (err) {
    console.error('Delete meal slot error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PATCH /menu/:menuId/day/:day/meal/:meal — partial update for slot metadata.
//
// v1 only supports `{ servings: number | null }` (per-day diner-count
// override). Null clears the override and the slot reverts to the user's
// household default for shopping-list aggregation. Slot ownership / recipe
// pinning stays in PUT to keep this method idempotent for metadata.
router.patch('/menu/:menuId/day/:day/meal/:meal', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = String(req.params.day)
    const meal = String(req.params.meal)
    const dayIndex = parseInt(day, 10)

    if (!isValidMeal(meal)) {
      res.status(400).json({ error: 'Invalid meal type' })
      return
    }

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
    if (dayIndex < 0 || dayIndex >= days.length) {
      res.status(400).json({ error: 'Invalid day index' })
      return
    }
    const slot = days[dayIndex]?.[meal]
    if (!slot) {
      res.status(404).json({ error: 'Slot does not exist' })
      return
    }

    if ('servings' in (req.body ?? {})) {
      const raw = req.body.servings
      if (raw === null) {
        delete slot.servings
      } else {
        const n = typeof raw === 'number' ? raw : parseInt(raw, 10)
        if (!Number.isFinite(n) || n < 1 || n > 24) {
          res.status(400).json({ error: 'servings must be an integer between 1 and 24' })
          return
        }
        slot.servings = n
      }
    }

    days[dayIndex][meal] = slot
    const [updated] = await db.update(menus).set({ days }).where(eq(menus.id, menuId)).returning()
    res.json(await hydrateMenuImages(updated))
  } catch (err) {
    console.error('Patch meal slot error:', err)
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

      res.json(await hydrateMenuImages(updated))
    } catch (err) {
      console.error('Lock meal error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  },
)

export default router
