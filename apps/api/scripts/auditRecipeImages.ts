/**
 * Read-only photo audit of the recipe catalogue: does each hero image show
 * the dish, in the house style? (services/recipeImageAudit.ts)
 *
 *   DATABASE_URL=… ANTHROPIC_API_KEY=… pnpm --filter @ona/api exec tsx scripts/auditRecipeImages.ts \
 *     [--only=<id,id>] [--web=https://mimoia.com] [--concurrency=3] [--out=report.json]
 *
 * `--fix` regenerates the failing ones, but only makes sense where the image
 * storage is (the ona-api container) — see the header of recipeImageAudit.ts.
 */
import { writeFile } from 'node:fs/promises'
import { pool } from '../src/db/connection.js'
import { cli } from '../src/services/recipeImageAudit.js'

const argv = process.argv.slice(2)
const out = argv.find((a) => a.startsWith('--out='))?.slice('--out='.length)
const rows = await cli(argv)
if (out) await writeFile(out, JSON.stringify(rows, null, 2))
await pool.end()
