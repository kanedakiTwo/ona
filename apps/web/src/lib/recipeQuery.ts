/** Query string of `GET /recipes` for the catalogue hooks (pure: also tested from the API suite). */
export interface RecipeFilters {
  search?: string
  meal?: string
  season?: string
  perPage?: number
  /** PR 8B-2: household-scoped custom-tag filter (AND across entries). */
  customTags?: string[]
  /** PRO-61: hide recipes that break the signed-in user's allergies or diet. */
  fitsMe?: boolean
  /**
   * PRO-299: «Mis recetas» — only the signed-in user's own recipes, filtered
   * by the API. Filtering the first 100 catalogue cards here left out the
   * newest copies (the catalogue lists them last): 7 shown, 8 owned.
   */
  mine?: boolean
}

export function buildQueryString(filters?: RecipeFilters): string {
  if (!filters) return ""
  const params = new URLSearchParams()
  if (filters.search) params.set("search", filters.search)
  if (filters.meal) params.set("meal", filters.meal)
  if (filters.season) params.set("season", filters.season)
  if (filters.perPage) params.set("perPage", String(filters.perPage))
  if (filters.fitsMe) params.set("fitsMe", "1")
  if (filters.mine) params.set("mine", "1")
  for (const tag of filters.customTags ?? []) {
    params.append("customTag", tag)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ""
}
