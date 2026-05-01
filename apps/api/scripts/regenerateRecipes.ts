/**
 * LLM-driven recipe regeneration script.
 *
 * Reads the existing recipe catalog (from the seed file + DB) and asks Claude
 * to convert each old-shape recipe (name, prepTime, meals, seasons, tags, flat
 * ingredient list, flat string steps) into the new schema (CreateRecipeInput
 * from @ona/shared) plus rich step metadata.
 *
 * Output is JSONL the curator reviews by hand. Three files in scripts/output/:
 *   - regen.jsonl          — every output the LLM produced (one line per recipe)
 *   - regen-passed.jsonl   — outputs that passed schema + lintRecipe()
 *   - regen-failed.jsonl   — outputs that failed; { recipe, errors, warnings }
 *
 * The script does NOT mutate the DB. A separate apply script (Task 9) reads
 * the curator-approved JSONL and writes recipes/recipe_ingredients/recipe_steps.
 *
 * IngredientRefs convention: the LLM mints temporary string ids inline
 * ("ing_0", "ing_1", ...) matching the position of each ingredient row in
 * the output. The apply script resolves these to real recipe_ingredients.id
 * UUIDs once those rows are created.
 *
 * Usage:
 *   pnpm --filter @ona/api regen:recipes
 *   pnpm --filter @ona/api regen:recipes --limit=2
 *   pnpm --filter @ona/api regen:recipes --ids=Falafel,Albondigas
 *   pnpm --filter @ona/api regen:recipes --model=claude-haiku-4-5-20251001
 *   pnpm --filter @ona/api regen:recipes --dry-run
 */

import Anthropic from '@anthropic-ai/sdk'
import { mkdir } from 'fs/promises'
import { createWriteStream } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

import { eq, asc } from 'drizzle-orm'
import { db, pool } from '../src/db/connection.js'
import {
  ingredients as ingredientsTable,
  recipes as recipesTable,
  recipeIngredients as recipeIngredientsTable,
  recipeSteps as recipeStepsTable,
} from '../src/db/schema.js'
import { seedRecipes, type SeedRecipe } from '../src/seed/recipes.js'
import { env } from '../src/config/env.js'
import {
  lintRecipe,
  type CatalogIngredient,
  type RecipeInput,
} from '../src/services/recipeLint.js'
import { regenRecipeSchema, type RegenRecipe } from '../src/services/regenSchema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, 'output')
const DEFAULT_MODEL = 'claude-opus-4-7'

// ─── CLI flag parsing ──────────────────────────────────────────────

interface CliArgs {
  limit?: number
  ids?: string[]
  model: string
  dryRun: boolean
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { model: DEFAULT_MODEL, dryRun: false }
  for (const raw of argv.slice(2)) {
    if (raw.startsWith('--limit=')) {
      args.limit = parseInt(raw.slice('--limit='.length), 10)
    } else if (raw.startsWith('--ids=')) {
      args.ids = raw.slice('--ids='.length).split(',').map(s => s.trim()).filter(Boolean)
    } else if (raw.startsWith('--model=')) {
      args.model = raw.slice('--model='.length)
    } else if (raw === '--dry-run') {
      args.dryRun = true
    } else if (raw === '--help' || raw === '-h') {
      printHelp()
      process.exit(0)
    } else {
      console.warn(`[regen] Unknown flag: ${raw}`)
    }
  }
  return args
}

function printHelp(): void {
  console.log(`Usage: regen:recipes [flags]

Flags:
  --limit=N         Only regenerate the first N recipes
  --ids=A,B,C       Only regenerate the listed recipe names (comma-separated, case-insensitive)
  --model=ID        Override the default model (default: ${DEFAULT_MODEL})
  --dry-run         Call the API but don't write JSONL; print parsed JSON to stdout
`)
}

// Note: regenRecipeSchema lives in src/services/regenSchema.ts so the apply
// script (Task 9) can re-validate the JSONL with the same loose contract.

// ─── Old-shape recipe (input to the LLM) ──────────────────────────

interface OldRecipe {
  name: string
  imageUrl?: string | null
  prepTime?: number | null
  meals: string[]
  seasons: string[]
  tags: string[]
  steps: string[]
  ingredients: Array<{ name: string; quantity: number; unit: string }>
  /** Database id when this recipe came from the DB */
  recipeId?: string
}

