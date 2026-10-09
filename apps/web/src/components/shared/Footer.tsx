import Link from "next/link"
import { BRAND_NAME } from "@ona/shared"
import { CONTACT_EMAIL } from "@/lib/contact"

/**
 * The one public footer (landing + every page under `app/(public)`, rendered
 * by `app/(public)/layout.tsx`). It is the landing's footer strip: sand band,
 * hairline, wordmark, the links (incl. aviso legal), contact (`CONTACT_EMAIL`:
 * NEXT_PUBLIC_SUPPORT_EMAIL, else hola@mimoia.com) and ©.
 *
 * Public marketing surface: `publicHealthClaims.test.ts` scans this file.
 */
const LINKS = [
  { href: "/como-funciona", label: "Cómo funciona" },
  { href: "/recipes", label: "Recetas" },
  { href: "/privacidad", label: "Privacidad" },
  { href: "/terminos", label: "Términos" },
  { href: "/aviso-legal", label: "Aviso legal" },
]

export default function Footer() {
  return (
    <footer data-testid="site-footer" className="bg-[#F2EDE0] px-6 pb-24 pt-16 text-sm text-[#7A7066] md:px-10 md:pb-32 md:pt-20">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 border-t border-[#DDD6C5] pt-12 md:flex-row md:justify-between">
        <div className="font-display text-2xl text-[#1A1612]">{BRAND_NAME}</div>
        <nav aria-label="Enlaces del pie" className="flex flex-wrap justify-center gap-x-8 gap-y-3">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="link-reveal hover:text-[#1A1612]">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col items-center gap-1 text-xs md:items-end">
          <a href={`mailto:${CONTACT_EMAIL}`} className="link-reveal hover:text-[#1A1612]">
            {CONTACT_EMAIL}
          </a>
          <span>© 2026 {BRAND_NAME}</span>
        </div>
      </div>
    </footer>
  )
}
