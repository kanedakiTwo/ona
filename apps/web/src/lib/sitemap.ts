import type { MetadataRoute } from "next"
import { SITE_URL } from "./site"

/**
 * The entries of /sitemap.xml (`app/sitemap.ts`): the public pages, every
 * published blog article (specs/blog.md) and every catalogue recipe the API's
 * `GET /recipes/sitemap` lists — published, without the book ones (PRO-1077,
 * D-104). Pure, so the tests can check it without a server.
 */
export const PUBLIC_PAGES = ["/", "/como-funciona", "/recipes", "/blog", "/privacidad", "/terminos", "/aviso-legal"]

export interface SitemapRecipe {
  id: string
  updatedAt: string | null
}

export function sitemapEntries(
  posts: ReadonlyArray<{ slug: string; fecha: string }>,
  recipes: readonly SitemapRecipe[],
  siteUrl = SITE_URL,
): MetadataRoute.Sitemap {
  return [
    ...PUBLIC_PAGES.map((path) => ({ url: `${siteUrl}${path}` })),
    ...posts.map((post) => ({
      url: `${siteUrl}/blog/${post.slug}`,
      lastModified: post.fecha,
    })),
    ...recipes
      .filter((r) => typeof r?.id === "string" && r.id)
      .map((r) => ({
        url: `${siteUrl}/recipes/${r.id}`,
        ...(r.updatedAt ? { lastModified: r.updatedAt } : {}),
      })),
  ]
}
