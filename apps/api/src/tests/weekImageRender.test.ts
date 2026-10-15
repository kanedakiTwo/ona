/**
 * The WhatsApp week image (2026-10-15) renders on the server without a
 * browser: satori + resvg + sharp, bundled fonts and icons. These tests draw
 * the two approved formats for real and check the JPG.
 *
 * To look at the result: `WEEK_IMAGE_OUT_DIR=/some/dir` writes
 * `server-A.jpg` / `server-B.jpg` there; `WEEK_IMAGE_PHOTOS=<file>` (lines
 * `Recipe name|image url|…`) uses real recipe photos instead of plain tiles.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { buildWeekImageModel, photoRecipeIds } from '../services/weekImage/model.js'
import { renderWeekImage, WIDTH } from '../services/weekImage/render.js'
import { loadRecipePhotos } from '../services/weekImage/photos.js'
import { weekMenuImage } from '../services/weekImage/index.js'

const id = (name: string) => name.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '-')
const r = (recipeName: string, extra: Record<string, unknown> = {}) => ({ kind: 'recipe' as const, recipeId: id(recipeName), recipeName, ...extra })
const slot = (...dishes: any[]) => ({ dishes })

/** Luis's week, as in the approved prototype A (generated Thursday 15 Oct). */
const PAIRS: [string, string][] = [
  ['Ropa vieja del cocido', 'Onigirazu'],
  ['Tortilla de patatas', 'Arroz tres delicias'],
  ['Pizza de colores con verduras', 'Verduras estofadas'],
  ['Pisto con huevo frito a la Thermomix', 'Guisantes lágrima'],
  ['Pollo agridulce', 'Costillas a la riojana'],
  ['Alubias rojas con entraña y embutidos', 'Lentejas guisadas'],
  ['Hamburguesa casera', 'Oreja a la plancha'],
]
const WEEK_A = PAIRS.map(([l, d]) => ({ lunch: slot(r(l)), dinner: slot(r(d)) }))

/** Prototype B: breakfast + lunch + dinner, two dishes each. */
const BREAKFASTS = ['Porridge de avena con plátano', 'Tostadas con aguacate y huevo', 'Yogur con avena y manzana']
const SIDES = ['Ensalada griega', 'Crema de calabacín', 'Sopa juliana', 'Ensalada de atún']
const WEEK_B = PAIRS.map(([l, d], i) => ({
  breakfast: slot(r(BREAKFASTS[i % 3]), { kind: 'note', text: 'Fruta de temporada' }),
  lunch: slot(r(l), r(SIDES[i % 4])),
  dinner: slot(r(d), r(SIDES[(i + 2) % 4])),
}))

/** Plain coloured squares stand in for recipe photos (no network in CI). */
async function fakePhotos(ids: string[]): Promise<Map<string, Buffer>> {
  const palette = [[200, 140, 90], [120, 150, 90], [190, 90, 60], [230, 200, 140], [150, 110, 80]]
  const out = new Map<string, Buffer>()
  await Promise.all(ids.map(async (rid, i) => {
    const [r, g, b] = palette[i % palette.length]
    out.set(rid, await sharp({ create: { width: 320, height: 320, channels: 3, background: { r, g, b } } }).jpeg().toBuffer())
  }))
  return out
}

async function photosFor(ids: string[]): Promise<Map<string, Buffer>> {
  const file = process.env.WEEK_IMAGE_PHOTOS
  if (!file) return fakePhotos(ids)
  const urls = new Map<string, string>()
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [name, url] = line.split('|')
    if (name && url) urls.set(id(name), url)
  }
  return loadRecipePhotos(ids.map((recipeId) => ({ recipeId, url: urls.get(recipeId) })), { webUrl: 'https://mimoia.com', timeoutMs: 8000 })
}

