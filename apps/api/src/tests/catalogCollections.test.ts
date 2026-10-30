/**
 * Catalogue collections (PRO-374, specs/catalog-import.md → «Colecciones»):
 * the upload's rules with an injected database, and the routes on a real
 * Express app with injected services.
 *
 *   - the §6 words (`healthClaimWordsIn`): «perder grasa», «menopausia»… in a
 *     title or subtitle reject the collection; «Otoño» or «Invitados» don't;
 *   - only published catalogue recipes: a draft, a retired one or one not in
 *     the catalogue reject it, and nothing is saved;
 *   - recipes by id or by exact name (accents and case aside), in the file's order;
 *   - POST /admin/catalog-collections: admin only, 400 with every problem, audited;
 *   - GET /catalog-collections[/:slug]: no account needed, 404 for an unknown one.
 */
import express, { type RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { checkCatalogCollection, healthClaimWordsIn } from '@ona/shared'
import {
  importCatalogCollection,
  type CatalogCollectionImportDeps,
  type CollectionRecipeCandidate,
} from '../services/catalogCollections.js'
import { createCatalogCollectionsRouter, type CatalogCollectionsDeps } from '../routes/catalogCollections.js'

const ADMIN = '11111111-1111-4111-8111-111111111111'
const LENTEJAS = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f70'
const CREMA = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f71'
const BORRADOR = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f72'
const RETIRADA = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f73'

const CATALOG: CollectionRecipeCandidate[] = [
  { id: LENTEJAS, name: 'Lentejas estofadas', status: 'published', retired: false },
  { id: CREMA, name: 'Crema de calabaza asada', status: 'published', retired: false },
  { id: BORRADOR, name: 'Bizcocho de manzana', status: 'draft', retired: false },
  { id: RETIRADA, name: 'Pisto antiguo', status: 'published', retired: true },
]

function fakeDb(): CatalogCollectionImportDeps & { saveCollection: ReturnType<typeof vi.fn> } {
  return {
    findCatalogRecipes: vi.fn(async () => CATALOG),
    saveCollection: vi.fn(async () => ({ id: 'c0ffee00-0000-4000-8000-000000000001', created: true })),
  }
}

const OTONO = {
  slug: 'otono',
  title: 'Otoño en casa',
  subtitle: 'Cuchara y horno para las primeras tardes frías',
  season: 'autumn',
  recipes: [CREMA, 'lentejas  ESTOFADAS'],
}

describe('healthClaimWordsIn (§6)', () => {
  it('finds health words with or without accents, also in plural or feminine', () => {
    expect(healthClaimWordsIn('Cenas para perder grasa')).toEqual(['perder grasa'])
    expect(healthClaimWordsIn('Recetas en la MENOPAUSIA')).toEqual(['menopausia'])
    expect(healthClaimWordsIn('Platos antiinflamatorios')).toEqual(['antiinflamatorio'])
    expect(healthClaimWordsIn('Para diabéticos')).toEqual(['diabetico'])
    expect(healthClaimWordsIn('Si estás embarazada')).toEqual(['embarazada'])
  })

  it('leaves the editorial words alone', () => {
    for (const t of ['Vuelta al cole', 'Halloween', 'Invitados en casa', 'Picoteo', 'Otoño', 'Curry de garbanzos', 'Jamón curado', 'Dieta mediterránea']) {
      expect(healthClaimWordsIn(t)).toEqual([])
    }
  })
})

describe('importCatalogCollection', () => {
  it('saves a collection of published recipes, by id or name, in the file order', async () => {
    const db = fakeDb()
    const r = await importCatalogCollection(OTONO, db)
    expect(r.ok).toBe(true)
    expect(db.saveCollection).toHaveBeenCalledWith({
      slug: 'otono',
      title: 'Otoño en casa',
      subtitle: 'Cuchara y horno para las primeras tardes frías',
      season: 'autumn',
      recipeIds: [CREMA, LENTEJAS],
      published: true,
    })
    expect(db.findCatalogRecipes).toHaveBeenCalledWith([CREMA], ['lentejas estofadas'])
  })

  it('rejects a collection about «perder grasa» and saves nothing', async () => {
    const db = fakeDb()
    const r = await importCatalogCollection({ ...OTONO, slug: 'cenas-ligeras', title: 'Cenas para perder grasa' }, db)
    expect(r).toEqual({ ok: false, problems: [expect.stringContaining('«perder grasa»')] })
    if (!r.ok) expect(r.problems[0]).toMatch(/no hacemos colecciones por salud/)
    expect(db.findCatalogRecipes).not.toHaveBeenCalled()
    expect(db.saveCollection).not.toHaveBeenCalled()
  })

  it('rejects a subtitle with a health word too', async () => {
    const r = await importCatalogCollection({ ...OTONO, subtitle: 'Ideas para la menopausia' }, fakeDb())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.problems[0]).toMatch(/^El subtítulo habla de salud/)
  })

  it('rejects a collection with a recipe in draft and saves nothing', async () => {
    const db = fakeDb()
    const r = await importCatalogCollection({ ...OTONO, recipes: [CREMA, BORRADOR] }, db)
    expect(r).toEqual({ ok: false, problems: ['La receta «Bizcocho de manzana» está en borrador: solo van recetas publicadas.'] })
    expect(db.saveCollection).not.toHaveBeenCalled()
  })

  it('names every recipe that can not go: retired, not in the catalogue, twice', async () => {
    const r = await importCatalogCollection({ ...OTONO, recipes: [RETIRADA, 'Tarta que no existe', LENTEJAS, 'Lentejas estofadas'] }, fakeDb())
    expect(r).toEqual({
      ok: false,
      problems: [
        'La receta «Pisto antiguo» está retirada del catálogo.',
        'La receta «Tarta que no existe» no está en el catálogo.',
        'La receta «Lentejas estofadas» está dos veces.',
      ],
    })
  })

  it('checks the shape: slug, empty list, unknown season', () => {
    const r = checkCatalogCollection({ slug: 'Vuelta Al Cole', title: 'Vuelta al cole', season: 'otoño', recipes: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.problems).toHaveLength(3)
      expect(r.problems[0]).toMatch(/slug/)
    }
  })
})

