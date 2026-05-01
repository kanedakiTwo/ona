/**
 * Recipe lint validator — single source of truth for recipe data integrity.
 *
 * Used by:
 *   - the recipe save endpoint (POST/PUT /recipes)
 *   - the photo-extraction pipeline (POST /recipes/extract-from-image)
 *   - the LLM seed regeneration script (apps/api/scripts/regenerateRecipes.ts)
 *
 * The validator is **pure**: it does not touch the DB. The caller is expected
 * to query the ingredient catalog and pass it in via {@link LintOptions}.
 *
 * Performance budget: < 50 ms for a 30-ingredient recipe (see specs/recipe-quality.md).
 */

import {
  DIFFICULTIES,
  MEALS,
  SEASONS,
  type Difficulty,
  type Meal,
  type Season,
  type Unit,
  type NutritionPerServing,
} from '@ona/shared'
import { INGREDIENT_RANGES, globalCeiling, type QuantityRange } from './recipeLint.ranges.js'

// ─── Public types ────────────────────────────────────────────────

/** A single ingredient row on a recipe, post-id-mint. */
export interface RecipeIngredientLintInput {
  id: string
  ingredientId: string
  section?: string
  quantity: number
  unit: Unit
  optional?: boolean
  note?: string
  displayOrder?: number
}

/** A single step on a recipe. */
export interface RecipeStepLintInput {
  index: number
  text: string
  durationMin?: number | null
  temperature?: number | null
  technique?: string
  ingredientRefs?: string[]
}

/**
 * The shape lint validates: the write shape ({@link createRecipeSchema})
 * with `RecipeIngredient.id` already minted, plus optional `nutritionPerServing`
 * (passed by the regeneration pipeline; absent for normal saves).
 */
export interface RecipeInput {
  name?: string | null
  servings?: number | null
  prepTime?: number | null
  cookTime?: number | null
  difficulty?: Difficulty
  meals?: Meal[]
  seasons?: Season[]
  equipment?: string[]
  tags?: string[]
  internalTags?: string[]
  ingredients: RecipeIngredientLintInput[]
  steps: RecipeStepLintInput[]
  nutritionPerServing?: NutritionPerServing | null
}

/** Catalog rows passed in by the caller; the validator never queries the DB. */
export interface CatalogIngredient {
  id: string
  name: string
  allergenTags?: string[]
  fdcId?: number | null
  density?: number | null
  unitWeight?: number | null
}

export interface LintOptions {
  ingredientCatalog: CatalogIngredient[]
  /** When true, suppresses QUANTITY_OUT_OF_RANGE errors. Other rules are unaffected. */
  force?: boolean
}

export interface LintIssue {
  /** Stable, machine-readable code (e.g. 'STEP_INGREDIENT_NOT_LISTED'). */
  code: string
  /** Spanish, surfaced to the user. */
  message: string
  /** Dot-path into the recipe shape, e.g. 'steps[3].text' or 'ingredients[0]'. */
  path?: string
}

export interface LintResult {
  /** false if any blocking error fired (after applying force-overrides). */
  ok: boolean
  errors: LintIssue[]
  warnings: LintIssue[]
}

// ─── Normalization & fuzzy match helpers ─────────────────────────

/** Lowercase, strip diacritics, trim, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .replace(/ñ/g, 'n')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Trivial Spanish noun stem: drop common plural / gender suffixes. */
export function stem(word: string): string {
  const w = word
  if (w.length > 4) {
    if (w.endsWith('es')) return w.slice(0, -2)
    if (w.endsWith('as') || w.endsWith('os')) return w.slice(0, -2)
    if (w.endsWith('a') || w.endsWith('o')) return w.slice(0, -1)
  }
  if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1)
  return w
}

/** Iterative Levenshtein distance — pure TS, no deps. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Two-row DP keeps memory at O(min(a, b))
  const m = a.length
  const n = b.length
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1
      const del = prev[j] + 1
      const ins = curr[j - 1] + 1
      const sub = prev[j - 1] + cost
      curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[n]
}

/** Match threshold: ≤ 1 for short tokens, ≤ 2 otherwise. */
function isFuzzyMatch(a: string, b: string): boolean {
  if (a === b) return true
  const len = Math.max(a.length, b.length)
  const threshold = len <= 5 ? 1 : 2
  return levenshtein(a, b) <= threshold
}

/**
 * Tokenize a normalized step text into a list of word tokens (length ≥ 2)
 * plus their stems. Punctuation is split out.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2)
}

/**
 * Catalog index built once per lint call. Maps normalized name → catalog row,
 * and pre-computes token sets for cheap step-text matching.
 */
