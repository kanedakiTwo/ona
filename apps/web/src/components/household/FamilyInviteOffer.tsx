"use client"

/**
 * «Familia en el mismo hogar» offer (PRO-261, D-088; specs/household.md →
 * «Ofrecer la invitación»): shown once in the sign-up (2 adults or more) and
 * once the first time the shopping list opens. «Te preparo el mensaje»
 * creates the invitation (`source` = the moment, for PRO-263) and turns into
 * «Enviar por WhatsApp» + «Copiar» (`FamilyInviteShare`).
 *
 * `useFamilyOfferOnce(moment, wanted)` decides once per mount: when the
 * server says it's due and `wanted` holds, it stamps it as shown (so it never
 * comes back) and keeps it on screen for the rest of this visit.
 */
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Users, X } from "lucide-react"
import { api } from "@/lib/api"
import { FamilyInviteShare } from "./FamilyInviteShare"

export type FamilyOfferMoment = "alta" | "compra"

interface FamilyOfferStatus {
  alta: boolean
  compra: boolean
}

const KEY = ["households", "family-offer"]

export function useFamilyOfferOnce(moment: FamilyOfferMoment, wanted: boolean): { show: boolean; dismiss: () => void } {
  const qc = useQueryClient()
  const status = useQuery<FamilyOfferStatus>({
    queryKey: KEY,
    queryFn: () => api.get("/households/me/family-offer"),
    staleTime: Infinity,
  })
  const [shown, setShown] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const stamped = useRef(false)

  useEffect(() => {
    if (stamped.current || !wanted || !status.data?.[moment]) return
    stamped.current = true
    setShown(true)
    // Never again: not on reload, not after navigating back in this session.
    qc.setQueryData<FamilyOfferStatus>(KEY, (d) => (d ? { ...d, [moment]: false } : d))
    void api.post("/households/me/family-offer", { moment }).catch(() => {})
  }, [wanted, status.data, moment, qc])

  return { show: shown && wanted && !dismissed, dismiss: () => setDismissed(true) }
}

const COPY: Record<FamilyOfferMoment, { title: string; lead: string }> = {
  alta: {
    title: "¿Quieres que la otra persona vea también el menú y la lista?",
    lead: "Te preparo el mensaje con el enlace para que entre en tu casa.",
  },
  compra: {
    title: "Compártela con quien compra contigo",
    lead: "Si entra en tu casa, ve esta lista al momento y lo que tacha uno lo ve el otro.",
  },
}

export function FamilyInviteOffer({
  moment,
  onDismiss,
  className = "",
}: {
  moment: FamilyOfferMoment
  onDismiss: () => void
  className?: string
}) {
  const [invite, setInvite] = useState<{ id: string; token: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const copy = COPY[moment]

  async function prepare() {
    setBusy(true)
    setError(false)
    try {
      const inv = await api.post<{ id: string; token: string }>("/households/me/invites", { role: "member", source: moment })
      setInvite(inv)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      data-testid={`family-invite-offer-${moment}`}
      className={`relative rounded-[20px] border border-border-soft bg-paper p-4 pr-12 ${className}`}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Ahora no"
        className="absolute right-1.5 top-1.5 flex h-11 w-11 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
      >
        <X size={18} />
      </button>
      <p className="flex items-start gap-2 text-[15px] font-medium leading-snug text-ink">
        <Users size={18} className="mt-0.5 shrink-0 text-terracotta" aria-hidden="true" />
        {copy.title}
      </p>
      <p className="mt-1 text-[13px] leading-snug text-ink-muted">{copy.lead}</p>
      {invite ? (
        <FamilyInviteShare inviteId={invite.id} token={invite.token} className="mt-3" />
      ) : (
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={busy}
          data-testid="family-invite-prepare"
          className="mt-3 inline-flex min-h-[44px] items-center rounded-full border border-ink px-5 text-[14px] font-medium text-ink transition-colors hover:bg-cream-deep disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {busy ? "Preparando…" : "Te preparo el mensaje"}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-terracotta-deep">
          No he podido preparar la invitación. Puedes hacerlo desde Perfil → Mi casa.
        </p>
      )}
    </section>
  )
}
