"use client"

import { useAuth } from "@/lib/auth"
import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import type { OnboardingDraft } from "@ona/shared"
import { api } from "@/lib/api"
import OnboardingFlow from "@/components/onboarding/OnboardingFlow"

export default function OnboardingPage() {
  const { user, isLoading, updateUser } = useAuth()
  const router = useRouter()
  // PRO-178: where the sign-up was left (any device), and whether it was
  // finished elsewhere (WhatsApp, another browser) since this one cached it.
  const status = useQuery({
    queryKey: ["onboarding-status", user?.id],
    queryFn: () => api.get<{ onboardingDone?: boolean | null; onboardingDraft?: OnboardingDraft | null }>(`/user/${user!.id}`),
    enabled: Boolean(user) && !user?.onboardingDone,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
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
    if (status.data?.onboardingDone && user && !user.onboardingDone) {
      onboardedOnArrival.current = true
      updateUser({ onboardingDone: true })
    }
    if (!isLoading && user?.onboardingDone && onboardedOnArrival.current) {
      // Straight to /menu ("/" only bounces onboarded users there).
      router.push("/menu")
    }
  }, [user, isLoading, router, status.data, updateUser])

  const statusPending = Boolean(user) && !user?.onboardingDone && status.isPending
  if (isLoading || !user || statusPending || status.data?.onboardingDone) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-cream">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted" role="status">Cargando...</p>
      </div>
    )
  }

  return <OnboardingFlow draft={status.data?.onboardingDraft ?? null} />
}
