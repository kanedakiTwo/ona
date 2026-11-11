"use client"

/**
 * /cocinar — «Cocinar ahora» (specs/cook-now.md): what was planned for the
 * meal of now, the four questions and the proposal, «Con lo que tienes» and
 * the whole pantry (moved here from /profile/pantry).
 */
import { useState } from "react"
import { useAuth } from "@/lib/auth"
import { menuDiners } from "@/lib/menuDiners"
import { useUser } from "@/hooks/useUser"
import { useCookNowToday } from "@/hooks/useCookNow"
import { Accent } from "@/components/profile/SubPage"
import { TodayPlannedCard } from "@/components/cocinar/TodayPlannedCard"
import { CookNowFlow } from "@/components/cocinar/CookNowFlow"
import { PantryMatchCard } from "@/components/cocinar/PantryMatchCard"
import { PantryManager } from "@/components/pantry/PantryManager"

export default function CocinarPage() {
  const { user } = useAuth()
  const { data: today } = useCookNowToday()
  const [flowOpen, setFlowOpen] = useState(false)
  const { data: profile } = useUser(user?.id)
  // Same count as the menu (a child is one person): see lib/menuDiners.ts.
  const householdDiners = menuDiners({
    adults: (profile?.adults as number | undefined) ?? user?.adults,
    kidsCount: (profile?.kidsCount as number | undefined) ?? user?.kidsCount,
  })
  // The meal's own people count when it has one, else the household's.
  const defaultDiners = today?.slotServings ?? householdDiners

  if (flowOpen && today)
    return <CookNowFlow today={today} defaultDiners={defaultDiners} householdDiners={householdDiners} onClose={() => setFlowOpen(false)} />

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto w-full max-w-[var(--page-max)] px-4 pb-12 pt-6 md:px-8 lg:px-12">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">Cocinar</p>
          <h1 className="mt-1 font-serif-text text-[30px] font-[650] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]">
            ¿Qué <Accent>cocinamos</Accent>?
          </h1>
        </header>
        <TodayPlannedCard today={today} defaultDiners={defaultDiners} onStart={() => setFlowOpen(true)} />
        <PantryMatchCard servings={defaultDiners} />
        <section id="despensa" aria-labelledby="despensa-titulo" className="mt-10 scroll-mt-6">
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
