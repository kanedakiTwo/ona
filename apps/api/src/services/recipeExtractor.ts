import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { ingredients } from '../db/schema.js'
import { suggestIngredient } from './ingredientAutoCreate.js'
import { tokenSetMatch } from './ingredientTokenMatch.js'
import { disambiguateIngredients } from './ingredientMatcherLLM.js'
import { inferAllergenTagsFromName } from './nutrition/allergens.js'
import type {
  ExtractedRecipe,
  ExtractedIngredient,
  Difficulty,
  Meal,
  Season,
  Unit,
} from '@ona/shared'
import { UNITS } from '@ona/shared'

// ─── Provider interface (swap implementation to change AI backend) ───
export interface RawExtractedRecipe {
  name: string
  /** Source image URL captured by the extractor (schema.org Recipe.image,
   * og:image, twitter:image, or YouTube thumbnail). Null when the source
   * provided nothing usable. The URL importer's route handler persists this
   * directly into `recipes.image_url`; users can later swap it with the
   * "Regenerar imagen" endpoint per the recipes spec. */
  imageUrl?: string | null
  prepTime: number | null
  cookTime?: number | null
  servings?: number | null
  /** Confidence level for the servings value. Optional — the extractor entry
   * points harden it to a non-null value before producing ExtractedRecipe. */
  servingsConfidence?: 'explicit' | 'estimated' | null
  difficulty?: string | null
  ingredients: {
    name: string
    quantity: number
    unit: string
    /** Human-readable quantity as extracted (e.g. 2 for "2 cda"). Null when no
     * display conversion applies (unit was already canonical). */
    displayQuantity?: number | null
    /** Human-readable unit label as extracted (e.g. "cda"). Null when no
     * display conversion applies. */
    displayUnit?: string | null
  }[]
  steps: string[]
  suggestedMeals: string[]
  suggestedSeasons: string[]
  tags: string[]
}

export interface VisionProvider {
  extractRecipe(imageBase64: string, mimeType: string): Promise<RawExtractedRecipe>
}

/**
 * Hint passed to the text-based extractor so the model can prefer cantidades
 * stated in the spoken transcript over those in the description, etc.
 */
export type TextExtractionHint = 'youtube' | 'article'

/**
 * Result of asking the LLM to extract a recipe from a text payload (article
 * body / YouTube transcript). When `isRecipe` is false, the input did not
 * describe a cookable recipe and `reason` carries a short Spanish explanation
 * for the user.
 */
export type TextExtractionResult =
  | { isRecipe: true; raw: RawExtractedRecipe }
  | { isRecipe: false; reason: string }

export interface TextExtractionProvider {
  extractRecipeFromText(
    text: string,
    hint: TextExtractionHint,
  ): Promise<TextExtractionResult>
}

const VALID_UNITS = new Set<string>(UNITS as readonly string[])
const VALID_DIFFICULTIES = new Set<string>(['easy', 'medium', 'hard'])

/**
 * Map a raw unit string (possibly legacy: "kg", "ud", "cdta") to the canonical
 * `Unit` enum. Falls back to `'g'` for unknown units (the lint validator will
 * eventually flag any nonsensical resulting quantity).
 */
function coerceUnit(raw: string): Unit {
  const norm = (raw ?? '').trim().toLowerCase()
  if (VALID_UNITS.has(norm)) return norm as Unit
  // Common synonyms surfaced by the LLM prompt.
  if (norm === 'kg') return 'g'
  if (norm === 'l') return 'ml'
  if (norm === 'ud' || norm === 'unidad' || norm === 'unidades') return 'u'
  if (norm === 'cdta') return 'cdita'
  return 'g'
}

// ─── Ingredient matching ────────────────────────────────────────────

/**
 * For an unmatched ingredient name, ask USDA for the best Foundation
 * candidate and persist a new row. On any USDA failure (network, no
 * matches, rate limit) fall back to a stub row with allergens inferred
 * from the name and zero nutrition. Returns null only if the DB write
 * itself fails.
 */
