/**
 * «La receta del día» (PRO-1099, specs/recipe-of-the-day.md):
 *   - the view built from the recipe (short text, key ingredients, minutes,
 *     cuisine, credit, links, photos in both sizes);
 *   - «hoy no hay»: the last one before the day asked for, with its own date;
 *   - GET /recipe-of-the-day[/:date] on a real Express app with injected
 *     services: no account, 400 for a date that isn't a day, 404 when there
 *     has never been one; the photo route answers a JPEG of each size;
 *   - the photo cut to 1080×1350 and 1200×630;
 *   - Mimo's get_recipe_of_the_day, the same on the web chat and WhatsApp.
 * The one-per-day rule at the database is in recipeOfTheDay.smoke.ts.
 */
import express from 'express'
import sharp from 'sharp'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { isIsoDay, type RecipeOfTheDayView } from '@ona/shared'
import {
  buildRecipeOfTheDayView,
  clearRecipeOfTheDayPhotoCache,
  cuisineOf,
  cutPhoto,
  keyIngredients,
  loadRecipeOfTheDay,
  recipeOfTheDayPhoto,
  shortText,
  todayInMadrid,
  type FeaturedIngredientRow,
  type FeaturedRecipeRow,
} from '../services/recipeOfTheDay.js'
import { createRecipeOfTheDayRouter, type RecipeOfTheDayRouteDeps } from '../routes/recipeOfTheDay.js'
import { getRecipeOfTheDay, recipeOfTheDaySummary } from '../services/assistant/recipeOfTheDaySkills.js'
import { skills } from '../services/assistant/skills.js'
import { AppApiError } from '../services/assistant/appApi.js'

const WEB = 'https://mimoia.com'
const LENTEJAS = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f70'

const ROW: FeaturedRecipeRow = {
  id: LENTEJAS,
  name: 'Lentejas estofadas',
  featuredOn: '2026-11-03',
  imageUrl: '/images/recipes/lentejas-estofadas.jpg',
  prepTime: 15,
  cookTime: 30,
  totalTime: 45,
  tags: ['guiso', 'española'],
  internalTags: ['catalogo-tanda', 'tipo:guiso', 'cocina:espanola'],
  sourceUrl: 'https://www.youtube.com/watch?v=abc',
  catalogSource: { origin: 'cocina', batch: 'cocina-01', auditIssues: [], allergenDoubt: false, credit: 'Receta de la Yaya' },
}

const INGS: FeaturedIngredientRow[] = [
  { name: 'Sal', unit: 'pizca', optional: false, displayOrder: 6 },
  { name: 'Lentejas pardinas', unit: 'g', optional: false, displayOrder: 0 },
  { name: 'Aceite de oliva virgen extra', unit: 'cda', optional: false, displayOrder: 1 },
  { name: 'Chorizo', unit: 'g', optional: false, displayOrder: 2 },
  { name: 'Zanahoria', unit: 'u', optional: false, displayOrder: 3 },
  { name: 'Agua', unit: 'ml', optional: false, displayOrder: 4 },
  { name: 'Pimentón de la Vera', unit: 'cdita', optional: true, displayOrder: 5 },
]