interface IndexedCatalogRow {
  row: CatalogIngredient
  normName: string
  nameTokens: string[]
  nameStems: string[]
}

interface CatalogIndex {
  byId: Map<string, CatalogIngredient>
  /** Same map as byId but pointing at the pre-tokenized representation. */
  indexedById: Map<string, IndexedCatalogRow>
  /** All catalog rows with their normalized name & stem-token list. */
  rows: IndexedCatalogRow[]
}

function buildCatalogIndex(catalog: CatalogIngredient[]): CatalogIndex {
  const byId = new Map<string, CatalogIngredient>()
  const indexedById = new Map<string, IndexedCatalogRow>()
  const rows: IndexedCatalogRow[] = []
  for (const row of catalog) {
    byId.set(row.id, row)
    const normName = normalize(row.name)
    const tokens = tokenize(normName)
    const indexed: IndexedCatalogRow = {
      row,
      normName,
      nameTokens: tokens,
      nameStems: tokens.map(stem),
    }
    indexedById.set(row.id, indexed)
    rows.push(indexed)
  }
  return { byId, indexedById, rows }
}

/**
 * Does the step text mention this catalog ingredient?
 *
 * Order of preference:
 *   1. Full normalized name appears as a substring of the normalized text
 *   2. Single-token name fuzzy-matches some token (or its stem) in the text
 *   3. Two-token name fuzzy-matches some bigram in the text
 */
function stepMentionsIngredient(
  textTokens: string[],
  textStems: string[],
  fullNormalizedText: string,
  cat: CatalogIndex['rows'][number]
): boolean {
  if (cat.normName.length === 0) return false
  // Full-name substring at word boundaries (cheap and precise; avoids "sal"
  // matching inside "saltea")
  if (cat.nameTokens.length >= 2 && containsWholePhrase(fullNormalizedText, cat.normName)) return true

  if (cat.nameTokens.length === 1) {
    const target = cat.nameTokens[0]
    const targetStem = cat.nameStems[0]
    for (let i = 0; i < textTokens.length; i++) {
      if (isFuzzyMatch(textTokens[i], target)) return true
      if (isFuzzyMatch(textStems[i], targetStem)) return true
    }
    return false
  }

  if (cat.nameTokens.length === 2) {
    const [a, b] = cat.nameTokens
    for (let i = 0; i < textTokens.length - 1; i++) {
      if (isFuzzyMatch(textTokens[i], a) && isFuzzyMatch(textTokens[i + 1], b)) return true
    }
    return false
  }

  // Names with 3+ tokens: rely on whole-phrase substring (already checked above).
  return false
}

/** Substring containment, but only at word boundaries (start/end or whitespace-flanked). */
function containsWholePhrase(haystack: string, needle: string): boolean {
  if (!needle) return false
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) return false
    const before = idx === 0 ? ' ' : haystack[idx - 1]
    const after = idx + needle.length >= haystack.length ? ' ' : haystack[idx + needle.length]
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true
    from = idx + 1
  }
}

// ─── Time-hint regex (Spanish) ──────────────────────────────────

const TIME_HINT_RE = /(\d+)\s*(min(uto)?s?|hora|horas|h)\b|media\s+hora/i

// ─── Validator ──────────────────────────────────────────────────

const ML_OR_G: ReadonlySet<Unit> = new Set<Unit>(['g', 'ml'])

