/**
 * Recipe search by name (2026-11-25). `GET /recipes?search=` was a plain
 * substring of the whole text: «chuletón» found «Chuletón de ternera a la
 * plancha con patatas», but «chuleton» or «Chuletón con patatas» found nothing.
 *
 * The rule, the same on the API (SQL, apps/api/src/services/recipeSearch.ts)
 * and in the web's client-side filters:
 *   - no case, no accents, ñ = n (`foldIngredientName`, the ingredient search's fold);
 *   - each word on its own, in any order, and every word must be in the name
 *     (inside a word too, so «patat» finds «patatas» while typing);
 *   - empty words («con», «de», «a la»…) don't count;
 *   - names that start with a searched word go first.
 */
import { foldIngredientName } from './ingredientSearch.js'

/** Words that don't count in a search («chuletón con patatas» = «chuletón patatas»). «sin» counts: «sin gluten». */
export const RECIPE_SEARCH_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'al', 'con', 'de', 'del', 'e', 'el', 'en', 'la', 'las', 'lo', 'los', 'o', 'u', 'un', 'una', 'unos', 'unas', 'y', 'para', 'por',
])

/** The folded words a search looks for. Only empty words → those words (searching «con» still searches). */
export function recipeSearchWords(raw: string): string[] {
  const all = foldIngredientName(raw ?? '').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const words = all.filter((w) => !RECIPE_SEARCH_STOPWORDS.has(w))
  return [...new Set(words.length > 0 ? words : all)]
}

/** Does the recipe name match the search? An empty search matches everything. */
export function matchesRecipeSearch(name: string, raw: string): boolean {
  const words = recipeSearchWords(raw)
  if (words.length === 0) return true
  const n = foldIngredientName(name ?? '')
  return words.every((w) => n.includes(w))
}

/** 0 when the name starts with one of the searched words, else 1 (sort ascending, stable). */
export function recipeSearchRank(name: string, raw: string): 0 | 1 {
  const n = foldIngredientName(name ?? '')
  return recipeSearchWords(raw).some((w) => n.startsWith(w)) ? 0 : 1
}
