/**
 * «La receta del día» (PRO-1099, specs/recipe-of-the-day.md). Public: no
 * account needed — the web page, the networks' posts and Mimo read it.
 *
 *   GET /recipe-of-the-day              today's (Madrid); if today has none, the last one, with its date
 *   GET /recipe-of-the-day/AAAA-MM-DD   that day's; if it has none, the last one before it
 *   GET /recipe-of-the-day/AAAA-MM-DD/photo/vertical|horizontal
 *                                       that day's photo cut to 1080×1350 or 1200×630 (JPEG);
 *                                       404 when that very day has no recipe or no photo
 *
 * 404 `NONE` when there has never been one up to that day; 400 for a date
 * that isn't a real day.
 */
import { Router } from 'express'
import { isIsoDay, RECIPE_OF_THE_DAY_PHOTO_SIZES, type RecipeOfTheDayPhotoFormat, type RecipeOfTheDayView } from '@ona/shared'
import { env } from '../config/env.js'
import {
  createDbRecipeOfTheDayDeps,
  createDbRecipeOfTheDayPhotoDeps,
  loadRecipeOfTheDay,
  recipeOfTheDayPhoto,
  todayInMadrid,
} from '../services/recipeOfTheDay.js'

export interface RecipeOfTheDayRouteDeps {
  load: (day: string) => Promise<RecipeOfTheDayView | null>
  photo: (day: string, format: RecipeOfTheDayPhotoFormat) => Promise<Buffer | null>
  today: () => string
}

const NONE = { error: 'Todavía no hay receta del día.', code: 'NONE' }
const NO_PHOTO = { error: 'Ese día no tiene foto de receta del día.', code: 'NO_PHOTO' }
const BAD_DATE = { error: 'La fecha tiene que ser un día AAAA-MM-DD.', code: 'INVALID_DATE' }

export function createRecipeOfTheDayRouter(overrides: Partial<RecipeOfTheDayRouteDeps> = {}): Router {
  const d: RecipeOfTheDayRouteDeps = {
    load: (day) => loadRecipeOfTheDay(day, createDbRecipeOfTheDayDeps(env.WEB_PUBLIC_URL)),
    photo: (day, format) => recipeOfTheDayPhoto(day, format, createDbRecipeOfTheDayPhotoDeps(env.WEB_PUBLIC_URL)),
    today: () => todayInMadrid(),
    ...overrides,
  }
  const router = Router()

  const answer = async (day: string, res: import('express').Response) => {
    try {
      const view = await d.load(day)
      if (!view) return void res.status(404).json(NONE)
      // Changes at most once a day; five minutes keeps midnight honest.
      res.set('Cache-Control', 'public, max-age=300')
      res.json(view)
    } catch (err) {
      console.error('recipe of the day error:', (err as Error)?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  router.get('/recipe-of-the-day', (_req, res) => answer(d.today(), res))

  router.get('/recipe-of-the-day/:date', (req, res) => {
    const day = String(req.params.date)
    if (!isIsoDay(day)) return void res.status(400).json(BAD_DATE)
    return answer(day, res)
  })

  router.get('/recipe-of-the-day/:date/photo/:format', async (req, res) => {
    const day = String(req.params.date)
    const format = String(req.params.format)
    if (!isIsoDay(day)) return void res.status(400).json(BAD_DATE)
    if (!(format in RECIPE_OF_THE_DAY_PHOTO_SIZES)) return void res.status(404).json(NO_PHOTO)
    try {
      const jpeg = await d.photo(day, format as RecipeOfTheDayPhotoFormat)
      if (!jpeg) return void res.status(404).json(NO_PHOTO)
      res.set('Cache-Control', 'public, max-age=3600')
      res.type('image/jpeg').send(jpeg)
    } catch (err) {
      console.error('recipe of the day photo error:', (err as Error)?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

export default createRecipeOfTheDayRouter()
