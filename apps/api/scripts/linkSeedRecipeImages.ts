#!/usr/bin/env tsx
/**
 * Link existing seed JPGs in apps/web/public/images/recipes/ to system
 * recipe rows in the DB. For each system recipe (author_id IS NULL):
 *   slug = slugify(name)
 *   if `<repo>/apps/web/public/images/recipes/${slug}.jpg` exists,
 *     set recipes.image_url = '/images/recipes/${slug}.jpg'.
 *
 * Free — no AiKit calls. Used after a dedup/reseed to attach the bulk
 * of hero images that were already generated locally on a previous run.
 *
 * Usage:
 *   DATABASE_URL=<db> tsx scripts/linkSeedRecipeImages.ts            # dry-run
 *   DATABASE_URL=<db> tsx scripts/linkSeedRecipeImages.ts --execute  # commit
 */
import path from 'node:path'
import fs from 'node:fs'
import { db, pool } from '../src/db/connection.js'
import { recipes } from '../src/db/schema.js'
import { isNull, eq } from 'drizzle-orm'

const EXECUTE = process.argv.includes('--execute')
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const IMG_DIR = path.join(REPO_ROOT, 'apps/web/public/images/recipes')

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`)
  console.log(`Image dir: ${IMG_DIR}`)

  const rows = await db
    .select({ id: recipes.id, name: recipes.name, imageUrl: recipes.imageUrl })
    .from(recipes)
    .where(isNull(recipes.authorId))
    .orderBy(recipes.name)

  let matched = 0
  let skippedHadUrl = 0
  let skippedNoFile = 0
  const updates: { id: string; name: string; relUrl: string }[] = []

  for (const r of rows) {
    if (r.imageUrl) {
      skippedHadUrl++
      continue
    }
    const slug = slugify(r.name)
    for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
      const candidate = path.join(IMG_DIR, `${slug}.${ext}`)
      if (fs.existsSync(candidate)) {
        updates.push({ id: r.id, name: r.name, relUrl: `/images/recipes/${slug}.${ext}` })
        matched++
        break
      }
    }
    if (!updates.find((u) => u.id === r.id) && !r.imageUrl) skippedNoFile++
  }

  console.log(
    `Found ${matched} match(es) on disk, ${skippedHadUrl} already had image_url, ${skippedNoFile} have no matching file.`,
  )
  for (const u of updates.slice(0, 50)) {
    console.log(`  ${u.name.padEnd(40)} → ${u.relUrl}`)
  }
  if (updates.length > 50) console.log(`  …and ${updates.length - 50} more`)

  if (!EXECUTE) {
    console.log('\nDry-run only. Re-run with --execute to commit.')
    await pool.end()
    return
  }

  console.log('\nApplying updates...')
  for (const u of updates) {
    await db
      .update(recipes)
      .set({ imageUrl: u.relUrl, updatedAt: new Date() })
      .where(eq(recipes.id, u.id))
  }
  console.log(`Updated ${updates.length} row(s).`)
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  pool.end()
  process.exit(1)
})
