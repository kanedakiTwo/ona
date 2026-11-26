/**
 * `GET /recipes?search=` (2026-11-25, specs/recipes.md): every searched word
 * must be in the name, in any order, without case or accents (ñ = n); empty
 * words («con», «de», «a la»…) don't count. Same rule as `matchesRecipeSearch`
 * in @ona/shared, which the web uses to filter on the client.
 */
import { and, sql, type SQL } from 'drizzle-orm'
import { foldIngredientName, recipeSearchWords } from '@ona/shared'
import { recipes } from '../db/schema.js'
import { escapeLike, foldedColumn } from './ingredientSearch.js'

const foldedName = foldedColumn(recipes.name)

/** The filter for a search, or null when it has no words (no filter). */
export function recipeNameSearch(raw: string): SQL | null {
  const words = recipeSearchWords(raw)
  if (words.length === 0) return null
  return and(...words.map((w) => sql`${foldedName} like ${`%${escapeLike(w)}%`} escape '\\'`)) ?? null
}

/** The name contains the text, without case or accents (Mimo's name lookups; before, an `ilike` with accents). */
export function recipeNameContains(text: string): SQL {
  return sql`${foldedName} like ${`%${escapeLike(foldIngredientName(text))}%`} escape '\\'`
}
