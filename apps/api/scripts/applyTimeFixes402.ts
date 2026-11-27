#!/usr/bin/env tsx
/**
 * PRO-402 — Cocina's corrected times (audit of 2026-11-05) on the published
 * recipes. The batch and its rules: `src/services/recipeTimeFixes402.ts`.
 *
 * Without `--apply` it only reads and prints, recipe by recipe, the before
 * and the after («preparación / cocción / total (trabajo)») and the
 * preparativos it would add: that is the review. With `--apply` it writes
 * them, one by one, only while each recipe still has the times it read.
 * Running it twice changes nothing the second time.
 *
 * Usage:
 *   DATABASE_URL=… pnpm --filter @ona/api exec tsx scripts/applyTimeFixes402.ts           # review (nothing written)
 *   DATABASE_URL=… pnpm --filter @ona/api exec tsx scripts/applyTimeFixes402.ts --apply   # apply
 */
import { db, pool } from '../src/db/connection.js'
import { applyTimeFixes402 } from '../src/services/recipeTimeFixes402.js'

const apply = process.argv.includes('--apply')

try {
  await applyTimeFixes402(db, { apply })
} finally {
  await pool.end()
}
