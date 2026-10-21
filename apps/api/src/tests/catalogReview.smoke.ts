/**
 * Smoke (real API + Postgres) for the admin page «Recetas pendientes»
 * (specs/catalog-import.md, specs/admin-audit-log.md):
 *   - the real routes refuse a non-admin JWT (403) and an anonymous call (401);
 *   - drafts load with their ingredient names and step count, grouped by batch;
 *   - «Publicar» publishes one recipe and writes `catalog_draft.publish` in
 *     the same transaction; an audit issue holds it (nothing written);
 *   - «Descartar» / «Recuperar» set and take back Miguel's verdict, audited;
 *   - «Publicar las aprobadas» publishes only what the rule allows;
 *   - the import job store appends outcomes in order and a boot marks a job
 *     left running as interrupted.
 *
 *   API_URL=… DATABASE_URL=… SMOKE_USER_TOKEN=… SMOKE_USER_ID=… pnpm --filter @ona/api exec vitest run src/tests/catalogReview.smoke.ts
 */
import { afterAll, describe, expect, it } from 'vitest'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { API_URL, reachable, TOKEN, USER_ID } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { adminAuditLog, catalogImportJobs, recipeIngredients, recipes, recipeSteps, type CatalogSourceInfo } from '../db/schema.js'
import { publishIfWaitingForPhoto, saveReview } from '../services/catalogImportDb.js'
import { createDbImportJobStore } from '../services/catalogImportJobs.js'
import {
  discardCatalogDraft,
  loadCatalogDrafts,
  previewImport,
  publishApprovedInBatch,
  publishCatalogDraft,
  restoreCatalogDraft,
} from '../services/catalogReview.js'

const tag = `revision${Date.now().toString(36)}`
const created: string[] = []
const jobIds: string[] = []

/** A draft copy of a published catalogue recipe (with its ingredients and steps), with a photo unless `noPhoto`. */
async function insertDraft(name: string, source: Partial<CatalogSourceInfo> = {}, opts: { noPhoto?: boolean } = {}): Promise<string> {
  const [src] = await db.select().from(recipes).where(and(isNull(recipes.authorId), eq(recipes.status, 'published'))).orderBy(asc(recipes.name)).limit(1)
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src
  const [row] = await db
    .insert(recipes)
    .values({
      ...rest,
      name,
      status: 'draft',
      importBatch: tag,
      imageUrl: opts.noPhoto ? null : '/images/recipes/prueba.jpg',
      catalogSource: { origin: 'cocina', book: 'Cuaderno de pruebas', batch: tag, auditIssues: [], allergenDoubt: false, ...source },
    })
    .returning({ id: recipes.id })
  const ings = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, src.id))
  if (ings.length) await db.insert(recipeIngredients).values(ings.map(({ id: _i, ...i }) => ({ ...i, recipeId: row.id })))
  const steps = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, src.id))
  if (steps.length) await db.insert(recipeSteps).values(steps.map(({ id: _i, ...s }) => ({ ...s, recipeId: row.id, ingredientRefs: [] })))
  created.push(row.id)
  return row.id
}

async function sourceOf(id: string) {
  const [r] = await db.select({ status: recipes.status, catalogSource: recipes.catalogSource }).from(recipes).where(eq(recipes.id, id))
  return r
}

const auditFor = (id: string) => db.select().from(adminAuditLog).where(eq(adminAuditLog.targetId, id))

afterAll(async () => {
  if (!reachable) return
  if (created.length) {
    await db.delete(adminAuditLog).where(inArray(adminAuditLog.targetId, created))
    await db.delete(recipes).where(inArray(recipes.id, created))
  }
  await db.delete(adminAuditLog).where(eq(adminAuditLog.targetId, tag))
  if (jobIds.length) await db.delete(catalogImportJobs).where(inArray(catalogImportJobs.id, jobIds))
})

