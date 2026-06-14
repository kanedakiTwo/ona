import { Router } from 'express'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { menus, menuLogs, users, userSettings } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { generateMenuSchema, lockMealSchema, MEALS, MEAL_TYPE_TAGS, courseSchema } from '@ona/shared'
import type { DayMenu, Dish, LockedSlots, Meal, MealSlot, RecipeDish } from '@ona/shared'
import { generateMenu, extractMealDishCounts, normalizeMealTemplate } from '../services/menuGenerator.js'
import { calculateMenuCaloriesFromDB } from '../services/calorieCalculator.js'
import { calculateMenuNutrientsFromDB } from '../services/nutrientCalculator.js'
import { updateBalance } from '../services/nutrientBalance.js'
import { findRecipeForSlot, normaliseEquipment, type RecipeWithIngredients } from '../services/recipeMatcher.js'
import { findForCourse } from '../services/courseAwareMatcher.js'
import { addDish, removeDishAt, patchDish, reorderDish, coursesFor, dishCountFor } from '../services/menuDishes.js'
import { getMemoryForUser } from '../services/userMemoryStore.js'
import { detectSeason } from '@ona/shared'
import { recipeIngredients, ingredients, recipes, userFavorites } from '../db/schema.js'
import { resolveScope, scopeWhere, getPrimaryHouseholdId, canAccessRow } from '../services/scopeResolver.js'
import {
  enqueuePrepAlertsForMenu,
  clearPendingForMenu,
} from '../services/notificationScheduler.js'
import { z } from 'zod'

const router = Router()

/**
 * Allow only the canonical meal types in the slot-mutation routes. Without
 * this, a malicious caller could persist `meal: 'foo'` in the menu jsonb and
 * the shopping list aggregator would skip it silently. PUT keeps its current
 * lenient behavior to avoid breaking clients that already rely on it.
 */
const MEAL_VALUES = new Set<string>(MEALS)
const MEAL_TYPE_TAG_VALUES = new Set<string>(MEAL_TYPE_TAGS)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isValidUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s)
}
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
      if (!slot) continue
      // New multi-dish shape: iterate dishes[]
      if (Array.isArray(slot.dishes)) {
        for (const dish of slot.dishes) {
          if (dish.kind === 'recipe') ids.add(dish.recipeId)
        }
      }
    }
  }
  if (ids.size === 0) return menu
  const rows = await db
    .select({
      id: recipes.id,
      imageUrl: recipes.imageUrl,
      // Hydrating prep + total time so the week-list view can show a time
      // chip on every row without an extra per-recipe fetch. Pulled from
      // the same `recipes` row that already gives us the image URL.
      prepTime: recipes.prepTime,
      totalTime: recipes.totalTime,
      // Hydrate course so the UI shows the correct "Entrante / Principal /
      // Postre" eyebrow on multi-dish slots, including legacy rows persisted
      // before course tagging existed.
      course: recipes.course,
    })
    .from(recipes)
    .where(inArray(recipes.id, [...ids]))
  const recipeById = new Map(
    rows.map((r) => [
      r.id,
      { imageUrl: r.imageUrl, prepTime: r.prepTime, totalTime: r.totalTime, course: r.course },
    ]),
  )
  const hydratedDays = days.map((day) => {
    const next: DayMenu = {}
    for (const meal of Object.keys(day)) {
      const slot = day[meal] as MealSlot | undefined
      if (!slot) continue
      if (Array.isArray(slot.dishes)) {
        const hydratedDishes: Dish[] = slot.dishes.map((dish) => {
          if (dish.kind !== 'recipe') return dish
          const info = recipeById.get(dish.recipeId)
          const persisted = (dish as { course?: 'starter' | 'main' | 'dessert' | null }).course
          const hydratedCourse: 'starter' | 'main' | 'dessert' | null =
            persisted ??
            (info?.course === 'starter' || info?.course === 'main' || info?.course === 'dessert'
              ? info.course
              : null)
          return {
            ...dish,
            imageUrl: info?.imageUrl ?? null,
            prepTime: info?.prepTime ?? null,
            totalTime: info?.totalTime ?? null,
            // Persisted course (set when the dish was added) wins; otherwise
            // hydrate from the joined recipes.course so the UI eyebrow shows
            // the right label on legacy slots.
            course: hydratedCourse,
          }
        })
        next[meal] = { ...slot, dishes: hydratedDishes }
      } else {
        next[meal] = slot
      }
    }
    return next
  })
  return { ...menu, days: hydratedDays }
}

