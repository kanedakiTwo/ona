/**
 * Catalogue collections (PRO-374, specs/recipes.md → «Colecciones»,
 * specs/catalog-import.md → «Colecciones»).
 *
 *   GET  /catalog-collections            the `/recipes` row (with or without an account)
 *   GET  /catalog-collections/:slug      one collection and its recipe cards, in Cocina's order
 *   GET  /admin/catalog-collections      admin: every collection, published or not
 *   POST /admin/catalog-collections      admin: Cocina's file → saved by slug (audited);
 *                                        400 with every problem (§6 words, a draft, a
 *                                        recipe not in the catalogue) and nothing saved
 */
import { Router, type RequestHandler } from 'express'
import { CATALOG_COLLECTION_SLUG_RE, type CatalogCollectionAdminView, type CatalogCollectionCard } from '@ona/shared'
import { authMiddleware, optionalAuthMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { record } from '../services/auditLog.js'
import {
  createDbCollectionImportDeps,
  importCatalogCollection,
  listCollectionCards,
  listCollectionsForAdmin,
  loadCollection,
  type CatalogCollectionImportResult,
} from '../services/catalogCollections.js'
import { recipeCardsByIds } from './recipes.js'

export interface CatalogCollectionsDeps {
  adminAuth: RequestHandler[]
  optionalAuth: RequestHandler
  listCards: () => Promise<CatalogCollectionCard[]>
  loadCollection: (slug: string) => Promise<{ card: CatalogCollectionCard; recipeIds: string[] } | null>
  recipeCards: (ids: string[], userId: string | undefined) => Promise<unknown[]>
  listForAdmin: () => Promise<CatalogCollectionAdminView[]>
  importCollection: (body: unknown) => Promise<CatalogCollectionImportResult>
  record: typeof record
}

const NOT_FOUND = { error: 'Esa colección no existe.', code: 'NOT_FOUND' }

export function createCatalogCollectionsRouter(overrides: Partial<CatalogCollectionsDeps> = {}): Router {
  const d: CatalogCollectionsDeps = {
    adminAuth: [authMiddleware as RequestHandler, requireAdmin as RequestHandler],
    optionalAuth: optionalAuthMiddleware as RequestHandler,
    listCards: () => listCollectionCards(),
    loadCollection: (slug) => loadCollection(slug),
    recipeCards: (ids, userId) => recipeCardsByIds(ids, userId),
    listForAdmin: () => listCollectionsForAdmin(),
    importCollection: (body) => importCatalogCollection(body, createDbCollectionImportDeps()),
    record,
    ...overrides,
  }
  const router = Router()

  router.get('/catalog-collections', async (_req, res) => {
    try {
      res.json({ collections: await d.listCards() })
    } catch (err) {
      console.error('catalog collections error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.get('/catalog-collections/:slug', d.optionalAuth, async (req: AuthRequest, res) => {
    const slug = String(req.params.slug)
    if (!CATALOG_COLLECTION_SLUG_RE.test(slug)) return void res.status(404).json(NOT_FOUND)
    try {
      const found = await d.loadCollection(slug)
      if (!found || found.recipeIds.length === 0) return void res.status(404).json(NOT_FOUND)
      res.json({ collection: found.card, recipes: await d.recipeCards(found.recipeIds, req.userId) })
    } catch (err) {
      console.error('catalog collection error:', err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.get('/admin/catalog-collections', ...d.adminAuth, async (_req, res) => {
    try {
      res.json({ collections: await d.listForAdmin() })
    } catch (err) {
      console.error('[admin/catalog-collections] list failed:', (err as Error)?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.post('/admin/catalog-collections', ...d.adminAuth, async (req: AuthRequest, res) => {
    try {
      const r = await d.importCollection(req.body)
      if (!r.ok) return void res.status(400).json({ error: r.problems[0], code: 'INVALID_COLLECTION', problems: r.problems })
      const c = r.collection
      await d.record({
        adminId: req.userId!,
        action: 'catalog_collection.import',
        targetType: 'catalog_collection',
        targetId: r.id,
        payload: { slug: c.slug, title: c.title, recipes: c.recipeIds.length, published: c.published, created: r.created },
      })
      res.status(r.created ? 201 : 200).json({ id: r.id, created: r.created, slug: c.slug, title: c.title, recipeCount: c.recipeIds.length, published: c.published })
    } catch (err) {
      console.error('[admin/catalog-collections] import failed:', (err as Error)?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

export default createCatalogCollectionsRouter()
