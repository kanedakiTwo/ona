import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { users, userSettings } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { updateProfileSchema, onboardingSchema } from '@ona/shared'

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
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, req.params.id))
      .limit(1)

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json(user)
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

export default router
