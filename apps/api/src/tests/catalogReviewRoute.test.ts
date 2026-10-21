/**
 * Routes of the admin page «Recetas pendientes» (specs/catalog-import.md,
 * specs/admin-dashboard.md) on a real Express app bound to an ephemeral port.
 * The services are injected fakes (the SQL is in catalogReview.smoke.ts);
 * body parsing, zod and the real router are the real thing.
 *
 *   every route         401 without an admin JWT (authMiddleware + requireAdmin)
 *   GET  /admin/catalog-drafts                  the drafts by batch
 *   POST /admin/catalog-drafts/:id/publish      OK + publish one; 409 if the audit holds it
 *   POST /admin/catalog-drafts/:id/discard      Miguel's «no»
 *   POST /admin/catalog-drafts/:id/restore      verdict taken back
 *   POST /admin/catalog-batches/:batch/publish  what the rule allows in the batch
 *   POST /admin/catalog-import/check            the file checked, with what it would skip
 *   POST /admin/catalog-import/jobs             202: import in the background (audited)
 *   GET  /admin/catalog-import/jobs[/:id]       progress
 */
import express, { type RequestHandler } from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { buildCatalogImportPayload } from '@ona/shared'
import catalogReviewRouter, { createCatalogReviewRouter, type CatalogReviewDeps } from '../routes/catalogReview.js'
import { ImportBusyError, type ImportJobRow } from '../services/catalogImportJobs.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const TEXT = readFileSync(path.join(here, 'fixtures', 'tanda-cocina-inventada.json'), 'utf8')
const ADMIN = '11111111-1111-4111-8111-111111111111'
const ID = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f70'

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

const JOB: ImportJobRow = {
  id: '9b2f3c4d-1111-4222-8333-444455556666',
  batch: 'cocina-02',
  origin: 'cocina',
  fileName: 'tanda.json',
  status: 'running',
  total: 2,
  done: 0,
  outcomes: [],
  error: null,
  createdBy: ADMIN,
  createdAt: new Date('2026-10-21T09:00:00Z'),
  finishedAt: null,
}

function fakes(over: Partial<CatalogReviewDeps> = {}) {
  const deps = {
    adminAuth: [asAdmin],
    loadDrafts: vi.fn(async () => ({ pending: 0, batches: [] })),
    publishDraft: vi.fn(async (id: string) => ({ ok: true as const, id, name: 'Guiso', batch: 'cocina-01', wishesCovered: 1 })),
    discardDraft: vi.fn(async (id: string) => ({ ok: true as const, id, name: 'Guiso', batch: 'cocina-01' })),
    restoreDraft: vi.fn(async (id: string) => ({ ok: true as const, id, name: 'Guiso', batch: 'cocina-01' })),
    publishBatch: vi.fn(async () => ({ published: 2, wishesCovered: 0, held: [{ id: 'x', name: 'Otra', reason: 'sin_revisar' as const }] })),
    previewImport: vi.fn(async (names: readonly string[]) => ({ recipes: names.map((name, i) => ({ name, duplicateOf: i === 0 ? 'Guiso de garbanzos' : null })), alreadyInBatch: 3 })),
    canImport: vi.fn(() => true),
    startImport: vi.fn(async (_input: any, opts?: { beforeRun?: (job: ImportJobRow) => Promise<void> }) => {
      await opts?.beforeRun?.(JOB)
      return JOB
    }),
    listJobs: vi.fn(async () => [{ ...JOB, status: 'done' as const, done: 2 }]),
    getJob: vi.fn(async (id: string) => (id === JOB.id ? JOB : null)),
    record: vi.fn(async () => 'audit-id'),
    ...over,
  }
  return deps
}

async function app(over: Partial<CatalogReviewDeps> = {}) {
  const deps = fakes(over)
  const a = express()
  a.use(createCatalogReviewRouter(deps as unknown as Partial<CatalogReviewDeps>))
  // Like index.ts: the global parser (100 KB) comes after this router.
  a.use(express.json())
  return { base: await serve(a), deps }
}

const post = (base: string, p: string, body?: unknown) =>
  fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })

function payload(batch = 'cocina-02') {
  const built = buildCatalogImportPayload({ text: TEXT, fileName: 'tanda.json', batch })
  if (!built.ok) throw new Error('fixture')
  return built.payload
}

