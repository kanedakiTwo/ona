/**
 * House-style hero photo for a recipe, made and checked automatically
 * (specs/recipes.md → Photos):
 *
 *   describe the plated dish → Imagen with the house style → vision check
 *   (right dish + house style) → one more try on a miss → save.
 *
 * Runs in the background after a recipe is created from the form or
 * imported (URL, photo, WhatsApp, assistant). It only replaces an image
 * that isn't ours — none, or the source's og:image / YouTube thumbnail —
 * never a photo the user uploaded or one already generated.
 */

import { asc, eq } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes, recipeSteps } from '../db/schema.js'
import { currentCostChannel, runWithCostUser } from './costLedger.js'
import { buildRecipePrompt, generateRecipeImage, imageGenerationConfigured, writeRecipeImage } from './recipeImageGenerator.js'
import { checkRecipeImage, describeDish, verdictOk, type DishInput, type ImageVerdict } from './recipeImageCheck.js'
import { spendCapStatus } from './spendCap.js'

export interface Dish extends DishInput {
  meals: string[]
}

export interface HouseImageDeps {
  describe: (dish: DishInput) => Promise<string | null>
  generate: (prompt: string) => Promise<Buffer>
  check: (dish: DishInput, image: Buffer) => Promise<ImageVerdict | null>
}

const realDeps: HouseImageDeps = {
  describe: (dish) => describeDish(dish),
  generate: (prompt) => generateRecipeImage(prompt, '4:3'),
  check: (dish, image) => checkRecipeImage({ ...dish, image, mimeType: 'image/png' }),
}

export interface HouseImageResult {
  /** The image to save; null when no attempt showed the right dish. */
  png: Buffer | null
  verdict: ImageVerdict | null
  attempts: number
  description: string | null
}

/**
 * Pure orchestration (deps injected): up to `maxAttempts` generations.
 * Keeps the first that passes the check; otherwise the first that at least
 * shows the right dish. A missing checker (no API key) accepts the first.
 */
export async function makeHouseImage(dish: Dish, deps: HouseImageDeps = realDeps, maxAttempts = 2): Promise<HouseImageResult> {
  const description = await deps.describe(dish)
  const prompt = buildRecipePrompt({ name: dish.name, topIngredients: topIngredientNames(dish.ingredients), meals: dish.meals, description })
  let fallback: { png: Buffer; verdict: ImageVerdict } | null = null
  let last: ImageVerdict | null = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const png = await deps.generate(prompt)
    const verdict = await deps.check(dish, png)
    if (!verdict || verdictOk(verdict)) return { png, verdict, attempts: attempt, description }
    last = verdict
    if (verdict.matchesDish && !fallback) fallback = { png, verdict }
  }
  if (fallback) return { ...fallback, attempts: maxAttempts, description }
  return { png: null, verdict: last, attempts: maxAttempts, description }
}

/** "300 g ternera (picada)" → "ternera". */
function topIngredientNames(lines: string[]): string[] {
  return lines.slice(0, 4).map((l) => l.replace(/^[\d.,]+\s*\S*\s+/, '').replace(/\s*\(.*\)$/, ''))
}

/**
 * Ours = generated (or uploaded) into our storage, or a committed seed JPG.
 * Anything else (null, og:image, YouTube thumbnail) gets replaced.
 */
export function isReplaceableImage(url: string | null | undefined, publicBase: string = env.IMAGE_PUBLIC_URL_BASE): boolean {
  if (!url) return true
  if (url.startsWith('/images/recipes/')) return false
  const base = publicBase.replace(/\/+$/, '')
  return !(base && url.startsWith(`${base}/`))
}

