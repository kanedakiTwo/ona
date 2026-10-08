/**
 * WhatsApp channel hooks for the /profile card. See specs/whatsapp.md.
 *
 * Linking is completed from the phone (the user sends the one-time code to
 * ONA's number), so while a code is pending the status query polls until the
 * API reports `linked: true`.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export interface WhatsAppStatus {
  /** Channel configured on the server AND this account is allowed to use it. */
  available: boolean
  linked: boolean
  /** Masked, e.g. "+34 ••• ••• 222". */
  phone: string | null
  notify: boolean
  /** wa.me link to open the chat with Mimo once linked. */
  chatLink: string | null
}

export interface WhatsAppLinkCode {
  code: string
  expiresAt: string
  /** Text the user must send, e.g. "Vincular Mimoia: 4F7K2A". */
  message: string
  /** wa.me deep link with `message` prefilled; null if the server has no display number. */
  waLink: string | null
}

const STATUS_KEY = ["whatsapp", "status"] as const

export function useWhatsAppStatus(opts: { pollWhilePending?: boolean } = {}) {
  return useQuery<WhatsAppStatus>({
    queryKey: STATUS_KEY,
    queryFn: () => api.get<WhatsAppStatus>("/whatsapp/status"),
    staleTime: 30_000,
    refetchInterval: (query) =>
      opts.pollWhilePending && !query.state.data?.linked ? 3_000 : false,
  })
}

export function useWhatsAppLinkCode() {
  return useMutation<WhatsAppLinkCode, Error, void>({
    mutationFn: () => api.post<WhatsAppLinkCode>("/whatsapp/link-code"),
  })
}

export function useWhatsAppNotify() {
  const qc = useQueryClient()
  return useMutation<{ notify: boolean }, Error, boolean>({
    mutationFn: (notify) => api.patch<{ notify: boolean }>("/whatsapp/link", { notify }),
    onSuccess: () => qc.invalidateQueries({ queryKey: STATUS_KEY }),
  })
}

export function useWhatsAppUnlink() {
  const qc = useQueryClient()
  return useMutation<void, Error, void>({
    mutationFn: () => api.delete<void>("/whatsapp/link"),
    onSuccess: () => qc.invalidateQueries({ queryKey: STATUS_KEY }),
  })
}
