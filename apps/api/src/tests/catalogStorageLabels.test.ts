/**
 * PRO-372 — the background fill of «Se puede congelar» / «Aguanta N días en
 * nevera» for the catalogue that already exists (catalogStorageLabels.ts):
 * only catalogue recipes without the data, 20 at a time, never users'
 * recipes, and each recipe asked once per process. Fake AI and database.
 */
import { describe, expect, it } from 'vitest'
import {
  STORAGE_LABEL_BATCH,
  parseStorageLabels,
  storageLabelBatch,
  storageLabelMessage,
  sweepCatalogStorageLabels,
  type StorageCandidate,
  type StorageLabel,
  type StorageLabelInput,
  type StorageSweepDeps,
} from '../services/catalogStorageLabels.js'

function catalogue(n: number, prefix = 'c'): StorageCandidate[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `Receta ${prefix}${i}`, authorId: null, freezable: null, fridgeDays: null }))
}

function fakeDeps(rows: StorageCandidate[], over: Partial<StorageSweepDeps> = {}) {
  const lots: StorageLabelInput[][] = []
  const saved: StorageLabel[] = []
  const deps: StorageSweepDeps = {
    load: async () => rows,
    ingredientsOf: async (ids) => new Map(ids.map((id) => [id, ['garbanzos', 'cebolla']])),
    label: async (lot) => {
      lots.push(lot)
      return lot.map((r) => ({ id: r.id, freezable: true, fridgeDays: 3 }))
    },
    save: async (labels) => {
      saved.push(...labels)
    },
    log: () => {},
    ...over,
  }
  return { deps, lots, saved }
}

describe('catalogue storage labels (PRO-372)', () => {
  it('labels only catalogue recipes without data, in lots of 20', async () => {
    const rows: StorageCandidate[] = [
      ...catalogue(45),
      // A user's recipe: never touched.
      { id: 'u1', name: 'Mi guiso', authorId: 'user-1', freezable: null, fridgeDays: null },
      // Already has both: nothing to ask.
      { id: 'done', name: 'Lentejas', authorId: null, freezable: true, fridgeDays: 4 },
      // Has one of the two: asked (only the empty one is written by `save`).
      { id: 'half', name: 'Crema de calabaza', authorId: null, freezable: true, fridgeDays: null },
    ]
    const { deps, lots, saved } = fakeDeps(rows)
    const r = await sweepCatalogStorageLabels(deps)

    expect(lots.map((l) => l.length)).toEqual([20, 20, 6])
    for (const lot of lots) expect(lot.length).toBeLessThanOrEqual(STORAGE_LABEL_BATCH)
    const asked = lots.flat().map((l) => l.id)
    expect(asked).not.toContain('u1')
    expect(asked).not.toContain('done')
    expect(asked).toContain('half')
    expect(new Set(asked).size).toBe(asked.length)
    expect(saved.map((s) => s.id).sort()).toEqual(asked.sort())
    expect(lots[0][0].ingredients).toEqual(['garbanzos', 'cebolla'])
    expect(r).toEqual({ lots: 3, labelled: 46, failed: 0 })
  })

  it('a recipe the model is unsure about is not saved nor asked again in the next pass', async () => {
    const tried = new Set<string>()
    const { deps, lots, saved } = fakeDeps(catalogue(3), {
      label: async (lot) => {
        lots.push(lot)
        return lot.map((r) => (r.id === 'c1' ? { id: r.id, freezable: null, fridgeDays: null } : { id: r.id, freezable: false, fridgeDays: 2 }))
      },
    })
    await sweepCatalogStorageLabels(deps, tried)
    expect(saved.map((s) => s.id)).toEqual(['c0', 'c2'])
    await sweepCatalogStorageLabels(deps, tried)
    expect(lots).toHaveLength(1)
  })

  it('a failed call stops the pass and its lot is asked again next time', async () => {
    const tried = new Set<string>()
    let fail = true
    const { deps, lots } = fakeDeps(catalogue(25), {
      label: async (lot) => {
        lots.push(lot)
        if (fail) throw new Error('network')
        return lot.map((r) => ({ id: r.id, freezable: true, fridgeDays: 3 }))
      },
    })
    expect(await sweepCatalogStorageLabels(deps, tried)).toMatchObject({ lots: 1, failed: 20 })
    fail = false
    expect(await sweepCatalogStorageLabels(deps, tried)).toMatchObject({ lots: 2, labelled: 25 })
    expect(lots.map((l) => l.length)).toEqual([20, 20, 5])
  })

  it('the lot helper skips what was tried, and caps at 20', () => {
    expect(storageLabelBatch(catalogue(30), new Set(['c0', 'c1'])).map((r) => r.id)[0]).toBe('c2')
    expect(storageLabelBatch(catalogue(30))).toHaveLength(20)
  })

  it('parses the answer by number; odd values are no data', () => {
    const lot = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const text = '```json\n{"recipes":[{"n":1,"freezable":true,"fridgeDays":4},{"n":2,"freezable":"no","fridgeDays":40},{"n":9,"freezable":true,"fridgeDays":2}]}\n```'
    expect(parseStorageLabels(text, lot)).toEqual([
      { id: 'a', freezable: true, fridgeDays: 4 },
      { id: 'b', freezable: null, fridgeDays: null },
    ])
    expect(storageLabelMessage([{ id: 'a', name: 'Lentejas', ingredients: ['lentejas', 'chorizo'] }])).toBe('1. Lentejas — lentejas, chorizo')
  })
})
