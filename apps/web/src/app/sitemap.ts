import type { MetadataRoute } from "next"
import { getPublishedPosts } from "@/lib/blog/posts"
import { SITE_URL } from "@/lib/site"

/**
 * /sitemap.xml — the public pages a search engine should know about, plus
 * every published blog article (specs/blog.md), and the recipe catalogue
 * `/recipes` (public signed out, specs/recipes.md). App routes behind login are
 * left out on purpose.
 */
const PUBLIC_PAGES = ["/", "/como-funciona", "/recipes", "/blog", "/privacidad", "/terminos", "/aviso-legal"]

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...PUBLIC_PAGES.map((path) => ({ url: `${SITE_URL}${path}` })),
    ...getPublishedPosts().map((post) => ({
      url: `${SITE_URL}/blog/${post.slug}`,
      lastModified: post.fecha,
    })),
  ]
}
