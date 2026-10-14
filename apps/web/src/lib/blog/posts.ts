import { readdirSync, readFileSync } from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import { isValidSlug, parseArticle, parseMarkdown, type Block, type BlogFrontMatter } from "./markdown"

/**
 * Server-only loader for the blog (specs/blog.md). Articles are
 * `apps/web/content/blog/<slug>.md`; only `publicado: true` ones exist for
 * the site — the listing, the article route, `generateStaticParams` and the
 * sitemap all go through `getPublishedPosts()`.
 *
 * Test hook: outside production builds, `BLOG_CONTENT_DIR` points the loader
 * at another folder (the e2e job uses `e2e/fixtures/blog`, which holds one
 * published and one unpublished fixture), so the suite can read a published
 * article without publishing anything real. It is ignored when
 * NODE_ENV=production (`next build` / the deployed server).
 */

export interface BlogPost extends BlogFrontMatter {
  slug: string
}

export interface BlogArticle extends BlogPost {
  blocks: Block[]
}

export function blogContentDir(): string {
  const override = process.env.NODE_ENV !== "production" ? process.env.BLOG_CONTENT_DIR : undefined
  if (override) return isAbsolute(override) ? override : resolve(process.cwd(), override)
  return join(process.cwd(), "content", "blog")
}

function readAll(): BlogArticle[] {
  const dir = blogContentDir()
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".md"))
  } catch {
    return []
  }
  return files.map((file) => {
    const slug = file.slice(0, -3)
    if (!isValidSlug(slug)) {
      throw new Error(`Blog: «${file}» no es un nombre válido (minúsculas, números y guiones).`)
    }
    try {
      const { meta, body } = parseArticle(readFileSync(join(dir, file), "utf8"))
      return { ...meta, slug, blocks: parseMarkdown(body) }
    } catch (err) {
      throw new Error(`Blog: ${file}: ${(err as Error).message}`)
    }
  })
}

/** Published articles, newest first. */
export function getPublishedPosts(): BlogPost[] {
  return readAll()
    .filter((p) => p.publicado)
    .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.slug.localeCompare(b.slug)))
    .map(({ blocks: _blocks, ...post }) => post)
}

/** One published article, or null (unknown slug or `publicado: false` → the route 404s). */
export function getPublishedArticle(slug: string): BlogArticle | null {
  if (!isValidSlug(slug)) return null
  return readAll().find((p) => p.slug === slug && p.publicado) ?? null
}
