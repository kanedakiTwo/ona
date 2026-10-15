import type { Metadata } from "next"
import { BRAND_NAME } from "@ona/shared"
import { minutesLabel, recipeTotalMinutes } from "./recipeView"
import { SITE_URL } from "./site"

/**
 * Link previews for `/recipes/<id>` (specs/recipes.md → "Página de receta"):
 * what WhatsApp, Telegram, iMessage or a search engine show when someone
 * pastes the link. Built from the anonymous `GET /recipes/:id` response, so
 * only catalogue recipes get a real preview; a private or missing recipe gets
 * a generic, non-indexed one (we never confirm a private recipe exists).
 *
 * Pure, so the tests can check it without a server.
 */

export interface PreviewRecipe {
  id: string
  name: string
  imageUrl?: string | null
  servings?: number | null
  totalTime?: number | null
  prepTime?: number | null
  cookTime?: number | null
  ingredients?: readonly unknown[] | null
}

export const GENERIC_RECIPE_METADATA: Metadata = {
  title: `Receta · ${BRAND_NAME}`,
  description: `${BRAND_NAME}: el planificador de menús semanales que te hace la lista de la compra.`,
  robots: { index: false },
}

/** `/images/recipes/x.jpg` (served by the web) or an absolute URL (API volume, third parties) → absolute. */
export function absoluteImageUrl(imageUrl: string | null | undefined, siteUrl = SITE_URL): string | null {
  if (!imageUrl) return null
  try {
    return new URL(imageUrl, siteUrl).toString()
  } catch {
    return null
  }
}

export function recipePreviewDescription(recipe: PreviewRecipe): string {
  const facts = [
    recipe.servings && recipe.servings > 0 ? `para ${recipe.servings} ${recipe.servings === 1 ? "persona" : "personas"}` : "",
    minutesLabel(recipeTotalMinutes(recipe)),
    recipe.ingredients?.length ? `${recipe.ingredients.length} ingredientes` : "",
  ].filter(Boolean)
  const lead = facts.length ? `Receta ${facts.join(" · ")}.` : "Receta."
  return `${lead} Ingredientes, pasos y modo cocina en ${BRAND_NAME}, el planificador de menús semanales.`
}

export function recipeMetadata(recipe: PreviewRecipe | null): Metadata {
  if (!recipe) return GENERIC_RECIPE_METADATA
  const path = `/recipes/${recipe.id}`
  const description = recipePreviewDescription(recipe)
  const image = absoluteImageUrl(recipe.imageUrl)
  return {
    metadataBase: new URL(SITE_URL),
    title: `${recipe.name} · ${BRAND_NAME}`,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      url: path,
      siteName: BRAND_NAME,
      locale: "es_ES",
      title: recipe.name,
      description,
      ...(image ? { images: [{ url: image, alt: recipe.name }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: recipe.name,
      description,
      ...(image ? { images: [image] } : {}),
    },
  }
}
