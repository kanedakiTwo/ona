"use client"

/**
 * /afinar — «Afina tu menú» (PRO-146, specs/taste.md): recipes one at a
 * time, full screen (no tab bar, no Mimo button), centred column on desktop.
 * `?empezar=1` (from «Empezar» on the menu) skips the intro.
 *
 * Its own way out (2026-10-21, a friend of Miguel's in the installed app on
 * Windows: «no sale menú de navegación para ir atrás o al menú principal»):
 * a «‹ Perfil» / «‹ Menú» link back to the page it came from — the installed
 * app has no browser back button — and, from `md`, the desktop sidebar stays
 * visible beside the screen.
 */
import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { TasteSwiper } from "@/components/taste/TasteSwiper"
import { backTarget, previousPathBefore } from "@/lib/navHistory"

export default function AfinarPage() {
  const router = useRouter()
  // Read once on the client (avoids a Suspense boundary for useSearchParams).
  const [startAtCards, setStartAtCards] = useState<boolean | null>(null)
  useEffect(() => {
    setStartAtCards(new URLSearchParams(window.location.search).get("empezar") === "1")
  }, [])
  // Where «‹ …» goes: the page this one was opened from (fixed on arrival).
  const [back] = useState(() => backTarget(previousPathBefore("/afinar")))

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-cream text-ink md:left-[var(--sidebar-width)]" data-testid="afinar">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
        <nav aria-label="Volver" className="px-3 pt-2">
          <Link
            href={back.href}
            draggable={false}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-[14px] text-ink-mid transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
          >
            <ChevronLeft size={16} strokeWidth={1.8} aria-hidden="true" />
            {back.label}
          </Link>
        </nav>
        {startAtCards !== null && (
          <TasteSwiper mode="page" compactTop startAtCards={startAtCards} onViewMenu={() => router.push("/menu")} />
        )}
      </div>
    </div>
  )
}
