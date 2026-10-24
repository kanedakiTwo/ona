/**
 * «Tiendas de Mimoia» REST surface (PRO-358; specs/shop-orders.md →
 * «Tiendas de Mimoia»). Mounted from routes/shopOrders.ts.
 *
 *   GET   /shop-network                  — the shops of the Red covering the household, in order, + its postal code
 *   POST  /shop-network/:id/adopt        — { alreadyCustomer } («¿Ya le comprabas?») → the household's new shop
 *   PUT   /household/postal-code         — { postalCode } → the household's ficha
 *
 *   GET   /admin/shop-network            — every shop of the Red with the households it got from the Red
 *   POST  /admin/shop-network            — alta
 *   PATCH /admin/shop-network/:id        — full edit, or { status } alone («no acepta hogares nuevos», baja, activa)
 */
import { Router, type Response } from 'express'
import type { z } from 'zod'
import { adoptNetworkShopSchema, networkShopInputSchema, networkShopStatusSchema, setPostalCodeSchema } from '@ona/shared'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { CHANNEL_HEADER } from '../services/menuEdits.js'
import { cookingStyleHousehold } from '../services/profile/cookingStyle.js'
import { setPostalCode, type PostalCodeSignal } from '../services/profile/postalCode.js'
import { adoptNetworkShop, createNetworkShop, householdNetworkView, listNetworkShopsAdmin, updateNetworkShop } from '../services/shopNetwork.js'
import { ShopOrderError } from '../services/shopOrders/store.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(res: Response, err: unknown, where: string) {
  if (err instanceof ShopOrderError) {
    res.status(err.status).json({ error: err.message, code: err.code })
    return
  }
  console.error(`${where} error:`, err)
  res.status(500).json({ error: 'Internal server error' })
}

function badRequest(res: Response, issues: z.ZodIssue[]) {
  res.status(400).json({ error: issues[0]?.message ?? 'Datos inválidos', issues })
}

/** Mimo calls these routes as the user over loopback with the conversation's channel (appApi.ts). */
function signalOf(req: AuthRequest): PostalCodeSignal {
  const ch = req.get(CHANNEL_HEADER)
  if (ch === 'whatsapp') return 'whatsapp'
  if (ch === 'web') return 'chat'
  return 'tiendas'
}

const router = Router()

router.get('/shop-network', authMiddleware, async (req: AuthRequest, res) => {
  try {
    res.json(await householdNetworkView(req.userId!))
  } catch (err) {
    fail(res, err, 'GET /shop-network')
  }
})

router.post('/shop-network/:id/adopt', authMiddleware, async (req: AuthRequest, res) => {
  if (!UUID_RE.test(String(req.params.id))) return void res.status(404).json({ error: 'Tienda no encontrada.' })
  const parsed = adoptNetworkShopSchema.safeParse(req.body ?? {})
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  try {
    res.status(201).json(await adoptNetworkShop(req.userId!, String(req.params.id), parsed.data.alreadyCustomer))
  } catch (err) {
    fail(res, err, 'POST /shop-network/:id/adopt')
  }
})

router.put('/household/postal-code', authMiddleware, async (req: AuthRequest, res) => {
  const parsed = setPostalCodeSchema.safeParse(req.body ?? {})
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  try {
    const hh = await cookingStyleHousehold(req.userId!)
    if (!hh) return void res.status(400).json({ error: 'Tu cuenta aún no tiene un hogar asignado.', code: 'NO_HOUSEHOLD' })
    if (!hh.canEdit) return void res.status(403).json({ error: 'Solo los adultos del hogar pueden cambiarlo.', code: 'CHILD' })
    res.json(await setPostalCode({ householdId: hh.householdId, code: parsed.data.postalCode, actorUserId: req.userId!, signal: signalOf(req) }))
  } catch (err) {
    fail(res, err, 'PUT /household/postal-code')
  }
})

router.get('/admin/shop-network', authMiddleware, requireAdmin, async (_req: AuthRequest, res) => {
  try {
    res.json(await listNetworkShopsAdmin())
  } catch (err) {
    fail(res, err, 'GET /admin/shop-network')
  }
})

router.post('/admin/shop-network', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  const parsed = networkShopInputSchema.safeParse(req.body ?? {})
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  try {
    res.status(201).json(await createNetworkShop(req.userId!, parsed.data))
  } catch (err) {
    fail(res, err, 'POST /admin/shop-network')
  }
})

router.patch('/admin/shop-network/:id', authMiddleware, requireAdmin, async (req: AuthRequest, res) => {
  if (!UUID_RE.test(String(req.params.id))) return void res.status(404).json({ error: 'Tienda no encontrada.' })
  const body = req.body ?? {}
  const onlyStatus = typeof body === 'object' && Object.keys(body).length === 1 && 'status' in body
  const parsed = onlyStatus ? networkShopStatusSchema.safeParse(body) : networkShopInputSchema.safeParse(body)
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  try {
    const patch = onlyStatus ? { status: (parsed.data as z.infer<typeof networkShopStatusSchema>).status } : { input: parsed.data as z.infer<typeof networkShopInputSchema> }
    const shop = await updateNetworkShop(req.userId!, String(req.params.id), patch)
    if (!shop) return void res.status(404).json({ error: 'Tienda no encontrada.' })
    res.json(shop)
  } catch (err) {
    fail(res, err, 'PATCH /admin/shop-network/:id')
  }
})

export default router
