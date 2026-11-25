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
import {
  lastPhotoRejection,
  photoGivenUp,
  tryCatalogPhoto,
  withPhotoAttempt,
  withPhotoRetry,
  type CatalogPhotoDeps,
} from '../services/catalogPhotoAttempts.js'
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

describe('a photo the checker turns down twice stops asking by itself (PRO-1313)', () => {
  const T0 = Date.UTC(2026, 10, 25, 8)
  const H = 3600_000

  /** The recipes table as the job sees it: catalog_source survives a restart, the claims don't. */
  function world(outcomes: ApplyOutcome[]) {
    const rows = new Map<string, PhotoCandidate>([['r', cand('r')]])
    let now = T0
    const made: string[] = []
    const attemptDeps: CatalogPhotoDeps = {
      load: async (id) => ({ found: rows.has(id), source: rows.get(id)?.catalogSource ?? null }),
      make: async (id) => {
        made.push(id)
        return outcomes.shift() ?? { status: 'rejected', verdict: { matchesDish: false, reason: 'no es el plato' } as any, attempts: 2 }
      },
      record: async (id, attempt) => {
        const row = rows.get(id)!
        rows.set(id, { ...row, catalogSource: withPhotoAttempt(row.catalogSource, attempt) })
      },
      now: () => new Date(now),
    }
    const sweep = async () => {
      const { deps } = fakeDeps([], {})
      return sweepCatalogPhotos({ ...deps, load: async () => [...rows.values()], makePhoto: (id) => tryCatalogPhoto(id, attemptDeps) })
    }
    return { rows, made, sweep, setNow: (t: number) => void (now = t), restart: () => _resetRequestedPhotos() }
  }

  it('each try is written in the recipe; after 2 turn-downs the recipe is out of the queue, also after a restart', async () => {
    const w = world([])
    await w.sweep()
    expect(w.rows.get('r')!.catalogSource).toMatchObject({ photoRejections: 1, photoAttempts: [{ outcome: 'rejected', reason: 'no es el plato' }] })

    // A restart right after: the turn-down is in the recipe, so no new photo for 6 hours.
    w.restart()
    expect(photoQueue([...w.rows.values()], T0 + H)).toEqual([])
    w.setNow(T0 + H)
    await w.sweep()
    expect(w.made).toEqual(['r'])

    // 6 hours later, the second try; turned down too.
    w.setNow(T0 + 7 * H)
    w.restart()
    await w.sweep()
    expect(w.made).toEqual(['r', 'r'])
    const source = w.rows.get('r')!.catalogSource
    expect(photoGivenUp(source)).toBe(true)
    expect(lastPhotoRejection(source)).toBe('no es el plato')

    // Days later and after any number of restarts: never again by itself.
    for (const days of [1, 3, 30]) {
      w.restart()
      w.setNow(T0 + days * 24 * H)
      expect(photoQueue([...w.rows.values()], T0 + days * 24 * H)).toEqual([])
      await w.sweep()
    }
    expect(w.made).toHaveLength(2)
    // The on-demand path (a menu, a visit) doesn't pay for it either.
    expect(await tryCatalogPhoto('r', { load: async () => ({ found: true, source }), make: async () => { throw new Error('should not be asked') }, record: async () => {}, now: () => new Date(T0 + 30 * 24 * H) })).toEqual({ status: 'given_up' })
  })

  it('«Pedir otra foto» puts it back in the queue; a saved photo starts the count again', async () => {
    const w = world([
      { status: 'rejected', verdict: null, attempts: 2 },
      { status: 'rejected', verdict: null, attempts: 2 },
      { status: 'saved', imageUrl: 'https://img/r.jpg', verdict: null, attempts: 1 },
    ])
    await w.sweep()
    w.setNow(T0 + 7 * H)
    w.restart()
    await w.sweep()
    expect(photoGivenUp(w.rows.get('r')!.catalogSource)).toBe(true)

    const row = w.rows.get('r')!
    w.rows.set('r', { ...row, catalogSource: withPhotoRetry(row.catalogSource) })
    w.restart()
    expect(photoQueue([...w.rows.values()], T0 + 7 * H + 60_000)).toEqual(['r'])
    w.setNow(T0 + 7 * H + 60_000)
    await w.sweep()
    expect(w.made).toEqual(['r', 'r', 'r'])
    const after = w.rows.get('r')!.catalogSource!
    expect(after.photoRejections).toBe(0)
    expect(after.photoAttempts!.map((a) => a.outcome)).toEqual(['rejected', 'rejected', 'saved'])
  })

  it('a network failure is not a turn-down; the history keeps the latest 10', async () => {
    const recorded: unknown[] = []
    const deps: CatalogPhotoDeps = {
      load: async () => ({ found: true, source: source }),
      make: async () => {
        throw new Error('ECONNRESET')
      },
      record: async (_id, a) => void recorded.push(a),
      now: () => new Date(T0),
    }
    await expect(tryCatalogPhoto('x', deps)).rejects.toThrow('ECONNRESET')
    expect(recorded).toEqual([])

    let s: Partial<typeof source> & Record<string, unknown> = source
    for (let i = 0; i < 12; i++) s = withPhotoAttempt(s, { at: new Date(T0 + i).toISOString(), outcome: 'saved' })
    expect(s.photoAttempts).toHaveLength(10)
  })
})