async function draw(days: any[], name: string) {
  const model = buildWeekImageModel({ weekStart: '2026-10-12', days }, { today: '2026-10-15' })!
  const photos = await photosFor(photoRecipeIds(model))
  const t0 = Date.now()
  const jpg = await renderWeekImage(model, photos)
  const ms = Date.now() - t0
  if (process.env.WEEK_IMAGE_OUT_DIR) writeFileSync(`${process.env.WEEK_IMAGE_OUT_DIR}/${name}`, jpg)
  return { model, jpg, ms, meta: await sharp(jpg).metadata() }
}

describe('renderWeekImage', () => {
  it('draws format A (comida y cena, one dish each) as a 1080-wide JPG', async () => {
    const { model, jpg, meta, ms } = await draw(WEEK_A, 'server-A.jpg')
    expect(model.format).toBe('A')
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(WIDTH)
    expect(meta.height).toBeGreaterThan(1400)
    expect(jpg.length).toBeGreaterThan(30_000)
    console.log(`[week-image] A: ${meta.width}×${meta.height}, ${Math.round(jpg.length / 1024)} KB, ${ms} ms`)
  }, 30_000)

  it('draws format B (desayuno, comida y cena, two dishes each) taller than A', async () => {
    const { model, jpg, meta, ms } = await draw(WEEK_B, 'server-B.jpg')
    expect(model.format).toBe('B')
    expect(meta.width).toBe(WIDTH)
    expect(meta.height).toBeGreaterThan(1600)
    expect(jpg.length).toBeGreaterThan(30_000)
    console.log(`[week-image] B: ${meta.width}×${meta.height}, ${Math.round(jpg.length / 1024)} KB, ${ms} ms`)
  }, 30_000)

  it('draws odd weeks too: four meals, notes, leftovers, a skipped and an empty day, no photos at all', async () => {
    const days: any[] = [
      { breakfast: slot({ kind: 'note', text: 'Café y tostadas 🍞' }), lunch: slot(r('Paella')), snack: slot(r('Fruta')), dinner: slot(r('Sopa'), r('Tortilla'), r('Ensalada')) },
      {},
      { lunch: slot(r('Paella', { variant: 'leftover' })), dinner: slot(r('Lentejas', { variant: 'freezer' })) },
      null,
      { dinner: slot(r('Pizza casera con nombre larguísimo que no cabe en dos líneas de ninguna manera posible')) },
    ]
    const model = buildWeekImageModel({ weekStart: '2026-10-12', days, skippedDays: [3] }, { today: '2026-10-15' })!
    const jpg = await renderWeekImage(model)
    const meta = await sharp(jpg).metadata()
    expect(model.columns).toHaveLength(4)
    expect(meta.width).toBe(WIDTH)
    if (process.env.WEEK_IMAGE_OUT_DIR) writeFileSync(`${process.env.WEEK_IMAGE_OUT_DIR}/server-odd.jpg`, jpg)
  }, 30_000)
})

describe('weekMenuImage', () => {
  it('draws tiles when photos cannot be fetched (never fails because of a photo)', async () => {
    const failingFetch = (async () => { throw new Error('offline') }) as unknown as typeof fetch
    const jpg = await weekMenuImage(
      { weekStart: '2026-10-12', days: WEEK_A },
      {
        today: '2026-10-15',
        webUrl: 'https://mimoia.com',
        photoUrls: async (ids) => new Map(ids.map((i) => [i, `/images/recipes/${i}.jpg`])),
        fetchImpl: failingFetch,
      },
    )
    expect(jpg).not.toBeNull()
    expect((await sharp(jpg!).metadata()).width).toBe(WIDTH)
  }, 30_000)

  it('also survives the photo lookup itself failing', async () => {
    const jpg = await weekMenuImage(
      { weekStart: '2026-10-12', days: WEEK_A },
      { today: '2026-10-15', webUrl: 'https://mimoia.com', photoUrls: async () => { throw new Error('db down') } },
    )
    expect(jpg).not.toBeNull()
  }, 30_000)

  it('returns null for a week with nothing to draw', async () => {
    const jpg = await weekMenuImage(
      { weekStart: '2026-10-12', days: [{}, {}] },
      { today: '2026-10-15', webUrl: 'https://mimoia.com', photoUrls: async () => new Map() },
    )
    expect(jpg).toBeNull()
  })
})
