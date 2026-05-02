/**
 * Apply regenerated recipes to the DB.
 *
 * Reads JSONL produced by `scripts/regenerateRecipes.ts` (Task 8) — one
 * curator-approved recipe per line, in the loose `regenRecipeSchema` shape
 * (with temporary `"ing_<INDEX>"` ingredientRefs). For each line:
 *
 *   1. Re-parse with regenRecipeSchema.safeParse (defense-in-depth).
 *   2. Mint a UUID for each ingredient row up front; build an
 *      `"ing_<i>" → uuid` map; resolve every step.ingredientRefs.
 *   3. Run lintRecipe() against the live ingredient catalog as a final
 *      guardrail. Failures go to regen-skipped.jsonl, log + continue.
 *   4. Find an existing recipe row by case-insensitive name match. If found,
 *      REPLACE it: delete its recipe_ingredients + recipe_steps and update
 *      its row in place (preserving id, imageUrl, authorId, createdAt). If
 *      not, INSERT a new row.
 *   5. Insert recipe_ingredients (with the minted UUIDs) and recipe_steps
 *      (with resolved ingredientRefs).
 *   6. Compute nutritionPerServing (aggregateNutrition) and allergens
 *      (allergenUnion). Compute totalTime: sum of step.durationMin if every
 *      step has it, else prepTime + cookTime. Persist these on the recipe.
 *   7. Single transaction per recipe — no partial writes.
 *
 * Idempotent: re-running the same JSONL produces the same DB state. Recipes
 * absent from the JSONL are NEVER deleted by this script.
 *
 * Usage:
 *   pnpm --filter @ona/api apply:recipes
 *   pnpm --filter @ona/api apply:recipes --dry-run
 *   pnpm --filter @ona/api apply:recipes --ids="Falafel,Albóndigas en salsa española"
 *   pnpm --filter @ona/api apply:recipes --input=path/to/file.jsonl
 *   pnpm --filter @ona/api apply:recipes --ignore-warnings  (default; reserved for forward compatibility)
 */

import { mkdir, readFile } from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { eq, sql } from 'drizzle-orm'

import { db, pool } from '../src/db/connection.js'
import {
  ingredients as ingredientsTable,
  recipes as recipesTable,
  recipeIngredients as recipeIngredientsTable,
  recipeSteps as recipeStepsTable,
} from '../src/db/schema.js'
import { regenRecipeSchema, type RegenRecipe } from '../src/services/regenSchema.js'
import {
  lintRecipe,
  type CatalogIngredient,
  type LintIssue,
  type RecipeInput,
} from '../src/services/recipeLint.js'
import {
  aggregateNutrition,
  type IngredientCatalogEntry,
} from '../src/services/nutrition/aggregate.js'
import { allergenUnion, inferAllergenTagsFromName } from '../src/services/nutrition/allergens.js'
import { suggestIngredient } from '../src/services/ingredientAutoCreate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, 'output')
const DEFAULT_INPUT = path.join(OUTPUT_DIR, 'regen-passed.jsonl')
const SKIPPED_PATH = path.join(OUTPUT_DIR, 'regen-skipped.jsonl')

// ─── CLI flag parsing ──────────────────────────────────────────────

interface CliArgs {
  dryRun: boolean
  ids?: string[]
  input: string
  ignoreWarnings: boolean
  autoCreateMissing: boolean
  force: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dryRun: false,
    input: DEFAULT_INPUT,
    ignoreWarnings: true, // warnings never block; flag is forward-looking
    autoCreateMissing: true,
    force: false,
  }
  for (const raw of argv.slice(2)) {
    if (raw === '--dry-run') {
      args.dryRun = true
    } else if (raw === '--force') {
      args.force = true
    } else if (raw.startsWith('--ids=')) {
      args.ids = raw
        .slice('--ids='.length)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    } else if (raw.startsWith('--input=')) {
      args.input = path.resolve(raw.slice('--input='.length))
    } else if (raw === '--ignore-warnings') {
      args.ignoreWarnings = true
    } else if (raw === '--auto-create-missing=false') {
      args.autoCreateMissing = false
    } else if (raw === '--auto-create-missing=true' || raw === '--auto-create-missing') {
      args.autoCreateMissing = true
    } else if (raw === '--help' || raw === '-h') {
      printHelp()
      process.exit(0)
    } else {
      console.warn(`[apply] Unknown flag: ${raw}`)
    }
  }
  return args
}

