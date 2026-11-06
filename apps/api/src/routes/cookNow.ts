/**
 * «Cocinar ahora» (specs/cook-now.md):
 *   GET  /cook-now/today     the meal of now, what was planned, where it can move
 *   POST /cook-now/proposal  { minutes, servings, canBuy, requirePantryUse? } → 0–3 recipes
 *   POST /cook-now/phrase    { recipeId } → { text | null } (Mimo's line, Task 12)
 *   POST /cook-now/choose    { recipeId, servings, displacedTo } → puts it in the meal of now
 */
import { Router } from 'express'
import { cookNowChooseSchema, cookNowProposalSchema } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { requireActiveAccount } from '../services/accountAccess.js'
import { chooseCookNowRecipe, findCookNowProposal, loadCookNowToday } from '../services/cookNow/load.js'

const router = Router()
router.use('/cook-now', authMiddleware)

router.get('/cook-now/today', async (req: AuthRequest, res) => {
  try {
    const t = await loadCookNowToday(req.userId!)
    res.json({ weekStart: t.weekStart, day: t.day, meal: t.meal, menuId: t.menu?.id ?? null, planned: t.planned, locked: t.locked, slotServings: t.slotServings, targets: t.targets })
  } catch (err) {
    console.error('GET /cook-now/today error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/cook-now/proposal', async (req: AuthRequest, res) => {
  const parsed = cookNowProposalSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Respuestas no válidas', issues: parsed.error.issues })
    return
  }
  try {
    res.json(await findCookNowProposal(req.userId!, parsed.data))
  } catch (err) {
    console.error('POST /cook-now/proposal error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/cook-now/choose', requireActiveAccount(), async (req: AuthRequest, res) => {
  const parsed = cookNowChooseSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Elección no válida', issues: parsed.error.issues })
    return
  }
  try {
    const result = await chooseCookNowRecipe(req, parsed.data)
    if (!result.placed && result.reason === 'bad_target') {
      res.status(400).json({ error: 'Ese día no está libre para pasar lo planeado' })
      return
    }
    res.json(result)
  } catch (err) {
    console.error('POST /cook-now/choose error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
