import { BRAND_NAME, ingredientDisplayName } from "@ona/shared"
import { MEAL_LABELS } from "./labels"
import { absoluteImageUrl, recipePreviewDescription, type PreviewRecipe } from "./recipeMetadata"
import { formatQuantity, recipeTotalMinutes } from "./recipeView"
import { SITE_URL } from "./site"

/**
 * PRO-1077 (specs/recipes.md → «SEO de la ficha»): the `schema.org/Recipe`
 * JSON-LD that `app/recipes/[id]/layout.tsx` writes into the server HTML of a
 * catalogue recipe, so a search engine reads the recipe without running the
 * page. Built from the anonymous `GET /recipes/:id` response; a book recipe
 * (`fromBook`, D-104) gets none until Legal's OK. Pure, so the tests can
 * check it without a server.
 */

export interface JsonLdRecipe extends Omit<PreviewRecipe, "ingredients"> {
  ingredients?: ReadonlyArray<{
    ingredientName?: string | null
    quantity: number
    unit: string
    note?: string | null
  }> | null
  steps?: ReadonlyArray<{ index: number; text: string }> | null
  yieldText?: string | null
  course?: string | null
  meals?: readonly string[] | null
  tags?: readonly string[] | null
  sourceUrl?: string | null
  fromBook?: boolean
  nutritionPerServing?: { kcal: number } | null
  nutritionIncomplete?: boolean
}

const COURSE_CATEGORY: Record<string, string> = {
  starter: "Entrante",
  main: "Plato principal",
  dessert: "Postre",
}

/** Minutes → ISO 8601 duration: 45 → "PT45M", 90 → "PT1H30M". Null for nothing to say. */
export function isoDuration(minutes: number | null | undefined): string | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}`
}

/** «Tomate (200 g), maduro» — the ingredient as the ficha lists it; no amount when it has none. */
export function ingredientLine(ing: NonNullable<JsonLdRecipe["ingredients"]>[number]): string | null {
  const name = ing.ingredientName?.trim()
  if (!name) return null
  const unstated = !(ing.quantity > 0) && ing.unit !== "pizca" && ing.unit !== "al_gusto"
  const amount = unstated ? "" : ` (${formatQuantity(ing.quantity, ing.unit as Parameters<typeof formatQuantity>[1])})`
  const note = ing.note?.trim() ? `, ${ing.note.trim()}` : ""
  return `${ingredientDisplayName(name)}${amount}${note}`
}

export function recipeJsonLd(recipe: JsonLdRecipe | null): Record<string, unknown> | null {
  if (!recipe || recipe.fromBook) return null
  const url = `${SITE_URL}/recipes/${recipe.id}`
  const image = absoluteImageUrl(recipe.imageUrl)
  const ingredients = (recipe.ingredients ?? []).map(ingredientLine).filter((l): l is string => !!l)
  const steps = [...(recipe.steps ?? [])]
    .filter((s) => s.text?.trim())
    .sort((a, b) => a.index - b.index)
    .map((s, i) => ({ "@type": "HowToStep", position: i + 1, text: s.text.trim() }))
  const category = recipe.course
    ? COURSE_CATEGORY[recipe.course]
    : (recipe.meals ?? []).map((m) => MEAL_LABELS[m as keyof typeof MEAL_LABELS]).filter(Boolean).join(", ")
  const yields = [
    recipe.servings && recipe.servings > 0 ? `${recipe.servings} ${recipe.servings === 1 ? "persona" : "personas"}` : "",
    recipe.yieldText?.trim() ?? "",
  ].filter(Boolean)
  const kcal = recipe.nutritionIncomplete ? null : recipe.nutritionPerServing?.kcal
  const optional: Record<string, unknown> = {
    image: image ? [image] : undefined,
    prepTime: isoDuration(recipe.prepTime),
    cookTime: isoDuration(recipe.cookTime),
    totalTime: isoDuration(recipeTotalMinutes(recipe)),
    recipeYield: yields.length ? yields : undefined,
    recipeCategory: category || undefined,
    keywords: recipe.tags?.length ? recipe.tags.join(", ") : undefined,
    nutrition: kcal && kcal > 0 ? { "@type": "NutritionInformation", calories: `${Math.round(kcal)} kcal` } : undefined,
    isBasedOn: recipe.sourceUrl || undefined,
  }
  return {
    "@context": "https://schema.org",
    "@type": "Recipe",
    "@id": url,
    url,
    name: recipe.name,
    description: recipePreviewDescription(recipe),
    inLanguage: "es-ES",
    author: { "@type": "Organization", name: BRAND_NAME, url: SITE_URL },
    publisher: { "@type": "Organization", name: BRAND_NAME, url: SITE_URL },
    recipeIngredient: ingredients,
    recipeInstructions: steps,
    ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v != null)),
  }
}

/** For `<script type="application/ld+json">`: `<` escaped so a recipe text can't close the tag. */
export function jsonLdScript(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}
