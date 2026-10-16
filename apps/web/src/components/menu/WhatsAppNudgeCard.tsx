"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { MessageCircle } from "lucide-react"
import { api } from "@/lib/api"
import { useWhatsAppStatus } from "@/hooks/useWhatsApp"

/**
 * The one WhatsApp reminder (PRO-107, specs/whatsapp.md): whoever didn't
 * connect WhatsApp in the sign-up sees this card on /menu once, after their
 * first week is resolved. The API decides when (`GET /whatsapp/status` →
 * `nudge`); showing it stamps it (`POST /whatsapp/nudge/seen`), so it never
 * comes back — after «Ahora no», a reload or on another device.
 */
export function WhatsAppNudgeCard() {
  const status = useWhatsAppStatus()
  const [hidden, setHidden] = useState(false)
  const stamped = useRef(false)
  const show = Boolean(status.data?.nudge) && !hidden

  useEffect(() => {
    if (!show || stamped.current) return
    stamped.current = true
    api.post("/whatsapp/nudge/seen").catch(() => {})
  }, [show])

  if (!show) return null
  return (
    <section
      data-testid="whatsapp-nudge"
      aria-label="Mimo en WhatsApp"
      className="mx-5 mt-3 rounded-2xl border border-border-soft bg-paper px-4 py-4 lg:mx-0"
    >
      <p className="font-serif-text text-[18px] font-[650] leading-snug text-ink">¿Te lo mando por WhatsApp?</p>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">
        Le escribes a Mimo «¿qué cenamos?» y te contesta con tu menú.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <Link
          href="/whatsapp/conectar"
          className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[14px] font-semibold text-cream"
        >
          <MessageCircle size={16} aria-hidden="true" /> Conectar WhatsApp
        </Link>
        <button type="button" onClick={() => setHidden(true)} className="text-[14px] font-semibold text-ink-muted">
          Ahora no
        </button>
      </div>
    </section>
  )
}