describe('access', () => {
  it('every route needs an admin JWT (401 anonymous)', async () => {
    const a = express()
    a.use(catalogReviewRouter)
    const base = await serve(a)
    const calls: Array<[string, string]> = [
      ['GET', '/admin/catalog-drafts'],
      ['POST', `/admin/catalog-drafts/${ID}/publish`],
      ['POST', `/admin/catalog-drafts/${ID}/discard`],
      ['POST', `/admin/catalog-drafts/${ID}/restore`],
      ['POST', '/admin/catalog-batches/cocina-01/publish'],
      ['POST', '/admin/catalog-import/check'],
      ['POST', '/admin/catalog-import/jobs'],
      ['GET', '/admin/catalog-import/jobs'],
      ['GET', `/admin/catalog-import/jobs/${ID}`],
    ]
    for (const [method, p] of calls) {
      const r = await fetch(`${base}${p}`, { method, headers: { 'x-metrics-token': 'anything' } })
      expect(r.status, `${method} ${p}`).toBe(401)
    }
  })
})

describe('drafts', () => {
  it('GET lists them', async () => {
    const { base, deps } = await app()
    const r = await fetch(`${base}/admin/catalog-drafts`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ pending: 0, batches: [] })
    expect(deps.loadDrafts).toHaveBeenCalledOnce()
  })

  it('publish: the admin id goes through; 409 with the audit in words when it holds the recipe; 404 for anything else', async () => {
    const { base, deps } = await app({
      publishDraft: vi.fn(async (id: string) =>
        id === ID
          ? ({ ok: false, code: 'AUDIT_HOLD', issues: [{ code: 'sin_pasos', label: 'sin pasos' }] } as const)
          : id === '00000000-0000-4000-8000-000000000000'
            ? ({ ok: false, code: 'NOT_FOUND' } as const)
            : ({ ok: true, id, name: 'Guiso', batch: 'cocina-01', wishesCovered: 1 } as const),
      ),
    })
    const ok = await post(base, '/admin/catalog-drafts/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/publish')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toMatchObject({ published: true, name: 'Guiso', wishesCovered: 1 })
    expect(deps.publishDraft).toHaveBeenLastCalledWith('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', ADMIN)

    const held = await post(base, `/admin/catalog-drafts/${ID}/publish`)
    expect(held.status).toBe(409)
    const body = await held.json()
    expect(body.code).toBe('AUDIT_HOLD')
    expect(body.error).toContain('sin pasos')

    expect((await post(base, '/admin/catalog-drafts/00000000-0000-4000-8000-000000000000/publish')).status).toBe(404)
    expect((await post(base, '/admin/catalog-drafts/no-es-un-id/publish')).status).toBe(404)
  })

  it('discard and restore', async () => {
    const { base, deps } = await app()
    const d = await post(base, `/admin/catalog-drafts/${ID}/discard`)
    expect(d.status).toBe(200)
    expect(await d.json()).toMatchObject({ discarded: true, name: 'Guiso' })
    expect(deps.discardDraft).toHaveBeenLastCalledWith(ID, ADMIN)
    const r = await post(base, `/admin/catalog-drafts/${ID}/restore`)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ restored: true })
    expect(deps.restoreDraft).toHaveBeenLastCalledWith(ID, ADMIN)
  })

  it('publish a batch: what the rule allows, with what waits and why', async () => {
    const { base, deps } = await app()
    const r = await post(base, '/admin/catalog-batches/cocina-01/publish')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ published: 2, wishesCovered: 0, held: [{ id: 'x', name: 'Otra', reason: 'sin_revisar' }] })
    expect(deps.publishBatch).toHaveBeenLastCalledWith('cocina-01', ADMIN)
    expect((await post(base, '/admin/catalog-batches/..%2Fx/publish')).status).toBe(400)
  })
})

