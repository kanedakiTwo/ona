"use client"

import { useAuth } from "@/lib/auth"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import OnboardingFlow from "@/components/onboarding/OnboardingFlow"

export default function OnboardingPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
    if (!isLoading && user?.onboardingDone) {
      // Straight to /menu ("/" only bounces onboarded users there), so it
      // doesn't race OnboardingFlow's own push("/menu") through the landing.
      router.push("/menu")
    }
  }, [user, isLoading, router])

  if (isLoading || !user) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-cream">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted" role="status">Cargando...</p>
      </div>
    )
  }

  return <OnboardingFlow />
}