// ─── Loaders ──────────────────────────────────────────────────────

async function loadCatalog(): Promise<CatalogIngredient[]> {
  const rows = await db
    .select({
      id: ingredientsTable.id,
      name: ingredientsTable.name,
      allergenTags: ingredientsTable.allergenTags,
      fdcId: ingredientsTable.fdcId,
      density: ingredientsTable.density,
      unitWeight: ingredientsTable.unitWeight,
    })
    .from(ingredientsTable)
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    allergenTags: r.allergenTags ?? [],
    fdcId: r.fdcId,
    density: r.density,
    unitWeight: r.unitWeight,
  }))
}

/**
 * Load every "old recipe" the script should regenerate.
 *
 * Sources:
 *   1. The Notion-derived seed file (apps/api/src/seed/recipes.ts).
 *   2. The DB recipes table — for entries that exist in both, the DB row wins
 *      (it's more authoritative; curators may have edited it post-seed).
 *
 * Recipes from the DB that aren't in the seed are also included.
 */
async function loadOldRecipes(catalog: CatalogIngredient[]): Promise<OldRecipe[]> {
  const ingredientNameById = new Map(catalog.map(c => [c.id, c.name]))

  // Pull every catalog recipe (authorId is null for system recipes; we still
  // include user recipes so curators can review their data quality too).
  const dbRows = await db
    .select({
      id: recipesTable.id,
      name: recipesTable.name,
      imageUrl: recipesTable.imageUrl,
      prepTime: recipesTable.prepTime,
      meals: recipesTable.meals,
      seasons: recipesTable.seasons,
      tags: recipesTable.tags,
    })
    .from(recipesTable)

  // Index seed by normalized name for lookup
  const seedByName = new Map<string, SeedRecipe>()
  for (const r of seedRecipes) {
    seedByName.set(r.name.toLowerCase(), r)
  }

  const dbByName = new Map<string, (typeof dbRows)[number]>()
  for (const r of dbRows) {
    dbByName.set(r.name.toLowerCase(), r)
  }

  // For each name, fetch ingredients + steps from DB if available
  // For brevity in the prompt, we only fall back to seed values when the DB
  // row is missing the corresponding data.
  const merged: OldRecipe[] = []
  const seen = new Set<string>()

  // Walk the seed first (deterministic order, the curator's source of truth)
  for (const seed of seedRecipes) {
    const key = seed.name.toLowerCase()
    seen.add(key)
    const dbRow = dbByName.get(key)
    if (dbRow) {
      const dbIngs = await loadDbIngredientsFor(dbRow.id, ingredientNameById)
      const dbSteps = await loadDbStepsFor(dbRow.id)
      merged.push({
        name: dbRow.name,
        imageUrl: dbRow.imageUrl,
        prepTime: dbRow.prepTime ?? seed.prepTime ?? null,
        meals: dbRow.meals ?? seed.meals,
        seasons: dbRow.seasons ?? seed.seasons,
        tags: dbRow.tags ?? seed.tags,
        steps: dbSteps.length > 0 ? dbSteps : seed.steps,
        ingredients: dbIngs.length > 0 ? dbIngs : seed.ingredients,
        recipeId: dbRow.id,
      })
    } else {
      merged.push({
        name: seed.name,
        imageUrl: seed.imageUrl,
        prepTime: seed.prepTime,
        meals: seed.meals,
        seasons: seed.seasons,
        tags: seed.tags,
        steps: seed.steps,
        ingredients: seed.ingredients,
      })
    }
  }

  // Add DB-only recipes (not in the seed)
  for (const dbRow of dbRows) {
    const key = dbRow.name.toLowerCase()
    if (seen.has(key)) continue
    const dbIngs = await loadDbIngredientsFor(dbRow.id, ingredientNameById)
    const dbSteps = await loadDbStepsFor(dbRow.id)
    if (dbIngs.length === 0 && dbSteps.length === 0) {
      // Empty shell — skip; nothing for the LLM to work from.
      continue
    }
    merged.push({
      name: dbRow.name,
      imageUrl: dbRow.imageUrl,
      prepTime: dbRow.prepTime,
      meals: dbRow.meals ?? [],
      seasons: dbRow.seasons ?? [],
      tags: dbRow.tags ?? [],
      steps: dbSteps,
      ingredients: dbIngs,
      recipeId: dbRow.id,
    })
  }

  return merged
}

