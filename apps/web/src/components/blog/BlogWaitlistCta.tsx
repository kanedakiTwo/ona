import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

/** Where every blog CTA points: the landing's waitlist, tagged `?ref=blog` (specs/waitlist.md). */
export const BLOG_WAITLIST_HREF = "/?ref=blog#lista-de-espera"

/** Closing call to the waitlist at the end of every article (specs/blog.md). */
export default function BlogWaitlistCta() {
  return (
    <section data-testid="blog-cta" className="mt-16 rounded-[28px] bg-[#F2EDE0] px-6 py-12 text-center md:px-12 md:py-16">
      <div className="text-eyebrow mb-4">Lista de espera · Mimoia</div>
      <h2 className="text-editorial-md">
        Tu semana de comidas, <span className="font-italic italic text-[#C65D38]">ya pensada</span>.
      </h2>
      <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-[#4A4239]">
        Entramos por tandas, cada dos a cuatro semanas. Sin tarjeta. Sin compromiso.
      </p>
      <Link
        href={BLOG_WAITLIST_HREF}
        className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-[#1A1612] px-7 py-4 text-base font-medium text-[#FAF6EE] transition-all hover:gap-3.5 hover:bg-[#2D6A4F]"
      >
        Únete a la lista de espera
        <ArrowUpRight size={18} />
      </Link>
    </section>
  )
}