describe('import a batch file', () => {
  it('check: a bad file answers 400 with the problems in Spanish (never an `errors` array)', async () => {
    const { base } = await app()
    const bad = JSON.parse(TEXT)
    bad.recipes[0].ingredients[0].unit = 'gr'
    const r = await post(base, '/admin/catalog-import/check', { batch: 'cocina-02', fileName: null, file: bad })
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.code).toBe('INVALID_BATCH_FILE')
    expect(body.errors).toBeUndefined()
    expect(body.problems[0]).toContain('la unidad «gr» no vale')
    const noBatch = await post(base, '/admin/catalog-import/check', { ...payload(), batch: 'Con Espacios' })
    expect(noBatch.status).toBe(400)
    expect((await noBatch.json()).problems[0]).toMatch(/nombre de la tanda/)
    const notJson = await post(base, '/admin/catalog-import/check', '{ "batch": ')
    expect(notJson.status).toBe(400)
    expect((await notJson.json()).code).toBe('INVALID_JSON')
  })

  it('check: a good file says what an import would do, without starting it', async () => {
    const { base, deps } = await app()
    const r = await post(base, '/admin/catalog-import/check', payload())
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({
      batch: 'cocina-02',
      origin: 'cocina',
      book: 'Cuaderno de pruebas',
      recipes: [
        { name: 'Guiso de prueba con garbanzos', duplicateOf: 'Guiso de garbanzos' },
        { name: 'Bizcocho de prueba de los lunes', duplicateOf: null },
      ],
      warnings: [],
      alreadyInBatch: 3,
    })
    expect(deps.previewImport).toHaveBeenCalledWith(['Guiso de prueba con garbanzos', 'Bizcocho de prueba de los lunes'], 'cocina-02')
    expect(deps.startImport).not.toHaveBeenCalled()
  })

  it('jobs: 202 at once, the drafts the command would read, and the start in the audit log', async () => {
    const { base, deps } = await app()
    const r = await post(base, '/admin/catalog-import/jobs', payload())
    expect(r.status).toBe(202)
    const body = await r.json()
    expect(body.job).toMatchObject({ id: JOB.id, status: 'running', total: 2, done: 0, counts: { draft: 0, duplicate: 0, rejected: 0 } })
    const [input] = deps.startImport.mock.calls[0]
    expect(input).toMatchObject({ batch: 'cocina-02', origin: 'cocina', fileName: 'tanda.json', adminId: ADMIN })
    expect(input.drafts).toHaveLength(2)
    expect(input.drafts[0]).toMatchObject({ name: 'Guiso de prueba con garbanzos', source: { origin: 'cocina', book: 'Cuaderno de pruebas', file: 'tanda.json', credit: 'Receta de la tía Inventada' } })
    expect(input.drafts[1].source.credit).toBe('Receta del primo Ficticio')
    expect(deps.record).toHaveBeenCalledWith(
      expect.objectContaining({ adminId: ADMIN, action: 'catalog_import.start', targetType: 'catalog_import', targetId: JOB.id, payload: expect.objectContaining({ batch: 'cocina-02', recipes: 2, fileName: 'tanda.json' }) }),
    )
  })

  it('jobs: one at a time (409), and 503 when the server has no AI key', async () => {
    const busy = await app({ startImport: vi.fn(async () => { throw new ImportBusyError('cocina-01') }) })
    const r = await post(busy.base, '/admin/catalog-import/jobs', payload())
    expect(r.status).toBe(409)
    expect((await r.json()).error).toContain('cocina-01')

    const noKey = await app({ canImport: vi.fn(() => false) })
    const k = await post(noKey.base, '/admin/catalog-import/jobs', payload())
    expect(k.status).toBe(503)
    expect(noKey.deps.startImport).not.toHaveBeenCalled()
  })

  it('a batch bigger than the global 100 KB body limit goes through; one over 2 MB is a clear 413', async () => {
    const { base, deps } = await app()
    const big = payload()
    big.file.recipes = Array.from({ length: 180 }, (_, i) => ({ ...big.file.recipes[0], name: `Plato de prueba ${i}`, tags: ['x'.repeat(50), 'y'.repeat(50), 'z'.repeat(50)] }))
    const body = JSON.stringify(big)
    expect(body.length).toBeGreaterThan(120_000) // express.json()'s default limit is 100 KB
    const r = await post(base, '/admin/catalog-import/jobs', body)
    expect(r.status).toBe(202)
    expect(deps.startImport.mock.calls[0][0].drafts).toHaveLength(180)

    const huge = await post(base, '/admin/catalog-import/jobs', JSON.stringify({ ...big, padding: 'x'.repeat(2_200_000) }))
    expect(huge.status).toBe(413)
    expect((await huge.json()).error).toMatch(/demasiado grande/)
  })

  it('progress: the latest jobs, and one by id', async () => {
    const { base } = await app()
    const list = await (await fetch(`${base}/admin/catalog-import/jobs`)).json()
    expect(list.jobs[0]).toMatchObject({ id: JOB.id, status: 'done', done: 2 })
    const one = await fetch(`${base}/admin/catalog-import/jobs/${JOB.id}`)
    expect(one.status).toBe(200)
    expect((await one.json()).job.id).toBe(JOB.id)
    expect((await fetch(`${base}/admin/catalog-import/jobs/${ID}`)).status).toBe(404)
  })
})
