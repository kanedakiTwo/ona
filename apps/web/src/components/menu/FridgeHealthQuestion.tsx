"use client"

import { useState } from "react"
import Link from "next/link"
import type { FridgeHealthAnswer, FridgeHealthQuestion as Question } from "@ona/shared"
import { HealthConsentCheckbox } from "@/components/HealthConsentCheckbox"

/**
 * PRO-295 · the fridge answer talks about an allergy or intolerance («no
 * tomo nada de lactosa, me sienta fatal»): before generating the week, ask
 * whether to save it as a restriction of the diet. Saving needs the health
 * consent of the sign-up; without it, the same box is ticked here. «No,
 * genera sin guardarlo» generates as is.
 */
export function FridgeHealthQuestion({
  question,
  busy,
  onAnswer,
}: {
  question: Question
  busy: boolean
  onAnswer: (answer: FridgeHealthAnswer) => void
}) {
  const [consent, setConsent] = useState(false)
  const known = question.restrictions.length > 0
  const canSave = known && (!question.needsConsent || consent)

  return (
    <div
      className="mx-auto mt-5 max-w-sm rounded-[18px] border border-terracotta/40 bg-terracotta/5 px-4 py-4 text-left"
      role="group"
      aria-label="Alergia o intolerancia en la nevera"
      data-testid="fridge-health-question"
    >
      <p className="text-[15px] font-medium text-ink">
        {known ? (
          <>¿Guardo «{question.restrictions.join(", ")}» en tu dieta?</>
        ) : (
          <>Hablas de una alergia o intolerancia</>
        )}
      </p>
      {question.quote && <p className="mt-1 text-[13px] italic text-ink-soft">«{question.quote}»</p>}
      <p className="mt-2 text-[13px] text-ink-soft">
        {known
          ? "Si la guardo, ningún menú la incluirá. Si no, solo tiro de lo que hay en la nevera."
          : "No sé exactamente cuál. Añádela en tu perfil y genero el menú sin ella, o genera ahora sin guardar nada."}
      </p>
      {known && question.needsConsent && (
        <div className="mt-3">
          <HealthConsentCheckbox checked={consent} onChange={setConsent} disabled={busy} />
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {known ? (
          <button
            type="button"
            disabled={!canSave || busy}
            onClick={() => onAnswer({ decision: "save", ...(question.needsConsent ? { consent: true } : {}) })}
            className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-4 text-[14px] font-semibold text-cream transition-colors hover:bg-forest disabled:opacity-50"
          >
            Sí, guardarla y generar
          </button>
        ) : (
          <Link
            href="/profile"
            className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-4 text-[14px] font-semibold text-cream transition-colors hover:bg-forest"
          >
            Ir a mi perfil
          </Link>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer({ decision: "skip" })}
          className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-paper px-4 text-[14px] text-ink-mid transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
        >
          No, generar sin guardarla
        </button>
      </div>
    </div>
  )
}
