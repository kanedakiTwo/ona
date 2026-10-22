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

/**
 * AiKit's OpenAI-compatible inference API (PRO-265, D-090). The old
 * Imagen-fal route (`/api/free-form-tools/image-generation/generate-imagen-fal`)
 * answers 403 `API_KEY_ROUTE_NOT_ALLOWED` to every key since 2026-10-08 and is
 * gone. Don't point this at the `imagen-4` family: it 500s on this route.
 */
export const AIKIT_IMAGES_URL = 'https://cms.aikit.es/api/inference/images/generations'

// "Que no parezca tan perfecto" (Miguel, 2026-10-08): home cooking shot in
// window light, with the small accidents of a real table — not a studio.
// One style for every recipe: the 8 per-recipe variants of PRO-59 looked
// more artificial and were dropped (PRO-89, Miguel 2026-10-14). This is the
// text that generated the current catalogue.
export const STYLE_SUFFIX =
  'Fotografía real de comida casera recién servida, tomada desde arriba o en tres cuartos, como en un libro de cocina de autor. Cerámica artesana algo irregular (blanca, crema o de barro) sobre madera natural gastada o lino crudo arrugado. Luz natural de ventana, cálida, con sombras suaves. Nada de perfección de estudio: ración servida con naturalidad y algo desigual, cortes irregulares, piezas distintas entre sí, alguna gota de salsa o miga en el borde del plato o en el mantel, una cuchara de servir apoyada o una servilleta descolocada, encuadre ligeramente descentrado. Paleta cálida (cremas, ocres, terracota), sin texto, sin manos ni personas. Textura fotográfica real con ligero grano, profundidad de campo media; que no parezca una imagen generada por ordenador.'

export type AspectRatio = '4:3' | '1:1' | '3:4'

export interface RecipePromptInput {
  name: string
  /** Top 3-4 ingredient names by displayOrder; helps the model pick the right cuisine and props. */
  topIngredients: string[]
  /** Recipe `meals` array — only used to pick framing for breakfast/snack. */
  meals: string[]
  /**
   * What the plated dish looks like (`describeDish` in recipeImageCheck.ts).
   * When present it replaces the ingredient line: the name + 4 ingredients
   * alone often gave the model the wrong dish.
   */
  description?: string | null
}

/** Compose the editorial prompt sent to the image model. Pure. */
/**
 * Spanish dish words that the image models read as an English word their content policy blocks
 * («Rape alangostado» came back 422 from AiKit on 2026-10-22: «rape» is monkfish). Swapped for a
 * synonym in the prompt only; the recipe keeps its name.
 */
const PROMPT_SYNONYMS: Array<[RegExp, string]> = [[/(?<![\p{L}])rape(?![\p{L}])/giu, 'pejesapo']]

export function promptSafe(text: string): string {
  return PROMPT_SYNONYMS.reduce((t, [re, to]) => t.replace(re, (m) => (m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to)), text)
}

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
  return promptSafe(
    [`${input.name}.`, ingredientsLine, mealHint, STYLE_SUFFIX]
      .filter((s) => s.length > 0)
      .join(' '),
  )
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

/** What AiKit is asked for: a model and, optionally, a quality. */
export interface ImageChoice {
  model: string
  quality?: string
}

/**
 * D-117 (Miguel, 2026-10-22): the first photo with gpt-image-2 in high quality; when the vision
 * check turns it down, the second try with nano-banana-pro (about 1 in 5 should get there).
 */
export function imageChoiceForAttempt(attempt: number): ImageChoice {
  const primary: ImageChoice = { model: env.AIKIT_IMAGE_MODEL, ...(env.AIKIT_IMAGE_QUALITY ? { quality: env.AIKIT_IMAGE_QUALITY } : {}) }
  if (attempt <= 1 || !env.AIKIT_IMAGE_RETRY_MODEL) return primary
  return { model: env.AIKIT_IMAGE_RETRY_MODEL }
}

/** The price-table name of what AiKit served: «gpt-image-2-high» for the high quality. */
export function aikitCostModel(served: string, quality?: string): string {
  return quality && quality !== 'low' && served === 'gpt-image-2' ? `${served}-${quality}` : served
}

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
 * Generate one recipe photo and return PNG bytes. AiKit's gpt-image-2 first
 * (in 'auto'), OpenAI gpt-image when AiKit refuses (403), is rate-limited or
 * over budget (429), breaks (5xx) or isn't set up.
 * Exported so callers can decide whether to persist to disk (the bulk
 * script does, the route handler can defer until the quota write commits).
 */
export async function generateRecipeImage(
  prompt: string,
  aspectRatio: AspectRatio = '4:3',
  choice: ImageChoice = imageChoiceForAttempt(1),
): Promise<Buffer> {
  const providers = imageProviders()
  if (providers.length === 0) throw new AikitNotConfiguredError()
  let lastErr: unknown = null
  for (const p of providers) {
    try {
      return p === 'aikit' ? await generateWithAikit(prompt, aspectRatio, choice) : await generateWithOpenAI(prompt, aspectRatio)
    } catch (err) {
      lastErr = err
      if (providers.length > 1) console.warn(`[recipeImage] ${p} failed, trying next:`, (err as Error)?.message ?? err)
    }
  }
  throw lastErr
}

/** Size asked for each format (gpt-image sizes; the answer is cropped to the exact ratio). */
export const AIKIT_SIZE: Record<AspectRatio, string> = { '4:3': '1536x1024', '1:1': '1024x1024', '3:4': '1024x1536' }
const OPENAI_SIZE: Record<AspectRatio, string> = { '4:3': '1536x1024', '1:1': '1024x1024', '3:4': '1024x1536' }
const RATIO: Record<AspectRatio, number> = { '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4 }

async function generateWithAikit(prompt: string, aspectRatio: AspectRatio, choice: ImageChoice): Promise<Buffer> {
  const { model, quality } = choice
  const res = await fetch(AIKIT_IMAGES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.AIKIT_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, n: 1, size: AIKIT_SIZE[aspectRatio], ...(quality ? { quality } : {}) }),
  })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.text()).slice(0, 300) } catch {}
    throw new AikitGenerationError(res.status, `AiKit images ${res.status}: ${detail}`)
  }
  const body = (await res.json()) as { model?: string; data?: Array<{ b64_json?: string }> }
  const b64 = body.data?.[0]?.b64_json
  if (!b64) throw new AikitGenerationError(502, 'AiKit images: empty response')
  // AiKit answers an unknown model with gpt-image-2 without saying so: what it served is what we pay.
  const served = body.model || model
  if (served !== model) console.warn(`[recipeImage] asked AiKit for ${model}, it served ${served}`)
  // Billed to the requesting user (route context); the bulk seed script has
  // no context and lands as a system cost.
  recordCost({ feature: 'recipe_image', provider: 'aikit', model: aikitCostModel(served, served === model ? quality : undefined), units: { images: 1 } })
  return cropToRatio(Buffer.from(b64, 'base64'), aspectRatio)
}

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
  return cropToRatio(Buffer.from(b64, 'base64'), aspectRatio)
}

/** gpt-image has no 4:3 size — center-crop the frame to the ratio asked for. */
async function cropToRatio(bytes: Buffer, aspectRatio: AspectRatio): Promise<Buffer> {
  const img = sharp(bytes)
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
