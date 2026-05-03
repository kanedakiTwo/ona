/**
 * Small UI helpers shared between the recipe detail page and the
 * cook-mode page (Task 14). Kept tiny on purpose — anything heavier
 * (scaling, lint, nutrition) lives in the API layer.
 */

import { householdToDiners } from "@ona/shared"
import type { Recipe, RecipeIngredient, Unit, HouseholdSize } from "@ona/shared"

// ─── Tag visibility ────────────────────────────────────────────────

const RESERVED_TAG_VALUES: ReadonlySet<string> = new Set([
  // meals
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  // seasons
  "spring",
  "summer",
  "autumn",
  "winter",
  // difficulty
  "easy",
  "medium",
  "hard",
])

/** Mirror of the server-side `publicTagsOf` so the UI can filter without a round-trip. */
export function publicTagsOf(recipe: {
  tags?: string[] | null
  internalTags?: string[] | null
}): string[] {
  const tags = recipe.tags ?? []
  const internal = new Set((recipe.internalTags ?? []).map((t) => t.toLowerCase()))
  return tags.filter((t) => {
    const lower = t.toLowerCase()
    if (RESERVED_TAG_VALUES.has(lower)) return false
    if (internal.has(lower)) return false
    return true
  })
}

// ─── Times → "Prep 25' · Cocción 35' · Total 60'" ──────────────────

export function timelineString(opts: {
  prepTime?: number | null
  cookTime?: number | null
  activeTime?: number | null
  totalTime?: number | null
}): string {
  const parts: string[] = []
  if (opts.prepTime != null && opts.prepTime > 0) parts.push(`Prep ${opts.prepTime}'`)
  if (opts.cookTime != null && opts.cookTime > 0) parts.push(`Cocción ${opts.cookTime}'`)
  if (opts.activeTime != null && opts.activeTime > 0) parts.push(`Activo ${opts.activeTime}'`)
  if (opts.totalTime != null && opts.totalTime > 0) parts.push(`Total ${opts.totalTime}'`)
  return parts.join(" · ")
}

// ─── Ingredient grouping by section ────────────────────────────────

export interface IngredientGroup<T extends RecipeIngredient = RecipeIngredient> {
  /** null when the ingredients have no section set (default group) */
  section: string | null
  ingredients: T[]
}

/**
 * Group ingredients by `section`. Sections appear in the order their
 * first ingredient does. Ungrouped ingredients land in a leading group
 * with `section: null` (or the only group, when nothing has a section).
 */
export function groupIngredientsBySection<T extends RecipeIngredient>(
  ingredients: T[],
): IngredientGroup<T>[] {
  const hasAnySection = ingredients.some((i) => i.section != null && i.section !== "")
  if (!hasAnySection) {
    return [{ section: null, ingredients: [...ingredients] }]
  }

  const groups = new Map<string | null, T[]>()
  const order: (string | null)[] = []
  for (const ing of ingredients) {
    const key = ing.section && ing.section !== "" ? ing.section : null
    if (!groups.has(key)) {
      groups.set(key, [])
      order.push(key)
    }
    groups.get(key)!.push(ing)
  }
  return order.map((section) => ({ section, ingredients: groups.get(section)! }))
}

// ─── Unit display ──────────────────────────────────────────────────

/**
 * Render the quantity + unit for an ingredient line.
 *
 * - `pizca` / `al_gusto` ignore the quantity entirely and render Spanish
 *   text instead ("una pizca", "al gusto") because the scaler also
 *   leaves them untouched.
 * - `g`, `ml` show the number then the unit, no space.
 * - `u`, `cda`, `cdita` show the number, a thin space, then the
 *   pluralized Spanish word.
 */
export function formatQuantity(quantity: number, unit: Unit): string {
  if (unit === "pizca") return "una pizca"
  if (unit === "al_gusto") return "al gusto"

  const q = formatNumber(quantity)
  if (unit === "g" || unit === "ml") return `${q} ${unit}`
  if (unit === "u") return `${q} ${quantity === 1 ? "ud" : "uds"}`
  if (unit === "cda") return `${q} ${quantity === 1 ? "cda" : "cdas"}`
  if (unit === "cdita") return `${q} ${quantity === 1 ? "cdita" : "cditas"}`
  return `${q} ${unit}`
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  // Up to 2 decimals, no trailing zeros.
  return n.toFixed(2).replace(/\.?0+$/, "")
}

// ─── Allergen Spanish labels ───────────────────────────────────────

export const ALLERGEN_LABELS: Record<string, string> = {
  gluten: "Gluten",
  lactosa: "Lactosa",
  huevo: "Huevo",
  frutos_secos: "Frutos secos",
  cacahuetes: "Cacahuetes",
  soja: "Soja",
  pescado: "Pescado",
  marisco: "Marisco",
  crustaceos: "Crustáceos",
  moluscos: "Moluscos",
  apio: "Apio",
  mostaza: "Mostaza",
  sesamo: "Sésamo",
  altramuces: "Altramuces",
  sulfitos: "Sulfitos",
}

export function allergenLabel(token: string): string {
  return ALLERGEN_LABELS[token.toLowerCase()] ?? token
}

// ─── Household → diner count ───────────────────────────────────────

const LEGACY_HOUSEHOLD_DINERS: Record<HouseholdSize, number> = {
  solo: 1,
  couple: 2,
  family_no_kids: 3,
  family_with_kids: 4,
}

/**
 * Resolve the diner count to seed the recipe-detail scaler. Prefers the
 * authoritative `adults` + `kidsCount` shape; falls back to the legacy
 * `householdSize` enum for users who haven't yet edited their profile after
 * the migration. Returns null when nothing is set so callers can fall back
 * to `recipe.servings`.
 */
export function householdToDinersOrNull(input: {
  adults?: number | null
  kidsCount?: number | null
  householdSize?: HouseholdSize | null
}): number | null {
  if (typeof input.adults === 'number' && input.adults > 0) {
    return householdToDiners(input.adults, input.kidsCount ?? 0)
  }
  if (input.householdSize) {
    return LEGACY_HOUSEHOLD_DINERS[input.householdSize] ?? null
  }
  return null
}

/** @deprecated Use `householdToDinersOrNull({ adults, kidsCount, householdSize })`. */
export function householdSizeToDiners(size?: HouseholdSize | null): number | null {
  if (!size) return null
  return LEGACY_HOUSEHOLD_DINERS[size] ?? null
}
