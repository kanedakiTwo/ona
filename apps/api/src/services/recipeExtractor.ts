import { db } from '../db/connection.js'
import { ingredients } from '../db/schema.js'
import type { ExtractedRecipe, ExtractedIngredient, Meal, Season } from '@ona/shared'

// ─── Provider interface (swap implementation to change AI backend) ───
export interface RawExtractedRecipe {
  name: string
  prepTime: number | null
  ingredients: { name: string; quantity: number; unit: string }[]
  steps: string[]
  suggestedMeals: string[]
  suggestedSeasons: string[]
  tags: string[]
}

export interface VisionProvider {
  extractRecipe(imageBase64: string, mimeType: string): Promise<RawExtractedRecipe>
}

// ─── Ingredient matching ────────────────────────────────────────────
async function matchIngredients(
  rawIngredients: { name: string; quantity: number; unit: string }[]
): Promise<ExtractedIngredient[]> {
  const allIngredients = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)

  return rawIngredients.map((ext) => {
    const normalized = ext.name.toLowerCase().trim()

    // 1. Exact match (case-insensitive)
    let match = allIngredients.find(
      (i) => i.name.toLowerCase() === normalized
    )

    // 2. Containment: DB name inside extracted, or vice versa
    if (!match) {
      match = allIngredients.find(
        (i) =>
          normalized.includes(i.name.toLowerCase()) ||
          i.name.toLowerCase().includes(normalized)
      )
    }

    // 3. First word match (min 3 chars)
    if (!match) {
      const firstWord = normalized.split(' ')[0]
      if (firstWord.length >= 3) {
        match = allIngredients.find((i) =>
          i.name.toLowerCase().startsWith(firstWord)
        )
      }
    }

    return {
      extractedName: ext.name,
      ingredientId: match?.id ?? null,
      ingredientName: match?.name ?? null,
      quantity: ext.quantity,
      unit: ext.unit,
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
  mimeType: string
): Promise<ExtractedRecipe> {
  const imageBase64 = imageBuffer.toString('base64')

  const raw = await provider.extractRecipe(imageBase64, mimeType)

  const matchedIngredients = await matchIngredients(raw.ingredients)

  const meals = raw.suggestedMeals.filter((m): m is Meal =>
    VALID_MEALS.includes(m as Meal)
  )
  const seasons = raw.suggestedSeasons.filter((s): s is Season =>
    VALID_SEASONS.includes(s as Season)
  )

  const unmatchedCount = matchedIngredients.filter((i) => !i.matched).length
  const warnings: string[] = []
  if (unmatchedCount > 0) {
    warnings.push(
      `${unmatchedCount} ingrediente(s) no encontrado(s) en la base de datos`
    )
  }

  return {
    name: raw.name,
    prepTime: raw.prepTime,
    meals: meals.length > 0 ? meals : ['lunch', 'dinner'],
    seasons: seasons.length > 0 ? seasons : [...VALID_SEASONS],
    tags: raw.tags,
    steps: raw.steps,
    ingredients: matchedIngredients,
    unmatchedCount,
    warnings,
  }
}