function printHelp(): void {
  console.log(`Usage: apply:recipes [flags]

Flags:
  --dry-run                       Validate + lint + resolve refs + compute nutrition; do NOT touch the DB
  --ids=A,B,C                     Only apply recipes whose name (case-insensitive) is in the list
  --input=<path>                  Override the default JSONL path (default: ${DEFAULT_INPUT})
  --ignore-warnings               Proceed even if lint emits warnings (default; warnings never block)
  --auto-create-missing=true|false  When true (default), missing ingredients (non-UUID ingredientId or
                                  unknown UUID) are auto-created via USDA before lint. When false,
                                  the recipe is skipped — legacy behaviour.
`)
}

// ─── Catalog loading ─────────────────────────────────────────────

interface FullCatalogRow extends CatalogIngredient {
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  salt: number
}

async function loadFullCatalog(): Promise<FullCatalogRow[]> {
  const rows = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      allergenTags: ingredientsTable.allergenTags,
      fdcId: ingredientsTable.fdcId,
      density: ingredientsTable.density,
      unitWeight: ingredientsTable.unitWeight,
      calories: ingredientsTable.calories,
      protein: ingredientsTable.protein,
      carbs: ingredientsTable.carbs,
      fat: ingredientsTable.fat,
      fiber: ingredientsTable.fiber,
      salt: ingredientsTable.salt,
    })
    .from(ingredientsTable)
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    allergenTags: r.allergenTags ?? [],
    fdcId: r.fdcId,
    density: r.density,
    unitWeight: r.unitWeight,
    calories: r.calories ?? 0,
    protein: r.protein ?? 0,
    carbs: r.carbs ?? 0,
    fat: r.fat ?? 0,
    fiber: r.fiber ?? 0,
    salt: r.salt ?? 0,
  }))
}

function buildLintCatalog(catalog: FullCatalogRow[]): CatalogIngredient[] {
  return catalog.map(c => ({
    id: c.id,
    name: c.name,
    allergenTags: c.allergenTags,
    fdcId: c.fdcId,
    density: c.density,
    unitWeight: c.unitWeight,
  }))
}

function buildNutritionCatalog(
  catalog: FullCatalogRow[],
): Map<string, IngredientCatalogEntry> {
  const m = new Map<string, IngredientCatalogEntry>()
  for (const c of catalog) {
    m.set(c.id, {
      id: c.id,
      name: c.name,
      calories: c.calories,
      protein: c.protein,
      carbs: c.carbs,
      fat: c.fat,
      fiber: c.fiber,
      salt: c.salt,
      density: c.density,
      unitWeight: c.unitWeight,
    })
  }
  return m
}

function buildAllergenCatalog(
  catalog: FullCatalogRow[],
): Map<string, { allergenTags?: string[] | null }> {
  const m = new Map<string, { allergenTags?: string[] | null }>()
  for (const c of catalog) {
    m.set(c.id, { allergenTags: c.allergenTags ?? [] })
  }
  return m
}

// ─── JSONL reading ───────────────────────────────────────────────

interface JsonlLine {
  lineNo: number
  raw: string
  obj: unknown
  parseError?: string
}

async function readJsonl(filePath: string): Promise<JsonlLine[]> {
  let content: string
  try {
    content = await readFile(filePath, 'utf8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      console.error(`[apply] Input file not found: ${filePath}`)
      return []
    }
    throw err
  }
  const lines: JsonlLine[] = []
  let lineNo = 0
  for (const raw of content.split('\n')) {
    lineNo++
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    try {
      const obj = JSON.parse(trimmed)
      lines.push({ lineNo, raw: trimmed, obj })
    } catch (err: any) {
      lines.push({ lineNo, raw: trimmed, obj: null, parseError: err?.message ?? String(err) })
    }
  }
  return lines
}