async function autoCreateMissingIngredient(
  rawName: string,
): Promise<{ id: string; name: string; warning?: string } | null> {
  const trimmed = rawName.trim()
  if (!trimmed) return null

  let bestFdcId: number | null = null
  let nutrition = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, saltG: 0 }
  let warning: string | undefined

  try {
    const suggestion = await suggestIngredient(trimmed, { limit: 3 })
    const top = suggestion.candidates.find(
      (c) => c.dataType === 'Foundation' || c.dataType === 'SR Legacy',
    ) ?? suggestion.candidates[0]
    if (top) {
      bestFdcId = top.fdcId
      nutrition = top.per100g
    } else {
      warning = `Sin coincidencias USDA para "${trimmed}"; guardado como stub.`
    }
  } catch (err) {
    warning = `USDA no disponible para "${trimmed}"; guardado como stub.`
    console.warn('[extractor] auto-create suggest failed:', err)
  }

  try {
    const [row] = await db
      .insert(ingredients)
      .values({
        name: trimmed,
        fdcId: bestFdcId,
        aisle: null,
        allergenTags: inferAllergenTagsFromName(trimmed),
        calories: nutrition.kcal,
        protein: nutrition.proteinG,
        carbs: nutrition.carbsG,
        fat: nutrition.fatG,
        fiber: nutrition.fiberG,
        salt: nutrition.saltG,
      })
      .returning({ id: ingredients.id, name: ingredients.name })
    return { id: row.id, name: row.name, warning }
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === '23505') {
      const [hit] = await db
        .select({ id: ingredients.id, name: ingredients.name })
        .from(ingredients)
        .where(eq(ingredients.name, trimmed))
        .limit(1)
      if (hit) return { id: hit.id, name: hit.name }
    }
    console.error('[extractor] auto-create insert failed:', err)
    return null
  }
}

/**
 * Resolve raw extracted ingredient names to the catalog. Three-stage cascade,
 * each stage is the previous one's fallback:
 *
 *   1. Pure token-set match (`ingredientTokenMatch.ts`): exact, then
 *      noise-stripped (cooking-state modifiers like "picada" / "fresca"
 *      removed), then user-generic (user typed less specific than the
 *      catalogue). NEVER collapses meaning — refuses anything where the
 *      user's input carries semantic content the catalogue lacks (the
 *      "pechuga de pollo" → "pollo" trap).
 *
 *   2. LLM disambiguation (`ingredientMatcherLLM.ts`): a single batched
 *      Claude call per import sees every leftover name + the full
 *      catalogue + the recipe title. Resolves genuine aliases that the
 *      token matcher can't see ("chuletón" → "chuleta de vaca",
 *      "pimentón dulce de la vera" → "pimentón dulce"). LLM is
 *      explicitly instructed to refuse part-of-animal collapses; on any
 *      failure (no API key, network, malformed JSON) it returns an empty
 *      verdict map and we fall through.
 *
 *   3. USDA auto-create (`ingredientAutoCreate.ts`): the existing
 *      Foundation/SR-Legacy lookup with Spanish↦English translation
 *      ingests the missing ingredient with full nutrition + allergens.
 *      The first time "pechuga de pollo" comes through it lands as a
 *      brand-new catalogue row; subsequent imports hit stage 1 directly.
 *
 * `displayQuantity` and `displayUnit` are passive fields that ride
 * through unmodified — none of the three stages touches them. Used by
 * both the photo extractor and the URL extractor.
 *
 * Optional `recipeName` improves LLM disambiguation accuracy by giving
 * it context (the same name "huevo" reads differently inside an aioli
 * recipe than in a sponge cake recipe).
 */
