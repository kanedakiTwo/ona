import { db } from '../db/connection.js'
import { ingredients } from '../db/schema.js'
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
async function matchIngredients(
  rawIngredients: { name: string; quantity: number; unit: string }[],
): Promise<ExtractedIngredient[]> {
  const allIngredients = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)

  return rawIngredients.map((ext) => {
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

    // Convert the kg → g and l → ml synonyms in quantity to keep the magnitude
    // sane. (The `coerceUnit` step alone would silently 1000× the recipe.)
    let { quantity } = ext
    const lowerUnit = (ext.unit ?? '').toLowerCase()
    if (lowerUnit === 'kg' || lowerUnit === 'l') quantity = quantity * 1000

    return {
      extractedName: ext.name,
      ingredientId: match?.id ?? null,
      ingredientName: match?.name ?? null,
      quantity,
      unit: coerceUnit(ext.unit),
      matched: !!match,
    }
  })
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

  const matchedIngredients = await matchIngredients(raw.ingredients)

  const meals = raw.suggestedMeals.filter((m): m is Meal =>
    VALID_MEALS.includes(m as Meal),
  )
  const seasons = raw.suggestedSeasons.filter((s): s is Season =>
    VALID_SEASONS.includes(s as Season),
  )

  const unmatchedCount = matchedIngredients.filter((i) => !i.matched).length
  const warnings: string[] = []
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
