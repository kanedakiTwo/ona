import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { BRAND_NAME } from "@ona/shared"
import { getPublishedArticle, getPublishedPosts } from "@/lib/blog/posts"
import { formatBlogDate } from "@/lib/blog/markdown"
import { SITE_URL } from "@/lib/site"
import BlogBody from "@/components/blog/BlogBody"
import BlogWaitlistCta from "@/components/blog/BlogWaitlistCta"

/**
 * /blog/[slug] — one published article (specs/blog.md). Only published slugs
 * are pre-rendered; anything else (unknown or `publicado: false`) is a 404.
 */

export const dynamicParams = false

export function generateStaticParams() {
  return getPublishedPosts().map((p) => ({ slug: p.slug }))
}

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = getPublishedArticle(slug)
  if (!post) return {}
  const url = `/blog/${post.slug}`
  return {
    metadataBase: new URL(SITE_URL),
    title: `${post.titulo} · ${BRAND_NAME}`,
    description: post.resumen,
    authors: [{ name: post.autor }],
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      siteName: BRAND_NAME,
      locale: "es_ES",
      title: post.titulo,
      description: post.resumen,
      publishedTime: post.fecha,
      authors: [post.autor],
      images: [{ url: post.imagen, alt: post.titulo }],
    },
  }
}

export default async function BlogArticlePage({ params }: Params) {
  const { slug } = await params
  const post = getPublishedArticle(slug)
  if (!post) notFound()

  return (
    <article className="bg-[#FAF6EE] px-4 pb-24 pt-28 md:px-10 md:pb-32 md:pt-36">
      <div className="mx-auto max-w-[720px]">
        <Link
          href="/blog"
          className="inline-flex items-center gap-1 text-sm text-[#7A7066] transition-colors hover:text-[#1A1612]"
        >
          <ChevronLeft size={16} /> Blog
        </Link>

        <header className="mt-8">
          <div className="text-eyebrow">
            <time dateTime={post.fecha}>{formatBlogDate(post.fecha)}</time> · {post.autor}
          </div>
          <h1 className="mt-4 font-display text-[40px] leading-[1.05] tracking-[-0.02em] text-[#1A1612] md:text-[56px]">
            {post.titulo}
          </h1>
          <p className="mt-6 font-italic text-[22px] italic leading-snug text-[#4A4239]">{post.resumen}</p>
        </header>

        <div className="mt-10 aspect-[16/10] overflow-hidden rounded-[24px] bg-[#EFE8D8]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.imagen} alt="" className="h-full w-full object-cover" />
        </div>

        <div className="mt-12">
          <BlogBody blocks={post.blocks} />
        </div>

        <BlogWaitlistCta />
      </div>
    </article>
  )
}
