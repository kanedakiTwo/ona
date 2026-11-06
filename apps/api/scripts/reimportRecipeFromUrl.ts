#!/usr/bin/env tsx
/**
 * Re-run the URL importer for recipes that were saved from a link, replacing
 * their name, ingredients and steps in place: same id (menus, favourites and
 * links keep working), same author, tags and photo (the house photo is never
 * swapped for the source's). For imports that landed empty or broken — e.g.
 * 2026-11-02, «Recepta de botifarra amb seques» saved with 0 ingredients and
 * 0 steps because the page's JSON-LD was an empty shell.
 *
 * Needs ANTHROPIC_API_KEY, so run it where the API runs:
 *   railway ssh --service ona-api --environment production -- \
 *     pnpm --filter @ona/api exec tsx scripts/reimportRecipeFromUrl.ts <id> [<id>…]            # dry-run
 *   … tsx scripts/reimportRecipeFromUrl.ts <id> --execute                                        # commit
 *   … tsx scripts/reimportRecipeFromUrl.ts <id> --html=<file> --execute   # page saved from a browser,
 *       for sites that show our server an anti-bot wall (one id at a time)
 */
import { readFileSync } from 'node:fs'
import { inArray } from 'drizzle-orm'
import { db, pool } from '../src/db/connection.js'
import { recipes } from '../src/db/schema.js'
import { AnthropicProvider } from '../src/services/providers/anthropic.js'
import { extractRecipeFromUrl } from '../src/services/recipeUrlExtractor.js'
import { extractedToWriteInput } from '../src/services/recipeImport.js'
import { persistRecipe } from '../src/services/recipePersistence.js'

const EXECUTE = process.argv.includes('--execute')
const IDS = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const HTML_FILE = process.argv.find((a) => a.startsWith('--html='))?.slice('--html='.length) ?? null

async function main() {
  if (IDS.length === 0) throw new Error('Usage: reimportRecipeFromUrl.ts <recipeId> [<recipeId>…] [--html=<file>] [--execute]')
  if (HTML_FILE && IDS.length > 1) throw new Error('--html takes a single recipe id')
  const fetchArticle = HTML_FILE ? async () => readFileSync(HTML_FILE, 'utf8') : undefined
  console.log(`Mode: ${EXECUTE ? 'EXECUTE' : 'DRY-RUN'}`)

  const rows = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      authorId: recipes.authorId,
      sourceUrl: recipes.sourceUrl,
      internalTags: recipes.internalTags,
    })
    .from(recipes)
    .where(inArray(recipes.id, IDS))
  const provider = new AnthropicProvider()

  for (const id of IDS) {
    const row = rows.find((r) => r.id === id)
    if (!row) { console.log(`✗ ${id}: no existe`); continue }
    if (!row.sourceUrl) { console.log(`✗ ${id} «${row.name}»: sin enlace de origen`); continue }

    const extracted = await extractRecipeFromUrl(row.sourceUrl, { provider, fetchArticle })
    console.log(`\n${id} «${row.name}» → «${extracted.name}»`)
    for (const i of extracted.ingredients) {
      console.log(`  ${i.matched ? '·' : '✗'} ${i.quantity} ${i.unit} ${i.ingredientName ?? i.extractedName}`)
    }
    extracted.steps.forEach((s, n) => console.log(`  ${n + 1}. ${s}`))
    if (extracted.warnings.length > 0) console.log(`  avisos: ${extracted.warnings.join(' · ')}`)
    if (!EXECUTE) continue

    const input = extractedToWriteInput(extracted, {
      internalTags: row.internalTags ?? [],
      sourceUrl: row.sourceUrl,
    })
    const result = await persistRecipe(
      // null + preserveExistingImage keeps the photo the recipe already has.
      { ...input, imageUrl: null },
      { authorId: row.authorId, recipeId: row.id, softLint: true, force: true, preserveExistingImage: true },
    )
    console.log(result.ok ? `  ✓ guardada` : `  ✗ no guardada: ${JSON.stringify(result.errors)}`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
