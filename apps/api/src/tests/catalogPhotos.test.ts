/**
 * Catalogue photos before anyone opens the recipe (Miguel, 2026-10-21: «debería
 * generarse antes de que nadie pudiera acceder»; specs/catalog-import.md →
 * Photos). The API makes the photo of every catalogue draft and of any
 * published recipe still without one; a publish that was waiting for the
 * photo goes out when it lands. One ask per recipe every 6 hours, shared with
 * the on-demand path, so the two never pay twice.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { _resetRequestedPhotos, claimCatalogPhoto, releaseCatalogPhoto, requestCatalogPhotos } from '../services/catalogImageOnDemand.js'
import { photoQueue, sweepCatalogPhotos, type PhotoCandidate, type PhotoSweepDeps } from '../services/catalogPhotos.js'
import type { ApplyOutcome } from '../services/recipeHouseImage.js'

const source = { origin: 'miguel' as const, batch: 'libros-01', auditIssues: [], allergenDoubt: false }
const cand = (id: string, over: Partial<PhotoCandidate> = {}): PhotoCandidate => ({ id, status: 'draft', imageUrl: null, catalogSource: source, ...over })

afterEach(() => _resetRequestedPhotos())

describe('photoQueue', () => {
  it('published first, then the drafts waiting to go out, then the rest; never a discarded draft or one with a photo', () => {
    const queue = photoQueue([
      cand('draft1'),
      cand('waiting', { catalogSource: { ...source, publishWhenPhoto: true } }),
      cand('pub', { status: 'published' }),
      cand('discarded', { catalogSource: { ...source, reviewOk: false } }),
      cand('has-photo', { imageUrl: '/images/recipes/x.jpg' }),
      cand('archived', { status: 'archived' }),
      cand('draft2', { catalogSource: null }),
    ])
    expect(queue).toEqual(['pub', 'waiting', 'draft1', 'draft2'])
  })
})

function fakeDeps(rows: PhotoCandidate[], outcomes: Record<string, ApplyOutcome | Error>, waiting: string[] = []) {
  const made: string[] = []
  const published: string[] = []
  const logs: string[] = []
  const deps: PhotoSweepDeps = {
    load: async () => rows,
    makePhoto: async (id) => {
      made.push(id)
      const o = outcomes[id] ?? { status: 'saved', imageUrl: `https://img/${id}.jpg`, verdict: null, attempts: 1 }
      if (o instanceof Error) throw o
      return o
    },
    publishIfWaiting: async (id) => {
      if (!waiting.includes(id)) return false
      published.push(id)
      return true
    },
    claim: (id) => claimCatalogPhoto(id),
    release: (id) => releaseCatalogPhoto(id),
    log: (line) => void logs.push(line),
  }
  return { deps, made, published, logs }
}

describe('sweepCatalogPhotos', () => {
  it('makes each photo and publishes the drafts whose publish was waiting for it', async () => {
    const rows = [cand('a', { catalogSource: { ...source, publishWhenPhoto: true } }), cand('b')]
    const { deps, made, published } = fakeDeps(rows, {}, ['a'])
    expect(await sweepCatalogPhotos(deps)).toEqual({ saved: 2, published: 1, rejected: 0, failed: 0 })
    expect(made).toEqual(['a', 'b'])
    expect(published).toEqual(['a'])
  })

  it('a photo the checker turned down is not paid for again on the next pass; a failed call is', async () => {
    const rows = [cand('no'), cand('net')]
    const first = fakeDeps(rows, { no: { status: 'rejected', verdict: null, attempts: 2 }, net: new Error('ECONNRESET') }, ['no'])
    expect(await sweepCatalogPhotos(first.deps)).toEqual({ saved: 0, published: 0, rejected: 1, failed: 1 })
    expect(first.published).toEqual([])
    expect(first.logs).toHaveLength(2)

    const second = fakeDeps(rows, {})
    await sweepCatalogPhotos(second.deps)
    expect(second.made).toEqual(['net'])
  })

  it('someone set a photo meanwhile: nothing saved, but a waiting publish still goes out', async () => {
    const { deps, published } = fakeDeps([cand('x')], { x: { status: 'skipped', reason: 'changed_meanwhile' } }, ['x'])
    expect(await sweepCatalogPhotos(deps)).toEqual({ saved: 0, published: 1, rejected: 0, failed: 0 })
    expect(published).toEqual(['x'])
  })
})

describe('one ask per recipe every 6 hours, shared with the on-demand path', () => {
  it('the sweep skips a photo the recipe page already asked for, and the page skips one the sweep took', async () => {
    const asked: string[] = []
    expect(requestCatalogPhotos([{ id: 'p', authorId: null, imageUrl: null }], (id) => void asked.push(id))).toEqual(['p'])
    const { deps, made } = fakeDeps([cand('p', { status: 'published' }), cand('q', { status: 'published' })], {})
    await sweepCatalogPhotos(deps)
    expect(made).toEqual(['q'])
    expect(requestCatalogPhotos([{ id: 'q', authorId: null, imageUrl: null }], (id) => void asked.push(id))).toEqual([])
    expect(asked).toEqual(['p'])
  })

  it('after 6 hours it may ask again', () => {
    const t0 = Date.UTC(2026, 9, 21, 8)
    expect(claimCatalogPhoto('r', t0)).toBe(true)
    expect(claimCatalogPhoto('r', t0 + 5 * 3600_000)).toBe(false)
    expect(claimCatalogPhoto('r', t0 + 6 * 3600_000)).toBe(true)
  })
})
