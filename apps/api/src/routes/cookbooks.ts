/**
 * Cookbooks REST surface (PR 8A).
 *
 *   GET    /cookbooks                                 — list (with recipe counts)
 *   POST   /cookbooks                                 — create
 *   GET    /cookbooks/:id                             — detail + recipes
 *   PATCH  /cookbooks/:id                             — rename / description / emoji
 *   DELETE /cookbooks/:id                             — hard delete
 *   POST   /cookbooks/:id/recipes/:recipeId           — add recipe (idempotent)
 *   DELETE /cookbooks/:id/recipes/:recipeId           — remove recipe
 *   GET    /recipes/:recipeId/cookbooks               — which household cookbooks contain this recipe
 *
 * All routes are auth-only and household-scoped.
 */

import { Router } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  addRecipeToCookbook,
  createCookbookForUser,
  deleteCookbookForUser,
  getCookbookForUser,
  listCookbooksForRecipe,
  listCookbooksForUser,
  NoHouseholdError,
  patchCookbookForUser,
  removeRecipeFromCookbook,
  validateCookbookDescription,
  validateCookbookEmoji,
  validateCookbookName,
} from '../services/cookbooksStore.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const router = Router()
router.use(authMiddleware)

router.get('/cookbooks', async (req: AuthRequest, res) => {
  try {
    const rows = await listCookbooksForUser(req.userId!)
    res.json(rows)
  } catch (err) {
    console.error('GET /cookbooks error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/cookbooks', async (req: AuthRequest, res) => {
  try {
    const name = validateCookbookName(req.body?.name)
    if (!name.ok) {
      res.status(400).json({ error: name.reason })
      return
    }
    const description = validateCookbookDescription(req.body?.description)
    if (!description.ok) {
      res.status(400).json({ error: description.reason })
      return
    }
    const emoji = validateCookbookEmoji(req.body?.emoji)
    if (!emoji.ok) {
      res.status(400).json({ error: emoji.reason })
      return
    }
    const row = await createCookbookForUser(req.userId!, {
      name: name.value,
      description: description.value,
      emoji: emoji.value,
    })
    res.status(201).json(row)
  } catch (err) {
    if (err instanceof NoHouseholdError) {
      res.status(400).json({ error: err.message, code: 'NO_HOUSEHOLD' })
      return
    }
    console.error('POST /cookbooks error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/cookbooks/:id', async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id)
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'id must be a UUID' })
      return
    }
    const book = await getCookbookForUser(req.userId!, id)
    if (!book) {
      res.status(404).json({ error: 'Cookbook not found' })
      return
    }
    res.json(book)
  } catch (err) {
    console.error('GET /cookbooks/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/cookbooks/:id', async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id)
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'id must be a UUID' })
      return
    }
    const patch: { name?: string; description?: string | null; emoji?: string | null } = {}
    if (req.body?.name !== undefined) {
      const v = validateCookbookName(req.body.name)
      if (!v.ok) {
        res.status(400).json({ error: v.reason })
        return
      }
      patch.name = v.value
    }
    if (req.body?.description !== undefined) {
      const v = validateCookbookDescription(req.body.description)
      if (!v.ok) {
        res.status(400).json({ error: v.reason })
        return
      }
      patch.description = v.value
    }
    if (req.body?.emoji !== undefined) {
      const v = validateCookbookEmoji(req.body.emoji)
      if (!v.ok) {
        res.status(400).json({ error: v.reason })
        return
      }
      patch.emoji = v.value
    }
    const row = await patchCookbookForUser(req.userId!, id, patch)
    if (!row) {
      res.status(404).json({ error: 'Cookbook not found' })
      return
    }
    res.json(row)
  } catch (err) {
    console.error('PATCH /cookbooks/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/cookbooks/:id', async (req: AuthRequest, res) => {
  try {
    const id = String(req.params.id)
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: 'id must be a UUID' })
      return
    }
    const ok = await deleteCookbookForUser(req.userId!, id)
    if (!ok) {
      res.status(404).json({ error: 'Cookbook not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    console.error('DELETE /cookbooks/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/cookbooks/:id/recipes/:recipeId', async (req: AuthRequest, res) => {
  try {
    const cookbookId = String(req.params.id)
    const recipeId = String(req.params.recipeId)
    if (!UUID_RE.test(cookbookId) || !UUID_RE.test(recipeId)) {
      res.status(400).json({ error: 'IDs must be UUIDs' })
      return
    }
    const ok = await addRecipeToCookbook(req.userId!, cookbookId, recipeId)
    if (!ok) {
      res.status(404).json({ error: 'Cookbook not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    console.error('POST /cookbooks/:id/recipes/:recipeId error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/cookbooks/:id/recipes/:recipeId', async (req: AuthRequest, res) => {
  try {
    const cookbookId = String(req.params.id)
    const recipeId = String(req.params.recipeId)
    if (!UUID_RE.test(cookbookId) || !UUID_RE.test(recipeId)) {
      res.status(400).json({ error: 'IDs must be UUIDs' })
      return
    }
    const ok = await removeRecipeFromCookbook(req.userId!, cookbookId, recipeId)
    if (!ok) {
      res.status(404).json({ error: 'Cookbook not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    console.error('DELETE /cookbooks/:id/recipes/:recipeId error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/recipes/:recipeId/cookbooks', async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.recipeId)
    if (!UUID_RE.test(recipeId)) {
      res.status(400).json({ error: 'recipeId must be a UUID' })
      return
    }
    const rows = await listCookbooksForRecipe(req.userId!, recipeId)
    res.json(rows)
  } catch (err) {
    console.error('GET /recipes/:id/cookbooks error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
