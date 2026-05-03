import { Router } from 'express'
import { eq, ilike } from 'drizzle-orm'
import { db } from '../db/connection.js'
import {
  recipeIngredients,
  recipes,
  users,
  userSettings,
} from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { updateProfileSchema, onboardingSchema } from '@ona/shared'
import { env } from '../config/env.js'

const router = Router()

// All routes require auth
router.use(authMiddleware)

// GET /user/:id
router.get('/user/:id', async (req, res) => {
  try {
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        sex: users.sex,
        age: users.age,
        weight: users.weight,
        height: users.height,
        activityLevel: users.activityLevel,
        householdSize: users.householdSize,
        adults: users.adults,
        kidsCount: users.kidsCount,
        cookingFreq: users.cookingFreq,
        restrictions: users.restrictions,
        favoriteDishes: users.favoriteDishes,
        priority: users.priority,
        onboardingDone: users.onboardingDone,
        imageGenMonthKey: users.imageGenMonthKey,
        imageGenCount: users.imageGenCount,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, req.params.id))
      .limit(1)

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    // Surface the AI-image quota in a stable shape. The raw count is only
    // meaningful when paired with the current month — return 0 when the
    // stored key is from a previous month (the next regen will reset it).
    const monthKey = new Date().toISOString().slice(0, 7)
    const used = user.imageGenMonthKey === monthKey ? (user.imageGenCount ?? 0) : 0
    const { imageGenMonthKey: _omit1, imageGenCount: _omit2, ...rest } = user

    res.json({
      ...rest,
      imageGenQuota: { used, limit: env.IMAGE_GEN_MONTHLY_LIMIT, monthKey },
    })
  } catch (err) {
    console.error('Get user error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /user/:id
router.put('/user/:id', validate(updateProfileSchema), async (req: AuthRequest, res) => {
  try {
    if (req.userId !== req.params.id) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const [updated] = await db
      .update(users)
      .set(req.body)
      .where(eq(users.id, req.params.id))
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        sex: users.sex,
        age: users.age,
        weight: users.weight,
        height: users.height,
        activityLevel: users.activityLevel,
        householdSize: users.householdSize,
        adults: users.adults,
        kidsCount: users.kidsCount,
        cookingFreq: users.cookingFreq,
        restrictions: users.restrictions,
        favoriteDishes: users.favoriteDishes,
        priority: users.priority,
        onboardingDone: users.onboardingDone,
        createdAt: users.createdAt,
      })

    if (!updated) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json(updated)
  } catch (err) {
    console.error('Update user error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /user/:id/onboarding
router.post('/user/:id/onboarding', validate(onboardingSchema), async (req: AuthRequest, res) => {
  try {
    if (req.userId !== req.params.id) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const { adults, kidsCount, cookingFreq, restrictions, favoriteDishes, priority } = req.body

    const [updated] = await db
      .update(users)
      .set({
        adults,
        kidsCount,
        // Clear the deprecated enum so it doesn't shadow the new fields.
        householdSize: null,
        cookingFreq,
        restrictions,
        favoriteDishes,
        priority,
        onboardingDone: true,
      })
      .where(eq(users.id, req.params.id))
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        householdSize: users.householdSize,
        adults: users.adults,
        kidsCount: users.kidsCount,
        cookingFreq: users.cookingFreq,
        restrictions: users.restrictions,
        favoriteDishes: users.favoriteDishes,
        priority: users.priority,
        onboardingDone: users.onboardingDone,
      })

    if (!updated) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json(updated)
  } catch (err) {
    console.error('Onboarding error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /user/:id/settings
router.get('/user/:id/settings', async (req: AuthRequest, res) => {
  try {
    if (req.userId !== req.params.id) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const [settings] = await db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, req.params.id))
      .limit(1)

    res.json(settings ?? { userId: req.params.id, template: [] })
  } catch (err) {
    console.error('Get settings error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /user/:id/settings
router.put('/user/:id/settings', async (req: AuthRequest, res) => {
  try {
    if (req.userId !== req.params.id) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const { template } = req.body

    const [existing] = await db
      .select({ id: userSettings.id })
      .from(userSettings)
      .where(eq(userSettings.userId, req.params.id))
      .limit(1)

    let result
    if (existing) {
      [result] = await db
        .update(userSettings)
        .set({ template })
        .where(eq(userSettings.userId, req.params.id))
        .returning()
    } else {
      [result] = await db
        .insert(userSettings)
        .values({ userId: req.params.id, template })
        .returning()
    }

    res.json(result)
  } catch (err) {
    console.error('Update settings error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /user/:id/recipes-curator/gaps
//
// Surfaces every recipe the user authored, plus a per-recipe set of "status
// pills" the UI uses to flag missing data. This powers the "Mis recetas"
// tab inside `/profile` so users can spot recipes that need a touch-up
// (no nutrition computed yet, ingredients auto-added by the importer, etc.).
//
// The marker `note ILIKE '%añadido automáticamente%'` is the same string
// the article importer writes when it had to invent a recipe_ingredients
// row from a free-text reference — flagging that lets the user correct
// quantities or units before the row pollutes future shopping lists.
router.get('/user/:id/recipes-curator/gaps', async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.id)
    if (req.userId !== userId) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const owned = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        imageUrl: recipes.imageUrl,
        servings: recipes.servings,
        totalTime: recipes.totalTime,
        equipment: recipes.equipment,
        allergens: recipes.allergens,
        nutritionPerServing: recipes.nutritionPerServing,
        updatedAt: recipes.updatedAt,
      })
      .from(recipes)
      .where(eq(recipes.authorId, userId))

    if (owned.length === 0) {
      res.json({
        recipes: [],
        counts: { total: 0, sinNutricion: 0, ingredientesPendientesRevision: 0 },
      })
      return
    }

    // Find auto-added ingredient rows for the recipes we just read. We
    // pull every flagged row (the table is small) and filter to the
    // user's recipe ids in memory — keeps the SQL portable.
    const autoMarker = '%añadido automáticamente%'
    const recipeIds = new Set(owned.map((r) => r.id))
    const flagged = await db
      .selectDistinct({ recipeId: recipeIngredients.recipeId })
      .from(recipeIngredients)
      .where(ilike(recipeIngredients.note, autoMarker))
    const flaggedSet = new Set(
      flagged.filter((f) => recipeIds.has(f.recipeId)).map((f) => f.recipeId),
    )

    let sinNutricion = 0
    let ingredientesPendientesRevision = 0

    const out = owned.map((r) => {
      const npp = r.nutritionPerServing as { kcal?: number | null } | null
      const kcal = npp?.kcal ?? null
      const equipment = (r.equipment as string[] | null) ?? []
      const allergens = (r.allergens as string[] | null) ?? []
      const totalTime = r.totalTime
      const hasAuto = flaggedSet.has(r.id)

      const statusPills: string[] = []
      if (kcal == null || kcal === 0) {
        statusPills.push('sin nutrición')
        sinNutricion++
      }
      if (hasAuto) {
        statusPills.push('ingredientes auto-añadidos')
        ingredientesPendientesRevision++
      }
      if (equipment.length === 0) statusPills.push('sin equipo')
      if (totalTime == null || totalTime === 0) statusPills.push('sin tiempo')

      return {
        id: r.id,
        name: r.name,
        imageUrl: r.imageUrl,
        servings: r.servings,
        kcal: kcal == null || kcal === 0 ? null : kcal,
        allergens,
        totalTime,
        updatedAt: r.updatedAt,
        statusPills,
      }
    })

    // Newest first by updatedAt so users see what they just edited.
    out.sort((a, b) => {
      const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
      const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      return bt - at
    })

    res.json({
      recipes: out,
      counts: {
        total: out.length,
        sinNutricion,
        ingredientesPendientesRevision,
      },
    })
  } catch (err) {
    console.error('GET /user/:id/recipes-curator/gaps error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
