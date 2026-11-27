import type { Metadata } from "next"
import { recipeMetadata } from "@/lib/recipeMetadata"
import { fetchPublicRecipe } from "@/lib/publicRecipe"
import { jsonLdScript, recipeJsonLd } from "@/lib/recipeJsonLd"
import { PageBody } from "@/components/shared/ServerHtmlOnly"

/**
 * Server layout of `/recipes/<id>` (and its `/cook`, `/edit`): only here to
 * give shared links and search engines a real preview (title, description,
 * photo, canonical) in the server HTML, and the `schema.org/Recipe` JSON-LD
 * (PRO-1077). The pages themselves stay client components. RootShell paints
 * an empty page on the server while the session resolves; the JSON-LD still
 * reaches the server HTML through `ServerHtmlOnly` (PRO-1346), which leaves
 * out what is inside `PageBody`. The recipe is fetched without a token, so a
 * private recipe gets the generic metadata and no JSON-LD, nor do book recipes
 * (D-104) — see lib/recipeMetadata.ts, lib/recipeJsonLd.ts and lib/publicRecipe.ts.
 */

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  return recipeMetadata(await fetchPublicRecipe(id))
}

export default async function RecipeLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { id } = await params
  const data = recipeJsonLd(await fetchPublicRecipe(id))
  return (
    <>
      {data && (
        <script
          type="application/ld+json"
          data-testid="recipe-jsonld"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }}
        />
      )}
      <PageBody>{children}</PageBody>
    </>
  )
}