async function loadDbIngredientsFor(
  recipeId: string,
  ingredientNameById: Map<string, string>,
): Promise<Array<{ name: string; quantity: number; unit: string }>> {
  const rows = await db
    .select({
      ingredientId: recipeIngredientsTable.ingredientId,
      quantity: recipeIngredientsTable.quantity,
      unit: recipeIngredientsTable.unit,
    })
    .from(recipeIngredientsTable)
    .where(eq(recipeIngredientsTable.recipeId, recipeId))
  return rows
    .map(r => {
      const name = ingredientNameById.get(r.ingredientId)
      if (!name) return null
      return { name, quantity: Number(r.quantity), unit: String(r.unit) }
    })
    .filter((x): x is { name: string; quantity: number; unit: string } => x != null)
}

async function loadDbStepsFor(recipeId: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ index: recipeStepsTable.index, text: recipeStepsTable.text })
      .from(recipeStepsTable)
      .where(eq(recipeStepsTable.recipeId, recipeId))
      .orderBy(asc(recipeStepsTable.index))
    return rows.map(r => r.text)
  } catch {
    // recipe_steps may not yet exist on this dev DB if the migration was skipped
    return []
  }
}

// ─── Prompt assembly ──────────────────────────────────────────────

function buildSystemPrompt(catalog: CatalogIngredient[]): string {
  const catalogList = catalog
    .map(c => `${c.id}\t${c.name}`)
    .join('\n')
  return `You are a culinary data engineer regenerating the ONA recipe catalog.

ONA is a Spanish meal-planning app. The previous recipes have data quality
issues: steps mention ingredients not on the ingredient list, gramajes are
calibrated for 5-6 diners while the UI claims "Para 2", many fields are
missing. Your job is to produce a clean, lint-passing recipe in the new schema.

# Output schema

Return ONE JSON object with this exact shape (no prose, no markdown fences):

{
  "name": string,
  "servings": integer >= 1 (the number of diners the gramajes are calibrated for),
  "yieldText": string (optional, e.g. "12 albóndigas", "1 L de salsa"),
  "prepTime": integer minutes (active prep time, optional),
  "cookTime": integer minutes (passive/active cooking time, optional),
  "activeTime": integer minutes (optional),
  "difficulty": "easy" | "medium" | "hard",
  "meals": ["breakfast"|"lunch"|"dinner"|"snack"],   // at least one
  "seasons": ["spring"|"summer"|"autumn"|"winter"],  // 1..4
  "equipment": [string, ...]  // utensils ("sartén", "horno", "batidora")
  "tags": [string, ...]       // public tags shown to user (NOT meal/season/difficulty)
  "internalTags": [string, ...] // hidden curator tags (e.g. "compartida")
  "notes": string (optional, free-form curator notes),
  "tips": string (optional, cooking tips for the user),
  "substitutions": string (optional, alternative ingredients),
  "storage": string (optional, refrigeration / freezing notes),
  "ingredients": [
    {
      "ingredientId": "<UUID from the catalog below>",
      "section": string (optional, e.g. "Para la masa"),
      "quantity": positive number (in the unit below — calibrated for "servings" diners),
      "unit": "g" | "ml" | "u" | "cda" | "cdita" | "pizca" | "al_gusto",
      "optional": boolean (default false),
      "note": string (optional, e.g. "rallado fino"),
      "displayOrder": integer >= 0 (0-based ordering)
    },
    ...
  ],
  "steps": [
    {
      "index": integer >= 0 (0-based step number, ascending),
      "text": string (Spanish, imperative, mentions every ingredient used in this step by its catalog name),
      "durationMin": integer (optional, only when the step itself takes time),
      "temperature": integer °C (optional, e.g. 200 for "horno a 200C"),
      "technique": string (optional short label: "sofreír", "hornear", "marinar"),
      "ingredientRefs": [string, ...]   // SEE BELOW
    },
    ...
  ]
}

# IngredientRefs convention (IMPORTANT)

For each step, populate "ingredientRefs" with TEMPORARY string ids of the
form "ing_<INDEX>", where INDEX is the 0-based position of that ingredient in
your "ingredients" array.

Example: if your ingredients list is
  [0] cebolla, [1] tomate, [2] aceite de oliva
and step 2 uses cebolla and aceite, then step 2's ingredientRefs is
["ing_0", "ing_2"].

These temporary ids are resolved to real recipe_ingredients.id UUIDs by a
later apply script — do NOT mint real UUIDs and do NOT reuse "ing_<n>" as a
catalog id.

# Ingredient catalog (USE ONLY THESE)

Use ingredient names from the catalog below, matching by name
(case-insensitive). Do NOT invent new ingredients. If the original recipe uses
something not in the catalog, pick the closest catalog entry.

Set "ingredientId" to the catalog UUID (the first column).

Catalog (uuid <TAB> name):
${catalogList}

# Lint rules your output must satisfy

1. servings >= 1 and the gramajes scale FROM the original ingredient list TO
   that serving count (most originals are calibrated for ~5-6 diners; if you
   set servings: 2, divide quantities accordingly).
2. Every catalog ingredient mentioned in a step's text must appear in the
   recipe's ingredients array OR be linked through that step's ingredientRefs.
3. Every non-optional ingredient in the array must be mentioned in some step
   (by its catalog name) OR be referenced by some step's ingredientRefs.
4. Quantities per serving fall inside reasonable ranges (proteins 80-250 g,
   grains 40-120 g, oil 5-30 g, sal 0.5-15 g). Out-of-range quantities are
   blocking errors.
5. Every id in ingredientRefs matches an "ing_<INDEX>" that exists in the
   ingredients array (no dangling references).
6. If you set prepTime, cookTime, AND step.durationMin on every step, the sum
   of step.durationMin must not exceed (prepTime + cookTime) by more than 20%.
7. Public "tags" must NOT collide with meal names, seasons, difficulties, or
   any value in "internalTags".

# Quality bar

- Steps are imperative, in Spanish, complete (no "etc.").
- Add equipment, technique labels, and durations where reasonable.
- Add notes/tips/storage when you have something useful to say.
- yieldText is optional but nice for things that don't divide cleanly into
  servings (sauces, batches of cookies).
- Output ONLY the JSON object. No prose, no \`\`\`json fences, no preamble.`
}

