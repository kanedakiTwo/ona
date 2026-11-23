/**
 * GET /ingredients?search= without case or accents (2026-11-10): "Tomate" finds "tomate", "brocoli" finds "brócoli",
 * "Romanescu" and "romanescu" find each other. Before, a plain `LIKE '%Tomate%'` found nothing and the recipe form
 * offered to create a duplicate.
 *
 * The column is folded in SQL with the same rule as the term (`foldIngredientName` in @ona/shared): translate() over
 * FOLD_FROM, lower(), single spaces. Results rank the exact name first, then names that start with the term, then
 * those with a word that starts with it, then the rest; so "sal" shows "sal" before "agua con sal".
 */
import { sql, type SQL } from 'drizzle-orm'
import { FOLD_FROM, foldIngredientName } from '@ona/shared'
import { ingredients } from '../db/schema.js'

/** FOLD_FROM letter by letter without its accent (case kept: lower() comes after). */
export const FOLD_TO = [...FOLD_FROM].map((c) => c.normalize('NFD').replace(/\p{Diacritic}+/gu, '')).join('')

/** The term goes inside a LIKE pattern: its own %, _ and \ are literal. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

const folded = sql`btrim(regexp_replace(lower(translate(${ingredients.name}, ${FOLD_FROM}, ${FOLD_TO})), '\\s+', ' ', 'g'))`

/** The filter and the ranking for a search term, or null when the term folds to nothing (no filter). */
export function ingredientSearch(raw: string): { term: string; where: SQL; rank: SQL } | null {
  const term = foldIngredientName(raw)
  if (!term) return null
  const t = escapeLike(term)
  return {
    term,
    where: sql`${folded} like ${`%${t}%`} escape '\\'`,
    rank: sql`case when ${folded} = ${term} then 0 when ${folded} like ${`${t}%`} escape '\\' then 1 when ${folded} like ${`% ${t}%`} escape '\\' then 2 else 3 end`,
  }
}
