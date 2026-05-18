/**
 * Recipe-photos REST surface (PR 8C). Household-shared gallery on top of
 * the recipe's hero image.
 *
 *   GET    /recipes/:recipeId/photos               — list household gallery
 *   POST   /recipes/:recipeId/photos               — multipart upload, max 8 MB
 *   DELETE /recipes/:recipeId/photos/:photoId      — owner / member only
 */

import { Router } from 'express'
import multer from 'multer'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  deletePhotoForUser,
  listPhotosForRecipe,
  NoHouseholdError,
  uploadPhotoForRecipe,
} from '../services/recipePhotosStore.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
    cb(null, allowed.includes(file.mimetype))
  },
})

const router = Router()
router.use(authMiddleware)

router.get('/recipes/:recipeId/photos', async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.recipeId)
    if (!UUID_RE.test(recipeId)) {
      res.status(400).json({ error: 'recipeId must be a UUID' })
      return
    }
    const rows = await listPhotosForRecipe(req.userId!, recipeId)
    res.json(rows)
  } catch (err) {
    console.error('GET /recipes/:id/photos error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/recipes/:recipeId/photos', upload.single('photo'), async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.recipeId)
    if (!UUID_RE.test(recipeId)) {
      res.status(400).json({ error: 'recipeId must be a UUID' })
      return
    }
    if (!req.file) {
      res.status(400).json({ error: 'Falta el archivo `photo` (formato jpg / png / webp / heic, ≤ 8 MB)' })
      return
    }
    const caption = typeof req.body?.caption === 'string' ? req.body.caption : null
    const row = await uploadPhotoForRecipe(req.userId!, recipeId, {
      bytes: req.file.buffer,
      caption,
    })
    res.status(201).json(row)
  } catch (err) {
    if (err instanceof NoHouseholdError) {
      res.status(400).json({ error: err.message, code: 'NO_HOUSEHOLD' })
      return
    }
    console.error('POST /recipes/:id/photos error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.delete('/recipes/:recipeId/photos/:photoId', async (req: AuthRequest, res) => {
  try {
    const recipeId = String(req.params.recipeId)
    const photoId = String(req.params.photoId)
    if (!UUID_RE.test(recipeId) || !UUID_RE.test(photoId)) {
      res.status(400).json({ error: 'IDs must be UUIDs' })
      return
    }
    const ok = await deletePhotoForUser(req.userId!, photoId)
    if (!ok) {
      res.status(404).json({ error: 'Photo not found' })
      return
    }
    res.status(204).send()
  } catch (err) {
    console.error('DELETE /recipes/:id/photos/:id error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
