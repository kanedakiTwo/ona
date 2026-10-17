"use client"

/**
 * /afinar — «Afina tu menú» (PRO-146, specs/taste.md): recipes one at a
 * time, full screen (no tab bar, no Mimo button), centred column on desktop.
 * `?empezar=1` (from «Empezar» on the menu) skips the intro.
 */
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { TasteSwiper } from "@/components/taste/TasteSwiper"

export default function AfinarPage() {
  const router = useRouter()
  // Read once on the client (avoids a Suspense boundary for useSearchParams).
  const [startAtCards, setStartAtCards] = useState<boolean | null>(null)
  useEffect(() => {
    setStartAtCards(new URLSearchParams(window.location.search).get("empezar") === "1")
  }, [])

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-cream text-ink">
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col pt-[var(--safe-top)] pb-[var(--safe-bottom)]">
        {startAtCards !== null && (
          <TasteSwiper mode="page" startAtCards={startAtCards} onViewMenu={() => router.push("/menu")} />
        )}
      </div>
    </div>
  )
}
