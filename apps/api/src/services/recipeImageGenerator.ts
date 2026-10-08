/**
 * Shared pipeline for turning a recipe into an editorial-style hero image.
 *
 * Used by:
 *   - `apps/api/scripts/generateRecipeImages.ts` (bulk seed regeneration)
 *   - `POST /recipes/:id/regenerate-image` (per-user, quota-bounded)
 *   - `recipeHouseImage.ts` (automatic image on create/import, checked)
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
import { recordCost } from './costLedger.js'

const AIKIT_BASE = 'https://cms.aikit.es/api/free-form-tools/image-generation'

// "Que no parezca tan perfecto" (Miguel, 2026-10-08): home cooking shot in
// window light, with the small accidents of a real table — not a studio.
const STYLE_SUFFIX =
  'Fotografía real de comida casera recién servida, tomada desde arriba o en tres cuartos, como en un libro de cocina de autor. Cerámica artesana algo irregular (blanca, crema o de barro) sobre madera natural gastada o lino crudo arrugado. Luz natural de ventana, cálida, con sombras suaves. Nada de perfección de estudio: ración servida con naturalidad y algo desigual, cortes irregulares, piezas distintas entre sí, alguna gota de salsa o miga en el borde del plato o en el mantel, una cuchara de servir apoyada o una servilleta descolocada, encuadre ligeramente descentrado. Paleta cálida (cremas, ocres, terracota), sin texto, sin manos ni personas. Textura fotográfica real con ligero grano, profundidad de campo media; que no parezca una imagen generada por ordenador.'

export type AspectRatio = '4:3' | '1:1' | '3:4'

export interface RecipePromptInput {
  name: string
  /** Top 3-4 ingredient names by displayOrder; helps Imagen pick the right cuisine and props. */
  topIngredients: string[]
  /** Recipe `meals` array — only used to pick framing for breakfast/snack. */
  meals: string[]
  /**
   * What the plated dish looks like (`describeDish` in recipeImageCheck.ts).
   * When present it replaces the ingredient line: the name + 4 ingredients
   * alone often gave Imagen the wrong dish.
   */
  description?: string | null
}

/** Compose the editorial prompt sent to Imagen-fal. Pure. */
export function buildRecipePrompt(input: RecipePromptInput): string {
  const ingredientsLine = input.description
    ? input.description.replace(/\.?\s*$/, '.')
    : input.topIngredients.length > 0
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

/** Thrown when the image provider rejects the request (auth, quota, model error, etc). */
export class AikitGenerationError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AikitGenerationError'
    this.status = status
  }
}

/** Thrown when no image provider is configured. The route handler maps this to 503. */
export class AikitNotConfiguredError extends Error {
  constructor() {
    super('No image provider configured (AIKIT_API_KEY / OPENAI_API_KEY).')
    this.name = 'AikitNotConfiguredError'
  }
}

type Provider = 'aikit' | 'openai'

/** Providers to try, in order, for the configured mode. */
export function imageProviders(
  mode: typeof env.RECIPE_IMAGE_PROVIDER = env.RECIPE_IMAGE_PROVIDER,
  keys: { aikit: boolean; openai: boolean } = { aikit: !!env.AIKIT_API_KEY, openai: !!env.OPENAI_API_KEY },
): Provider[] {
  const order: Provider[] = mode === 'openai' ? ['openai'] : mode === 'aikit' ? ['aikit'] : ['aikit', 'openai']
  return order.filter((p) => keys[p])
}

export function imageGenerationConfigured(): boolean {
  return imageProviders().length > 0
}

/**
 * Generate one recipe photo and return PNG/JPEG bytes. AiKit's Imagen-fal
 * first (in 'auto'), OpenAI gpt-image when AiKit refuses or isn't set up.
 * Exported so callers can decide whether to persist to disk (the bulk
 * script does, the route handler can defer until the quota write commits).
 */
export async function generateRecipeImage(
  prompt: string,
  aspectRatio: AspectRatio = '4:3',
): Promise<Buffer> {
  const providers = imageProviders()
  if (providers.length === 0) throw new AikitNotConfiguredError()
  let lastErr: unknown = null
  for (const p of providers) {
    try {
      return p === 'aikit' ? await generateWithAikit(prompt, aspectRatio) : await generateWithOpenAI(prompt, aspectRatio)
    } catch (err) {
      lastErr = err
      if (providers.length > 1) console.warn(`[recipeImage] ${p} failed, trying next:`, (err as Error)?.message ?? err)
    }
  }
  throw lastErr
}

async function generateWithAikit(prompt: string, aspectRatio: AspectRatio): Promise<Buffer> {
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
  // Billed to the requesting user (route context); the bulk seed script has
  // no context and lands as a system cost.
  recordCost({ feature: 'recipe_image', provider: 'aikit', model: 'imagen-fal', units: { images: 1 } })
  return Buffer.from(await res.arrayBuffer())
}

const OPENAI_SIZE: Record<AspectRatio, string> = { '4:3': '1536x1024', '1:1': '1024x1024', '3:4': '1024x1536' }
const RATIO: Record<AspectRatio, number> = { '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4 }

async function generateWithOpenAI(prompt: string, aspectRatio: AspectRatio): Promise<Buffer> {
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: env.OPENAI_IMAGE_MODEL, prompt, size: OPENAI_SIZE[aspectRatio], quality: 'medium', n: 1 }),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.text()).slice(0, 300) } catch {}
    throw new AikitGenerationError(res.status, `OpenAI images ${res.status}: ${detail}`)
  }
  const body = (await res.json()) as { data?: Array<{ b64_json?: string }> }
  const b64 = body.data?.[0]?.b64_json
  if (!b64) throw new AikitGenerationError(502, 'OpenAI images: empty response')
  recordCost({ feature: 'recipe_image', provider: 'openai', model: env.OPENAI_IMAGE_MODEL, units: { images: 1 } })
  // gpt-image has no 4:3 — center-crop the 3:2 frame to the ratio asked for.
  const img = sharp(Buffer.from(b64, 'base64'))
  const { width = 0, height = 0 } = await img.metadata()
  const want = RATIO[aspectRatio]
  if (!width || !height || Math.abs(width / height - want) < 0.01) return img.png().toBuffer()
  const w = width / height > want ? Math.round(height * want) : width
  const h = width / height > want ? height : Math.round(width / want)
  return img.extract({ left: Math.round((width - w) / 2), top: Math.round((height - h) / 2), width: w, height: h }).png().toBuffer()
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