describe('the view of the recipe of the day', () => {
  it('key ingredients: in order, without salt, water, oil, «al gusto» or optional ones', () => {
    expect(keyIngredients(INGS)).toEqual(['lentejas pardinas', 'chorizo', 'zanahoria'])
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `Cosa ${i}`, unit: 'g', optional: false, displayOrder: i }))
    expect(keyIngredients(many)).toHaveLength(5)
  })

  it('cuisine: the readable public tag of the hidden cocina: slug', () => {
    expect(cuisineOf(ROW)).toBe('española')
    expect(cuisineOf({ tags: [], internalTags: ['cocina:oriente-medio'] })).toBe('oriente medio')
    expect(cuisineOf({ tags: ['española'], internalTags: [] })).toBeNull()
  })

  it('short text from the recipe itself, never source text', () => {
    expect(shortText({ title: 'Lentejas estofadas', minutes: 45, cuisine: 'española', keyIngredients: ['lentejas', 'chorizo', 'zanahoria'] })).toBe(
      'Lentejas estofadas, de la cocina española, en 45 minutos. Con lentejas, chorizo y zanahoria.',
    )
    expect(shortText({ title: 'Ensalada', minutes: null, cuisine: null, keyIngredients: [] })).toBe('Ensalada.')
  })

  it('carries title, minutes, credit, links and both photo sizes', () => {
    const v = buildRecipeOfTheDayView(ROW, INGS, { requestedDate: '2026-11-03', webUrl: `${WEB}/` })
    expect(v).toMatchObject({
      date: '2026-11-03',
      requestedDate: '2026-11-03',
      isRequestedDate: true,
      recipeId: LENTEJAS,
      title: 'Lentejas estofadas',
      minutes: 45,
      cuisine: 'española',
      credit: 'Receta de la Yaya',
      sourceUrl: 'https://www.youtube.com/watch?v=abc',
      url: `${WEB}/recipes/${LENTEJAS}`,
      imageUrl: '/images/recipes/lentejas-estofadas.jpg',
      photos: {
        vertical: `${WEB}/receta-del-dia/2026-11-03/foto/vertical`,
        horizontal: `${WEB}/receta-del-dia/2026-11-03/foto/horizontal`,
      },
    })
    expect(v.text).toContain('Con lentejas pardinas, chorizo y zanahoria.')
    // Nothing else of catalog_source leaves (D-067).
    expect(JSON.stringify(v)).not.toContain('cocina-01')
    expect(buildRecipeOfTheDayView({ ...ROW, imageUrl: null }, INGS, { requestedDate: '2026-11-03', webUrl: WEB }).photos).toBeNull()
  })

  it('«hoy no hay»: the last one before, with its own date', async () => {
    const asked: string[] = []
    const v = await loadRecipeOfTheDay('2026-11-04', {
      webUrl: WEB,
      findFeatured: async (day) => (asked.push(day), ROW),
      ingredientsOf: async () => INGS,
    })
    expect(asked).toEqual(['2026-11-04'])
    expect(v).toMatchObject({ date: '2026-11-03', requestedDate: '2026-11-04', isRequestedDate: false })
    expect(await loadRecipeOfTheDay('2026-11-04', { webUrl: WEB, findFeatured: async () => null, ingredientsOf: async () => [] })).toBeNull()
  })

  it('today is Madrid\'s day, and only real days count', () => {
    // 23:30 UTC on 3 Nov is already the 4th in Madrid (CET).
    expect(todayInMadrid(new Date('2026-11-03T23:30:00Z'))).toBe('2026-11-04')
    expect(isIsoDay('2026-11-04')).toBe(true)
    expect(isIsoDay('2026-02-30')).toBe(false)
    expect(isIsoDay('4-11-2026')).toBe(false)
  })
})

// ─── Routes ─────────────────────────────────────────────────────

const servers: Server[] = []
afterAll(() => servers.forEach((s) => s.close()))

