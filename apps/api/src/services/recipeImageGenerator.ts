/**
 * Shared pipeline for turning a recipe into an editorial-style hero image.
 *
 * Used by:
 *   - `apps/api/scripts/generateRecipeImages.ts` (bulk seed regeneration)
 *   - `POST /recipes/:id/regenerate-image` (per-user, quota-bounded)
 *
 * The pipeline is intentionally side-effect-free until `writeRecipeImage`:
 * `buildRecipePrompt` / `generateRecipeImage` are pure (apart from the
 * outbound API call), so the route handler can do quota bookkeeping in a
 * transaction around them.
 */
import sharp from 'sharp'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from '../config/env.js'

const AIKIT_BASE = 'https://cms.aikit.es/api/free-form-tools/image-generation'

const STYLE_SUFFIX =
  'Fotografía editorial cenital estilo libro de cocina. Plato cerámico blanco mate sobre superficie de madera natural o lino crudo color crema. Luz natural cálida lateral y suave. Composición limpia, espacio negativo, paleta cálida (cremas, ocres, terracota), sin texto, sin manos, sin cubiertos en primer plano. Acabado fotográfico realista, profundidad de campo media, alta resolución.'

export type AspectRatio = '4:3' | '1:1' | '3:4'

export interface RecipePromptInput {
  name: string
  /** Top 3-4 ingredient names by displayOrder; helps Imagen pick the right cuisine and props. */
  topIngredients: string[]
  /** Recipe `meals` array — only used to pick framing for breakfast/snack. */
  meals: string[]
}

/** Compose the editorial prompt sent to Imagen-fal. Pure. */
export function buildRecipePrompt(input: RecipePromptInput): string {
  const ingredientsLine =
    input.topIngredients.length > 0
      ? `Ingredientes principales visibles: ${input.topIngredients.join(', ')}.`
      : ''
  const mealHint = input.meals.includes('breakfast')
    ? 'Encuadre tipo desayuno.'
    : input.meals.includes('snack')
      ? 'Tamaño de ración pequeña, tipo snack.'
      : ''
  return [`${input.name}.`, ingredientsLine, mealHint, STYLE_SUFFIX]
    .filter((s) => s.length > 0)
    .join(' ')
}

/** Thrown when AiKit rejects the request (auth, quota, model error, etc). */
export class AikitGenerationError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AikitGenerationError'
    this.status = status
  }
}

/** Thrown when AIKIT_API_KEY isn't configured. The route handler maps this to 503. */
export class AikitNotConfiguredError extends Error {
  constructor() {
    super('AIKIT_API_KEY is not configured.')
    this.name = 'AikitNotConfiguredError'
  }
}

/**
 * Hit AiKit's Imagen-fal endpoint and return the raw PNG bytes.
 * Exported so callers can decide whether to persist to disk (the bulk
 * script does, the route handler can defer until the quota write commits).
 */
export async function generateRecipeImage(
  prompt: string,
  aspectRatio: AspectRatio = '4:3',
): Promise<Buffer> {
  if (!env.AIKIT_API_KEY) throw new AikitNotConfiguredError()

  const form = new FormData()
  form.append('prompt', prompt)
  form.append('aspectRatio', aspectRatio)
  form.append('numberOfImages', '1')

  const res = await fetch(`${AIKIT_BASE}/generate-imagen-fal`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AIKIT_API_KEY}` },
    body: form,
  })

  if (!res.ok) {
    let detail = ''
    try { detail = (await res.text()).slice(0, 300) } catch {}
    throw new AikitGenerationError(
      res.status,
      `AiKit ${res.status} ${res.statusText}: ${detail}`,
    )
  }
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.startsWith('image/')) {
    throw new AikitGenerationError(502, `Expected image/*, got ${ct}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

export interface WriteResult {
  /** Absolute path on disk where the JPEG was saved. */
  filePath: string
  /** Public URL string to store in `recipes.image_url`. */
  imageUrl: string
  /** Bytes written. */
  size: number
}

/**
 * Compress the PNG and persist it under the configured storage dir.
 * Filename is the caller's responsibility — pass the recipe id (stable,
 * collision-free) for user-generated images, or the slug for the seed
 * script's case where filenames are committed to the repo.
 */
export async function writeRecipeImage(
  pngBytes: Buffer,
  filename: string,
): Promise<WriteResult> {
  const jpg = await sharp(pngBytes)
    .resize({ width: 1200, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()

  await mkdir(env.IMAGE_STORAGE_DIR, { recursive: true })
  const filePath = join(env.IMAGE_STORAGE_DIR, filename)
  await writeFile(filePath, jpg)

  // Strip a trailing slash if present so the join doesn't double up.
  const base = env.IMAGE_PUBLIC_URL_BASE.replace(/\/+$/, '')
  return { filePath, imageUrl: `${base}/${filename}`, size: jpg.length }
}
