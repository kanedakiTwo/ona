"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Menu, X } from "lucide-react"

export default function PublicNavbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => { document.body.style.overflow = "" }
  }, [menuOpen])

  return (
    <nav
      className={`sticky top-0 z-50 bg-white transition-shadow duration-200 ${
        scrolled ? "shadow-[0_2px_8px_rgba(0,0,0,0.08)]" : ""
      }`}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 md:h-16">
        {/* Logo */}
        <Link
          href="/"
          className="font-[family-name:var(--font-display)] text-2xl text-[#2D6A4F]"
        >
          ONA
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-8 md:flex">
          <Link
            href="/como-funciona"
            className="text-base font-medium text-[#1A1A1A] transition-colors hover:text-[#2D6A4F]"
          >
            Como funciona
          </Link>
          <Link
            href="/recetas"
            className="text-base font-medium text-[#1A1A1A] transition-colors hover:text-[#2D6A4F]"
          >
            Recetas
          </Link>
          <Link href="/register" className="btn-primary btn-s inline-flex items-center">
            Empezar gratis
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="flex items-center justify-center md:hidden"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? "Cerrar menu" : "Abrir menu"}
        >
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile fullscreen menu */}
      {menuOpen && (
        <div className="fixed inset-0 top-14 z-40 flex flex-col bg-white px-6 pt-8 md:hidden">
          <Link
            href="/como-funciona"
            onClick={() => setMenuOpen(false)}
            className="border-b border-[#EEEEEE] py-4 text-lg font-medium text-[#1A1A1A]"
          >
            Como funciona
          </Link>
          <Link
            href="/recetas"
            onClick={() => setMenuOpen(false)}
            className="border-b border-[#EEEEEE] py-4 text-lg font-medium text-[#1A1A1A]"
          >
            Recetas
          </Link>
          <div className="mt-8">
            <Link
              href="/register"
              onClick={() => setMenuOpen(false)}
              className="btn-primary btn-l flex w-full items-center justify-center"
            >
              Empezar gratis
            </Link>
          </div>
        </div>
      )}
    </nav>
  )
}
