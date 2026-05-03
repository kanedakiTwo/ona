/**
 * Generate editorial-style cookbook photos for every recipe in the catalog
 * using AiKit's Imagen-fal endpoint, then save them as JPEGs and update each
 * recipe's `image_url`.
 *
 * Why this exists: the seed shipped with ~7 hand-picked photos and ~70
 * placeholder JPEGs that were copied across whole dish families (one "green
 * vegetables" shot reused for 11 recipes). The DB has `image_url` null for
 * every recipe today, so the frontend falls back to a generic Unsplash
 * placeholder; this script gives every recipe a real, on-brand hero image.
 *
 * Usage:
 *   AIKIT_API_KEY=aik_… pnpm tsx apps/api/scripts/generateRecipeImages.ts [flags]
 *
 * Flags:
 *   --dry-run               Print the prompt that would be sent for each
 *                           recipe and exit. No API call, no DB write.
 *   --only=<slug,slug,...>  Only regenerate the listed slugs (handy for
 *                           tweaking 1-2 prompts).
 *   --include-user          Include user-authored recipes (default: skip).
 *   --concurrency=N         Max in-flight API calls (default 3).
 *   --aspect=4:3|1:1|3:4    Aspect ratio sent to Imagen-fal (default 4:3).
 *   --skip-existing         Leave recipes that already have a non-null
 *                           image_url untouched.
 *   --no-db                 Generate the JPEGs but don't update the DB row
 *                           (for testing; spec assumes DB is updated).
 */
import { eq, isNull, inArray } from 'drizzle-orm'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { writeFile, mkdir } from 'node:fs/promises'
import { db, pool } from '../src/db/connection.js'
import { recipes, recipeIngredients, ingredients } from '../src/db/schema.js'
import {
  buildRecipePrompt,
  generateRecipeImage,
  type AspectRatio,
} from '../src/services/recipeImageGenerator.js'

// The seed script writes filenames keyed by slug (so checked-in JPGs in
// `apps/web/public/images/recipes/<slug>.jpg` keep their stable URLs); the
// runtime endpoint writes by recipe id (collision-free, opaque). Both share
// the prompt builder and AiKit client from `recipeImageGenerator.ts`.
const SEED_IMAGES_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../apps/web/public/images/recipes',
)

// ─── CLI ──────────────────────────────────────────────────────────

interface Flags {
  dryRun: boolean
  only: Set<string> | null
  includeUser: boolean
  concurrency: number
  aspect: '4:3' | '1:1' | '3:4'
  skipExisting: boolean
  noDb: boolean
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    dryRun: false,
    only: null,
    includeUser: false,
    concurrency: 3,
    aspect: '4:3',
    skipExisting: false,
    noDb: false,
  }
  for (const a of argv) {
    if (a === '--dry-run') flags.dryRun = true
    else if (a === '--include-user') flags.includeUser = true
    else if (a === '--skip-existing') flags.skipExisting = true
    else if (a === '--no-db') flags.noDb = true
    else if (a.startsWith('--only=')) {
      flags.only = new Set(a.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean))
    } else if (a.startsWith('--concurrency=')) {
      flags.concurrency = Math.max(1, Math.min(8, parseInt(a.slice('--concurrency='.length), 10) || 3))
    } else if (a.startsWith('--aspect=')) {
      const v = a.slice('--aspect='.length)
      if (v === '4:3' || v === '1:1' || v === '3:4') flags.aspect = v
      else throw new Error(`--aspect must be 4:3 | 1:1 | 3:4, got ${v}`)
    }
  }
  return flags
}

// ─── Slug ────────────────────────────────────────────────────────

/**
 * Spanish-aware slug. Matches the convention of the existing files in
 * `apps/web/public/images/recipes/`: lowercase, accents stripped, spaces and
 * punctuation collapsed to hyphens.
 */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// ─── Concurrency-limited map ─────────────────────────────────────

