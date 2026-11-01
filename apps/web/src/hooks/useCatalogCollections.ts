import { useQuery } from "@tanstack/react-query"
import type { CatalogCollectionCard } from "@ona/shared"
import { api } from "@/lib/api"
import type { CatalogCardRecipe } from "@/components/recipes/RecipeCard"

/** The «Colecciones» row of `/recipes` (PRO-374): `GET /catalog-collections`, with or without an account. */
export function useCatalogCollections() {
  return useQuery<CatalogCollectionCard[]>({
    queryKey: ["catalog-collections"],
    queryFn: async () => (await api.get<{ collections: CatalogCollectionCard[] }>("/catalog-collections")).collections,
    staleTime: 5 * 60_000,
  })
}

export interface CatalogCollectionPage {
  collection: CatalogCollectionCard
  recipes: CatalogCardRecipe[]
}

/** One collection and its recipes, in Cocina's order (`/recipes/coleccion/<slug>`). */
export function useCatalogCollection(slug: string | undefined) {
  return useQuery<CatalogCollectionPage>({
    queryKey: ["catalog-collections", slug],
    queryFn: () => api.get<CatalogCollectionPage>(`/catalog-collections/${encodeURIComponent(slug ?? "")}`),
    enabled: !!slug,
    retry: false,
  })
}
