"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { HEALTH_CONSENT_TEXT, type HealthConsentState } from "@ona/shared"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"

/**
 * One-time screen for accounts that already held health data before the
 * consent existed (RGPD art. 9, PRO-21). The server says when it's needed
 * (`needsPrompt`: data on file, no consent and no withdrawal on record);
 * either answer records a date, so it never comes back. "No" deletes the data.
 */
export function HealthConsentGate() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    api
      .get<HealthConsentState>(`/user/${user.id}/health-consent`)
      .then((s) => {
        if (!cancelled && s?.needsPrompt) setOpen(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user?.id])

  async function answer(consent: boolean) {
    if (!user || busy) return
    setBusy(true)
    try {
      await api.post(`/user/${user.id}/health-consent`, { consent })
      setOpen(false)
    } catch {
      // Stay open: the answer wasn't recorded.
    } finally {
      setBusy(false)
    }
  }

  if (!open || typeof document === "undefined") return null
  const [lead] = HEALTH_CONSENT_TEXT.split("Más información en la política de privacidad.")

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#1A1612]/50 lg:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="health-consent-title"
        className="w-full max-w-[480px] rounded-t-[28px] bg-[#FAF6EE] px-5 pt-6 pb-[max(var(--safe-bottom),20px)] lg:rounded-[28px] lg:pb-6"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7A7066]">Tus datos de salud</p>
        <h2 id="health-consent-title" className="mt-1 font-serif-text text-[1.4rem] font-[650] leading-tight text-[#1A1612]">
          ¿Seguimos guardándolos?
        </h2>
        <p className="mt-3 text-[14px] leading-relaxed text-[#1A1612]">
          Tienes guardados datos de salud (alergias, restricciones o datos físicos). Para seguir usándolos necesitamos tu
          consentimiento explícito:
        </p>
        <p className="mt-3 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-3 text-[13px] leading-snug text-[#1A1612]">
          «{lead.trim()}» Más información en la{" "}
          <Link href="/privacidad" className="underline">
            política de privacidad
          </Link>
          .
        </p>
        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => answer(true)}
            className="flex h-12 items-center justify-center rounded-full bg-[#1A1612] text-[15px] font-semibold text-[#FAF6EE] disabled:opacity-50"
          >
            Sí, consiento
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => answer(false)}
            className="flex h-12 items-center justify-center rounded-full border border-[#DDD6C5] text-[15px] text-[#1A1612] disabled:opacity-50"
          >
            No, borra esos datos
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
