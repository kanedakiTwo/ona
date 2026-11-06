import type { MetadataRoute } from "next"
import { getPublishedPosts } from "@/lib/blog/posts"
import { sitemapEntries, type SitemapRecipe } from "@/lib/sitemap"

/**
 * /sitemap.xml — the public pages a search engine should know about, plus
 * every published blog article (specs/blog.md), the recipe catalogue
 * `/recipes` (public signed out, specs/recipes.md) and every published
 * catalogue recipe but the book ones (PRO-1077, D-104; lib/sitemap.ts). App
 * routes behind login are left out on purpose. Fails soft: without the API,
 * the sitemap has no recipes.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "")

// Read on each request (the list is cached an hour below), never frozen at build time without the API.
export const dynamic = "force-dynamic"

async function fetchSitemapRecipes(): Promise<SitemapRecipe[]> {
  try {
    const res = await fetch(`${API_URL}/recipes/sitemap`, {
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 3600 },
    })
    if (!res.ok) return []
    const data = (await res.json()) as unknown
    return Array.isArray(data) ? (data as SitemapRecipe[]) : []
  } catch {
    return []
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return sitemapEntries(getPublishedPosts(), await fetchSitemapRecipes())
}
