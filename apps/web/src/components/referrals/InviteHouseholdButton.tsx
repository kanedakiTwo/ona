"use client"

/**
 * «Invitar a otro hogar» (PRO-163, D-059; specs/auth.md «Invitar a otro
 * hogar»): opens WhatsApp with the approved message and the account's own
 * link (`GET /referrals/me`, PRO-162); on a computer, «Copiar» too. Each tap
 * counts as `invite_shared` (only the number). Not «Invitar a alguien» in
 * Casa, which brings someone into this household (PRO-118).
 */
import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Copy, Send } from "lucide-react"
import { inviteHouseholdShareText, whatsappShareHref } from "@ona/shared"
import { api } from "@/lib/api"

/** The account's own code and link; `enabled` false (signed out) asks nothing. */
export function useReferralLink(enabled = true) {
  return useQuery<{ code: string; link: string }>({
    queryKey: ["referrals", "me"],
    queryFn: () => api.get("/referrals/me"),
    staleTime: Infinity,
    enabled,
  })
}

function countShare() {
  void api.post("/usage/invite-shared", {}).catch(() => {})
}

export function InviteHouseholdButton({ place, className = "" }: { place: "perfil" | "compra"; className?: string }) {
  const referral = useReferralLink()
  const [copied, setCopied] = useState(false)
  const message = referral.data ? inviteHouseholdShareText(referral.data.link) : null

  async function copy() {
    if (!message) return
    countShare()
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked: the WhatsApp button still works.
    }
  }

  return (
    <section
      data-testid={`invite-household-${place}`}
      className={`rounded-2xl border border-border-soft bg-paper px-4 py-4 ${className}`}
    >
      <p className="text-[15px] font-medium text-ink">¿Conoces otra casa a la que le vendría bien?</p>
      <p className="mt-0.5 text-[13px] leading-snug text-ink-soft">
        Mándale tu enlace para que pruebe Mimoia.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href={message ? whatsappShareHref(message) : undefined}
          aria-disabled={!message}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            if (!message) {
              e.preventDefault()
              return
            }
            countShare()
          }}
          data-testid="invite-household-whatsapp"
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-cream ${
            message ? "" : "pointer-events-none opacity-50"
          }`}
        >
          <Send size={16} /> Invitar a otro hogar
        </a>
        <button
          type="button"
          onClick={copy}
          disabled={!message}
          data-testid="invite-household-copy"
          className="hidden min-h-[44px] items-center gap-2 rounded-full border border-ink px-5 text-[14px] font-medium text-ink disabled:opacity-50 md:inline-flex"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </section>
  )
}
