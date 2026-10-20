import { Router, type RequestHandler } from 'express'
import { metricsAuth, viaMetricsToken } from '../middleware/metricsAuth.js'
import { listCatalogWishes, type CatalogWishRow } from '../services/catalogWishes.js'

/**
 * «Deseos del catálogo» (PRO-154, specs/catalog-import.md).
 *
 *   GET /admin/catalog-wishes?status=abierto&limit=200
 *     admin JWT or x-metrics-token (Cocina reads it). Dish, sources, how many
 *     households and status — never who asked. The dish is free text from a
 *     registered user, accepted as a dish name; the token gets ≤ 80 characters.
 */
const STATUSES = new Set(['abierto', 'cubierto', 'descartado', 'todos'])

export function createCatalogWishesRouter(
  overrides: Partial<{ list: (opts: { status?: string; limit?: number }) => Promise<CatalogWishRow[]>; readAuth: RequestHandler }> = {},
): Router {
  const d = { list: (o: { status?: string; limit?: number }) => listCatalogWishes(o), readAuth: metricsAuth, ...overrides }
  const router = Router()
  router.get('/admin/catalog-wishes', d.readAuth, async (req, res) => {
    try {
      const raw = String(req.query.status ?? 'abierto')
      const status = STATUSES.has(raw) ? raw : 'abierto'
      const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000)
      const rows = await d.list({ status: status === 'todos' ? undefined : status, limit })
      const token = viaMetricsToken(req)
      res.json({
        status,
        count: rows.length,
        items: rows.map((r) => ({
          id: r.id,
          dish: token ? r.dish.slice(0, 80) : r.dish,
          households: r.households,
          sources: r.sources,
          status: r.status,
          recipeId: r.recipeId,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      })
    } catch (err) {
      console.error('catalog wishes error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })
  return router
}

export default createCatalogWishesRouter()
