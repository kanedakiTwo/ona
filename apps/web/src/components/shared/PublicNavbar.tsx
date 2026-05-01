"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowRight, Menu, X } from "lucide-react"

const NAV_LINKS = [
  { href: "/como-funciona", label: "Como funciona" },
  { href: "/recetas", label: "Recetas" },
]

export default function PublicNavbar() {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  // Home navbar shows transparent over hero, others are solid from start
  return (
    <>
      <nav
        className={`fixed left-0 right-0 top-0 z-50 transition-all duration-500 ${
          scrolled || open ? "bg-[#FAF6EE]/90 backdrop-blur-md" : "bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 md:px-10">
          <Link href="/" className="font-display text-2xl tracking-tight text-[#1A1612]">
            ONA
          </Link>

          <div className="hidden items-center gap-10 text-sm md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`link-reveal ${
                  pathname === link.href ? "font-medium text-[#1A1612]" : "text-[#4A4239]"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <Link href="/login" className="link-reveal text-[#4A4239]">
              Entrar
            </Link>
            <Link href="/register" className="btn-editorial btn-editorial-primary text-xs">
              Empezar gratis
              <ArrowRight size={14} />
            </Link>
          </div>

          <button
            onClick={() => setOpen(!open)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-[#DDD6C5] text-[#1A1612] md:hidden"
            aria-label={open ? "Cerrar menu" : "Abrir menu"}
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>

      {open && (
        <div className="fixed inset-0 z-40 flex flex-col bg-[#FAF6EE] pt-24 md:hidden">
          <div className="flex flex-1 flex-col gap-2 px-6">
            {NAV_LINKS.map((link, i) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="border-b border-[#DDD6C5] py-6 font-display text-3xl text-[#1A1612] transition-colors hover:text-[#2D6A4F]"
                style={{ animation: `fadeUp 0.5s ${i * 0.06}s both cubic-bezier(0.19, 1, 0.22, 1)` }}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="border-b border-[#DDD6C5] py-6 font-display text-3xl text-[#4A4239]"
            >
              Entrar
            </Link>
          </div>
          <div className="px-6 pb-12">
            <Link
              href="/register"
              onClick={() => setOpen(false)}
              className="btn-editorial btn-editorial-primary w-full justify-center text-base"
            >
              Empezar gratis
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  )
}
