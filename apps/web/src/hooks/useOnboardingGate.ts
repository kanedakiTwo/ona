"use client"

/**
 * PRO-178: /menu without the sign-up finished goes to /onboarding (where the
 * sign-up resumes on the step it was left). Accounts the browser already
 * knows as onboarded pass straight through, with no extra request. Otherwise
 * the server decides (`GET /user/:id` → `onboardingRequired`): finished on
 * another device or by WhatsApp → the page shows; a member who joined
 * someone else's household by invitation → the page shows; still pending →
 * `/onboarding`. A failed check never blocks the menu, and neither does one
 * still unanswered after API_SLOW_MS (8 s): it used to leave /menu on a
 * near-empty «Cargando...» for good (Windows app, 2026-10-21). If the late
 * answer says the sign-up is pending, it still goes to `/onboarding`.
 *
 * Only the answer fetched for this visit counts (2026-10-22). A disabled query
 * still hands back what an earlier visit cached: an account that reached
 * /menu before finishing the sign-up (logging in lands there) kept «pending»
 * in the cache, and after finishing it /menu sent it back to /onboarding,
 * which sent it to /menu, for good. Finishing the sign-up also writes the new
 * state into the gate's cache (`markOnboardedInCache`).
 */
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useQuery, type QueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { useSlowLoad } from "@/components/profile/SubLoadError"

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

  // What the server said for this visit; never an earlier visit's cached answer.
  const fresh = !knownDone && status.isFetchedAfterMount ? status.data : undefined
  const required = fresh?.onboardingRequired === true
  const { slow } = useSlowLoad(Boolean(user) && !knownDone && !fresh && !status.isError)
  useEffect(() => {
    if (!fresh) return
    if (fresh.onboardingRequired) router.replace("/onboarding")
    else if (fresh.onboardingDone) updateUser({ onboardingDone: true })
  }, [fresh, router, updateUser])

  if (isLoading || !user) return "checking"
  if (knownDone || status.isError) return "ok"
  if (slow && !required) return "ok"
  if (!fresh || required) return "checking"
  return "ok"
}

/**
 * The sign-up just finished: the gate's cached answer says so. Only the gate's: /onboarding
 * still shows what comes after (the WhatsApp sign-up's «Tu menú está listo») and leaves by itself.
 */
export function markOnboardedInCache(queryClient: QueryClient, userId: string): void {
  queryClient.setQueryData(["onboarding-gate", userId], (prev: object | undefined) => ({ ...(prev ?? {}), onboardingDone: true, onboardingRequired: false }))
}