const EXAMPLE_INPUT: OldRecipe = {
  name: 'Albondigas en salsa espanola',
  prepTime: 0,
  meals: ['lunch', 'dinner'],
  seasons: ['spring', 'summer', 'autumn', 'winter'],
  tags: ['compartida'],
  steps: [
    'Freir las albondigas en abundante aceite hasta dorar por todos lados, reservar en plato con papel absorbente',
    'Picar cebolla, zanahoria y ajo muy menudo, rehogar en cazuela con aceite colado de las albondigas',
    'Anadir sal, pimienta y harina, remover hasta disolver',
    'Verter el vino y un vaso de agua o caldo, cocinar 25 minutos a fuego lento removiendo',
    'Batir la salsa con batidora',
    'Verter en la cazuela, anadir las albondigas y cocer 10 minutos',
  ],
  ingredients: [
    { name: 'ternera', quantity: 1000, unit: 'g' },
    { name: 'cebolla', quantity: 200, unit: 'g' },
    { name: 'zanahoria', quantity: 150, unit: 'g' },
    { name: 'ajo', quantity: 10, unit: 'g' },
    { name: 'harina de trigo', quantity: 15, unit: 'g' },
    { name: 'aceite de oliva virgen', quantity: 30, unit: 'g' },
  ],
}

/**
 * The example output uses placeholder UUIDs for ingredientId. The real run
 * replaces them with catalog UUIDs the LLM picks from the catalog block.
 * We use string placeholders here so the example is human-readable.
 */
