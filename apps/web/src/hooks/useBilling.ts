/**
 * Subscription state of the caller's household (specs/billing.md).
 */
import { useMutation, useQuery } from "@tanstack/react-query"
import type { BillingPeriod, BillingState, PlanKey } from "@ona/shared"
import { api } from "@/lib/api"

export function useBilling(opts: { enabled?: boolean; poll?: boolean } = {}) {
  return useQuery<BillingState>({
    queryKey: ["billing"],
    queryFn: () => api.get<BillingState>("/billing"),
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
    // Right after paying, the webhook may land a few seconds after the redirect.
    refetchInterval: (q) => (opts.poll && !q.state.data?.subscription ? 2_000 : false),
  })
}

/** Opens Stripe Checkout for a plan (full-page redirect). */
export function useCheckout() {
  return useMutation({
    mutationFn: (body: { plan: PlanKey; period: BillingPeriod }) => api.post<{ url: string }>("/billing/checkout", body),
    onSuccess: ({ url }) => {
      window.location.assign(url)
    },
  })
}

/** Opens Stripe's customer portal (change card, receipts, change plan, cancel). */
export function usePortal() {
  return useMutation({
    mutationFn: () => api.post<{ url: string }>("/billing/portal", {}),
    onSuccess: ({ url }) => {
      window.location.assign(url)
    },
  })
}
