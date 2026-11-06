"use client"

import { useState } from "react"
import Link from "next/link"
import { usePendingSignUp } from "@/hooks/useOnboardingGate"

/**
 * PRO-1042: the menu is already there (Mimo made it by WhatsApp, or the
 * account came through the API) and the sign-up isn't finished. /menu shows
 * the menu and offers the rest of the sign-up here, apart, instead of
 * sending back to its first question as if Mimo knew nothing.
 * /onboarding opens with those answers filled in. «Ahora no» hides it for
 * this visit.
 */
export function PendingSignUpCard() {
  const pending = usePendingSignUp()
  const [hidden, setHidden] = useState(false)
  if (!pending || hidden) return null
  return (
    <section
      data-testid="pending-sign-up"
      aria-label="Termina tu alta"
      className="mx-5 mt-3 rounded-2xl border border-border-soft bg-paper px-4 py-4 lg:mx-0"
    >
      <p className="font-serif-text text-[18px] font-[650] leading-snug text-ink">Te quedan unas preguntas del alta</p>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">
        Tu menú ya está hecho. Con ellas afino las próximas semanas, y lo que ya me contaste va rellenado.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <Link
          href="/onboarding"
          className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[14px] font-semibold text-cream"
        >
          Terminar el alta
        </Link>
        <button type="button" onClick={() => setHidden(true)} className="text-[14px] font-semibold text-ink-muted">
          Ahora no
        </button>
      </div>
    </section>
  )
}
