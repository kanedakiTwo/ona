import { fetchPublicRecipe } from "@/lib/publicRecipe"
import { jsonLdScript, recipeJsonLd } from "@/lib/recipeJsonLd"

/**
 * `@seo` slot of `/recipes/<id>` (PRO-1077, specs/recipes.md → «SEO de la
 * ficha»): the `schema.org/Recipe` JSON-LD in the server HTML. It is a slot
 * because the root layout renders it outside RootShell, which paints an
 * empty page on the server while the session resolves. Private, missing or
 * book recipes (D-104) get nothing.
 */
export default async function RecipeJsonLd({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = recipeJsonLd(await fetchPublicRecipe(id))
  if (!data) return null
  return (
    <script
      type="application/ld+json"
      data-testid="recipe-jsonld"
      dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
    />
  )
}
