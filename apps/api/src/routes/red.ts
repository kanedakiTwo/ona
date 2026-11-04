/**
 * Red de tiendas v2 (specs/shop-orders.md → «Red de tiendas», ona-hq D-165).
 * Only for RED_TIENDAS_EMAILS: everyone else gets `enabled: false` or 403.
 *
 *   GET  /red/status       — { enabled, postalCode }
 *   PUT  /red/postal-code  — { postalCode } → saved; Red copies checked against it
 *   POST /red/choice       — { kind, choice: red|super, redShopId? } → the household's shops
 */
import { Router, type Response } from 'express'
import { postalCodeSchema, redChoiceSchema, type RedKind } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { getPrimaryHouseholdId } from '../services/scopeResolver.js'
import { redEnabledFor } from '../services/red/flag.js'
import { redCandidates } from '../services/red/assign.js'
import { activeRedShops, assignRedShop, forgetSuperChoice, getHouseholdRed, keepKindAtSuper, setHouseholdPostalCode, toLite } from '../services/red/store.js'
import { listShops } from '../services/shopOrders/store.js'

const router = Router()
router.use('/red', authMiddleware)

function fail(res: Response, err: unknown, where: string) {
  console.error(`${where} error:`, err)
  res.status(500).json({ error: 'Internal server error' })
}

async function gate(req: AuthRequest, res: Response): Promise<string | null> {
  if (!(await redEnabledFor(req.userId!))) {
    res.status(403).json({ error: 'No disponible.' })
    return null
  }
  const hh = await getPrimaryHouseholdId(req.userId!)
  if (!hh) {
    res.status(400).json({ error: 'Tu cuenta aún no tiene un hogar asignado.' })
    return null
  }
  return hh
}

router.get('/red/status', async (req: AuthRequest, res) => {
  try {
    const enabled = await redEnabledFor(req.userId!)
    const hh = enabled ? await getPrimaryHouseholdId(req.userId!) : null
    res.json({ enabled, postalCode: hh ? (await getHouseholdRed(hh)).postalCode : null })
  } catch (err) {
    fail(res, err, 'GET /red/status')
  }
})

router.put('/red/postal-code', async (req: AuthRequest, res) => {
  try {
    const hh = await gate(req, res)
    if (!hh) return
    const parsed = postalCodeSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Código postal no válido' })
    await setHouseholdPostalCode(hh, parsed.data.postalCode)
    res.json({ postalCode: parsed.data.postalCode })
  } catch (err) {
    fail(res, err, 'PUT /red/postal-code')
  }
})

router.post('/red/choice', async (req: AuthRequest, res) => {
  try {
    const hh = await gate(req, res)
    if (!hh) return
    const parsed = redChoiceSchema.safeParse(req.body)
    if (!parsed.success) return void res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' })
    const { kind, choice, redShopId } = parsed.data
    if (choice === 'super') {
      await keepKindAtSuper(hh, kind)
    } else {
      const { postalCode } = await getHouseholdRed(hh)
      if (!postalCode) return void res.status(400).json({ error: 'Falta tu código postal.' })
      const red = await activeRedShops()
      const shop = red.find((r) => r.id === redShopId)
      const ok = shop && redCandidates(kind as RedKind, postalCode, [toLite(shop)]).length > 0
      if (!shop || !ok) return void res.status(404).json({ error: 'Esa tienda de la Red no llega a tu código postal.' })
      await forgetSuperChoice(hh, kind)
      const id = await assignRedShop(hh, shop, postalCode)
      if (!id) return void res.status(400).json({ error: 'Máximo 20 tiendas por hogar.' })
    }
    res.json({ shops: await listShops(req.userId!) })
  } catch (err) {
    fail(res, err, 'POST /red/choice')
  }
})

export default router