async function pMap<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const flags = parseFlags(process.argv.slice(2))
  // The shared service reads AIKIT_API_KEY from `env` at call time; we only
  // pre-flight the check here so a missing key dies fast instead of after the
  // first generate() call.
  if (!process.env.AIKIT_API_KEY && !flags.dryRun) {
    console.error('AIKIT_API_KEY env var is required (unless --dry-run).')
    process.exit(1)
  }

  // Load recipes + their top ingredients (by displayOrder).
  const where = flags.includeUser ? undefined : isNull(recipes.authorId)
  const rows = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      meals: recipes.meals,
      tags: recipes.tags,
      imageUrl: recipes.imageUrl,
      authorId: recipes.authorId,
    })
    .from(recipes)
    .where(where)
    .orderBy(recipes.name)

  // Pull top 4 ingredients per recipe in one query (cheaper than N).
  const recipeIds = rows.map((r) => r.id)
  const ingRows = recipeIds.length === 0
    ? []
    : await db
        .select({
          recipeId: recipeIngredients.recipeId,
          name: ingredients.name,
          displayOrder: recipeIngredients.displayOrder,
        })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
        .where(inArray(recipeIngredients.recipeId, recipeIds))

  const topByRecipe = new Map<string, string[]>()
  for (const row of ingRows) {
    const list = topByRecipe.get(row.recipeId) ?? []
    list.push(row.name)
    topByRecipe.set(row.recipeId, list)
  }
  for (const [k, v] of topByRecipe) {
    // The ingRows are not globally sorted; sort here by displayOrder via the original row.
    const ordered = ingRows
      .filter((r) => r.recipeId === k)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((r) => r.name)
    topByRecipe.set(k, ordered.slice(0, 4))
  }

  // Filter
  let targets = rows.map((r) => ({
    ...r,
    slug: slugify(r.name),
    topIngredients: topByRecipe.get(r.id) ?? [],
  }))
  if (flags.only) targets = targets.filter((t) => flags.only!.has(t.slug))
  if (flags.skipExisting) targets = targets.filter((t) => !t.imageUrl)

  if (targets.length === 0) {
    console.log('No recipes matched the filter. Nothing to do.')
    await pool.end()
    return
  }

  console.log(
    `Targets: ${targets.length} recipe(s). dry-run=${flags.dryRun}, concurrency=${flags.concurrency}, aspect=${flags.aspect}.`,
  )

  if (!flags.dryRun) await mkdir(SEED_IMAGES_DIR, { recursive: true })

  let okCount = 0
  let failCount = 0

  await pMap(targets, flags.concurrency, async (t, i) => {
    const tag = `[${i + 1}/${targets.length}] ${t.slug}`
    const prompt = buildRecipePrompt({
      name: t.name,
      topIngredients: t.topIngredients,
      meals: t.meals,
    })

    if (flags.dryRun) {
      console.log(`${tag} prompt:\n  ${prompt}\n`)
      return
    }

    try {
      const png = await generateRecipeImage(prompt, flags.aspect as AspectRatio)

      // Mirror writeRecipeImage's compression pipeline but force the slug-keyed
      // path under apps/web/public so the seeded JPGs stay committed to the
      // repo (vs the runtime endpoint that uses the volume + recipe id).
      const jpg = await sharp(png)
        .resize({ width: 1200, withoutEnlargement: true })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer()
      const outPath = join(SEED_IMAGES_DIR, `${t.slug}.jpg`)
      await writeFile(outPath, jpg)

      if (!flags.noDb) {
        await db
          .update(recipes)
          .set({ imageUrl: `/images/recipes/${t.slug}.jpg`, updatedAt: new Date() })
          .where(eq(recipes.id, t.id))
      }

      console.log(
        `${tag} ✅  ${(png.length / 1024).toFixed(0)} KB PNG → ${(jpg.length / 1024).toFixed(0)} KB JPG`,
      )
      okCount++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${tag} ❌  ${msg}`)
      failCount++
    }
  })

  console.log(`\nDone. ${okCount} ok, ${failCount} failed.`)
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end().catch(() => {})
  process.exit(1)
})
