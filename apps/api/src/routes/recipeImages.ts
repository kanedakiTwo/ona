/**
 * Recipe images from the photo volume in prod (or the
 * `apps/web/public/images/recipes` dir in dev). Filenames include the
 * recipe id, so the bytes for a given URL are stable until regeneration —
 * long-cache + Cache-Control: immutable. The frontend bumps a `?v=<updatedAt>`
 * query when the recipe changes to bust the cache without affecting headers.
 *
 * PRO-1318: a file that isn't there answers 404 (it used to reach the error
 * handler and come out as a 500). The recipes that still point at a missing
 * file go back to the photo queue (recipeImageFiles.ts).
 */
import express, { Router } from 'express'

export function createRecipeImagesRouter(dir: string): Router {
  const router = Router()
  router.use('/images/recipes', express.static(dir, { immutable: true, maxAge: '365d' }))
  router.use('/images/recipes', (_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })
  return router
}
