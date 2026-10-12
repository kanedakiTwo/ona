"use client"

import { useAuth } from "@/lib/auth"
import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import OnboardingFlow from "@/components/onboarding/OnboardingFlow"

export default function OnboardingPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  // Onboarded already when this page first saw the user? Only then does the
  // page redirect: when the flow itself finishes, OnboardingFlow /
  // OnboardingWhatsApp navigate (OnboardingFlow may open next week's menu,
  // PRO-65, and a second push("/menu") here would race it).
  const onboardedOnArrival = useRef<boolean | null>(null)

  useEffect(() => {
    if (!isLoading && !user) {
      router.push("/login")
    }
    if (!isLoading && user && onboardedOnArrival.current === null) {
      onboardedOnArrival.current = Boolean(user.onboardingDone)
    }
    if (!isLoading && user?.onboardingDone && onboardedOnArrival.current) {
      // Straight to /menu ("/" only bounces onboarded users there).
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
