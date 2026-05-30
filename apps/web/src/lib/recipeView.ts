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

/**
 * Boil a long, SEO-style recipe title down to a short display name suitable
 * for tight cells (the week grid, future menu chips, etc).
 *
 * Strategy:
 *   1. Strip common Spanish openers ("Cómo hacer", "Receta de", "Las 7
 *      recetas que…", "Aprende a preparar"…). They eat horizontal space
 *      without adding info.
 *   2. Cut at the first preposition that introduces an "explanatory tail"
 *      ("apetecible para disfrutar de…", "que te hará amar la…") so the
 *      dish name comes through, not the article subtitle.
 *   3. Word-truncate at 24 chars max, ellipsis suffix.
 *   4. Title-case the first letter — the rest stays as-is so proper nouns
 *      keep their casing.
 */
export function shortRecipeName(raw: string | null | undefined): string {
  if (!raw) return ""
  let t = raw.trim()

  // 1. Strip leading "how-to / recipe-of / N-recipes-that…" openers.
  t = t.replace(
    /^(cómo\s+(?:hacer|preparar|cocinar)|aprende\s+a\s+(?:hacer|preparar|cocinar)|guía\s+para\s+(?:hacer|preparar|cocinar)|las?\s+(?:\d+\s+)?recetas?(?:\s+que)?|receta\s+(?:de|para|tradicional\s+de))\s+/i,
    "",
  )

  // 2. Cut subtitle tails. Common joiners: " : ", " - ", " — ", " · ", or a
  // long " para … " / " que … " clause whose subject is descriptive.
  t = t.split(/\s*[:|·\-—]\s*/)[0]
  const tailCut = t.match(/^(.+?)\s+(?:para\s+(?:disfrutar|aprender|hacer|que)|que\s+(?:te\s+har[áa]|nos\s+har[áa]|adoraréis|amar))/i)
  if (tailCut && tailCut[1].length >= 4) t = tailCut[1]

  // 3. Word-truncate at 24 chars.
  if (t.length > 24) {
    const cut = t.slice(0, 24)
    const lastSpace = cut.lastIndexOf(" ")
    t = (lastSpace > 12 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…"
  }

  // 4. First-letter uppercase, rest untouched.
  if (t.length > 0) t = t[0].toUpperCase() + t.slice(1)
  return t
}

/**
 * Map a lint/zod error path like `steps[0].text` or `ingredients[7]` into a
 * Spanish, human-readable label like "Paso 1" or "Ingrediente 8". The
 * server's lint messages already contain the user-facing prose ("El paso 1
 * menciona huevo pero no aparece en los ingredientes…"); this helper just
 * gives the prefix a friendly form so users don't see raw JSON paths.
 *
 * Returns null for `_form` so the caller can render the message alone.
 */
export function humanizeLintKey(key: string): string | null {
  if (!key || key === "_form") return null
  const stepMatch = key.match(/^steps\[(\d+)\](?:\..+)?$/)
  if (stepMatch) return `Paso ${Number(stepMatch[1]) + 1}`
  const ingMatch = key.match(/^ingredients\[(\d+)\](?:\..+)?$/)
  if (ingMatch) return `Ingrediente ${Number(ingMatch[1]) + 1}`
  const FIELD_LABELS: Record<string, string> = {
    name: "Nombre",
    servings: "Comensales",
    prepTime: "Tiempo de preparación",
    cookTime: "Tiempo de cocción",
    difficulty: "Dificultad",
    meals: "Comidas",
    seasons: "Temporadas",
    tags: "Etiquetas",
    ingredients: "Ingredientes",
    steps: "Pasos",
    notes: "Notas",
    tips: "Trucos",
  }
  return FIELD_LABELS[key] ?? key
}