export function lintRecipe(recipe: RecipeInput, opts: LintOptions): LintResult {
  const errors: LintIssue[] = []
  const warnings: LintIssue[] = []

  const catalog = buildCatalogIndex(opts.ingredientCatalog ?? [])

  // 1. MISSING_NAME
  if (!recipe.name || recipe.name.trim().length === 0) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'La receta necesita un nombre.',
      path: 'name',
    })
  }

  // 2. MISSING_SERVINGS
  if (recipe.servings == null || !Number.isFinite(recipe.servings) || recipe.servings < 1) {
    errors.push({
      code: 'MISSING_SERVINGS',
      message: 'Indica cuántas raciones rinde la receta (mínimo 1).',
      path: 'servings',
    })
  }

  // 3. NO_INGREDIENTS
  const ingredients = recipe.ingredients ?? []
  if (ingredients.length === 0) {
    errors.push({
      code: 'NO_INGREDIENTS',
      message: 'La receta debe tener al menos un ingrediente.',
      path: 'ingredients',
    })
  }

  // 4. NO_STEPS
  const steps = recipe.steps ?? []
  if (steps.length === 0) {
    errors.push({
      code: 'NO_STEPS',
      message: 'La receta debe tener al menos un paso.',
      path: 'steps',
    })
  }

  // Pre-compute per-step token data once (used by rule 5 and rule 6).
  const stepData = steps.map(step => {
    const fullNorm = normalize(step.text ?? '')
    const tokens = tokenize(fullNorm)
    const stems = tokens.map(stem)
    return { step, fullNorm, tokens, stems }
  })

  // Set of catalog ingredient ids attached to this recipe.
  const recipeIngredientIds = new Set(ingredients.map(i => i.ingredientId))

  // Map recipe-ingredient row id → its catalog ingredient id (for ingredientRefs lookup).
  const rowIdToCatalogId = new Map<string, string>()
  for (const ing of ingredients) {
    rowIdToCatalogId.set(ing.id, ing.ingredientId)
  }

  // 5. STEP_INGREDIENT_NOT_LISTED
  // For each step, detect catalog ingredients mentioned in the text. If any
  // mentioned ingredient is not in this recipe (by ingredientId) AND not in
  // step.ingredientRefs (resolved through the row id → catalog id map), error.
  steps.forEach((step, i) => {
    const data = stepData[i]
    if (!data) return
    const refsCatalogIds = new Set<string>()
    for (const ref of step.ingredientRefs ?? []) {
      const catId = rowIdToCatalogId.get(ref)
      if (catId) refsCatalogIds.add(catId)
    }
    for (const cat of catalog.rows) {
      if (!stepMentionsIngredient(data.tokens, data.stems, data.fullNorm, cat)) continue
      if (recipeIngredientIds.has(cat.row.id)) continue
      if (refsCatalogIds.has(cat.row.id)) continue
      errors.push({
        code: 'STEP_INGREDIENT_NOT_LISTED',
        message: `El paso ${i + 1} menciona "${cat.row.name}" pero no aparece en los ingredientes ni está vinculado.`,
        path: `steps[${i}].text`,
      })
    }
  })

  // 6. ORPHAN_INGREDIENT
  // For each non-optional ingredient: must be mentioned by name in some step
  // OR referenced by some step's ingredientRefs.
  const refdRowIds = new Set<string>()
  for (const step of steps) {
    for (const ref of step.ingredientRefs ?? []) refdRowIds.add(ref)
  }
  ingredients.forEach((ing, i) => {
    if (ing.optional) return
    if (refdRowIds.has(ing.id)) return
    const indexedRow = catalog.indexedById.get(ing.ingredientId)
    if (!indexedRow) {
      // Unknown catalog ingredient — can't fuzzy-match. We can still surface as orphan.
      errors.push({
        code: 'ORPHAN_INGREDIENT',
        message: `El ingrediente #${i + 1} no se menciona en ningún paso.`,
        path: `ingredients[${i}]`,
      })
      return
    }
    let mentioned = false
    for (const data of stepData) {
      if (stepMentionsIngredient(data.tokens, data.stems, data.fullNorm, indexedRow)) {
        mentioned = true
        break
      }
    }
    if (!mentioned) {
      errors.push({
        code: 'ORPHAN_INGREDIENT',
        message: `El ingrediente "${indexedRow.row.name}" no se menciona en ningún paso.`,
        path: `ingredients[${i}]`,
      })
    }
  })

  // 7. QUANTITY_OUT_OF_RANGE — only g/ml; force bypasses
  if (recipe.servings && recipe.servings >= 1) {
    ingredients.forEach((ing, i) => {
      if (!ML_OR_G.has(ing.unit)) return
      const cat = catalog.byId.get(ing.ingredientId)
      const perServing = ing.quantity / recipe.servings!
      const range = pickRange(cat?.name)
      const max = range?.maxPerServingG ?? globalCeiling
      const min = range?.minPerServingG ?? 0
      if (perServing > max || perServing < min) {
        if (!opts.force) {
          const label = cat?.name ?? `ingrediente #${i + 1}`
          errors.push({
            code: 'QUANTITY_OUT_OF_RANGE',
            message: `La cantidad de "${label}" (${perServing.toFixed(0)} ${ing.unit} por ración) está fuera del rango razonable (${min}-${max} ${ing.unit}).`,
            path: `ingredients[${i}]`,
          })
        }
      }
    })
  }

  // 8. STEP_REF_DANGLING
  steps.forEach((step, i) => {
    const refs = step.ingredientRefs ?? []
    refs.forEach((ref, j) => {
      if (!rowIdToCatalogId.has(ref)) {
        errors.push({
          code: 'STEP_REF_DANGLING',
          message: `El paso ${i + 1} referencia un ingrediente que no existe en la receta.`,
          path: `steps[${i}].ingredientRefs[${j}]`,
        })
      }
    })
  })

  // 9. TIME_INCONSISTENT
  if (
    recipe.prepTime != null &&
    recipe.cookTime != null &&
    steps.length > 0 &&
    steps.every(s => s.durationMin != null)
  ) {
    const sum = steps.reduce((acc, s) => acc + (s.durationMin ?? 0), 0)
    const budget = recipe.prepTime + recipe.cookTime
    if (sum > budget * 1.2) {
      errors.push({
        code: 'TIME_INCONSISTENT',
        message: `La suma de los pasos (${sum} min) supera prep+cook (${budget} min) en más de un 20%.`,
        path: 'steps',
      })
    }
  }

  // 10. TAG_LEAK_PUBLIC
  const reservedLeak = new Set<string>([
    ...MEALS.map(m => m.toLowerCase()),
    ...SEASONS.map(s => s.toLowerCase()),
    ...DIFFICULTIES.map(d => d.toLowerCase()),
    ...(recipe.internalTags ?? []).map(t => t.toLowerCase()),
  ])
  ;(recipe.tags ?? []).forEach((tag, i) => {
    if (reservedLeak.has(tag.toLowerCase())) {
      errors.push({
        code: 'TAG_LEAK_PUBLIC',
        message: `El tag público "${tag}" colisiona con un valor reservado (comida, estación, dificultad o tag interno).`,
        path: `tags[${i}]`,
      })
    }
  })

  // ─── Warnings ──────────────────────────────────────────────────

  // NUTRITION_GAP — ingredient row references catalog row lacking fdcId
  ingredients.forEach((ing, i) => {
    const cat = catalog.byId.get(ing.ingredientId)
    if (!cat) return
    if (cat.fdcId == null) {
      warnings.push({
        code: 'NUTRITION_GAP',
        message: `"${cat.name}" no tiene mapeo de USDA (fdcId); la nutrición será incompleta.`,
        path: `ingredients[${i}]`,
      })
    }
  })

  // MISSING_DENSITY_FOR_ML
  ingredients.forEach((ing, i) => {
    if (ing.unit !== 'ml') return
    const cat = catalog.byId.get(ing.ingredientId)
    if (!cat) return
    if (cat.density == null) {
      warnings.push({
        code: 'MISSING_DENSITY_FOR_ML',
        message: `"${cat.name}" se usa en ml pero no tiene densidad; no se podrá convertir a gramos.`,
        path: `ingredients[${i}]`,
      })
    }
  })

  // KCAL_OUT_OF_BAND
  if (recipe.nutritionPerServing && typeof recipe.nutritionPerServing.kcal === 'number') {
    const kcal = recipe.nutritionPerServing.kcal
    if (kcal < 150 || kcal > 1500) {
      warnings.push({
        code: 'KCAL_OUT_OF_BAND',
        message: `La receta tiene ${kcal.toFixed(0)} kcal por ración; revisa cantidades (rango razonable: 150–1500).`,
        path: 'nutritionPerServing.kcal',
      })
    }
  }

  // STEP_HAS_TIME_HINT_NO_DURATION
  steps.forEach((step, i) => {
    if (step.durationMin != null) return
    if (TIME_HINT_RE.test(step.text ?? '')) {
      warnings.push({
        code: 'STEP_HAS_TIME_HINT_NO_DURATION',
        message: `El paso ${i + 1} contiene una pista de tiempo; añade durationMin.`,
        path: `steps[${i}].durationMin`,
      })
    }
  })

  // NO_EQUIPMENT
  if (!recipe.equipment || recipe.equipment.length === 0) {
    warnings.push({
      code: 'NO_EQUIPMENT',
      message: 'La receta no lista ningún utensilio. Considera añadir al menos uno.',
      path: 'equipment',
    })
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}

/** Look up a sanity range by ingredient name, normalized. */
function pickRange(name: string | undefined): QuantityRange | undefined {
  if (!name) return undefined
  const norm = normalize(name)
  if (INGREDIENT_RANGES[norm]) return INGREDIENT_RANGES[norm]
  // Fallback: match against the first whitespace-separated token (e.g. "pollo de corral" → "pollo")
  const first = norm.split(' ')[0]
  if (first && INGREDIENT_RANGES[first]) return INGREDIENT_RANGES[first]
  return undefined
}
