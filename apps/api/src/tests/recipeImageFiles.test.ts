/**
 * PRO-1318: a recipe photo that isn't on the volume answers 404 (not 500),
 * and the recipes that point at a missing file go back to the photo queue.
 */
import express from 'express'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import { errorHandler } from '../middleware/errorHandler.js'
import { createRecipeImagesRouter } from '../routes/recipeImages.js'
import { findMissingImages, requeueMissingRecipePhotos, volumeFilename, type HeroRow, type RequeueDeps } from '../services/recipeImageFiles.js'

const BASE = 'https://api.test/images/recipes'
const dir = mkdtempSync(path.join(tmpdir(), 'ona-images-'))
writeFileSync(path.join(dir, 'hay.jpg'), 'jpg')
let server: Server | null = null

async function serve(): Promise<string> {
  if (server) return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const app = express()
  app.use(createRecipeImagesRouter(dir))
  app.use(errorHandler)
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterAll(() => {
  server?.closeAllConnections()
  server?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('GET /images/recipes/<file>', () => {
  it('serves a file that is there, long-cached', async () => {
    const res = await fetch(`${await serve()}/images/recipes/hay.jpg`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('jpg')
    expect(res.headers.get('cache-control')).toContain('immutable')
  })

  it('answers 404 for a file that is not there', async () => {
    const url = await serve()
    const res = await fetch(`${url}/images/recipes/no-esta.jpg`)
    expect(res.status).toBe(404)
    const traversal = await fetch(`${url}/images/recipes/..%2F..%2Fetc%2Fpasswd`)
    expect(traversal.status).toBeGreaterThanOrEqual(400)
    expect(traversal.status).toBeLessThan(500)
  })
})

describe('volumeFilename', () => {
  it('names the volume file only for our own URLs', () => {
    expect(volumeFilename(`${BASE}/abc.jpg`, BASE)).toBe('abc.jpg')
    expect(volumeFilename(`${BASE}/abc.jpg?v=3`, BASE)).toBe('abc.jpg')
    expect(volumeFilename('/images/recipes/seed.jpg', BASE)).toBeNull()
    expect(volumeFilename('https://youtube.com/x.jpg', BASE)).toBeNull()
    expect(volumeFilename(`${BASE}/a/b.jpg`, BASE)).toBeNull()
    expect(volumeFilename(`${BASE}/..`, BASE)).toBeNull()
    expect(volumeFilename(null, BASE)).toBeNull()
  })
})

const heroes: HeroRow[] = [
  { id: 'cat-ok', authorId: null, imageUrl: `${BASE}/cat-ok.jpg` },
  { id: 'cat-lost', authorId: null, imageUrl: `${BASE}/cat-lost.jpg` },
  { id: 'user-lost', authorId: 'u1', imageUrl: `${BASE}/user-lost.jpg` },
  { id: 'seed', authorId: null, imageUrl: '/images/recipes/seed.jpg' },
  { id: 'og', authorId: 'u2', imageUrl: 'https://example.com/og.jpg' },
]
const files = new Set(['cat-ok.jpg', 'g1.jpg'])

describe('findMissingImages', () => {
  it('finds catalogue and user recipes whose file is gone, and counts gallery photos', () => {
    const found = findMissingImages(heroes, [`${BASE}/g1.jpg`, `${BASE}/g2.jpg`, `${BASE}/g3.jpg`], new Set([...files, 'g3.jpg']), BASE)
    expect(found.heroesOnVolume).toBe(3)
    expect(found.catalogue).toEqual(['cat-lost'])
    expect(found.user).toEqual([{ id: 'user-lost', authorId: 'u1' }])
    expect(found.galleryOnVolume).toBe(3)
    expect(found.galleryMissing).toBe(1)
    expect(found.braked).toBe(false)
  })

  it('brakes when the volume is unreadable, empty or mostly missing', () => {
    expect(findMissingImages(heroes, [], null, BASE).braked).toBe(true)
    expect(findMissingImages(heroes, [], new Set(), BASE).braked).toBe(true)
    expect(findMissingImages(heroes, [], new Set(['otro.jpg']), BASE).braked).toBe(true)
  })
})

function deps(over: Partial<RequeueDeps> = {}): RequeueDeps & { cleared: HeroRow[]; scheduled: string[]; woke: number; lines: string[] } {
  const d = {
    cleared: [] as HeroRow[],
    scheduled: [] as string[],
    woke: 0,
    lines: [] as string[],
    loadHeroes: async () => [...heroes, { id: 'cat-ok2', authorId: null, imageUrl: `${BASE}/cat-ok2.jpg` }],
    loadGallery: async () => [],
    listFiles: async () => new Set([...files, 'cat-ok2.jpg']),
    clearImages: async (rows: HeroRow[]) => {
      d.cleared.push(...rows)
    },
    wakeCatalogue: () => {
      d.woke += 1
    },
    scheduleUser: (id: string) => {
      d.scheduled.push(id)
    },
    log: (line: string) => {
      d.lines.push(line)
    },
    publicBase: BASE,
    ...over,
  }
  return d
}

describe('requeueMissingRecipePhotos', () => {
  it('sends recipes without their file back to the photo queue', async () => {
    const d = deps()
    await requeueMissingRecipePhotos(d)
    expect(d.cleared.map((r) => r.id).sort()).toEqual(['cat-lost', 'user-lost'])
    expect(d.woke).toBe(1)
    expect(d.scheduled).toEqual(['user-lost'])
    expect(d.lines[0]).toContain('2 missing (1 catalogue, 1 user)')
    expect(d.lines[0]).not.toMatch(/cat-lost|user-lost/)
  })

  it('changes nothing when the volume looks unmounted', async () => {
    const d = deps({ listFiles: async () => new Set() })
    await requeueMissingRecipePhotos(d)
    expect(d.cleared).toEqual([])
    expect(d.woke).toBe(0)
    expect(d.scheduled).toEqual([])
    expect(d.lines[0]).toContain('nothing changed')
  })

  it('does nothing when every file is there', async () => {
    const d = deps({ loadHeroes: async () => [heroes[0]] })
    await requeueMissingRecipePhotos(d)
    expect(d.cleared).toEqual([])
    expect(d.woke).toBe(0)
  })
})
