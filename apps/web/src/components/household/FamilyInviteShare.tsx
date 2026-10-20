"use client"

/**
 * «Enviar por WhatsApp» + «Copiar» for an invitation to THIS household
 * (PRO-260, D-088; specs/household.md → «Invitar al hogar por WhatsApp»).
 * WhatsApp opens with the message already written and the link
 * (`familyInviteShareText`); «Copiar» copies the same message. The first tap
 * of either stamps the invite as sent (`POST /households/me/invites/:id/shared`),
 * which `/admin/usage` counts per moment (PRO-263).
 *
 * Not «Invitar a otro hogar» (PRO-163, `components/referrals/`), which brings
 * a different household to Mimoia.
 */
import { useState } from "react"
import { Check, Copy, MessageCircle } from "lucide-react"
import { familyInviteShareText, householdInvitePath, whatsappShareHref } from "@ona/shared"
import { api } from "@/lib/api"

export function familyInviteUrl(token: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return `${origin}${householdInvitePath(token)}`
}

export function FamilyInviteShare({
  inviteId,
  token,
  className = "",
}: {
  inviteId: string
  token: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const message = familyInviteShareText(familyInviteUrl(token))

  function markShared() {
    void api.post(`/households/me/invites/${inviteId}/shared`).catch(() => {})
  }

  async function copy() {
    markShared()
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked: WhatsApp still works.
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <a
        href={whatsappShareHref(message)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={markShared}
        data-testid="family-invite-whatsapp"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-cream focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <MessageCircle size={16} /> Enviar por WhatsApp
      </a>
      <button
        type="button"
        onClick={() => void copy()}
        data-testid="family-invite-copy"
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-ink px-5 text-[14px] font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copiado" : "Copiar"}
      </button>
      {copied && (
        <span role="status" className="sr-only">
          Mensaje copiado.
        </span>
      )}
    </div>
  )
}