// POST /menu/generate - requires auth; a caller may only (re)generate their
// own menu. The `userId` in the body must match the authenticated user — the
// route used to be open (anyone could overwrite any user's week by passing
// their id), which is the IDOR this guard closes.
router.post('/menu/generate', authMiddleware, validate(generateMenuSchema), async (req: AuthRequest, res) => {
  try {
    const { userId, weekStart, customTemplate, empty } = req.body

    if (userId !== req.userId) {
      res.status(403).json({ error: 'No puedes generar el menú de otro usuario.' })
      return
    }

    // PR 1B: resolve scope once for the whole handler. Reads filter by
    // household when the flag is on; writes dual-populate `household_id`
    // either way so the column stays consistent.
    const scope = await resolveScope(userId)
    const householdId = await getPrimaryHouseholdId(userId)

    // Preserve the user's manual shaping across regenerate: if a menu for
    // this week already exists, carry its bannedRecipeIds + skippedDays
    // into the new generation. The previous menu row stays in the DB as
    // history; the new row is what the UI reads.
    const [previous] = await db
      .select({
        bannedRecipeIds: menus.bannedRecipeIds,
        skippedDays: menus.skippedDays,
      })
      .from(menus)
      .where(and(scopeWhere(menus.userId, menus.householdId, scope), eq(menus.weekStart, weekStart)))
      .orderBy(desc(menus.createdAt))
      .limit(1)
    const carryBanned = new Set<string>(previous?.bannedRecipeIds ?? [])
    const carrySkipped = new Set<number>(previous?.skippedDays ?? [])

    // Empty branch — skip the matcher entirely. Used by "Vaciar semana"
    // and "Empezar de cero". We honour the user's mealTemplate so the
    // slots that appear match what they normally plan.
    if (empty) {
      const [settings] = await db
        .select()
        .from(userSettings)
        .where(eq(userSettings.userId, userId))
        .limit(1)
      const tpl = normalizeMealTemplate(customTemplate ?? settings?.template) ?? [
        { breakfast: true, lunch: true, dinner: true },
        { breakfast: true, lunch: true, dinner: true },
        { breakfast: true, lunch: true, dinner: true },
        { breakfast: true, lunch: true, dinner: true },
        { breakfast: true, lunch: true, dinner: true },
        { breakfast: true, lunch: true, dinner: true },
        { breakfast: true, lunch: true, dinner: true },
      ]
      const days = tpl.map((dayTpl) => {
        const day: Record<string, { dishes: [] }> = {}
        for (const meal of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
          if (dayTpl[meal]) day[meal] = { dishes: [] }
        }
        return day
      })
      const [menu] = await db
        .insert(menus)
        .values({
          userId,
          householdId,
          weekStart,
          days,
          locked: {},
          bannedRecipeIds: [...carryBanned],
          skippedDays: [...carrySkipped],
        })
        .returning()
      const hydrated = await hydrateMenuImages(menu)
      res.status(201).json({ ...hydrated, warnings: [] })
      return
    }

    // Generate the menu
    const { days, warnings } = await generateMenu(
      userId,
      weekStart,
      customTemplate,
      db,
      {},
      undefined,
      carryBanned,
      carrySkipped,
    )

    // Save to menus table — carry the lists forward so the matcher honours
    // them next regeneration too.
    const [menu] = await db
      .insert(menus)
      .values({
        userId,
        householdId,
        weekStart,
        days,
        locked: {},
        bannedRecipeIds: [...carryBanned],
        skippedDays: [...carrySkipped],
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

    // Enqueue prep-time alerts for this menu (PR-D). Best-effort: a
    // failure here must NOT take the menu down — we log and continue.
    // Opt-in: only fires when the user has matching `prep_habits`.
    enqueuePrepAlertsForMenu(menu.id).catch((err) => {
      console.warn('[menus.generate] enqueuePrepAlertsForMenu failed:', err)
    })

    const hydrated = await hydrateMenuImages(menu)
    res.status(201).json({ ...hydrated, warnings })
  } catch (err) {
    console.error('Generate menu error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// All remaining routes require auth
router.use(authMiddleware)

/**
 * IDOR guard for every `/menu/:menuId/...` mutation route. The slot routes
 * fetch the menu by id for their own logic, but they used to do so with NO
 * ownership check — any authenticated user could mutate any menu by id. This
 * param middleware runs once per matched `:menuId` route (after authMiddleware
 * has set `req.userId`) and rejects rows the caller can't reach:
 *   - 400 if the id isn't a UUID
 *   - 404 if no such menu
 *   - 403 if it exists but belongs to another user / household
 * Owner-or-same-household access mirrors the shopping list rule.
 */
router.param('menuId', async (req: AuthRequest, res, next, menuId) => {
  try {
    if (typeof menuId !== 'string' || !UUID_RE.test(menuId)) {
      res.status(400).json({ error: 'menuId must be a UUID' })
      return
    }
    const [row] = await db
      .select({ userId: menus.userId, householdId: menus.householdId })
      .from(menus)
      .where(eq(menus.id, menuId))
      .limit(1)
    if (!row) {
      res.status(404).json({ error: 'Menu not found' })
      return
    }
    const scope = await resolveScope(req.userId!)
    if (!canAccessRow(row, req.userId!, scope)) {
      res.status(403).json({ error: 'No tienes acceso a este menú.' })
      return
    }
    next()
  } catch (err) {
    next(err)
  }
})

/**
 * Resolve the read scope for a `:userId`-path route, enforcing that the
 * caller can only read their own menus — or, when household scope is on, those
 * of a fellow household member. The scope is always derived from the *token*
 * (`callerId`), never the path param, so passing someone else's id can never
 * widen what comes back.
 */
async function resolveReadScopeForCaller(callerId: string, pathUserId: string) {
  const scope = await resolveScope(callerId)
  if (callerId === pathUserId) return { scope, allowed: true as const }
  if (scope.kind === 'household') {
    const otherHousehold = await getPrimaryHouseholdId(pathUserId)
    if (otherHousehold && otherHousehold === scope.value) {
      return { scope, allowed: true as const }
    }
  }
  return { scope, allowed: false as const }
}

// GET /menu/:userId/history - list past menus
router.get('/menu/:userId/history', async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.userId)
    const { scope, allowed } = await resolveReadScopeForCaller(req.userId!, userId)
    if (!allowed) {
      res.status(403).json({ error: 'No tienes acceso a estos menús.' })
      return
    }

    const results = await db
      .select({
        id: menus.id,
        weekStart: menus.weekStart,
        createdAt: menus.createdAt,
      })
      .from(menus)
      .where(scopeWhere(menus.userId, menus.householdId, scope))
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
    const { scope, allowed } = await resolveReadScopeForCaller(req.userId!, userId)
    if (!allowed) {
      res.status(403).json({ error: 'No tienes acceso a este menú.' })
      return
    }

    const [menu] = await db
      .select()
      .from(menus)
      .where(and(scopeWhere(menus.userId, menus.householdId, scope), eq(menus.weekStart, weekId)))
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

    const slot = days[dayIndex]?.[meal]
    if (!slot) {
      res.status(404).json({ error: 'Slot not found' })
      return
    }

    // Manual override: if the body carries a `recipeId`, skip the matcher and
    // replace every recipe-dish in the slot with the given recipe. This is the
    // path used by the menu UI's "cambiar plato" picker and by the assistant's
    // swap_meal skill when the user names a specific recipe.
    const manualRecipeId = typeof req.body?.recipeId === 'string' ? req.body.recipeId : null
    if (manualRecipeId) {
      const [chosen] = await db
        .select({ id: recipes.id, name: recipes.name, course: recipes.course })
        .from(recipes)
        .where(eq(recipes.id, manualRecipeId))
        .limit(1)
      if (!chosen) {
        res.status(404).json({ error: 'Recipe not found' })
        return
      }
      // Replace all recipe-dishes with the chosen recipe; preserve note dishes.
      const newDishes: Dish[] = slot.dishes.map((dish) => {
        if (dish.kind !== 'recipe') return dish
        return {
          kind: 'recipe',
          recipeId: chosen.id,
          recipeName: chosen.name,
          course: (chosen.course as any) ?? null,
        } satisfies RecipeDish
      })
      days[dayIndex][meal] = { ...slot, dishes: newDishes }
      const [updated] = await db
        .update(menus)
        .set({ days })
        .where(eq(menus.id, menuId))
        .returning()
      // Re-enqueue prep alerts after a manual swap — clear the menu's
      // pending rows first so old-recipe alerts disappear, then rebuild.
      // Best-effort: never block the swap response on this.
      ;(async () => {
        try {
          await clearPendingForMenu(menuId)
          await enqueuePrepAlertsForMenu(menuId)
        } catch (err) {
          console.warn('[menus.swap] re-enqueue prep alerts failed:', err)
        }
      })()
      res.json(await hydrateMenuImages(updated))
      return
    }

    // Collect used recipe IDs (excluding the slot being replaced)
    const usedRecipeIds = new Set<string>()
    for (let d = 0; d < days.length; d++) {
      for (const m of Object.keys(days[d])) {
        const s = days[d][m]
        if (!s) continue
        if (d === dayIndex && m === meal) continue
        for (const dish of s.dishes ?? []) {
          if (dish.kind === 'recipe') usedRecipeIds.add(dish.recipeId)
        }
      }
    }

    // Fetch user for restrictions + load dislikes from long-term memory.
    const [user] = await db
      .select({ restrictions: users.restrictions })
      .from(users)
      .where(eq(users.id, menu.userId))
      .limit(1)
    const restrictions: string[] = user?.restrictions ?? []
    const memory = await getMemoryForUser(menu.userId).catch(() => null)
    const dislikesValue = memory?.dislikes?.value
    const dislikes: string[] = Array.isArray(dislikesValue) ? (dislikesValue as string[]) : []
    const equipmentValue = memory?.equipment?.value
    const availableEquipment = Array.isArray(equipmentValue)
      ? new Set<string>((equipmentValue as string[]).map(normaliseEquipment))
      : undefined
    const timeValue = memory?.time_available?.value as Record<string, number> | undefined
    const SPANISH_DAY_KEYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const
    const maxPrepMinutes = timeValue && typeof timeValue === 'object'
      ? (timeValue[SPANISH_DAY_KEYS[dayIndex]] ?? null)
      : null

    // Fetch favorites — household-scoped when the flag is on so the
    // matcher boosts recipes any household member has starred.
    const favScope = await resolveScope(menu.userId)
    const favRows = await db
      .select({ recipeId: userFavorites.recipeId })
      .from(userFavorites)
      .where(scopeWhere(userFavorites.userId, userFavorites.householdId, favScope))

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

    const recipesWithIngredients = allRecipes.map((r: any) => ({
      id: r.id,
      name: r.name,
      course: r.course ?? null,
      meals: r.meals ?? [],
      seasons: r.seasons ?? [],
      tags: r.tags ?? [],
      equipment: r.equipment ?? [],
      prepTime: r.prepTime ?? null,
      ingredients: ingredientsByRecipe.get(r.id) ?? [],
    }))

    const season = detectSeason()

    const matcherOptions = {
      meal: meal as Meal,
      season,
      usedRecipeIds,
      restrictions,
      favoriteRecipeIds,
      bannedRecipeIds: new Set(menu.bannedRecipeIds ?? []),
      dislikes,
      availableEquipment,
      maxPrepMinutes,
    }

    // Re-pick a recipe for each existing recipe-dish, preserving the dish's course.
    // Note dishes stay in place unchanged.
    const newDishes = [...slot.dishes]
    for (let i = 0; i < slot.dishes.length; i++) {
      const dish = slot.dishes[i]
      if (dish.kind !== 'recipe') continue
      const currentCourse = dish.course ?? null
      const picked = findForCourse(recipesWithIngredients, currentCourse, matcherOptions)
      if (!picked) continue  // keep the old recipe if no candidate
      newDishes[i] = {
        kind: 'recipe',
        recipeId: picked.id,
        recipeName: picked.name,
        course: picked.course ?? null,
      }
    }

    days[dayIndex][meal] = { ...slot, dishes: newDishes }

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
    const existingSlot = days[dayIndex]?.[meal]
    if (existingSlot && existingSlot.dishes && existingSlot.dishes.length > 0) {
      res.status(409).json({ error: 'Slot already exists; use PUT to replace it' })
      return
    }

    const manualRecipeId = typeof req.body?.recipeId === 'string' ? req.body.recipeId : null
    let chosenId: string
    let chosenName: string
    let chosenCourse: string | null = null

    if (manualRecipeId) {
      const [chosen] = await db
        .select({ id: recipes.id, name: recipes.name, course: recipes.course })
        .from(recipes)
        .where(eq(recipes.id, manualRecipeId))
        .limit(1)
      if (!chosen) {
        res.status(404).json({ error: 'Recipe not found' })
        return
      }
      chosenId = chosen.id
      chosenName = chosen.name
      chosenCourse = chosen.course ?? null
    } else {
      // Run the matcher, same shape as PUT but with a fresh `usedRecipeIds`
      // built from every other slot in the week (so we don't repeat).
      const usedRecipeIds = new Set<string>()
      for (let d = 0; d < days.length; d++) {
        for (const m of Object.keys(days[d])) {
          const s = days[d][m]
          if (!s) continue
          for (const dish of s.dishes ?? []) {
            if (dish.kind === 'recipe') usedRecipeIds.add(dish.recipeId)
          }
        }
      }

      const [user] = await db
        .select({ restrictions: users.restrictions })
        .from(users)
        .where(eq(users.id, menu.userId))
        .limit(1)
      const restrictions: string[] = user?.restrictions ?? []
      const memory2 = await getMemoryForUser(menu.userId).catch(() => null)
      const dislikesValue2 = memory2?.dislikes?.value
      const dislikes: string[] = Array.isArray(dislikesValue2) ? (dislikesValue2 as string[]) : []
      const equipmentValue2 = memory2?.equipment?.value
      const availableEquipment = Array.isArray(equipmentValue2)
        ? new Set<string>((equipmentValue2 as string[]).map(normaliseEquipment))
        : undefined
      const SPANISH_DAY_KEYS2 = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const
      const timeValue2 = memory2?.time_available?.value as Record<string, number> | undefined
      const maxPrepMinutes = timeValue2 && typeof timeValue2 === 'object'
        ? (timeValue2[SPANISH_DAY_KEYS2[dayIndex]] ?? null)
        : null

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
        equipment: r.equipment ?? [],
        prepTime: r.prepTime ?? null,
        ingredients: ingredientsByRecipe.get(r.id) ?? [],
      }))

      const newRecipe = findRecipeForSlot(recipesWithIngredients, {
        meal: meal as Meal,
        season: detectSeason(),
        usedRecipeIds,
        restrictions,
        favoriteRecipeIds,
        bannedRecipeIds: new Set(menu.bannedRecipeIds ?? []),
        dislikes,
        availableEquipment,
        maxPrepMinutes,
      })
      if (!newRecipe) {
        res.status(404).json({ error: 'No matching recipe found for this slot' })
        return
      }
      chosenId = newRecipe.id
      chosenName = newRecipe.name
    }

    const initialDish: RecipeDish = {
      kind: 'recipe',
      recipeId: chosenId,
      recipeName: chosenName,
      course: chosenCourse as any,
    }
    days[dayIndex][meal] = { dishes: [initialDish] }
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

// POST /menu/:menuId/move-slot — move (or swap) a slot to another day/meal.
//
// Atomic single-write so the drag-and-drop UI in "Vista semana" doesn't have
// to sequence DELETE + POST + handle locked checks twice on the client. Body:
//   { fromDay, fromMeal, toDay, toMeal }
//
// If the target slot is empty the source is moved there (source becomes empty).
// If the target slot is occupied the two slots swap. Locked slots on either
// side reject the request with 400 (a locked slot means "don't move me").
router.post('/menu/:menuId/move-slot', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const body = req.body as {
      fromDay?: unknown
      fromMeal?: unknown
      toDay?: unknown
      toMeal?: unknown
    }
    const fromDay = Number(body.fromDay)
    const toDay = Number(body.toDay)
    const fromMeal = String(body.fromMeal ?? '')
    const toMeal = String(body.toMeal ?? '')

    if (!Number.isInteger(fromDay) || !Number.isInteger(toDay)) {
      res.status(400).json({ error: 'fromDay/toDay must be integers' })
      return
    }
    if (!isValidMeal(fromMeal) || !isValidMeal(toMeal)) {
      res.status(400).json({ error: 'Invalid meal type' })
      return
    }
    if (fromDay === toDay && fromMeal === toMeal) {
      res.status(400).json({ error: 'Source and target are the same slot' })
      return
    }

    const [menu] = await db.select().from(menus).where(eq(menus.id, menuId)).limit(1)
    if (!menu) {
      res.status(404).json({ error: 'Menu not found' })
      return
    }

    const days = menu.days as DayMenu[]
    const locked = (menu.locked as LockedSlots) ?? {}

    if (fromDay < 0 || fromDay >= days.length || toDay < 0 || toDay >= days.length) {
      res.status(400).json({ error: 'Invalid day index' })
      return
    }
    if (locked[String(fromDay)]?.[fromMeal] || locked[String(toDay)]?.[toMeal]) {
      res.status(400).json({ error: 'Cannot move a locked slot' })
      return
    }
    const sourceSlot = days[fromDay]?.[fromMeal]
    if (!sourceSlot || !sourceSlot.dishes || sourceSlot.dishes.length === 0) {
      res.status(404).json({ error: 'Source slot is empty' })
      return
    }
    const targetSlot = days[toDay]?.[toMeal]

    // Apply the move/swap on the in-memory copy then persist once.
    if (targetSlot && targetSlot.dishes && targetSlot.dishes.length > 0) {
      // Swap: both slots keep their other metadata (servings overrides, etc).
      days[toDay][toMeal] = sourceSlot
      days[fromDay][fromMeal] = targetSlot
    } else {
      days[toDay] = days[toDay] ?? {}
      days[toDay][toMeal] = sourceSlot
      delete days[fromDay][fromMeal]
    }

    const [updated] = await db
      .update(menus)
      .set({ days })
      .where(eq(menus.id, menuId))
      .returning()
    res.json(await hydrateMenuImages(updated))
  } catch (err) {
    console.error('Move meal slot error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PATCH /menu/:menuId/day/:day/meal/:meal — partial update for slot metadata.
//
// Supports `{ servings: number | null }` (per-day diner-count override).
// Null clears the override and the slot reverts to the user's household
// default for shopping-list aggregation. `pinnedType` moved to dish-level
// (use PATCH /dish/:position instead).
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

// POST /menu/:menuId/ban — veto a recipe for the rest of this week. Append-
// only set semantics; double-POST is a no-op (idempotent). Body `{ recipeId }`.
// The matcher excludes vetoed ids from every slot in this menu — Aleatorio,
// Añadir, whole-week Regenerar. Scope ends with the week — next menu starts
// with an empty veto list.
router.post('/menu/:menuId/ban', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const recipeId = req.body?.recipeId
    if (!isValidUuid(recipeId)) {
      res.status(400).json({ error: 'recipeId must be a uuid' })
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

    const existing = menu.bannedRecipeIds ?? []
    if (existing.includes(recipeId)) {
      res.json(await hydrateMenuImages(menu))
      return
    }
    const next = [...existing, recipeId]
    const [updated] = await db
      .update(menus)
      .set({ bannedRecipeIds: next })
      .where(eq(menus.id, menuId))
      .returning()
    res.json(await hydrateMenuImages(updated))
  } catch (err) {
    console.error('Ban recipe error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /menu/:menuId/ban/:recipeId — un-veto. Idempotent: returns the
// updated menu whether the id was in the list or not.
router.delete('/menu/:menuId/ban/:recipeId', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const recipeId = String(req.params.recipeId)
    if (!isValidUuid(recipeId)) {
      res.status(400).json({ error: 'recipeId must be a uuid' })
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

    const next = (menu.bannedRecipeIds ?? []).filter((id) => id !== recipeId)
    const [updated] = await db
      .update(menus)
      .set({ bannedRecipeIds: next })
      .where(eq(menus.id, menuId))
      .returning()
    res.json(await hydrateMenuImages(updated))
  } catch (err) {
    console.error('Unban recipe error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /menu/:menuId/day/:day/leftover — clone a previous slot's recipe as
// a leftover into the target slot. Body `{ sourceDay, sourceMeal, targetMeal }`.
// Source slot must exist and not itself be a leftover (no chains); target
// slot must be empty (use DELETE first to clear).
router.post('/menu/:menuId/day/:day/leftover', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const targetDay = parseInt(String(req.params.day), 10)
    const sourceDay = typeof req.body?.sourceDay === 'number' ? req.body.sourceDay : parseInt(String(req.body?.sourceDay), 10)
    const sourceMeal = String(req.body?.sourceMeal ?? '')
    const targetMeal = String(req.body?.targetMeal ?? '')

    if (!Number.isFinite(targetDay) || targetDay < 0 || targetDay > 6) {
      res.status(400).json({ error: 'Invalid day index' })
      return
    }
    if (!Number.isFinite(sourceDay) || sourceDay < 0 || sourceDay > 6) {
      res.status(400).json({ error: 'Invalid sourceDay' })
      return
    }
    if (!isValidMeal(sourceMeal) || !isValidMeal(targetMeal)) {
      res.status(400).json({ error: 'Invalid sourceMeal or targetMeal' })
      return
    }
    if (sourceDay === targetDay && sourceMeal === targetMeal) {
      res.status(400).json({ error: 'Source and target are the same slot' })
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

    const sourceSlot = days[sourceDay]?.[sourceMeal]
    if (!sourceSlot || !sourceSlot.dishes || sourceSlot.dishes.length === 0) {
      res.status(404).json({ error: 'Source slot is empty' })
      return
    }
    // Prevent chaining: reject if every recipe-dish in the source is already a leftover.
    const hasPlannedRecipe = sourceSlot.dishes.some(
      (d) => d.kind === 'recipe' && d.variant !== 'leftover',
    )
    if (!hasPlannedRecipe) {
      res.status(400).json({ error: 'Cannot chain leftovers — pick a planned source slot' })
      return
    }
    if (days[targetDay]?.[targetMeal]) {
      res.status(409).json({ error: 'Target slot is not empty — quita la receta primero' })
      return
    }

    // Clone only the recipe dishes from the source slot (notes dropped).
    const clonedDishes: RecipeDish[] = []
    sourceSlot.dishes.forEach((d, sourcePos) => {
      if (d.kind !== 'recipe') return  // notes don't propagate as leftovers
      clonedDishes.push({
        ...d,
        variant: 'leftover',
        leftoverOf: { day: sourceDay, meal: sourceMeal, dishPosition: sourcePos },
      })
    })

    if (!days[targetDay]) days[targetDay] = {}
    days[targetDay][targetMeal] = { servings: sourceSlot.servings, dishes: clonedDishes }

    const [updated] = await db
      .update(menus)
      .set({ days })
      .where(eq(menus.id, menuId))
      .returning()
    res.status(201).json(await hydrateMenuImages(updated))
  } catch (err) {
    console.error('Leftover error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /menu/:menuId/day/:day/skip — mark a whole day as "sin cocinar".
//
// Empties every non-locked slot in that day and appends the day index to
// `menus.skipped_days`. Whole-week regeneration leaves skipped days empty
// (the matcher checks the flag before iterating). Unskip via DELETE.
router.post('/menu/:menuId/day/:day/skip', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const dayIndex = parseInt(String(req.params.day), 10)

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

    // Empty every non-locked slot in this day.
    const dayLocks = locked[String(dayIndex)] ?? {}
    const nextDay: DayMenu = {}
    for (const meal of Object.keys(days[dayIndex] ?? {})) {
      if (dayLocks[meal]) nextDay[meal] = days[dayIndex][meal]
    }
    days[dayIndex] = nextDay

    const existing = menu.skippedDays ?? []
    const nextSkipped = existing.includes(dayIndex) ? existing : [...existing, dayIndex].sort((a, b) => a - b)

    const [updated] = await db
      .update(menus)
      .set({ days, skippedDays: nextSkipped })
      .where(eq(menus.id, menuId))
      .returning()
    res.json(await hydrateMenuImages(updated))
  } catch (err) {
    console.error('Skip day error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /menu/:menuId/day/:day/skip — un-skip. Does NOT auto-refill the
// day's slots; the user adds slots back manually via the existing "+ Añadir
// comida" affordance or regenerates the whole week.
router.delete('/menu/:menuId/day/:day/skip', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const dayIndex = parseInt(String(req.params.day), 10)
    if (!Number.isFinite(dayIndex) || dayIndex < 0 || dayIndex > 6) {
      res.status(400).json({ error: 'Invalid day index' })
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

    const next = (menu.skippedDays ?? []).filter((d) => d !== dayIndex)
    const [updated] = await db
      .update(menus)
      .set({ skippedDays: next })
      .where(eq(menus.id, menuId))
      .returning()
    res.json(await hydrateMenuImages(updated))
  } catch (err) {
    console.error('Unskip day error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── Dish-level routes ───────────────────────────────────────────────────────
// All 4 share the :menuId param middleware (IDOR checks run automatically).

const addDishSchema = z.union([
  z.object({
    kind: z.literal('recipe'),
    recipeId: z.string().uuid(),
    course: courseSchema.optional(),
    pinnedType: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal('note'),
    text: z.string().min(1).max(120),
  }),
])

// B.1: POST /menu/:menuId/day/:day/meal/:meal/dish — append a dish to a slot.
router.post('/menu/:menuId/day/:day/meal/:meal/dish', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = Number(req.params.day)
    const meal = String(req.params.meal)
    const parsed = addDishSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid dish payload', details: parsed.error.issues })
      return
    }
    const [menu] = await db.select().from(menus).where(eq(menus.id, menuId)).limit(1)
    if (!menu) { res.status(404).json({ error: 'Menu not found' }); return }
    const days = menu.days as DayMenu[]
    const slot = days[day]?.[meal] ?? { servings: null, dishes: [] }
    const next = addDish(slot.dishes, parsed.data as Dish)
    if (!days[day]) days[day] = {}
    days[day][meal] = { ...slot, dishes: next }
    await db.update(menus).set({ days: days as any }).where(eq(menus.id, menuId))
    res.json({ position: next.length - 1, dish: next[next.length - 1] })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// B.2: DELETE /menu/:menuId/day/:day/meal/:meal/dish/:position — remove a dish by position.
router.delete('/menu/:menuId/day/:day/meal/:meal/dish/:position', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = Number(req.params.day)
    const meal = String(req.params.meal)
    const position = Number(req.params.position)
    const [menu] = await db.select().from(menus).where(eq(menus.id, menuId)).limit(1)
    if (!menu) { res.status(404).json({ error: 'Menu not found' }); return }
    const days = menu.days as DayMenu[]
    const slot = days[day]?.[meal]
    if (!slot) { res.status(404).json({ error: 'Slot not found' }); return }
    if (position < 0 || position >= slot.dishes.length) {
      res.status(400).json({ error: 'Position out of range' }); return
    }
    const next = removeDishAt(slot.dishes, position)
    days[day][meal] = { ...slot, dishes: next }
    await db.update(menus).set({ days: days as any }).where(eq(menus.id, menuId))
    res.json({ dishes: next })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

const patchDishSchema = z.object({
  text: z.string().max(120).optional(),
  pinnedType: z.string().nullable().optional(),
  newPosition: z.number().int().nonnegative().optional(),
  course: courseSchema.optional(),
})

// B.3: PATCH /menu/:menuId/day/:day/meal/:meal/dish/:position — patch or reorder a dish.
// If `newPosition` is present, ignore other fields and reorder.
router.patch('/menu/:menuId/day/:day/meal/:meal/dish/:position', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = Number(req.params.day)
    const meal = String(req.params.meal)
    const position = Number(req.params.position)
    const parsed = patchDishSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid patch payload', details: parsed.error.issues })
      return
    }
    const [menu] = await db.select().from(menus).where(eq(menus.id, menuId)).limit(1)
    if (!menu) { res.status(404).json({ error: 'Menu not found' }); return }
    const days = menu.days as DayMenu[]
    const slot = days[day]?.[meal]
    if (!slot) { res.status(404).json({ error: 'Slot not found' }); return }
    if (position < 0 || position >= slot.dishes.length) {
      res.status(400).json({ error: 'Position out of range' }); return
    }
    const body = parsed.data
    let next: Dish[]
    if (body.newPosition !== undefined) {
      if (body.newPosition >= slot.dishes.length) {
        res.status(400).json({ error: 'newPosition out of range' }); return
      }
      next = reorderDish(slot.dishes, position, body.newPosition)
    } else {
      next = patchDish(slot.dishes, position, { text: body.text, pinnedType: body.pinnedType, course: body.course })
    }
    days[day][meal] = { ...slot, dishes: next }
    await db.update(menus).set({ days: days as any }).where(eq(menus.id, menuId))
    res.json({ dish: next[body.newPosition ?? position] })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// B.4: POST /menu/:menuId/day/:day/meal/:meal/dish/:position/regenerate — re-pick one recipe dish.
router.post('/menu/:menuId/day/:day/meal/:meal/dish/:position/regenerate', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = Number(req.params.day)
    const meal = String(req.params.meal)
    const position = Number(req.params.position)
    const [menu] = await db.select().from(menus).where(eq(menus.id, menuId)).limit(1)
    if (!menu) { res.status(404).json({ error: 'Menu not found' }); return }
    const days = menu.days as DayMenu[]
    const slot = days[day]?.[meal]
    if (!slot) { res.status(404).json({ error: 'Slot not found' }); return }
    if (position < 0 || position >= slot.dishes.length) {
      res.status(400).json({ error: 'Position out of range' }); return
    }
    const dish = slot.dishes[position]
    if (dish.kind === 'note') {
      res.status(400).json({ error: 'Cannot regenerate a note dish' }); return
    }

    // Build matcher options — same pattern as PUT /meal/:meal above.
    const usedRecipeIds = new Set<string>()
    for (let d = 0; d < days.length; d++) {
      for (const m of Object.keys(days[d])) {
        const s = days[d][m]
        if (!s) continue
        // Exclude the dish being regenerated from the used set
        s.dishes.forEach((dsh, idx) => {
          if (dsh.kind === 'recipe' && !(d === day && m === meal && idx === position)) {
            usedRecipeIds.add(dsh.recipeId)
          }
        })
      }
    }

    const [user] = await db
      .select({ restrictions: users.restrictions })
      .from(users)
      .where(eq(users.id, menu.userId))
      .limit(1)
    const restrictions: string[] = user?.restrictions ?? []
    const memRegen = await getMemoryForUser(menu.userId).catch(() => null)
    const dislikesValRegen = memRegen?.dislikes?.value
    const dislikesRegen: string[] = Array.isArray(dislikesValRegen) ? (dislikesValRegen as string[]) : []
    const equipValRegen = memRegen?.equipment?.value
    const availEquipRegen = Array.isArray(equipValRegen)
      ? new Set<string>((equipValRegen as string[]).map(normaliseEquipment))
      : undefined
    const SPANISH_DAY_KEYS_REGEN = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const
    const timeValRegen = memRegen?.time_available?.value as Record<string, number> | undefined
    const maxPrepRegen = timeValRegen && typeof timeValRegen === 'object'
      ? (timeValRegen[SPANISH_DAY_KEYS_REGEN[day]] ?? null)
      : null

    const favScopeRegen = await resolveScope(menu.userId)
    const favRowsRegen = await db
      .select({ recipeId: userFavorites.recipeId })
      .from(userFavorites)
      .where(scopeWhere(userFavorites.userId, userFavorites.householdId, favScopeRegen))
    const favoriteRecipeIdsRegen = new Set<string>(favRowsRegen.map((f: any) => f.recipeId))

    const allRecipesRegen = await db.select().from(recipes)
    const riRowsRegen = await db
      .select({
        recipeId: recipeIngredients.recipeId,
        ingredientId: recipeIngredients.ingredientId,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        ingredientName: ingredients.name,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))

    const ingredientsByRecipeRegen = new Map<string, any[]>()
    for (const row of riRowsRegen) {
      const list = ingredientsByRecipeRegen.get(row.recipeId) ?? []
      list.push({
        ingredientId: row.ingredientId,
        ingredientName: row.ingredientName,
        quantity: row.quantity,
        unit: row.unit ?? 'g',
      })
      ingredientsByRecipeRegen.set(row.recipeId, list)
    }
    const recipesWithIngredientsRegen = allRecipesRegen.map((r: any) => ({
      id: r.id,
      name: r.name,
      course: r.course ?? null,
      meals: r.meals ?? [],
      seasons: r.seasons ?? [],
      tags: r.tags ?? [],
      equipment: r.equipment ?? [],
      prepTime: r.prepTime ?? null,
      ingredients: ingredientsByRecipeRegen.get(r.id) ?? [],
    }))

    const matcherOptionsRegen = {
      meal: meal as Meal,
      season: detectSeason(),
      usedRecipeIds,
      restrictions,
      favoriteRecipeIds: favoriteRecipeIdsRegen,
      bannedRecipeIds: new Set(menu.bannedRecipeIds ?? []),
      dislikes: dislikesRegen,
      availableEquipment: availEquipRegen,
      maxPrepMinutes: maxPrepRegen,
    }

    const picked = findForCourse(recipesWithIngredientsRegen, dish.course ?? null, matcherOptionsRegen)
    if (!picked) {
      res.status(409).json({ error: 'No candidates for this course right now' }); return
    }
    const next = [...slot.dishes]
    next[position] = {
      kind: 'recipe',
      recipeId: picked.id,
      recipeName: picked.name,
      course: picked.course ?? null,
    }
    days[day][meal] = { ...slot, dishes: next }
    await db.update(menus).set({ days: days as any }).where(eq(menus.id, menuId))
    res.json({ dish: next[position] })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// B.5 follow-up: POST /menu/:menuId/day/:day/meal/:meal/dish/random — pick a
// random recipe via the matcher and APPEND it to dishes[]. Used by the
// "Aleatorio" option in <AddDishSheet> where the user wants the matcher to
// fill the slot with a sensible main / null-course recipe without typing.
router.post('/menu/:menuId/day/:day/meal/:meal/dish/random', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = Number(req.params.day)
    const meal = String(req.params.meal)
    const [menu] = await db.select().from(menus).where(eq(menus.id, menuId)).limit(1)
    if (!menu) { res.status(404).json({ error: 'Menu not found' }); return }
    const days = menu.days as DayMenu[]
    const slot = days[day]?.[meal] ?? { servings: null, dishes: [] }

    // Used-recipe-ids: every recipe-dish in the menu, so we don't repeat.
    const usedRecipeIds = new Set<string>()
    for (let d = 0; d < days.length; d++) {
      for (const m of Object.keys(days[d] ?? {})) {
        const s = days[d]?.[m]
        if (!s) continue
        for (const dsh of s.dishes) {
          if (dsh.kind === 'recipe') usedRecipeIds.add(dsh.recipeId)
        }
      }
    }

    const [user] = await db
      .select({ restrictions: users.restrictions })
      .from(users)
      .where(eq(users.id, menu.userId))
      .limit(1)
    const restrictions: string[] = user?.restrictions ?? []
    const memR = await getMemoryForUser(menu.userId).catch(() => null)
    const dislikesValR = memR?.dislikes?.value
    const dislikesR: string[] = Array.isArray(dislikesValR) ? (dislikesValR as string[]) : []
    const equipValR = memR?.equipment?.value
    const availEquipR = Array.isArray(equipValR)
      ? new Set<string>((equipValR as string[]).map(normaliseEquipment))
      : undefined
    const SPANISH_DAY_KEYS_R = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const
    const timeValR = memR?.time_available?.value as Record<string, number> | undefined
    const maxPrepR = timeValR && typeof timeValR === 'object'
      ? (timeValR[SPANISH_DAY_KEYS_R[day]] ?? null)
      : null

    const favScopeR = await resolveScope(menu.userId)
    const favRowsR = await db
      .select({ recipeId: userFavorites.recipeId })
      .from(userFavorites)
      .where(scopeWhere(userFavorites.userId, userFavorites.householdId, favScopeR))
    const favoriteRecipeIdsR = new Set<string>(favRowsR.map((f: any) => f.recipeId))

    const allRecipesR = await db.select().from(recipes)
    const riRowsR = await db
      .select({
        recipeId: recipeIngredients.recipeId,
        ingredientId: recipeIngredients.ingredientId,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        ingredientName: ingredients.name,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    const ingredientsByRecipeR = new Map<string, any[]>()
    for (const row of riRowsR) {
      const list = ingredientsByRecipeR.get(row.recipeId) ?? []
      list.push({ ingredientId: row.ingredientId, ingredientName: row.ingredientName, quantity: row.quantity, unit: row.unit ?? 'g' })
      ingredientsByRecipeR.set(row.recipeId, list)
    }
    const recipesWithIngredientsR = allRecipesR.map((r: any) => ({
      id: r.id, name: r.name, course: r.course ?? null,
      meals: r.meals ?? [], seasons: r.seasons ?? [],
      tags: r.tags ?? [], equipment: r.equipment ?? [],
      prepTime: r.prepTime ?? null,
      ingredients: ingredientsByRecipeR.get(r.id) ?? [],
    }))

    const matcherOptionsR = {
      meal: meal as Meal,
      season: detectSeason(),
      usedRecipeIds,
      restrictions,
      favoriteRecipeIds: favoriteRecipeIdsR,
      bannedRecipeIds: new Set(menu.bannedRecipeIds ?? []),
      dislikes: dislikesR,
      availableEquipment: availEquipR,
      maxPrepMinutes: maxPrepR,
    }

    // Decide which course to look for, based on the user's plantilla
    // (`mealDishCounts[meal]`) and what's already in the slot. The user wants
    // a sensible *next* dish, not just "any main / null".
    //
    // Rules:
    //   - Read expectedCourses = coursesFor(dishCountFor(meal, mdc)).
    //   - Subtract courses already present in the slot.
    //   - Pick the first missing expected course.
    //   - If all expected are present, fall back to `null` (any main/null) as
    //     a graceful "extra dish" — the user's intent is to grow the slot.
    const [settingsRow] = await db
      .select({ template: userSettings.template })
      .from(userSettings)
      .where(eq(userSettings.userId, menu.userId))
      .limit(1)
    const mdc = extractMealDishCounts(settingsRow?.template ?? {})
    const expectedCourses = coursesFor(dishCountFor(meal as Meal, mdc))
    const presentCourses = new Set<string | null>(
      slot.dishes
        .filter((d): d is RecipeDish => d.kind === 'recipe')
        .map((d) => d.course ?? null),
    )
    // Find the first expected course not yet present. null counts as "main"
    // for matching purposes (the convention is "main/null → main slot").
    const normalisedPresent = new Set([...presentCourses].map((c) => c ?? 'main'))
    const nextCourse =
      expectedCourses
        .map((c) => (c ?? 'main') as 'starter' | 'main' | 'dessert')
        .find((c) => !normalisedPresent.has(c)) ?? null
    // Also build an ingredient-overlap exclude set to avoid repeats like
    // "carrilleras de ternera + ternera con pimientos" in the same slot.
    const existingIngredientNames = new Set<string>()
    for (const dish of slot.dishes) {
      if (dish.kind !== 'recipe') continue
      const ing = ingredientsByRecipeR.get(dish.recipeId) ?? []
      for (const i of ing.slice(0, 5)) {
        existingIngredientNames.add((i.ingredientName as string).toLowerCase())
      }
    }
    const diversityFilteredPool = existingIngredientNames.size === 0
      ? recipesWithIngredientsR
      : recipesWithIngredientsR.filter((r) => {
          // Allow up to 1 ingredient overlap so the filter doesn't empty the pool;
          // 2+ overlapping ingredients → drop (likely the "same dish, different name").
          let overlap = 0
          for (const i of (r.ingredients ?? []).slice(0, 5)) {
            if (existingIngredientNames.has((i.ingredientName as string).toLowerCase())) overlap++
            if (overlap >= 2) return false
          }
          return true
        })

    // courseForMatcher: when the slot is empty (no dishes yet), pass null so
    // the matcher's "single-dish convention" (main OR null) applies and we get
    // a versatile recipe. When the slot already has dishes, we want a STRICT
    // course match — a starter+main pairing should produce a real main, not a
    // null-tagged side. Otherwise the second dish often duplicates the
    // protein or has no protein at all (the "2 ternera" / "no protein" bug
    // Miguel reported on 2026-06-08).
    const slotHasDishes = slot.dishes.length > 0
    const courseForMatcher: 'starter' | 'main' | 'dessert' | null =
      slotHasDishes
        ? (nextCourse === 'main' ? 'main' : nextCourse)
        : (nextCourse === 'main' ? null : nextCourse)
    // First try with the diversity filter applied; if no candidates, fall back
    // to the full pool — the user gets *something* rather than nothing.
    let picked = findForCourse(diversityFilteredPool, courseForMatcher, matcherOptionsR)
    if (!picked) picked = findForCourse(recipesWithIngredientsR, courseForMatcher, matcherOptionsR)
    if (!picked) {
      res.status(409).json({ error: 'No hay recetas disponibles ahora mismo.' }); return
    }
    const next = [...slot.dishes, {
      kind: 'recipe' as const,
      recipeId: picked.id,
      recipeName: picked.name,
      course: picked.course ?? null,
    }]
    if (!days[day]) days[day] = {}
    days[day][meal] = { ...slot, dishes: next }
    await db.update(menus).set({ days: days as any }).where(eq(menus.id, menuId))
    res.json({ position: next.length - 1, dish: next[next.length - 1] })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