async function serve(over: Partial<RecipeOfTheDayRouteDeps>): Promise<string> {
  const app = express()
  app.use(createRecipeOfTheDayRouter({ today: () => '2026-11-04', ...over }))
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const VIEW = (requestedDate: string): RecipeOfTheDayView => buildRecipeOfTheDayView(ROW, INGS, { requestedDate, webUrl: WEB })

describe('GET /recipe-of-the-day', () => {
  it('today\'s by default, no account needed; a given day by its date', async () => {
    const days: string[] = []
    const base = await serve({ load: async (d) => (days.push(d), VIEW(d)) })
    const today = await fetch(`${base}/recipe-of-the-day`)
    expect(today.status).toBe(200)
    expect(today.headers.get('cache-control')).toContain('public')
    expect(await today.json()).toMatchObject({ title: 'Lentejas estofadas', requestedDate: '2026-11-04', date: '2026-11-03', isRequestedDate: false })
    const given = await fetch(`${base}/recipe-of-the-day/2026-11-03`)
    expect(await given.json()).toMatchObject({ date: '2026-11-03', isRequestedDate: true })
    expect(days).toEqual(['2026-11-04', '2026-11-03'])
  })

  it('400 for a date that is not a day; 404 when there has never been one', async () => {
    const base = await serve({ load: async () => null })
    const bad = await fetch(`${base}/recipe-of-the-day/2026-13-01`)
    expect(bad.status).toBe(400)
    expect((await bad.json()).code).toBe('INVALID_DATE')
    const none = await fetch(`${base}/recipe-of-the-day`)
    expect(none.status).toBe(404)
    expect(await none.json()).toEqual({ error: 'Todavía no hay receta del día.', code: 'NONE' })
  })

  it('the photo route: a JPEG per size, 404 for another name or no photo', async () => {
    const asked: string[] = []
    const base = await serve({
      photo: async (day, format) => (asked.push(`${day}:${format}`), day === '2026-11-03' ? Buffer.from([0xff, 0xd8, 0xff]) : null),
    })
    const v = await fetch(`${base}/recipe-of-the-day/2026-11-03/photo/vertical`)
    expect(v.status).toBe(200)
    expect(v.headers.get('content-type')).toBe('image/jpeg')
    expect((await fetch(`${base}/recipe-of-the-day/2026-11-03/photo/cuadrada`)).status).toBe(404)
    expect((await fetch(`${base}/recipe-of-the-day/2026-11-04/photo/horizontal`)).status).toBe(404)
    expect(asked).toEqual(['2026-11-03:vertical', '2026-11-04:horizontal'])
  })
})

// ─── Photos ─────────────────────────────────────────────────────

describe('the photo cut for the networks', () => {
  beforeEach(() => clearRecipeOfTheDayPhotoCache())
  const square = () => sharp({ create: { width: 800, height: 800, channels: 3, background: '#C65D38' } }).jpeg().toBuffer()

  it('1080×1350 and 1200×630, from a photo of any shape', async () => {
    const src = await square()
    for (const [format, w, h] of [['vertical', 1080, 1350], ['horizontal', 1200, 630]] as const) {
      const meta = await sharp(await cutPhoto(src, format)).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', w, h])
    }
  })

  it('reads the catalogue photo from the web (relative) and keeps the cut', async () => {
    const src = await square()
    const fetched: string[] = []
    const deps = {
      webUrl: WEB,
      photoOf: async () => ({ recipeId: LENTEJAS, imageUrl: '/images/recipes/lentejas-estofadas.jpg' }),
      fetchImage: async (url: string) => (fetched.push(url), src),
    }
    const a = await recipeOfTheDayPhoto('2026-11-03', 'horizontal', deps)
    const b = await recipeOfTheDayPhoto('2026-11-03', 'horizontal', deps)
    expect(a && (await sharp(a).metadata()).width).toBe(1200)
    expect(b).toBe(a)
    expect(fetched).toEqual([`${WEB}/images/recipes/lentejas-estofadas.jpg`])
  })

  it('no recipe that day, no photo or an unreadable one → null', async () => {
    const base = { webUrl: WEB, fetchImage: async () => Buffer.from('no es una foto') }
    expect(await recipeOfTheDayPhoto('2026-11-03', 'vertical', { ...base, photoOf: async () => null })).toBeNull()
    expect(await recipeOfTheDayPhoto('2026-11-03', 'vertical', { ...base, photoOf: async () => ({ recipeId: LENTEJAS, imageUrl: null }) })).toBeNull()
    expect(await recipeOfTheDayPhoto('2026-11-03', 'vertical', { ...base, photoOf: async () => ({ recipeId: LENTEJAS, imageUrl: '/x.jpg' }) })).toBeNull()
  })
})

// ─── The page's link preview ────────────────────────────────────

describe('/receta-del-dia: Open Graph', () => {
  it('title, text and the 1200×630 cut as the preview image; a generic one when there is none', async () => {
    const { recipeOfTheDayMetadata, formatDayEs } = await import('../../../web/src/lib/recipeOfTheDay')
    const m = recipeOfTheDayMetadata(VIEW('2026-11-03'))
    expect(m.title).toBe('Lentejas estofadas · La receta del día · Mimoia')
    expect(m.alternates?.canonical).toBe('/receta-del-dia')
    const og = m.openGraph as { title: string; description: string; images: Array<{ url: string; width: number; height: number }> }
    expect(og.title).toBe('Lentejas estofadas')
    expect(og.description).toContain('Con lentejas pardinas')
    expect(og.images[0]).toMatchObject({ url: '/receta-del-dia/2026-11-03/foto/horizontal', width: 1200, height: 630 })
    expect(recipeOfTheDayMetadata(VIEW('2026-11-03'), '/receta-del-dia/2026-11-03').alternates?.canonical).toBe('/receta-del-dia/2026-11-03')
    const none = recipeOfTheDayMetadata(null)
    expect(none.title).toBe('La receta del día · Mimoia')
    expect(none.openGraph).toBeUndefined()
    expect(formatDayEs('2026-11-04')).toBe('Miércoles, 4 de noviembre')
  })
})

// ─── Mimo ───────────────────────────────────────────────────────

describe('Mimo: get_recipe_of_the_day (D-051)', () => {
  const fakeApi = (view: RecipeOfTheDayView | null, allergens: string[] = ['gluten']) => {
    const calls: string[] = []
    const api = async (method: string, path: string) => {
      calls.push(`${method} ${path}`)
      if (path.startsWith('/recipe-of-the-day')) {
        if (!view) throw new AppApiError(404, 'Todavía no hay receta del día.')
        return view
      }
      return { allergens }
    }
    return { api: api as any, calls }
  }

  it('is one of Mimo\'s tools, on the web chat and on WhatsApp alike', async () => {
    const { toolsFor } = await import('../services/assistant/skills.js')
    expect(skills.map((s) => s.name)).toContain('get_recipe_of_the_day')
    expect(toolsFor({ mode: 'whatsapp' }).map((s) => s.name)).toContain('get_recipe_of_the_day')
    expect(toolsFor({}).map((s) => s.name)).toContain('get_recipe_of_the_day')
  })

  it('reads the same endpoint as the page, today\'s or a given day\'s, with its allergens', async () => {
    for (const channel of ['web', 'whatsapp'] as const) {
      const { api, calls } = fakeApi(VIEW('2026-11-03'))
      const r = await getRecipeOfTheDay.handler({}, { userId: 'u1', db: null, api, channel })
      expect(calls).toEqual(['GET /recipe-of-the-day', `GET /recipes/${LENTEJAS}`])
      expect(r.data.recipeOfTheDay.title).toBe('Lentejas estofadas')
      expect(r.summary).toContain('«Lentejas estofadas»')
      expect(r.summary).toContain(`${WEB}/recipes/${LENTEJAS}`)
      expect(r.summary).toContain('Alérgenos: gluten.')
      expect(r.summary).toContain('no está elegida para este hogar')
    }
    const { api, calls } = fakeApi(VIEW('2026-11-03'))
    await getRecipeOfTheDay.handler({ date: '2026-11-03' }, { userId: 'u1', db: null, api })
    expect(calls[0]).toBe('GET /recipe-of-the-day/2026-11-03')
  })

  it('«hoy no hay» says which day it is from; none at all and a bad date are said too', async () => {
    expect(recipeOfTheDaySummary(VIEW('2026-11-04'), [])).toMatch(/^El miércoles 4 de noviembre no hay receta del día; la última fue «Lentejas estofadas», el martes 3 de noviembre\./)
    const none = await getRecipeOfTheDay.handler({}, { userId: 'u1', db: null, api: fakeApi(null).api })
    expect(none.summary).toBe('Todavía no hay receta del día.')
    const { api, calls } = fakeApi(VIEW('2026-11-03'))
    const bad = await getRecipeOfTheDay.handler({ date: 'mañana' }, { userId: 'u1', db: null, api })
    expect(bad.data.error).toBe('INVALID_DATE')
    expect(calls).toEqual([])
  })
})
