/**
 * "Compra en mis tiendas" REST surface (specs/shop-orders.md).
 *
 *   GET    /shops                       — the household's shops
 *   POST   /shops                       — add a shop
 *   PATCH  /shops/:id                   — edit a shop
 *   DELETE /shops/:id                   — delete a shop (and its drafts)
 *
 *   POST   /shop-orders/prepare         — draft one order per shop from the list for the next `days` (default 7)
 *   GET    /shop-orders                 — open orders (?all=1 adds closed ones, last 30 days)
 *   GET    /shop-orders/:id
 *   PATCH  /shop-orders/:id             — edit a draft (lines, cap)
 *   POST   /shop-orders/:id/sent        — the user sent the message
 *   POST   /shop-orders/:id/quote       — the shop's reply (pasted / forwarded) → assessed quote
 *   POST   /shop-orders/:id/approve     — the user's decisions → confirmation message
 *   POST   /shop-orders/:id/close       — collected / delivered (ticks the list)
 *   POST   /shop-orders/:id/cancel
 *
 *   GET    /shop-orders/link/:token     — PUBLIC: the wa.me/mailto behind a short link (no side effects)
 */

import { Router, type Response } from 'express'
import { z } from 'zod'
import { approveShopOrderSchema, patchShopOrderSchema, shopInputSchema } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { requireSpendCapacity } from '../middleware/spendCap.js'
import { appApiFor } from '../services/assistant/appApi.js'
import { addDays, madridParts } from '../services/madridTime.js'
import {
  addShop,
  approveOrder,
  cancelOrder,
  closeOrder,
  deleteShop,
  getOrder,
  listOrders,
  listShops,
  markSent,
  patchOrder,
  patchShop,
  prepareOrders,
  resolveShortLink,
  ShopOrderError,
  submitQuote,
} from '../services/shopOrders/store.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const quoteSchema = z.object({ text: z.string().trim().min(2).max(4000) })
const closeSchema = z.object({ finalTotalEur: z.number().nonnegative().max(5000).nullable().optional() })
const prepareSchema = z.object({
  listId: z.string().uuid().optional(),
  /** Days of menu to buy for, from today (Madrid). Fresh food: a week by default. */
  days: z.number().int().min(1).max(14).optional(),
})

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

// Public router: mounted before any auth middleware.
export const publicShopOrdersRouter = Router()

publicShopOrdersRouter.get('/shop-orders/link/:token', async (req, res) => {
  try {
    const which = req.query.m === 'ok' ? 'confirmation' : 'order'
    const url = await resolveShortLink(req.params.token, which)
    if (!url) {
      res.status(404).json({ error: 'Enlace caducado o no válido.' })
      return
    }
    res.json({ url })
  } catch (err) {
    fail(res, err, 'GET /shop-orders/link')
  }
})

const router = Router()
router.use(['/shops', '/shop-orders'], authMiddleware)

router.get('/shops', async (req: AuthRequest, res) => {
  try {
    res.json(await listShops(req.userId!))
  } catch (err) {
    fail(res, err, 'GET /shops')
  }
})

router.post('/shops', async (req: AuthRequest, res) => {
  const parsed = shopInputSchema.safeParse(req.body)
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  try {
    res.status(201).json(await addShop(req.userId!, parsed.data))
  } catch (err) {
    fail(res, err, 'POST /shops')
  }
})

router.patch('/shops/:id', async (req: AuthRequest, res) => {
  if (!UUID_RE.test(String(req.params.id))) return void res.status(404).json({ error: 'Tienda no encontrada.' })
  // Full-form PATCH: the web sends the whole shop, so validate it whole.
  const parsed = shopInputSchema.safeParse(req.body)
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  try {
    const shop = await patchShop(req.userId!, String(req.params.id), parsed.data)
    if (!shop) return void res.status(404).json({ error: 'Tienda no encontrada.' })
    res.json(shop)
  } catch (err) {
    fail(res, err, 'PATCH /shops/:id')
  }
})