export async function matchIngredients(
  rawIngredients: {
    name: string
    quantity: number
    unit: string
    displayQuantity?: number | null
    displayUnit?: string | null
  }[],
  opts: { recipeName?: string } = {},
): Promise<{ matched: ExtractedIngredient[]; warnings: string[] }> {
  const allIngredients = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)

  const matched: ExtractedIngredient[] = []
  const warnings: string[] = []

  // ─── Stage 1: pure token-set match ───────────────────────────────
  // Resolve in two passes so we can collect every "no-match" and send
  // them to the LLM in a single batched call (one LLM round-trip per
  // recipe import, not per ingredient).
  interface PendingRow {
    ext: (typeof rawIngredients)[number]
    quantity: number
    resolved: { id: string; name: string } | null
  }
  const pending: PendingRow[] = []

  for (const ext of rawIngredients) {
    let { quantity } = ext
    const lowerUnit = (ext.unit ?? '').toLowerCase()
    if (lowerUnit === 'kg' || lowerUnit === 'l') quantity = quantity * 1000

    const verdict = tokenSetMatch(ext.name, allIngredients)
    let resolved: { id: string; name: string } | null = null
    if (verdict.kind !== 'no-match') {
      resolved = { id: verdict.catalog.id, name: verdict.catalog.name }
    }
    pending.push({ ext, quantity, resolved })
  }

  // ─── Stage 2: LLM disambiguation for the still-unmatched ─────────
  const stage2Targets = pending
    .filter((p) => p.resolved == null)
    .map((p) => ({ extractedName: p.ext.name }))

  if (stage2Targets.length > 0) {
    const { verdicts } = await disambiguateIngredients({
      recipeName: opts.recipeName,
      unmatched: stage2Targets,
      catalog: allIngredients,
    })
    for (const row of pending) {
      if (row.resolved != null) continue
      const v = verdicts.get(row.ext.name)
      if (v && v.kind === 'alias') {
        row.resolved = { id: v.ingredientId, name: v.ingredientName }
      }
    }
  }

  // ─── Stage 3: USDA auto-create for whatever's still unmatched ────
  for (const row of pending) {
    const { ext, quantity, resolved } = row

    if (resolved == null) {
      const created = await autoCreateMissingIngredient(ext.name)
      if (created) {
        allIngredients.push({ id: created.id, name: created.name })
        if (created.warning) warnings.push(created.warning)
        matched.push({
          extractedName: ext.name,
          ingredientId: created.id,
          ingredientName: created.name,
          quantity,
          unit: coerceUnit(ext.unit),
          matched: true,
          displayQuantity: ext.displayQuantity ?? null,
          displayUnit: ext.displayUnit ?? null,
        })
        continue
      }
    }

    matched.push({
      extractedName: ext.name,
      ingredientId: resolved?.id ?? null,
      ingredientName: resolved?.name ?? null,
      quantity,
      unit: coerceUnit(ext.unit),
      matched: !!resolved,
      displayQuantity: ext.displayQuantity ?? null,
      displayUnit: ext.displayUnit ?? null,
    })
  }

  return { matched, warnings }
}

// ─── Main extraction function ───────────────────────────────────────
const VALID_MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']
const VALID_SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter']

export async function extractRecipeFromImage(
  provider: VisionProvider,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<ExtractedRecipe> {
  const imageBase64 = imageBuffer.toString('base64')

  const raw = await provider.extractRecipe(imageBase64, mimeType)

  const { matched: matchedIngredients, warnings: matchWarnings } =
    await matchIngredients(raw.ingredients)

  const meals = raw.suggestedMeals.filter((m): m is Meal =>
    VALID_MEALS.includes(m as Meal),
  )
  const seasons = raw.suggestedSeasons.filter((s): s is Season =>
    VALID_SEASONS.includes(s as Season),
  )

  const unmatchedCount = matchedIngredients.filter((i) => !i.matched).length
  const warnings: string[] = [...matchWarnings]
  if (unmatchedCount > 0) {
    warnings.push(`${unmatchedCount} ingrediente(s) no encontrado(s) en la base de datos`)
  }

  const difficulty: Difficulty | null =
    raw.difficulty && VALID_DIFFICULTIES.has(raw.difficulty.toLowerCase())
      ? (raw.difficulty.toLowerCase() as Difficulty)
      : null

  // Harden servings: the provider already clamps, but re-apply here for safety
  // in case a custom provider omits it.
  let servings = raw.servings
  let servingsConfidence: 'explicit' | 'estimated' = raw.servingsConfidence ?? 'estimated'
  if (servings == null || !Number.isInteger(servings) || servings < 1) {
    servings = 4
    servingsConfidence = 'estimated'
  }
  if (servings > 12) {
    servings = 12
    servingsConfidence = 'estimated'
  }

  return {
    name: raw.name,
    servings,
    servingsConfidence,
    prepTime: raw.prepTime,
    cookTime: raw.cookTime ?? null,
    meals: meals.length > 0 ? meals : ['lunch', 'dinner'],
    seasons: seasons.length > 0 ? seasons : [...VALID_SEASONS],
    difficulty,
    tags: raw.tags,
    steps: raw.steps,
    ingredients: matchedIngredients,
    unmatchedCount,
    warnings,
  }
}
