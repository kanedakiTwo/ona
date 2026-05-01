/**
 * USDA-driven ingredient seed (Task 7).
 *
 * For every row in the `ingredients` table, looks up a curator-maintained
 * mapping in `data/ingredient-fdc-map.yaml`, fetches the per-100 g
 * nutrient profile from USDA FoodData Central via the cached client
 * (`services/nutrition/usdaClient.ts`), and writes:
 *
 *   - fdcId, aisle, density, unitWeight, allergenTags  (from the mapping)
 *   - calories, protein, carbs, fat, fiber, salt        (from USDA, per-100 g)
 *
 * Idempotent: re-running on the same DB updates rows in place. Mappings
 * for ingredients not currently in the DB are silently ignored (the
 * curator may add them ahead of time).
 *
 * Spec: ../../../specs/nutrition.md ("Data Sources")
 *
 * CLI flags:
 *   --dry-run               Log what would change but do not write to DB.
 *   --only=<csv>            Restrict the run to these canonical names
 *                           (e.g. --only=cebolla,ajo,tomate). Useful for
 *                           re-runs after fixing a single mapping.
 *   --allergens-from-name   For ingredients without a mapping, fall back to
 *                           inferAllergenTagsFromName() and write JUST the
 *                           allergenTags column (no USDA fetch). Useful for
 *                           getting allergen coverage without full mapping.
 *
 * Exit codes:
 *   0 → run completed (even if some rows were unmapped — that's curator work)
 *   1 → hard error (DB unreachable, malformed yaml, missing API key)
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { eq } from 'drizzle-orm'
import { db, pool } from '../db/connection.js'
import { ingredients } from '../db/schema.js'
import {
  createUsdaClient,
  inferAllergenTagsFromName,
  type UsdaNutrientProfile,
} from '../services/nutrition/index.js'
import { normalize } from '../services/recipeLint.js'

// ─── Mapping shape ─────────────────────────────────────────────────

interface Mapping {
  name: string
  fdcId: number
  aisle: string | null
  density: number | null
  unitWeight: number | null
  allergenTags: string[]
}

// ─── CLI args ──────────────────────────────────────────────────────

interface CliArgs {
  dryRun: boolean
  only: Set<string> | null
  allergensFromName: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { dryRun: false, only: null, allergensFromName: false }
  for (const a of argv) {
    if (a === '--dry-run') {
      args.dryRun = true
    } else if (a.startsWith('--only=')) {
      const csv = a.slice('--only='.length)
      const names = csv
        .split(',')
        .map((s) => normalize(s))
        .filter((s) => s.length > 0)
      args.only = new Set(names)
    } else if (a === '--allergens-from-name') {
      args.allergensFromName = true
    } else if (a === '--help' || a === '-h') {
      printUsage()
      process.exit(0)
    } else {
      console.warn(`[seed/usda] unknown arg: ${a} (ignored)`)
    }
  }
  return args
}

function printUsage(): void {
  console.log(
    `Usage: pnpm --filter @ona/api seed:usda [--dry-run] [--only=name1,name2,...] [--allergens-from-name]`,
  )
}

// ─── Mapping loader ────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MAP_PATH = path.resolve(__dirname, 'data', 'ingredient-fdc-map.yaml')

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function validateMapping(raw: unknown, idx: number): Mapping {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`mapping[${idx}] is not an object`)
  }
  const m = raw as Record<string, unknown>
  if (typeof m.name !== 'string' || m.name.length === 0) {
    throw new Error(`mapping[${idx}] missing name`)
  }
  if (typeof m.fdcId !== 'number' || !Number.isInteger(m.fdcId) || m.fdcId <= 0) {
    throw new Error(`mapping[${idx}] (${m.name}) has invalid fdcId: ${m.fdcId}`)
  }
  const aisle =
    m.aisle === null || m.aisle === undefined
      ? null
      : typeof m.aisle === 'string'
        ? m.aisle
        : (() => {
            throw new Error(`mapping[${idx}] (${m.name}) aisle must be string or null`)
          })()
  const density =
    m.density === null || m.density === undefined
      ? null
      : typeof m.density === 'number'
        ? m.density
        : (() => {
            throw new Error(`mapping[${idx}] (${m.name}) density must be number or null`)
          })()
  const unitWeight =
    m.unitWeight === null || m.unitWeight === undefined
      ? null
      : typeof m.unitWeight === 'number'
        ? m.unitWeight
        : (() => {
            throw new Error(`mapping[${idx}] (${m.name}) unitWeight must be number or null`)
          })()
  const allergenTags = isStringArray(m.allergenTags) ? m.allergenTags : []
  return {
    name: m.name,
    fdcId: m.fdcId,
    aisle,
    density,
    unitWeight,
    allergenTags,
  }
}

async function loadMappings(): Promise<Mapping[]> {
  let raw: string
  try {
    raw = await fs.readFile(MAP_PATH, 'utf8')
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      throw new Error(
        `mapping file not found: ${MAP_PATH}\n` +
          `Copy ingredient-fdc-map.example.yaml and populate it before running this seed.`,
      )
    }
    throw err
  }

  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch (err) {
    throw new Error(`failed to parse ${MAP_PATH}: ${(err as Error).message}`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${MAP_PATH} must be a YAML list at the top level`)
  }
  return parsed.map((entry, i) => validateMapping(entry, i))
}

// ─── Main ──────────────────────────────────────────────────────────

interface RunStats {
  total: number
  mapped: number
  unmapped: number
}

async function run(args: CliArgs): Promise<RunStats> {
  const mappings = await loadMappings()

  // Index by normalized canonical name. Detect duplicate keys early.
  const mappingByNorm = new Map<string, Mapping>()
  for (const m of mappings) {
    const key = normalize(m.name)
    if (mappingByNorm.has(key)) {
      throw new Error(
        `duplicate mapping name (after normalization): "${m.name}" → "${key}"`,
      )
    }
    mappingByNorm.set(key, m)
  }
  console.log(`[seed/usda] loaded ${mappings.length} mappings from ${path.relative(process.cwd(), MAP_PATH)}`)

  // Pull current ingredient catalog
  const rows = await db.select().from(ingredients)
  if (rows.length === 0) {
    console.log('[seed/usda] no ingredient rows in DB — nothing to do')
    return { total: 0, mapped: 0, unmapped: 0 }
  }

  // Apply --only filter
  const selectedRows = args.only
    ? rows.filter((r) => args.only!.has(normalize(r.name)))
    : rows
  if (args.only) {
    console.log(
      `[seed/usda] --only filter applied (${args.only.size} names) → ${selectedRows.length} rows selected`,
    )
  }

  // Lazy USDA client — only constructed when we actually have a fetch to do.
  let usda: ReturnType<typeof createUsdaClient> | null = null
  const profileCache = new Map<number, UsdaNutrientProfile>()

  const stats: RunStats = { total: selectedRows.length, mapped: 0, unmapped: 0 }
  const unmappedNames: string[] = []

  for (const row of selectedRows) {
    const norm = normalize(row.name)
    const mapping = mappingByNorm.get(norm)

    if (!mapping) {
      stats.unmapped++
      unmappedNames.push(row.name)

      if (args.allergensFromName) {
        const inferred = inferAllergenTagsFromName(row.name)
        if (inferred.length > 0) {
          if (args.dryRun) {
            console.log(
              `[seed/usda] DRY-RUN UNMAPPED+allergens: ${row.name} → tags=${JSON.stringify(inferred)}`,
            )
          } else {
            await db
              .update(ingredients)
              .set({ allergenTags: inferred })
              .where(eq(ingredients.id, row.id))
            console.log(
              `[seed/usda] UNMAPPED+allergens: ${row.name} → tags=${JSON.stringify(inferred)}`,
            )
          }
          continue
        }
      }

      console.log(`[seed/usda] UNMAPPED: ${row.name}`)
      continue
    }

    // Fetch USDA profile (cached + coalesced inside the client, plus our
    // per-run profileCache to avoid even the disk read on duplicate fdcIds).
    let profile: UsdaNutrientProfile
    const cached = profileCache.get(mapping.fdcId)
    if (cached) {
      profile = cached
    } else {
      if (!usda) usda = createUsdaClient()
      try {
        profile = await usda.fetchByFdcId(mapping.fdcId)
      } catch (err) {
        console.error(
          `[seed/usda] FETCH ERROR: ${row.name} fdc=${mapping.fdcId}: ${(err as Error).message}`,
        )
        stats.unmapped++
        unmappedNames.push(row.name)
        continue
      }
      profileCache.set(mapping.fdcId, profile)
      // Be polite to USDA (the client itself does not throttle)
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const update = {
      fdcId: mapping.fdcId,
      aisle: mapping.aisle,
      density: mapping.density,
      unitWeight: mapping.unitWeight,
      allergenTags: mapping.allergenTags,
      calories: profile.per100g.kcal,
      protein: profile.per100g.proteinG,
      carbs: profile.per100g.carbsG,
      fat: profile.per100g.fatG,
      fiber: profile.per100g.fiberG,
      salt: profile.per100g.saltG,
    }

    if (args.dryRun) {
      console.log(
        `[seed/usda] DRY-RUN OK: ${row.name} → fdc=${mapping.fdcId} (${profile.description}) kcal=${Math.round(profile.per100g.kcal)}`,
      )
    } else {
      await db.update(ingredients).set(update).where(eq(ingredients.id, row.id))
      console.log(
        `[seed/usda] OK: ${row.name} → fdc=${mapping.fdcId} (${profile.description}) kcal=${Math.round(profile.per100g.kcal)}`,
      )
    }
    stats.mapped++
  }

  return stats
}

// ─── Entry point ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.dryRun) console.log('[seed/usda] DRY-RUN — no DB writes will be performed')

  let stats: RunStats
  try {
    stats = await run(args)
  } finally {
    await pool.end().catch(() => {
      /* ignore pool teardown errors */
    })
  }

  console.log(
    `[seed/usda] Total: ${stats.total} | Mapped: ${stats.mapped} | Unmapped: ${stats.unmapped}`,
  )
}

main().catch((err) => {
  console.error('[seed/usda] FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})
