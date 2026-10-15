import type { Metadata } from "next"
import { recipeMetadata, type PreviewRecipe } from "@/lib/recipeMetadata"

/**
 * Server layout of `/recipes/<id>` (and its `/cook`, `/edit`): only here to
 * give shared links a real preview (title, description, photo, canonical).
 * The pages themselves stay client components. The recipe is fetched without
 * a token, so a private recipe gets the generic metadata — see
 * lib/recipeMetadata.ts. Fails soft: a slow or broken API never blocks the page.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "")

async function fetchPublicRecipe(id: string): Promise<PreviewRecipe | null> {
  try {
    const res = await fetch(`${API_URL}/recipes/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(2500),
      next: { revalidate: 300 },
    })
    if (!res.ok) return null
    const data = (await res.json()) as PreviewRecipe
    return data?.id && data?.name ? data : null
  } catch {
    return null
  }
}

type Params = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params
  return recipeMetadata(await fetchPublicRecipe(id))
}

export default function RecipeLayout({ children }: { children: React.ReactNode }) {
  return children
}
