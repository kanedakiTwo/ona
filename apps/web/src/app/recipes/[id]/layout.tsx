import type { Metadata } from "next"
import { recipeMetadata } from "@/lib/recipeMetadata"
import { fetchPublicRecipe } from "@/lib/publicRecipe"

/**
 * Server layout of `/recipes/<id>` (and its `/cook`, `/edit`): only here to
 * give shared links and search engines a real preview (title, description,
 * photo, canonical) in the server HTML. The pages themselves stay client
 * components; the `schema.org/Recipe` JSON-LD is in `app/@seo/recipes/[id]`
 * (PRO-1077). The recipe is fetched without a token, so a private recipe gets
 * the generic metadata — see lib/recipeMetadata.ts and lib/publicRecipe.ts.
 */

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  return recipeMetadata(await fetchPublicRecipe(id))
}

export default function RecipeLayout({ children }: { children: React.ReactNode }) {
  return children
}
