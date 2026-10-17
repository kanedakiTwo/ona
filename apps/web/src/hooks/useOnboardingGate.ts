"use client"

/**
 * PRO-178: /menu without the sign-up finished goes to /onboarding (where the
 * sign-up resumes on the step it was left). Accounts the browser already
 * knows as onboarded pass straight through, with no extra request. Otherwise
 * the server decides (`GET /user/:id` → `onboardingRequired`): finished on
 * another device or by WhatsApp → the page shows; a member who joined
 * someone else's household by invitation → the page shows; still pending →
 * `/onboarding`. A failed check never blocks the menu.
 */
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

interface OnboardingStatus {
  onboardingDone?: boolean | null
  onboardingRequired?: boolean
}

export function useOnboardingGate(): "ok" | "checking" {
  const { user, isLoading, updateUser } = useAuth()
  const router = useRouter()
  const knownDone = Boolean(user?.onboardingDone)
  const status = useQuery({
    queryKey: ["onboarding-gate", user?.id],
    queryFn: () => api.get<OnboardingStatus>(`/user/${user!.id}`),
    enabled: Boolean(user) && !knownDone,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })

  const required = status.data?.onboardingRequired === true
  useEffect(() => {
    if (!status.data) return
    if (status.data.onboardingRequired) router.replace("/onboarding")
    else if (status.data.onboardingDone) updateUser({ onboardingDone: true })
  }, [status.data, router, updateUser])

  if (isLoading || !user) return "checking"
  if (knownDone || status.isError) return "ok"
  if (!status.data || required) return "checking"
  return "ok"
}
