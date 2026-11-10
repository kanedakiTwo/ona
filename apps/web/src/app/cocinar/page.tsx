"use client"

/**
 * /cocinar — «Cocinar ahora» (specs/cook-now.md). For now, the whole pantry
 * (moved here from /profile/pantry). The meal of now, the four questions and
 * «Con lo que tienes» come with the /cook-now/* routes (plan
 * docs/superpowers/plans/2026-11-03-cocinar-ahora.md, tasks 15 and 16).
 */
import { Accent } from "@/components/profile/SubPage"
import { PantryManager } from "@/components/pantry/PantryManager"

export default function CocinarPage() {
  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto w-full max-w-[var(--page-max)] px-4 pb-12 pt-6 md:px-8 lg:px-12">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">Cocinar</p>
          <h1 className="mt-1 font-serif-text text-[30px] font-[650] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]">
            ¿Qué <Accent>cocinamos</Accent>?
          </h1>
        </header>
        <section id="despensa" aria-labelledby="despensa-titulo" className="mt-8 scroll-mt-6">
          <h2 id="despensa-titulo" className="font-serif-text text-[24px] font-[650] leading-tight text-ink">
            Tu despensa
          </h2>
          <p className="mb-5 mt-1 max-w-[560px] text-[14px] leading-relaxed text-ink-soft">
            Lo que tienes en casa con cantidad y caducidad. Cuando marques una receta como cocinada, las cantidades bajan automáticamente.
          </p>
          <PantryManager />
        </section>
      </div>
    </div>
  )
}
