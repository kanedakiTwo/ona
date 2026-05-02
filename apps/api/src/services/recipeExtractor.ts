import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { ingredients } from '../db/schema.js'
import { suggestIngredient } from './ingredientAutoCreate.js'
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
  prepTime: number | null
  cookTime?: number | null
  servings?: number | null
  difficulty?: string | null
  ingredients: { name: string; quantity: number; unit: string }[]
  steps: string[]
  suggestedMeals: string[]
  suggestedSeasons: string[]
  tags: string[]
}

export interface VisionProvider {
  extractRecipe(imageBase64: string, mimeType: string): Promise<RawExtractedRecipe>
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

async function matchIngredients(
  rawIngredients: { name: string; quantity: number; unit: string }[],
): Promise<{ matched: ExtractedIngredient[]; warnings: string[] }> {
  const allIngredients = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)

  const matched: ExtractedIngredient[] = []
  const warnings: string[] = []

  for (const ext of rawIngredients) {
    const normalized = ext.name.toLowerCase().trim()

    let match = allIngredients.find((i) => i.name.toLowerCase() === normalized)

    if (!match) {
      match = allIngredients.find(
        (i) =>
          normalized.includes(i.name.toLowerCase()) ||
          i.name.toLowerCase().includes(normalized),
      )
    }

    if (!match) {
      const firstWord = normalized.split(' ')[0]
      if (firstWord.length >= 3) {
        match = allIngredients.find((i) => i.name.toLowerCase().startsWith(firstWord))
      }
    }

    let { quantity } = ext
    const lowerUnit = (ext.unit ?? '').toLowerCase()
    if (lowerUnit === 'kg' || lowerUnit === 'l') quantity = quantity * 1000

    if (!match) {
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
        })
        continue
      }
    }

    matched.push({
      extractedName: ext.name,
      ingredientId: match?.id ?? null,
      ingredientName: match?.name ?? null,
      quantity,
      unit: coerceUnit(ext.unit),
      matched: !!match,
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

  return {
    name: raw.name,
    servings: raw.servings ?? null,
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
