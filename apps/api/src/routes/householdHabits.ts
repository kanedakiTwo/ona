/**
 * How the household cooks (PRO-217, specs/household-profile.md).
 *
 *   GET /household/cooking-style        → { style | null, canEdit }
 *   PUT /household/cooking-style { style } → { style, changed }
 *
 * The same route for Perfil and for Mimo (`set_cooking_style`, which calls it
 * as the user over loopback): both land on the same `cooking_style` fact of
 * the caller's primary household. Per-route auth, mounted before the
 * catch-all routers.
 */
import { Router } from 'express'
import { COOKING_STYLE_PATH, setCookingStyleSchema } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { menuEditWho } from '../services/menuEdits.js'
import { cookingStyleHousehold, getCookingStyle, setCookingStyle, type CookingStyleSignal } from '../services/profile/cookingStyle.js'

const router = Router()

router.get(COOKING_STYLE_PATH, authMiddleware, async (req: AuthRequest, res) => {
  try {
    const home = await cookingStyleHousehold(req.userId!)
    if (!home) {
      res.json({ style: null, canEdit: false })
      return
    }
    res.json({ style: await getCookingStyle(home.householdId), canEdit: home.canEdit })
  } catch (err) {
    console.error('[cooking-style] get failed:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put(COOKING_STYLE_PATH, authMiddleware, validate(setCookingStyleSchema), async (req: AuthRequest, res) => {
  try {
    const home = await cookingStyleHousehold(req.userId!)
    if (!home) {
      res.status(404).json({ error: 'No tienes hogar' })
      return
    }
    if (!home.canEdit) {
      res.status(403).json({ error: 'Solo los adultos del hogar pueden cambiarlo' })
      return
    }
    const who = menuEditWho(req)
    const signal: CookingStyleSignal = who.actor === 'user' ? 'profile' : who.channel === 'whatsapp' ? 'whatsapp' : 'chat'
    const out = await setCookingStyle({ householdId: home.householdId, style: req.body.style, origin: 'user', actorUserId: req.userId!, signal })
    res.json(out)
  } catch (err) {
    console.error('[cooking-style] put failed:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