// ─── Per-recipe pipeline ─────────────────────────────────────────

interface ResolvedRecipe {
  /** Schema-validated regen recipe. */
  regen: RegenRecipe
  /** Minted UUIDs for the recipe_ingredients rows, in array order. */
  ingredientRowIds: string[]
  /** "ing_<i>" → minted UUID (parallel to ingredientRowIds). */
  refMap: Map<string, string>
  /** Lint input (post-resolution) for the final guardrail. */
  lintInput: RecipeInput
}

/**
 * Mint UUIDs, build the "ing_<i>" → UUID map, resolve every step.ingredientRefs.
 * Returns null if any ref doesn't resolve.
 */
function resolveRecipe(
  regen: RegenRecipe,
): { result: ResolvedRecipe } | { error: LintIssue[] } {
  const ingredientRowIds = regen.ingredients.map(() => randomUUID())
  const refMap = new Map<string, string>()
  for (let i = 0; i < ingredientRowIds.length; i++) {
    refMap.set(`ing_${i}`, ingredientRowIds[i])
  }

  const errors: LintIssue[] = []
  const resolvedSteps = regen.steps.map((step, sIdx) => {
    const refs: string[] = []
    for (let j = 0; j < (step.ingredientRefs ?? []).length; j++) {
      const tempId = step.ingredientRefs[j]
      // Already a UUID? Pass through (defensive — JSONL may be hand-written).
      if (UUID_RE.test(tempId)) {
        refs.push(tempId)
        continue
      }
      const real = refMap.get(tempId)
      if (!real) {
        errors.push({
          code: 'UNRESOLVED_INGREDIENT_REF',
          message: `Step ${sIdx + 1} references "${tempId}" but no such ingredient slot exists.`,
          path: `steps[${sIdx}].ingredientRefs[${j}]`,
        })
        continue
      }
      refs.push(real)
    }
    return {
      index: step.index,
      text: step.text,
      durationMin: step.durationMin ?? null,
      temperature: step.temperature ?? null,
      technique: step.technique,
      ingredientRefs: refs,
    }
  })

  if (errors.length > 0) {
    return { error: errors }
  }

  const lintInput: RecipeInput = {
    name: regen.name,
    servings: regen.servings,
    prepTime: regen.prepTime ?? null,
    cookTime: regen.cookTime ?? null,
    difficulty: regen.difficulty,
    meals: regen.meals,
    seasons: regen.seasons,
    equipment: regen.equipment ?? [],
    tags: regen.tags ?? [],
    internalTags: regen.internalTags ?? [],
    ingredients: regen.ingredients.map((ing, i) => ({
      id: ingredientRowIds[i],
      ingredientId: ing.ingredientId,
      section: ing.section,
      quantity: ing.quantity,
      unit: ing.unit,
      optional: ing.optional ?? false,
      note: ing.note,
      displayOrder: ing.displayOrder ?? i,
    })),
    steps: resolvedSteps,
    nutritionPerServing: regen.nutritionPerServing ?? null,
  }

  return {
    result: {
      regen,
      ingredientRowIds,
      refMap,
      lintInput,
    },
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Pre-pass for `--auto-create-missing`.
 *
 * Inspects the regen recipe and, for each ingredientId that is either:
 *   - not a UUID (i.e. a name like "alcaparras"), or
 *   - a UUID not present in the live catalog,
 * tries to auto-create a new ingredients row via USDA (top Foundation/SR
 * Legacy candidate; stub when nothing matches). Mutates the regen recipe in
 * place to swap the broken ingredientId for the new UUID, and adds the row
 * to the catalog so the lint pass sees it.
 *
 * Returns a list of warnings (non-fatal); the caller logs them.
 */
async function autoCreateMissingForRecipe(
  regen: RegenRecipe,
  catalog: FullCatalogRow[],
  catalogById: Map<string, FullCatalogRow>,
): Promise<string[]> {
  const warnings: string[] = []
  for (const ing of regen.ingredients) {
    const id = ing.ingredientId
    const isUuid = UUID_RE.test(id)
    if (isUuid && catalogById.has(id)) continue
    if (isUuid) {
      warnings.push(
        `[auto-create] ingredientId ${id} (unknown UUID) cannot be auto-created — no name available.`,
      )
      continue
    }
    const rawName = id.trim()
    if (rawName.length === 0) continue

    // 1. Existing-name match (case-insensitive).
    const existingByName = catalog.find(
      r => r.name.toLowerCase() === rawName.toLowerCase(),
    )
    if (existingByName) {
      ing.ingredientId = existingByName.id
      warnings.push(
        `[auto-create] mapped "${rawName}" → existing ingredient ${existingByName.id}.`,
      )
      continue
    }

    // 2. USDA suggest + insert.
    let bestFdcId: number | null = null
    let nutrition = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, saltG: 0 }
    try {
      const suggestion = await suggestIngredient(rawName, { limit: 3 })
      const top =
        suggestion.candidates.find(
          c => c.dataType === 'Foundation' || c.dataType === 'SR Legacy',
        ) ?? suggestion.candidates[0]
      if (top) {
        bestFdcId = top.fdcId
        nutrition = top.per100g
      } else {
        warnings.push(`[auto-create] no USDA match for "${rawName}"; saved as stub.`)
      }
    } catch (err: any) {
      warnings.push(
        `[auto-create] USDA error for "${rawName}": ${err?.message ?? String(err)}; saved as stub.`,
      )
    }

    const allergens = inferAllergenTagsFromName(rawName)
    const [inserted] = await db
      .insert(ingredientsTable)
      .values({
        name: rawName,
        fdcId: bestFdcId,
        aisle: null,
        allergenTags: allergens,
        calories: nutrition.kcal,
        protein: nutrition.proteinG,
        carbs: nutrition.carbsG,
        fat: nutrition.fatG,
        fiber: nutrition.fiberG,
        salt: nutrition.saltG,
      })
      .returning()

    const newRow: FullCatalogRow = {
      id: inserted.id,
      name: inserted.name,
      allergenTags: allergens,
      fdcId: bestFdcId,
      density: null,
      unitWeight: null,
      calories: nutrition.kcal,
      protein: nutrition.proteinG,
      carbs: nutrition.carbsG,
      fat: nutrition.fatG,
      fiber: nutrition.fiberG,
      salt: nutrition.saltG,
    }
    catalog.push(newRow)
    catalogById.set(newRow.id, newRow)
    ing.ingredientId = newRow.id
    warnings.push(
      `[auto-create] inserted "${rawName}" as ${newRow.id} (fdc=${bestFdcId ?? 'none'}).`,
    )
  }
  return warnings
}

/** Compute totalTime from durationMin (if every step has it) or prepTime + cookTime. */
function computeTotalTime(regen: RegenRecipe): number | null {
  if (regen.steps.length > 0 && regen.steps.every(s => s.durationMin != null)) {
    return regen.steps.reduce((acc, s) => acc + (s.durationMin ?? 0), 0)
  }
  const prep = regen.prepTime ?? 0
  const cook = regen.cookTime ?? 0
  if (prep === 0 && cook === 0) return null
  return prep + cook
}

// ─── DB write (per-recipe transaction) ───────────────────────────

interface ApplyCounts {
  recipesInserted: number
  recipesUpdated: number
  ingredientsInserted: number
  stepsInserted: number
}

interface ApplyOutcome {
  /** UUID of the recipe row (existing or newly minted). */
  recipeId: string
  /** True if we replaced an existing row, false if we inserted. */
  replaced: boolean
}

async function applyToDb(
  resolved: ResolvedRecipe,
  nutritionPerServing: ReturnType<typeof aggregateNutrition>['perServing'],
  allergens: string[],
  totalTime: number | null,
): Promise<ApplyOutcome> {
  const { regen, ingredientRowIds, lintInput } = resolved

  return await db.transaction(async tx => {
    // 1. Find by case-insensitive name match.
    const existing = await tx
      .select({
        id: recipesTable.id,
        imageUrl: recipesTable.imageUrl,
        authorId: recipesTable.authorId,
        createdAt: recipesTable.createdAt,
      })
      .from(recipesTable)
      .where(sql`LOWER(${recipesTable.name}) = LOWER(${regen.name})`)
      .limit(1)

    let recipeId: string
    let replaced: boolean

    const baseFields = {
      name: regen.name,
      servings: regen.servings,
      yieldText: regen.yieldText ?? null,
      prepTime: regen.prepTime ?? null,
      cookTime: regen.cookTime ?? null,
      activeTime: regen.activeTime ?? null,
      totalTime,
      difficulty: regen.difficulty,
      meals: regen.meals,
      seasons: regen.seasons,
      equipment: regen.equipment ?? [],
      allergens,
      notes: regen.notes ?? null,
      tips: regen.tips ?? null,
      substitutions: regen.substitutions ?? null,
      storage: regen.storage ?? null,
      nutritionPerServing,
      tags: regen.tags ?? [],
      internalTags: regen.internalTags ?? [],
      updatedAt: new Date(),
    } as const

    if (existing.length > 0) {
      // REPLACE: preserve id, imageUrl, authorId, createdAt.
      recipeId = existing[0].id
      replaced = true

      // Delete child rows first — recipe_ingredients has ON DELETE RESTRICT
      // for ingredients but cascades from recipes. Manually wipe to make the
      // delete order explicit and so we can keep the same recipe id.
      await tx.delete(recipeStepsTable).where(eq(recipeStepsTable.recipeId, recipeId))
      await tx
        .delete(recipeIngredientsTable)
        .where(eq(recipeIngredientsTable.recipeId, recipeId))

      // Update the recipe row in place. Don't override imageUrl: keep the
      // existing image (curators may have uploaded one) unless the regen
      // explicitly carries a new one.
      const updateFields: Record<string, unknown> = { ...baseFields }
      if (regen.imageUrl != null) {
        updateFields.imageUrl = regen.imageUrl
      }
      await tx.update(recipesTable).set(updateFields).where(eq(recipesTable.id, recipeId))
    } else {
      // INSERT a new row.
      const [inserted] = await tx
        .insert(recipesTable)
        .values({
          ...baseFields,
          imageUrl: regen.imageUrl ?? null,
        })
        .returning({ id: recipesTable.id })
      recipeId = inserted.id
      replaced = false
    }

    // 2. Insert recipe_ingredients (with minted row UUIDs).
    if (regen.ingredients.length > 0) {
      await tx.insert(recipeIngredientsTable).values(
        regen.ingredients.map((ing, i) => ({
          id: ingredientRowIds[i],
          recipeId,
          ingredientId: ing.ingredientId,
          section: ing.section ?? null,
          quantity: ing.quantity,
          unit: ing.unit,
          optional: ing.optional ?? false,
          note: ing.note ?? null,
          displayOrder: ing.displayOrder ?? i,
        })),
      )
    }

    // 3. Insert recipe_steps (with resolved ingredientRefs).
    if (lintInput.steps.length > 0) {
      await tx.insert(recipeStepsTable).values(
        lintInput.steps.map(step => ({
          recipeId,
          index: step.index,
          text: step.text,
          durationMin: step.durationMin ?? null,
          temperature: step.temperature ?? null,
          technique: step.technique ?? null,
          ingredientRefs: step.ingredientRefs ?? [],
        })),
      )
    }

    return { recipeId, replaced }
  })
}

// ─── Skipped writer ──────────────────────────────────────────────

interface SkippedWriter {
  write(payload: { recipe: unknown; errors: LintIssue[]; warnings?: LintIssue[] }): void
  close(): Promise<void>
}

async function openSkippedWriter(): Promise<SkippedWriter> {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const stream = createWriteStream(SKIPPED_PATH, { flags: 'w' })
  return {
    write(payload) {
      stream.write(JSON.stringify(payload) + '\n')
    },
    close: () =>
      new Promise<void>(res => {
        stream.end(res)
      }),
  }
}

// ─── Main ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  console.log(
    `[apply] dryRun=${args.dryRun} input=${args.input} ids=${args.ids?.join(',') ?? 'none'}`,
  )

  const lines = await readJsonl(args.input)
  if (lines.length === 0) {
    console.log('[apply] No input lines. Nothing to do.')
    return
  }

  const fullCatalog = await loadFullCatalog()
  if (fullCatalog.length === 0) {
    console.error('[apply] Ingredient catalog is empty — run db:seed first.')
    process.exitCode = 1
    return
  }
  // Mutable index — autoCreateMissingForRecipe pushes new rows into both.
  const catalogById = new Map<string, FullCatalogRow>(
    fullCatalog.map(r => [r.id, r]),
  )

  const idsFilter = args.ids ? new Set(args.ids.map(s => s.toLowerCase())) : null

  const skippedWriter = args.dryRun ? null : await openSkippedWriter()

  const counts: ApplyCounts = {
    recipesInserted: 0,
    recipesUpdated: 0,
    ingredientsInserted: 0,
    stepsInserted: 0,
  }
  let applied = 0
  let skipped = 0

  for (const line of lines) {
    if (line.parseError) {
      skipped++
      console.log(`[skip] line ${line.lineNo} — JSON parse error: ${line.parseError}`)
      if (skippedWriter) {
        skippedWriter.write({
          recipe: { _line: line.lineNo, _raw: line.raw },
          errors: [
            { code: 'JSON_PARSE_ERROR', message: line.parseError },
          ],
        })
      }
      continue
    }

    // The regen JSONL appends `_source` metadata. Strip unknown leading
    // underscore keys before schema validation so safeParse doesn't reject.
    const cleaned = stripPrivateKeys(line.obj)

    const schemaResult = regenRecipeSchema.safeParse(cleaned)
    if (!schemaResult.success) {
      const errors = schemaResult.error.issues.map(iss => ({
        code: 'SCHEMA_INVALID',
        message: `${iss.path.join('.')}: ${iss.message}`,
      }))
      const name = (cleaned as { name?: string })?.name ?? `<line ${line.lineNo}>`
      skipped++
      console.log(`[skip] ${name} — ${errors.length} schema issues`)
      if (skippedWriter) {
        skippedWriter.write({ recipe: cleaned, errors })
      }
      continue
    }

    const regen = schemaResult.data

    // CLI filter: --ids
    if (idsFilter && !idsFilter.has(regen.name.toLowerCase())) {
      continue
    }

    // 0. Auto-create missing ingredients (--auto-create-missing).
    if (args.autoCreateMissing && !args.dryRun) {
      try {
        const acWarns = await autoCreateMissingForRecipe(regen, fullCatalog, catalogById)
        for (const w of acWarns) console.log(`         ${w}`)
      } catch (err: any) {
        console.warn(
          `[apply] auto-create pre-pass failed for ${regen.name}: ${err?.message ?? String(err)}`,
        )
      }
    }
    // Rebuild per-iteration (cheap for ~250 rows; idempotent if no changes).
    const lintCatalog = buildLintCatalog(fullCatalog)
    const nutritionCatalog = buildNutritionCatalog(fullCatalog)
    const allergenCatalog = buildAllergenCatalog(fullCatalog)

    // 1. Resolve refs (and mint UUIDs).
    const resolution = resolveRecipe(regen)
    if ('error' in resolution) {
      skipped++
      console.log(
        `[skip] ${regen.name} — ${resolution.error.length} unresolved ingredient ref(s)`,
      )
      if (skippedWriter) {
        skippedWriter.write({ recipe: regen, errors: resolution.error })
      }
      continue
    }
    const resolved = resolution.result

    // 2. Final lint guardrail. `force` lets QUANTITY_OUT_OF_RANGE pass when
    // the regen pipeline asked for it (curator dashboard surfaces these).
    const lintResult = lintRecipe(resolved.lintInput, {
      ingredientCatalog: lintCatalog,
      force: args.force,
    })
    if (!lintResult.ok) {
      skipped++
      console.log(`[skip] ${regen.name} — ${lintResult.errors.length} lint issues`)
      for (const e of lintResult.errors) {
        console.log(`         ${e.code}: ${e.message}${e.path ? ` (${e.path})` : ''}`)
      }
      if (skippedWriter) {
        skippedWriter.write({
          recipe: regen,
          errors: lintResult.errors,
          warnings: lintResult.warnings,
        })
      }
      continue
    }

    // 3. Compute nutrition + allergens + totalTime.
    const aggregate = aggregateNutrition({
      servings: regen.servings,
      ingredients: resolved.lintInput.ingredients.map(ing => ({
        id: ing.id,
        ingredientId: ing.ingredientId,
        quantity: ing.quantity,
        unit: ing.unit,
      })) as any,
      catalog: nutritionCatalog,
    })
    const allergens = allergenUnion(
      regen.ingredients.map(ing => ({ ingredientId: ing.ingredientId })),
      allergenCatalog,
    )
    const totalTime = computeTotalTime(regen)

    if (args.dryRun) {
      applied++
      console.log(
        `[ok-dry] ${regen.name} — kcal=${aggregate.perServing.kcal}, allergens=[${allergens.join(', ')}] (${regen.ingredients.length} ingredients, ${regen.steps.length} steps)`,
      )
      if (aggregate.skipped.length > 0) {
        console.log(
          `         skipped ingredients in nutrition: ${aggregate.skipped.map(s => `${s.ingredientId}:${s.reason}`).join(', ')}`,
        )
      }
      continue
    }

    // 4. Write to DB inside a single transaction.
    try {
      const outcome = await applyToDb(
        resolved,
        aggregate.perServing,
        allergens,
        totalTime,
      )
      applied++
      if (outcome.replaced) counts.recipesUpdated++
      else counts.recipesInserted++
      counts.ingredientsInserted += regen.ingredients.length
      counts.stepsInserted += regen.steps.length

      console.log(
        `[ok] ${regen.name} — kcal=${aggregate.perServing.kcal}, allergens=[${allergens.join(', ')}] (${regen.ingredients.length} ingredients, ${regen.steps.length} steps)`,
      )
    } catch (err: any) {
      skipped++
      const msg = err?.message ?? String(err)
      console.log(`[skip] ${regen.name} — DB error: ${msg}`)
      if (skippedWriter) {
        skippedWriter.write({
          recipe: regen,
          errors: [{ code: 'DB_ERROR', message: msg }],
        })
      }
    }
  }

  if (skippedWriter) {
    await skippedWriter.close()
  }

  const total = applied + skipped
  console.log('')
  console.log(`Applied: ${applied} | Skipped: ${skipped} | Total: ${total}`)
  if (!args.dryRun) {
    console.log(
      `DB rows touched: ${counts.recipesInserted} inserted + ${counts.recipesUpdated} updated, ${counts.ingredientsInserted} recipe_ingredients, ${counts.stepsInserted} recipe_steps`,
    )
    console.log('')
    console.log(`Skipped recipes (if any) → ${SKIPPED_PATH}`)
  }
}

/** Drop top-level keys starting with `_` (regen.jsonl annotates with _source). */
function stripPrivateKeys(obj: unknown): unknown {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k.startsWith('_')) continue
    out[k] = v
  }
  return out
}

main()
  .catch(err => {
    console.error('[apply] Fatal:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => undefined)
  })
