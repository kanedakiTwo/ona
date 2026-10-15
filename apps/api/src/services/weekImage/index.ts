import type { WeekMenuInput } from '../menuText.js'
import { buildWeekImageModel, photoRecipeIds } from './model.js'
import { loadRecipePhotos } from './photos.js'
import { renderWeekImage } from './render.js'

export { buildWeekImageModel, photoRecipeIds } from './model.js'
export { renderWeekImage } from './render.js'

/**
 * A week's menu → the JPG WhatsApp sends after generating it, or null when
 * the week has nothing to draw. Throws if drawing fails; the caller then
 * sends the text digest instead.
 */
export async function weekMenuImage(
  menu: WeekMenuInput,
  opts: {
    today: string
    webUrl: string
    /** recipe id → its `image_url` (absolute or `/images/recipes/…`). */
    photoUrls: (recipeIds: string[]) => Promise<Map<string, string | null>>
    fetchImpl?: typeof fetch
  },
): Promise<Buffer | null> {
  const model = buildWeekImageModel(menu, { today: opts.today })
  if (!model) return null
  const ids = photoRecipeIds(model)
  let photos = new Map<string, Buffer>()
  if (ids.length > 0) {
    try {
      const urls = await opts.photoUrls(ids)
      photos = await loadRecipePhotos(
        ids.map((recipeId) => ({ recipeId, url: urls.get(recipeId) })),
        { webUrl: opts.webUrl, fetchImpl: opts.fetchImpl },
      )
    } catch (err) {
      // No photos is still a good image: every dish gets a neutral tile.
      console.warn('[week-image] photos unavailable, drawing tiles:', (err as Error)?.message ?? err)
    }
  }
  return renderWeekImage(model, photos)
}
