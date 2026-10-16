/**
 * Catalogue order and retired recipes (PRO-140, specs/recipes.md).
 *
 * Order of `GET /recipes` (signed in or not): most households with the
 * recipe in favourites first — the count is never shown and nothing is
 * filtered by it —; on a tie, Miguel's `FEATURED_RECIPES` in their order;
 * then the rest as before (oldest first).
 *
 * Retired: a system recipe with `retirada` in `internal_tags` is out of the
 * catalogue and of every automatic pick (menu, Mimo's suggestions), but still
 * opens by id for whoever has it in a menu, favourites or a cookbook.
 */
import { FEATURED_RECIPES, RETIRED_RECIPE_TAG } from '@ona/shared'

export function normalizeRecipeName(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}+/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

export function isRetiredRecipe(r: { authorId?: string | null; internalTags?: readonly string[] | null }): boolean {
  return r.authorId == null && (r.internalTags ?? []).includes(RETIRED_RECIPE_TAG)
}

export interface CatalogOrderRow {
  id: string
  name: string
  createdAt: Date | string | null
  /** Distinct households with it in favourites. */
  favoriteHouseholds: number
}

/** Pure: position in the featured list (by id, else by name), or Infinity. */
export function featuredRank(
  row: { id: string; name: string },
  featured: ReadonlyArray<{ id: string; name: string }> = FEATURED_RECIPES,
): number {
  const byId = featured.findIndex((f) => f.id === row.id)
  if (byId >= 0) return byId
  const n = normalizeRecipeName(row.name)
  const byName = featured.findIndex((f) => normalizeRecipeName(f.name) === n)
  return byName >= 0 ? byName : Number.POSITIVE_INFINITY
}

/** Pure: the catalogue order. Returns a new array. */
export function sortCatalog<T extends CatalogOrderRow>(
  rows: readonly T[],
  featured: ReadonlyArray<{ id: string; name: string }> = FEATURED_RECIPES,
): T[] {
  const time = (r: T) => (r.createdAt ? new Date(r.createdAt).getTime() : 0)
  return [...rows].sort(
    (a, b) =>
      b.favoriteHouseholds - a.favoriteHouseholds ||
      featuredRank(a, featured) - featuredRank(b, featured) ||
      time(a) - time(b) ||
      a.id.localeCompare(b.id),
  )
}