const EXAMPLE_OUTPUT_TEMPLATE = `{
  "name": "Albóndigas en salsa española",
  "servings": 4,
  "yieldText": "≈ 16 albóndigas",
  "prepTime": 25,
  "cookTime": 35,
  "difficulty": "medium",
  "meals": ["lunch", "dinner"],
  "seasons": ["spring", "summer", "autumn", "winter"],
  "equipment": ["sartén", "cazuela", "batidora"],
  "tags": ["clásico", "guiso"],
  "internalTags": ["compartida"],
  "notes": "Receta tradicional. Se puede congelar la salsa con las albóndigas.",
  "tips": "Para una salsa más sedosa, batir un par de minutos más al final.",
  "storage": "Hasta 3 días en la nevera; admite congelación.",
  "ingredients": [
    { "ingredientId": "<UUID-ternera>", "quantity": 400, "unit": "g", "displayOrder": 0 },
    { "ingredientId": "<UUID-cebolla>", "quantity": 80, "unit": "g", "displayOrder": 1 },
    { "ingredientId": "<UUID-zanahoria>", "quantity": 60, "unit": "g", "displayOrder": 2 },
    { "ingredientId": "<UUID-ajo>", "quantity": 4, "unit": "g", "displayOrder": 3 },
    { "ingredientId": "<UUID-harina-de-trigo>", "quantity": 6, "unit": "g", "displayOrder": 4 },
    { "ingredientId": "<UUID-aceite-de-oliva>", "quantity": 12, "unit": "g", "displayOrder": 5 }
  ],
  "steps": [
    { "index": 0, "text": "Formar bolas de unos 25 g con la ternera y freír en aceite de oliva hasta dorar por todos lados; reservar.", "durationMin": 8, "technique": "freír", "ingredientRefs": ["ing_0", "ing_5"] },
    { "index": 1, "text": "Picar la cebolla, la zanahoria y el ajo muy fino y rehogar en la misma cazuela con un poco de aceite de oliva.", "durationMin": 10, "technique": "sofreír", "ingredientRefs": ["ing_1", "ing_2", "ing_3", "ing_5"] },
    { "index": 2, "text": "Añadir la harina de trigo, remover hasta disolver y cocinar 1-2 minutos.", "durationMin": 2, "ingredientRefs": ["ing_4"] },
    { "index": 3, "text": "Verter un vaso de agua o caldo, cocer a fuego lento 20 minutos removiendo.", "durationMin": 20, "technique": "guisar" },
    { "index": 4, "text": "Batir la salsa con la batidora hasta que quede sedosa.", "durationMin": 1, "technique": "batir" },
    { "index": 5, "text": "Devolver la salsa a la cazuela, añadir las albóndigas y cocer 10 minutos más a fuego suave.", "durationMin": 10, "ingredientRefs": ["ing_0"] }
  ]
}`

function buildExampleUserMessage(): string {
  return `Regenerate this old-shape recipe into the new schema. Output ONLY the JSON object.

OLD RECIPE:
${JSON.stringify(EXAMPLE_INPUT, null, 2)}`
}

function buildExampleAssistantMessage(): string {
  return EXAMPLE_OUTPUT_TEMPLATE
}

function buildPerRecipeUserMessage(recipe: OldRecipe): string {
  const stripped = {
    name: recipe.name,
    prepTime: recipe.prepTime,
    meals: recipe.meals,
    seasons: recipe.seasons,
    tags: recipe.tags,
    steps: recipe.steps,
    ingredients: recipe.ingredients,
  }
  return `Regenerate this old-shape recipe into the new schema. Output ONLY the JSON object.

OLD RECIPE:
${JSON.stringify(stripped, null, 2)}`
}

// ─── LLM call ─────────────────────────────────────────────────────

function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set; cannot run the regen script.')
  }
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
}

/**
 * Strip ```json fences and any leading prose. The system prompt asks for raw
 * JSON, but the model occasionally still adds them.
 */
function extractJson(text: string): string {
  const trimmed = text.trim()
  // Fenced block
  const fence = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/)
  if (fence) return fence[1].trim()
  // Raw — return as-is
  return trimmed
}

async function callLLM(
  client: Anthropic,
  model: string,
  systemPrompt: string,
  oldRecipe: OldRecipe,
): Promise<string> {
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildExampleUserMessage(),
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: buildExampleAssistantMessage(),
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildPerRecipeUserMessage(oldRecipe),
          },
        ],
      },
    ],
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('LLM returned no text block')
  }
  return textBlock.text
}

