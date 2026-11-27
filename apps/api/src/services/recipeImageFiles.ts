/**
 * Recipes whose photo file is gone from the volume (PRO-1318).
 *
 * `recipes.image_url` can name a file the volume no longer has (a lost
 * write, a volume swapped by hand): the app shows it broken and the nightly
 * photo copy counts it as failed. At boot the API looks for them and gives
 * each recipe its photo again through the usual paths: a catalogue recipe
 * loses the dead URL and goes back to the catalogue queue (catalogPhotos.ts),
 * a user recipe asks the background generator, like a new recipe
 * (`scheduleHouseImage`, cost on its author). Gallery photos
 * (`recipe_photos`) are only counted: nobody can make them again.
 *
 * Only URLs under `IMAGE_PUBLIC_URL_BASE` live on the volume; in prod the
 * relative `/images/recipes/<slug>.jpg` seed photos are served by the web
 * app, so they are never touched. The log says counts, never which.
 *
 * Brake: if the volume can't be read, is empty, or more than half of the
 * files it should hold are missing, nothing changes — that is a volume that
 * isn't mounted, not lost photos.
 */
import { readdir } from 'fs/promises'
import { and, eq, isNotNull } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { recipePhotos, recipes } from '../db/schema.js'
import { wakeCatalogPhotos } from './catalogPhotos.js'
import { scheduleHouseImage } from './recipeHouseImage.js'
import { imageGenerationConfigured } from './recipeImageGenerator.js'

/** Pure: the volume file an image URL names, or null when it isn't one of ours. */
export function volumeFilename(url: string | null | undefined, publicBase: string = env.IMAGE_PUBLIC_URL_BASE): string | null {
  const base = publicBase.replace(/\/+$/, '')
  if (!url || !base || !url.startsWith(`${base}/`)) return null
  const name = url.slice(base.length + 1).split(/[?#]/)[0]
  if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) return null
  return name
}

export interface HeroRow {
  id: string
  authorId: string | null
  imageUrl: string | null
}

export interface MissingImages {
  /** Recipes whose hero photo is on the volume (or should be). */
  heroesOnVolume: number
  /** Catalogue recipes whose hero file is missing. */
  catalogue: string[]
  /** User recipes whose hero file is missing. */
  user: { id: string; authorId: string }[]
  galleryOnVolume: number
  galleryMissing: number
  /** True when the brake holds: nothing should change. */
  braked: boolean
}

/** Pure: which recipes point at a file the volume lacks. `files` null = volume unreadable. */
export function findMissingImages(
  heroes: readonly HeroRow[],
  galleryUrls: readonly string[],
  files: ReadonlySet<string> | null,
  publicBase: string = env.IMAGE_PUBLIC_URL_BASE,
): MissingImages {
  const out: MissingImages = { heroesOnVolume: 0, catalogue: [], user: [], galleryOnVolume: 0, galleryMissing: 0, braked: false }
  let missing = 0
  for (const r of heroes) {
    const name = volumeFilename(r.imageUrl, publicBase)
    if (!name) continue
    out.heroesOnVolume += 1
    if (files?.has(name)) continue
    missing += 1
    if (r.authorId) out.user.push({ id: r.id, authorId: r.authorId })
    else out.catalogue.push(r.id)
  }
  for (const url of galleryUrls) {
    const name = volumeFilename(url, publicBase)
    if (!name) continue
    out.galleryOnVolume += 1
    if (!files?.has(name)) {
      out.galleryMissing += 1
      missing += 1
    }
  }
  const expected = out.heroesOnVolume + out.galleryOnVolume
  out.braked = expected > 0 && (!files || files.size === 0 || missing * 2 > expected)
  return out
}

export interface RequeueDeps {
  loadHeroes: () => Promise<HeroRow[]>
  loadGallery: () => Promise<string[]>
  /** The file names on the volume; null when it can't be read. */
  listFiles: () => Promise<Set<string> | null>
  /** Clears `image_url` for these recipes, only while it still names the same URL. */
  clearImages: (rows: HeroRow[]) => Promise<void>
  wakeCatalogue: () => void
  scheduleUser: (id: string, authorId: string) => void
  log: (line: string) => void
  /** Defaults to `IMAGE_PUBLIC_URL_BASE`. */
  publicBase?: string
}

const realDeps: RequeueDeps = {
  loadHeroes: () =>
    db.select({ id: recipes.id, authorId: recipes.authorId, imageUrl: recipes.imageUrl }).from(recipes).where(isNotNull(recipes.imageUrl)),
  loadGallery: async () => (await db.select({ imageUrl: recipePhotos.imageUrl }).from(recipePhotos)).map((r) => r.imageUrl),
  listFiles: async () => {
    try {
      return new Set(await readdir(env.IMAGE_STORAGE_DIR))
    } catch {
      return null
    }
  },
  clearImages: async (rows) => {
    for (const r of rows) {
      if (!r.imageUrl) continue
      await db
        .update(recipes)
        .set({ imageUrl: null, updatedAt: new Date() })
        .where(and(eq(recipes.id, r.id), eq(recipes.imageUrl, r.imageUrl)))
    }
  },
  wakeCatalogue: () => wakeCatalogPhotos(),
  scheduleUser: (id, authorId) => scheduleHouseImage(id, authorId),
  log: (line) => console.info(line),
}

/** One look over the volume (deps injected). Returns what it found. */
export async function requeueMissingRecipePhotos(deps: RequeueDeps = realDeps): Promise<MissingImages> {
  const [heroes, gallery, files] = await Promise.all([deps.loadHeroes(), deps.loadGallery(), deps.listFiles()])
  const found = findMissingImages(heroes, gallery, files, deps.publicBase)
  const lost = found.catalogue.length + found.user.length
  deps.log(
    `[recipeImageFiles] ${found.heroesOnVolume} recipe photos on the volume, ${lost} missing (${found.catalogue.length} catalogue, ${found.user.length} user); ` +
      `${found.galleryOnVolume} gallery photos, ${found.galleryMissing} missing` +
      (found.braked ? ' — volume looks unmounted, nothing changed' : ''),
  )
  if (found.braked || lost === 0) return found
  const ids = new Set([...found.catalogue, ...found.user.map((u) => u.id)])
  await deps.clearImages(heroes.filter((h) => ids.has(h.id)))
  if (found.catalogue.length) deps.wakeCatalogue()
  for (const u of found.user) deps.scheduleUser(u.id, u.authorId)
  return found
}

/** Boot: one look, only where photos can be made again. Fire-and-forget. */
export function startRecipeImageFiles(): void {
  if (!imageGenerationConfigured() || process.env.NODE_ENV === 'test' || process.env.VITEST) return
  void requeueMissingRecipePhotos().catch((err) => console.warn('[recipeImageFiles] failed:', (err as Error)?.message ?? err))
}
