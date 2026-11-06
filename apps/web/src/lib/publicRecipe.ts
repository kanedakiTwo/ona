import type { JsonLdRecipe } from "./recipeJsonLd"

/**
 * The anonymous `GET /recipes/:id` the server side of `/recipes/<id>` reads:
 * the link-preview metadata (`app/recipes/[id]/layout.tsx`) and the JSON-LD
 * (`app/@seo/recipes/[id]/page.tsx`, PRO-1077). Without a token, so a private
 * recipe is null. Fails soft (2.5 s, cached 5 min): a slow or broken API never
 * blocks the page. Same URL and options in both, so Next fetches it once.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "")

export async function fetchPublicRecipe(id: string): Promise<JsonLdRecipe | null> {
  try {
    const res = await fetch(`${API_URL}/recipes/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(2500),
      next: { revalidate: 300 },
    })
    if (!res.ok) return null
    const data = (await res.json()) as JsonLdRecipe
    return data?.id && data?.name ? data : null
  } catch {
    return null
  }
}