/** Recipe → what the describer / checker read. */
export async function loadDish(recipeId: string): Promise<(Dish & { imageUrl: string | null; authorId: string | null }) | null> {
  const [row] = await db
    .select({ name: recipes.name, meals: recipes.meals, imageUrl: recipes.imageUrl, authorId: recipes.authorId })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1)
  if (!row) return null
  const [ings, steps] = await Promise.all([
    db
      .select({ name: ingredients.name, quantity: recipeIngredients.quantity, unit: recipeIngredients.unit, note: recipeIngredients.note })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, recipeId))
      .orderBy(asc(recipeIngredients.displayOrder)),
    db.select({ text: recipeSteps.text }).from(recipeSteps).where(eq(recipeSteps.recipeId, recipeId)).orderBy(asc(recipeSteps.index)),
  ])
  return {
    name: row.name,
    meals: row.meals ?? [],
    imageUrl: row.imageUrl ?? null,
    authorId: row.authorId ?? null,
    ingredients: ings.map((i) => dishLine(i)),
    steps: steps.map((s) => s.text),
  }
}

export function dishLine(i: { name: string; quantity: number; unit: string; note: string | null }): string {
  const qty = i.unit === 'al_gusto' || i.unit === 'pizca' ? '' : `${Math.round(i.quantity * 100) / 100} ${i.unit} `
  return `${qty}${i.name}${i.note ? ` (${i.note})` : ''}`
}

export type ApplyOutcome =
  | { status: 'saved'; imageUrl: string; verdict: ImageVerdict | null; attempts: number }
  | { status: 'skipped'; reason: 'not_found' | 'has_own_image' | 'changed_meanwhile' }
  | { status: 'rejected'; verdict: ImageVerdict | null; attempts: number }

/**
 * Make, check and save the house image for one recipe. `force` replaces even
 * our own image (admin re-generation from the audit script).
 */
export async function applyHouseImage(recipeId: string, opts: { force?: boolean; deps?: HouseImageDeps } = {}): Promise<ApplyOutcome> {
  const dish = await loadDish(recipeId)
  if (!dish) return { status: 'skipped', reason: 'not_found' }
  if (!opts.force && !isReplaceableImage(dish.imageUrl)) return { status: 'skipped', reason: 'has_own_image' }
  const made = await makeHouseImage(dish, opts.deps)
  if (!made.png) return { status: 'rejected', verdict: made.verdict, attempts: made.attempts }
  // Same row still has the image we started from? (the user may have
  // uploaded a photo while this ran — theirs wins.)
  const [now] = await db.select({ imageUrl: recipes.imageUrl }).from(recipes).where(eq(recipes.id, recipeId)).limit(1)
  if (!now) return { status: 'skipped', reason: 'not_found' }
  if ((now.imageUrl ?? null) !== dish.imageUrl) return { status: 'skipped', reason: 'changed_meanwhile' }
  const { imageUrl } = await writeRecipeImage(made.png, `${recipeId}.jpg`)
  await db.update(recipes).set({ imageUrl, updatedAt: new Date() }).where(eq(recipes.id, recipeId))
  return { status: 'saved', imageUrl, verdict: made.verdict, attempts: made.attempts }
}

/**
 * Fire-and-forget after create/import. No-op without an image provider, under tests, or
 * when the author's AI allowance for the month is spent (admins exempt).
 * Cost lands on the author.
 */
export function scheduleHouseImage(recipeId: string, authorId: string | null, opts: { isAdmin?: boolean; currentUrl?: string | null } = {}): void {
  if (!isReplaceableImage(opts.currentUrl)) return
  if (!imageGenerationConfigured() || process.env.NODE_ENV === 'test' || process.env.VITEST) return
  void runWithCostUser(authorId, async () => {
    try {
      if (authorId && !opts.isAdmin && (await spendCapStatus(authorId)).exceeded) return
      const out = await applyHouseImage(recipeId)
      if (out.status !== 'saved') console.info(`[recipeImage] ${recipeId}: ${out.status}`, out.status === 'rejected' ? out.verdict?.reason : out.reason)
    } catch (err) {
      console.warn(`[recipeImage] ${recipeId} failed:`, (err as Error)?.message ?? err)
    }
  }, currentCostChannel() ?? 'web')
}