router.delete('/shops/:id', async (req: AuthRequest, res) => {
  if (!UUID_RE.test(String(req.params.id))) return void res.status(404).json({ error: 'Tienda no encontrada.' })
  try {
    const ok = await deleteShop(req.userId!, String(req.params.id))
    if (!ok) return void res.status(404).json({ error: 'Tienda no encontrada.' })
    res.status(204).end()
  } catch (err) {
    fail(res, err, 'DELETE /shops/:id')
  }
})

router.post('/shop-orders/prepare', async (req: AuthRequest, res) => {
  const parsed = prepareSchema.safeParse(req.body ?? {})
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  try {
    let listId = parsed.data.listId
    if (!listId) {
      // Rebuild the rolling list first (same endpoint the app uses) so the
      // orders reflect the menu as it is now — and only the next `days` of
      // it: fresh fish for the week after next isn't bought today.
      const from = madridParts(new Date()).isoDate
      const to = addDays(from, (parsed.data.days ?? 7) - 1)
      const list = await appApiFor(req.userId!)<{ id: string }>('GET', `/shopping-list?from=${from}&to=${to}`)
      listId = list?.id
    }
    res.json(await prepareOrders(req.userId!, { listId }))
  } catch (err) {
    fail(res, err, 'POST /shop-orders/prepare')
  }
})

router.get('/shop-orders', async (req: AuthRequest, res) => {
  try {
    res.json(await listOrders(req.userId!, { includeClosed: req.query.all === '1' }))
  } catch (err) {
    fail(res, err, 'GET /shop-orders')
  }
})

function withOrder(handler: (req: AuthRequest, res: Response) => Promise<void>, where: string) {
  return async (req: AuthRequest, res: Response) => {
    if (!UUID_RE.test(String(req.params.id))) return void res.status(404).json({ error: 'Pedido no encontrado.' })
    try {
      await handler(req, res)
    } catch (err) {
      fail(res, err, where)
    }
  }
}

router.get('/shop-orders/:id', withOrder(async (req, res) => {
  res.json(await getOrder(req.userId!, String(req.params.id)))
}, 'GET /shop-orders/:id'))

router.patch('/shop-orders/:id', withOrder(async (req, res) => {
  const parsed = patchShopOrderSchema.safeParse(req.body)
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  res.json(await patchOrder(req.userId!, String(req.params.id), parsed.data))
}, 'PATCH /shop-orders/:id'))

router.post('/shop-orders/:id/sent', withOrder(async (req, res) => {
  res.json(await markSent(req.userId!, String(req.params.id)))
}, 'POST /shop-orders/:id/sent'))

// Reading the shop's reply is a paid model call → monthly AI spend cap.
router.post('/shop-orders/:id/quote', requireSpendCapacity(), withOrder(async (req, res) => {
  const parsed = quoteSchema.safeParse(req.body)
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  res.json(await submitQuote(req.userId!, String(req.params.id), parsed.data.text))
}, 'POST /shop-orders/:id/quote'))

router.post('/shop-orders/:id/approve', withOrder(async (req, res) => {
  const parsed = approveShopOrderSchema.safeParse(req.body ?? {})
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  res.json(await approveOrder(req.userId!, String(req.params.id), parsed.data))
}, 'POST /shop-orders/:id/approve'))

router.post('/shop-orders/:id/close', withOrder(async (req, res) => {
  const parsed = closeSchema.safeParse(req.body ?? {})
  if (!parsed.success) return badRequest(res, parsed.error.issues)
  res.json(await closeOrder(req.userId!, String(req.params.id), parsed.data))
}, 'POST /shop-orders/:id/close'))

router.post('/shop-orders/:id/cancel', withOrder(async (req, res) => {
  res.json(await cancelOrder(req.userId!, String(req.params.id)))
}, 'POST /shop-orders/:id/cancel'))

export default router