// ─── Lint preprocessing ───────────────────────────────────────────

/**
 * Convert a regen-shape recipe (with "ing_<i>" refs) into the lint validator's
 * RecipeInput shape (with row ids and matching refs).
 */
function toLintInput(recipe: RegenRecipe): RecipeInput {
  const idsByIndex = recipe.ingredients.map((_, i) => `ing_${i}`)
  return {
    name: recipe.name,
    servings: recipe.servings,
    prepTime: recipe.prepTime ?? null,
    cookTime: recipe.cookTime ?? null,
    difficulty: recipe.difficulty,
    meals: recipe.meals,
    seasons: recipe.seasons,
    equipment: recipe.equipment ?? [],
    tags: recipe.tags ?? [],
    internalTags: recipe.internalTags ?? [],
    ingredients: recipe.ingredients.map((ing, i) => ({
      id: idsByIndex[i],
      ingredientId: ing.ingredientId,
      section: ing.section,
      quantity: ing.quantity,
      unit: ing.unit,
      optional: ing.optional ?? false,
      note: ing.note,
      displayOrder: ing.displayOrder ?? i,
    })),
    steps: recipe.steps.map(step => ({
      index: step.index,
      text: step.text,
      durationMin: step.durationMin ?? null,
      temperature: step.temperature ?? null,
      technique: step.technique,
      ingredientRefs: step.ingredientRefs ?? [],
    })),
    nutritionPerServing: recipe.nutritionPerServing ?? null,
  }
}

// ─── Output writers ───────────────────────────────────────────────

interface JsonlWriters {
  all: NodeJS.WritableStream
  passed: NodeJS.WritableStream
  failed: NodeJS.WritableStream
  close(): Promise<void>
}

async function openWriters(): Promise<JsonlWriters> {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const all = createWriteStream(path.join(OUTPUT_DIR, 'regen.jsonl'), { flags: 'w' })
  const passed = createWriteStream(path.join(OUTPUT_DIR, 'regen-passed.jsonl'), { flags: 'w' })
  const failed = createWriteStream(path.join(OUTPUT_DIR, 'regen-failed.jsonl'), { flags: 'w' })
  return {
    all,
    passed,
    failed,
    close: () =>
      Promise.all([
        new Promise<void>(res => all.end(res)),
        new Promise<void>(res => passed.end(res)),
        new Promise<void>(res => failed.end(res)),
      ]).then(() => undefined),
  }
}

function writeLine(stream: NodeJS.WritableStream, obj: unknown): void {
  stream.write(JSON.stringify(obj) + '\n')
}