describe.skipIf(!reachable)('admin «Recetas pendientes» against Postgres', () => {
  it('the routes are for admins only', async () => {
    expect((await fetch(`${API_URL}/admin/catalog-drafts`)).status).toBe(401)
    const r = await fetch(`${API_URL}/admin/catalog-drafts`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    expect(r.status).toBe(403)
    const post = await fetch(`${API_URL}/admin/catalog-import/jobs`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: '{}' })
    expect(post.status).toBe(403)
  })

  it('drafts by batch, publish one (audited), hold one for the audit, discard and restore one, publish the approved', async () => {
    const a = await insertDraft(`Guiso de prueba ${tag}`)
    const b = await insertDraft(`Crema de prueba ${tag}`, { allergenDoubt: true, credit: 'Receta de la tía Inventada' })
    const held = await insertDraft(`Tosta de prueba ${tag}`, { auditIssues: ['sin_pasos'] })
    const approved = await insertDraft(`Ensalada de prueba ${tag}`)

    const view = await loadCatalogDrafts()
    const batch = view.batches.find((x) => x.batch === tag)!
    expect(batch.pending.map((d) => d.id)).toEqual([b, a, held, approved])
    expect(batch.pending[0]).toMatchObject({ allergenDoubt: true, credit: 'Receta de la tía Inventada', decision: 'sin_revisar' })
    expect(batch.pending[1].ingredients.length).toBeGreaterThan(0)
    expect(batch.pending[1].stepCount).toBeGreaterThan(0)
    expect(batch.pending[2]).toMatchObject({ decision: 'auditoria', auditIssues: [{ code: 'sin_pasos', label: 'sin pasos' }] })

    // Before importing: the drafts count as «already in» for a new file.
    const preview = await previewImport([`Guiso de prueba ${tag}`, `Plato nuevo ${tag}`], tag)
    expect(preview.recipes.map((r) => r.duplicateOf)).toEqual([`Guiso de prueba ${tag}`, null])
    expect(preview.alreadyInBatch).toBe(4)

    // «Publicar»
    const pub = await publishCatalogDraft(a, USER_ID)
    expect(pub).toMatchObject({ ok: true, name: `Guiso de prueba ${tag}`, batch: tag })
    const pa = await sourceOf(a)
    expect(pa.status).toBe('published')
    expect(pa.catalogSource).toMatchObject({ reviewOk: true })
    expect((await auditFor(a)).map((r) => [r.action, r.adminId])).toEqual([['catalog_draft.publish', USER_ID]])
    expect(await publishCatalogDraft(a, USER_ID)).toEqual({ ok: false, code: 'NOT_FOUND' })

    // The audit holds it: nothing changes, nothing is logged.
    expect(await publishCatalogDraft(held, USER_ID)).toMatchObject({ ok: false, code: 'AUDIT_HOLD' })
    expect((await sourceOf(held)).status).toBe('draft')
    expect(await auditFor(held)).toHaveLength(0)

    // «Descartar» → apart; «Recuperar» → back to «sin revisar».
    expect(await discardCatalogDraft(b, USER_ID)).toMatchObject({ ok: true })
    expect((await sourceOf(b)).catalogSource).toMatchObject({ reviewOk: false })
    let again = (await loadCatalogDrafts()).batches.find((x) => x.batch === tag)!
    expect(again.discarded.map((d) => d.id)).toEqual([b])
    expect(again.publishedCount).toBe(1)
    expect(await restoreCatalogDraft(b, USER_ID)).toMatchObject({ ok: true })
    const restored = (await sourceOf(b)).catalogSource as Record<string, unknown>
    expect(restored.reviewOk).toBeUndefined()
    expect(restored.credit).toBe('Receta de la tía Inventada')
    expect((await auditFor(b)).map((r) => r.action).sort()).toEqual(['catalog_draft.discard', 'catalog_draft.restore'])

    // «Publicar las aprobadas»: only the OK'd Cocina recipe goes out.
    await saveReview([approved], true)
    const res = await publishApprovedInBatch(tag, USER_ID)
    expect(res.published).toBe(1)
    expect(res.held.map((h) => [h.id, h.reason]).sort()).toEqual([[b, 'sin_revisar'], [held, 'auditoria']].sort())
    expect((await sourceOf(approved)).status).toBe('published')
    const [batchAudit] = await db.select().from(adminAuditLog).where(and(eq(adminAuditLog.targetId, tag), eq(adminAuditLog.action, 'catalog_batch.publish')))
    expect(batchAudit.payload).toMatchObject({ published: 1, ids: [approved] })

    again = (await loadCatalogDrafts()).batches.find((x) => x.batch === tag)!
    expect(again.pending.map((d) => d.id).sort()).toEqual([b, held].sort())
    expect(again.publishedCount).toBe(2)
  }, 60_000)

  it('nothing goes out without its photo: the publish waits and goes out by itself once the photo lands', async () => {
    const one = await insertDraft(`Pisto de prueba ${tag}`, {}, { noPhoto: true })
    const two = await insertDraft(`Sopa de prueba ${tag}`, { origin: 'miguel' }, { noPhoto: true })
    const said = await insertDraft(`Pisto sin foto descartado ${tag}`, {}, { noPhoto: true })

    // «Publicar» on one: Miguel's OK is kept, it stays a draft, waiting for its photo.
    const woke: string[] = []
    expect(await publishCatalogDraft(one, USER_ID, db, () => woke.push('one'))).toMatchObject({ ok: true, waitingPhoto: true })
    expect(woke).toEqual(['one'])
    expect((await sourceOf(one)).status).toBe('draft')
    expect((await sourceOf(one)).catalogSource).toMatchObject({ reviewOk: true, publishWhenPhoto: true })
    expect((await auditFor(one)).map((r) => [r.action, (r.payload as any)?.waitingPhoto])).toEqual([['catalog_draft.publish', true]])

    // «Publicar las aprobadas»: Miguel's own source waits for its photo too.
    const res = await publishApprovedInBatch(tag, USER_ID, db, () => woke.push('batch'))
    expect(res.published).toBe(0)
    expect(res.held.filter((h) => h.reason === 'sin_foto').map((h) => h.id).sort()).toEqual([one, two].sort())
    expect((await sourceOf(two)).catalogSource).toMatchObject({ publishWhenPhoto: true })

    // No photo yet: nothing happens.
    expect(await publishIfWaitingForPhoto(one)).toBe(false)
    // The photo lands → out; the flag is gone.
    await db.update(recipes).set({ imageUrl: '/images/recipes/prueba.jpg' }).where(inArray(recipes.id, [one, two, said]))
    expect(await publishIfWaitingForPhoto(one)).toBe(true)
    expect((await sourceOf(one)).status).toBe('published')
    expect((await sourceOf(one)).catalogSource).not.toHaveProperty('publishWhenPhoto')
    // Miguel said «no» while the photo was being made: it doesn't go out.
    await saveReview([two], false)
    expect(await publishIfWaitingForPhoto(two)).toBe(false)
    expect((await sourceOf(two)).status).toBe('draft')
    // Never asked to publish: the photo alone publishes nothing.
    expect(await publishIfWaitingForPhoto(said)).toBe(false)
    expect((await sourceOf(said)).status).toBe('draft')
  }, 60_000)

  it('the import job store: outcomes in order, finish, and a boot interrupts what was running', async () => {
    const store = createDbImportJobStore()
    const job = await store.create({ batch: tag, origin: 'cocina', fileName: 'tanda-inventada.json', total: 2, createdBy: USER_ID })
    jobIds.push(job.id)
    expect(job).toMatchObject({ status: 'running', done: 0, outcomes: [] })
    await store.progress(job.id, 1, { name: 'Uno', status: 'draft', recipeId: 'x', allergenDoubt: false, auditIssues: [] })
    await store.progress(job.id, 2, { name: 'Dos', status: 'rejected', reason: 'revisor', detail: 'paso sin ingrediente' })
    await store.finish(job.id, 'done')
    const done = await store.get(job.id)
    expect(done).toMatchObject({ status: 'done', done: 2 })
    expect(done!.outcomes.map((o) => o.name)).toEqual(['Uno', 'Dos'])
    expect(done!.finishedAt).not.toBeNull()
    expect((await store.list(20)).map((j) => j.id)).toContain(job.id)

    const stale = await store.create({ batch: tag, origin: 'cocina', fileName: null, total: 5, createdBy: USER_ID })
    jobIds.push(stale.id)
    expect((await store.findRunning())?.id).toBe(stale.id)
    expect(await store.interruptRunning()).toBeGreaterThanOrEqual(1)
    expect(await store.get(stale.id)).toMatchObject({ status: 'interrupted' })
    expect(await store.findRunning()).toBeNull()
  }, 30_000)
})
