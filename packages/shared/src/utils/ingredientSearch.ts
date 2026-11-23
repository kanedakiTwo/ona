/**
 * Ingredient search without case or accents (2026-11-10). The recipe form's
 * picker sent what the user typed straight into a case-sensitive SQL LIKE:
 * "Tomate" found nothing (the catalogue says "tomate"), "brocoli" missed
 * "brócoli", and the form then offered to create a duplicate.
 *
 * `foldIngredientName` is the one rule both sides use: the API folds the
 * search term with it and folds the column in SQL with `translate()` over
 * FOLD_FROM (apps/api/src/services/ingredientSearch.ts); the form uses it to
 * decide whether what was typed already exists.
 */

/** Accented letters the SQL side folds (translate + lower). Each one folds to exactly one plain letter. */
export const FOLD_FROM = 'áéíóúüñàèìòùâêîôûäëïöçÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖÇ'

/** Lowercase, no accents (ñ → n, as the SQL side does), single spaces, trimmed. */
export function foldIngredientName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Does `results` already hold what was typed (same name once folded)? Then the form doesn't offer to create it. */
export function hasSameIngredientName(results: ReadonlyArray<{ name: string }>, typed: string): boolean {
  const t = foldIngredientName(typed)
  return t.length > 0 && results.some((r) => foldIngredientName(r.name) === t)
}