// ─── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv)
  console.log(`[regen] model=${args.model} dryRun=${args.dryRun} limit=${args.limit ?? 'none'} ids=${args.ids?.join(',') ?? 'none'}`)

  // Load catalog and recipes
  console.log('[regen] Loading ingredient catalog from DB...')
  const catalog = await loadCatalog()
  console.log(`[regen] Catalog has ${catalog.length} ingredients`)

  console.log('[regen] Loading old recipes (seed + DB)...')
  let oldRecipes = await loadOldRecipes(catalog)
  console.log(`[regen] Loaded ${oldRecipes.length} old recipes`)

  // Apply CLI filters
  if (args.ids && args.ids.length > 0) {
    const wanted = new Set(args.ids.map(s => s.toLowerCase()))
    oldRecipes = oldRecipes.filter(r => wanted.has(r.name.toLowerCase()))
    console.log(`[regen] Filtered to ${oldRecipes.length} recipes by --ids`)
  }
  if (args.limit != null && args.limit >= 0) {
    oldRecipes = oldRecipes.slice(0, args.limit)
    console.log(`[regen] Limited to first ${oldRecipes.length} recipes`)
  }

  if (oldRecipes.length === 0) {
    console.log('[regen] Nothing to do.')
    return
  }

  // Open writers (no-op for dry-run)
  const writers = args.dryRun ? null : await openWriters()

  // Build the cached system prompt once
  const systemPrompt = buildSystemPrompt(catalog)

  const client = getClient()
  let passed = 0
  let failed = 0

  for (let i = 0; i < oldRecipes.length; i++) {
    const recipe = oldRecipes[i]
    const idx = `${(i + 1).toString().padStart(String(oldRecipes.length).length, ' ')}/${oldRecipes.length}`
    process.stdout.write(`[${idx}] ${recipe.name} ... `)

    let rawText: string
    try {
      rawText = await callLLM(client, args.model, systemPrompt, recipe)
    } catch (err: any) {
      failed++
      console.log(`API_ERROR: ${err?.message ?? String(err)}`)
      if (writers) {
        writeLine(writers.all, { _source: { name: recipe.name, recipeId: recipe.recipeId }, _apiError: String(err?.message ?? err) })
        writeLine(writers.failed, {
          recipe: { _source: { name: recipe.name, recipeId: recipe.recipeId } },
          errors: [{ code: 'API_ERROR', message: String(err?.message ?? err) }],
          warnings: [],
        })
      }
      continue
    }

    const jsonText = extractJson(rawText)
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch (err: any) {
      failed++
      console.log(`JSON_PARSE_ERROR: ${err?.message ?? String(err)}`)
      if (writers) {
        writeLine(writers.all, { _source: { name: recipe.name, recipeId: recipe.recipeId }, _raw: rawText })
        writeLine(writers.failed, {
          recipe: { _source: { name: recipe.name, recipeId: recipe.recipeId }, _raw: rawText },
          errors: [{ code: 'JSON_PARSE_ERROR', message: String(err?.message ?? err) }],
          warnings: [],
        })
      }
      continue
    }

    // Schema validate (loose: accepts string ingredientRefs)
    const schemaResult = regenRecipeSchema.safeParse(parsed)
    if (!schemaResult.success) {
      failed++
      const issues = schemaResult.error.issues.map(iss => ({
        code: 'SCHEMA_INVALID',
        message: `${iss.path.join('.')}: ${iss.message}`,
      }))
      console.log(`SCHEMA_INVALID (${issues.length} issue${issues.length === 1 ? '' : 's'})`)
      if (writers) {
        const annotated = { ...(parsed as object), _source: { name: recipe.name, recipeId: recipe.recipeId } }
        writeLine(writers.all, annotated)
        writeLine(writers.failed, { recipe: annotated, errors: issues, warnings: [] })
      }
      continue
    }

    const regenRecipe = schemaResult.data
    const annotated = { ...regenRecipe, _source: { name: recipe.name, recipeId: recipe.recipeId } }

    // Lint
    const lintInput = toLintInput(regenRecipe)
    const lintResult = lintRecipe(lintInput, { ingredientCatalog: catalog })

    if (args.dryRun) {
      console.log(lintResult.ok ? 'OK (dry-run, lint passed)' : `FAIL (dry-run, ${lintResult.errors.length} errors)`)
      console.log(JSON.stringify(annotated, null, 2))
      continue
    }

    // Always write to regen.jsonl
    writeLine(writers!.all, annotated)

    if (lintResult.ok) {
      passed++
      writeLine(writers!.passed, annotated)
      console.log(`OK ${recipe.name} (passed${lintResult.warnings.length > 0 ? `, ${lintResult.warnings.length} warning${lintResult.warnings.length === 1 ? '' : 's'}` : ''})`)
    } else {
      failed++
      writeLine(writers!.failed, {
        recipe: annotated,
        errors: lintResult.errors,
        warnings: lintResult.warnings,
      })
      console.log(`FAIL ${recipe.name} (${lintResult.errors.length} error${lintResult.errors.length === 1 ? '' : 's'})`)
    }
  }

  if (writers) {
    await writers.close()
  }

  console.log('')
  console.log(`Passed: ${passed} | Failed: ${failed} | Total: ${oldRecipes.length}`)
  if (!args.dryRun) {
    console.log('')
    console.log(`Curator review:`)
    console.log(`  ${path.join(OUTPUT_DIR, 'regen.jsonl')}        — every output (one line per recipe)`)
    console.log(`  ${path.join(OUTPUT_DIR, 'regen-passed.jsonl')} — outputs that passed lint`)
    console.log(`  ${path.join(OUTPUT_DIR, 'regen-failed.jsonl')} — outputs that failed (with errors and warnings)`)
  }
}

main()
  .catch(err => {
    console.error('[regen] Fatal:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await pool.end().catch(() => undefined)
  })
