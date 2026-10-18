import type { Metadata } from "next"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { BRAND_NAME } from "@ona/shared"
import { getPublishedPosts } from "@/lib/blog/posts"
import { SignupCtaLink, WaitlistOnly } from "@/components/shared/SignupCta"
import { formatBlogDate } from "@/lib/blog/markdown"
import { SITE_URL } from "@/lib/site"
import { BLOG_WAITLIST_HREF } from "@/components/blog/BlogWaitlistCta"

/**
 * /blog — listing of the published articles (specs/blog.md). Static: the
 * Markdown files are read at build time; unpublished ones never appear.
 */

const TITLE = `Blog · ${BRAND_NAME}`
const DESCRIPTION = "Ideas para organizar el menú de la semana, la compra y la cocina de casa, contadas por el equipo de Mimoia."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    url: "/blog",
    siteName: BRAND_NAME,
    locale: "es_ES",
    title: TITLE,
    description: DESCRIPTION,
  },
}

export default function BlogIndexPage() {
  const posts = getPublishedPosts()

  return (
    <div className="bg-[#FAF6EE] grain-subtle">
      <section className="pb-12 pt-28 md:pb-16 md:pt-40">
        <div className="public-container">
          <div className="text-eyebrow mb-6">Cuaderno de {BRAND_NAME}</div>
          <h1 className="text-editorial-xl">
            El <span className="font-italic italic text-[#C65D38]">blog</span>.
          </h1>
          <p className="mt-8 max-w-xl text-base leading-relaxed text-[#4A4239] md:text-lg">
            Ideas para que pensar las comidas de la semana pese menos: menú, compra y cocina de casa.
          </p>
        </div>
      </section>

      <section className="pb-24 md:pb-32">
        <div className="public-container">
          {posts.length === 0 ? (
            <div data-testid="blog-empty" className="border-t border-[#DDD6C5] pt-10">
              <p className="font-display text-2xl text-[#1A1612]">Pronto, los primeros artículos.</p>
              <p className="mt-3 max-w-md text-base text-[#4A4239]">
                <WaitlistOnly>Mientras tanto, apúntate a la lista de espera y te avisamos cuando entres.</WaitlistOnly>
              </p>
              <SignupCtaLink
                waitlistHref={BLOG_WAITLIST_HREF}
                waitlistLabel="Únete a la lista de espera"
                openRef="blog"
                className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-[#1A1612] px-7 py-4 text-base font-medium text-[#FAF6EE] transition-all hover:gap-3.5 hover:bg-[#2D6A4F]"
                icon={<ArrowUpRight size={18} />}
              />
            </div>
          ) : (
            <ul data-testid="blog-list" className="grid grid-cols-1 gap-12 md:grid-cols-2 md:gap-x-10 md:gap-y-16">
              {posts.map((post) => (
                <li key={post.slug} data-testid="blog-item">
                  <Link href={`/blog/${post.slug}`} className="group block">
                    <div className="aspect-[4/3] overflow-hidden rounded-[24px] bg-[#EFE8D8]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={post.imagen}
                        alt=""
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                      />
                    </div>
                    <div className="text-eyebrow mt-6">
                      <time dateTime={post.fecha}>{formatBlogDate(post.fecha)}</time> · {post.autor}
                    </div>
                    <h2 className="mt-3 font-display text-[26px] leading-tight text-[#1A1612] group-hover:text-[#2D6A4F] md:text-[30px]">
                      {post.titulo}
                    </h2>
                    <p className="mt-3 text-base leading-relaxed text-[#4A4239]">{post.resumen}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