// ─── Routes ────────────────────────────────────────────────────

const servers: Server[] = []
async function serve(app: express.Express): Promise<string> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

const asAdmin: RequestHandler = (req, _res, next) => {
  ;(req as any).userId = ADMIN
  next()
}
const denied: RequestHandler = (_req, res) => void res.status(401).json({ error: 'Unauthorized' })
const anonymous: RequestHandler = (_req, _res, next) => next()

const CARD = { slug: 'otono', title: 'Otoño en casa', subtitle: null, season: 'autumn' as const, recipeCount: 2, imageUrl: '/images/recipes/crema.png' }

async function app(over: Partial<CatalogCollectionsDeps> = {}) {
  const db = fakeDb()
  const deps = {
    adminAuth: [asAdmin],
    optionalAuth: anonymous,
    listCards: vi.fn(async () => [CARD]),
    loadCollection: vi.fn(async (slug: string) => (slug === 'otono' ? { card: CARD, recipeIds: [CREMA, LENTEJAS] } : null)),
    recipeCards: vi.fn(async (ids: string[]) => ids.map((id) => ({ id }))),
    listForAdmin: vi.fn(async () => []),
    importCollection: (body: unknown) => importCatalogCollection(body, db),
    record: vi.fn(async () => 'audit-id'),
    ...over,
  }
  const a = express()
  a.use(express.json())
  a.use(createCatalogCollectionsRouter(deps as CatalogCollectionsDeps))
  return { base: await serve(a), deps, db }
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('POST /admin/catalog-collections', () => {
  it('401 without an admin', async () => {
    const { base, db } = await app({ adminAuth: [denied] })
    expect((await post(`${base}/admin/catalog-collections`, OTONO)).status).toBe(401)
    expect(db.saveCollection).not.toHaveBeenCalled()
  })

  it('saves it and audits the upload', async () => {
    const { base, deps } = await app()
    const res = await post(`${base}/admin/catalog-collections`, OTONO)
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ slug: 'otono', recipeCount: 2, published: true, created: true })
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ adminId: ADMIN, action: 'catalog_collection.import', targetType: 'catalog_collection' }))
  })

  it('400 with the problems for «perder grasa» or a draft, nothing saved nor audited', async () => {
    const { base, deps, db } = await app()
    const health = await post(`${base}/admin/catalog-collections`, { ...OTONO, title: 'Perder grasa sin pasar hambre' })
    expect(health.status).toBe(400)
    expect(await health.json()).toMatchObject({ code: 'INVALID_COLLECTION', problems: [expect.stringContaining('perder grasa')] })
    const draft = await post(`${base}/admin/catalog-collections`, { ...OTONO, recipes: [BORRADOR] })
    expect(draft.status).toBe(400)
    expect((await draft.json()).problems).toEqual(['La receta «Bizcocho de manzana» está en borrador: solo van recetas publicadas.'])
    expect(db.saveCollection).not.toHaveBeenCalled()
    expect(deps.record).not.toHaveBeenCalled()
  })
})

describe('GET /catalog-collections', () => {
  it('lists the row and opens one with its cards, without an account', async () => {
    const { base, deps } = await app()
    expect(await (await fetch(`${base}/catalog-collections`)).json()).toEqual({ collections: [CARD] })
    const one = await fetch(`${base}/catalog-collections/otono`)
    expect(one.status).toBe(200)
    expect(await one.json()).toEqual({ collection: CARD, recipes: [{ id: CREMA }, { id: LENTEJAS }] })
    expect(deps.recipeCards).toHaveBeenCalledWith([CREMA, LENTEJAS], undefined)
  })

  it('404 for an unknown or malformed slug', async () => {
    const { base } = await app()
    expect((await fetch(`${base}/catalog-collections/no-existe`)).status).toBe(404)
    expect((await fetch(`${base}/catalog-collections/NO%20VALE`)).status).toBe(404)
  })
})
