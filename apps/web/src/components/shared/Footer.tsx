"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowUpRight } from "lucide-react"

export default function Footer() {
  const pathname = usePathname()
  // The landing page has its own footer embedded
  if (pathname === "/") return null

  return (
    <footer className="relative bg-[#1A1612] px-6 pb-12 pt-24 text-[#FAF6EE] md:px-10 md:pb-16 md:pt-32">
      <div className="mx-auto max-w-7xl">
        {/* Big editorial CTA */}
        <div className="mb-20 grid grid-cols-1 gap-8 border-b border-[#FAF6EE]/15 pb-20 md:grid-cols-12 md:items-end">
          <div className="md:col-span-8">
            <div className="text-eyebrow mb-4 text-[#95D5B2]">¿Listo?</div>
            <h2 className="text-editorial-lg">
              Tu menu de <span className="font-italic italic text-[#52B788]">esta</span> semana
              <br />
              esta a 2 minutos.
            </h2>
          </div>
          <div className="md:col-span-4 md:flex md:justify-end">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-full bg-[#FAF6EE] px-6 py-3.5 text-sm font-medium text-[#1A1612] transition-all hover:gap-3 hover:bg-[#52B788]"
            >
              Empezar gratis
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>

        {/* Links grid */}
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          <div>
            <div className="text-eyebrow mb-4 text-[#FAF6EE]/40">Producto</div>
            <ul className="space-y-3 text-sm">
              <li><Link href="/como-funciona" className="link-reveal text-[#FAF6EE]/80 hover:text-[#FAF6EE]">Como funciona</Link></li>
              <li><Link href="/recipes" className="link-reveal text-[#FAF6EE]/80 hover:text-[#FAF6EE]">Recetas</Link></li>
              <li><Link href="/register" className="link-reveal text-[#FAF6EE]/80 hover:text-[#FAF6EE]">Empezar</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-eyebrow mb-4 text-[#FAF6EE]/40">Filosofia</div>
            <ul className="space-y-3 text-sm">
              <li><span className="text-[#FAF6EE]/80">Antiinflamatoria</span></li>
              <li><span className="text-[#FAF6EE]/80">De temporada</span></li>
              <li><span className="text-[#FAF6EE]/80">Sin culpa</span></li>
            </ul>
          </div>
          <div>
            <div className="text-eyebrow mb-4 text-[#FAF6EE]/40">Legal</div>
            <ul className="space-y-3 text-sm">
              <li><Link href="/privacidad" className="link-reveal text-[#FAF6EE]/80 hover:text-[#FAF6EE]">Privacidad</Link></li>
              <li><Link href="/terminos" className="link-reveal text-[#FAF6EE]/80 hover:text-[#FAF6EE]">Terminos</Link></li>
            </ul>
          </div>
          <div>
            <div className="text-eyebrow mb-4 text-[#FAF6EE]/40">Contacto</div>
            <ul className="space-y-3 text-sm">
              <li><a href="mailto:hola@ona.app" className="link-reveal text-[#FAF6EE]/80 hover:text-[#FAF6EE]">hola@ona.app</a></li>
            </ul>
          </div>
        </div>

        {/* Big logo bottom */}
        <div className="mt-24 flex items-end justify-between">
          <div>
            <div className="font-display text-[clamp(4rem,12vw,10rem)] leading-none tracking-tighter text-[#FAF6EE]">
              ONA
            </div>
            <div className="mt-4 text-xs text-[#FAF6EE]/50">
              © 2026 ONA · Cook with intention
            </div>
          </div>
          <div className="hidden text-right text-xs text-[#FAF6EE]/40 md:block">
            <div>Madrid · Spain</div>
            <div className="mt-1 font-italic italic">Issue №01</div>
          </div>
        </div>
      </div>
    </footer>
  )
}
