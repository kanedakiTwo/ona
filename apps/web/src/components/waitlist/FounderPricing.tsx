"use client"

import { useState } from "react"
import {
  FOUNDER_CTA,
  FOUNDER_DECLINE_LABELS,
  FOUNDER_DECLINE_REASONS,
  FOUNDER_FOOTER,
  FOUNDER_FOOTER_BETA,
  FOUNDER_HOUSEHOLD,
  FOUNDER_NONE,
  FOUNDER_PLANS,
  FOUNDER_RESERVE_NOTE,
  FOUNDER_SUBTITLE,
  FOUNDER_TITLE,
  PRICE_QUESTIONS,
  founderPlanById,
  type FounderDeclineReason,
  type FounderPlanId,
  type PriceQuestionKey,
} from "@ona/shared"
import { apiPublic } from "@/lib/api"

type Step = "questions" | "plans" | "reserved" | "declined"

/**
 * After joining the waitlist (PRO-26): four optional price questions, then
 * — only after answering, so the prices don't anchor the answers — the
 * founder plans and «Reservar mi plaza de fundador». Nothing is charged.
 * The entry's opt-out token is the credential.
 */
export function FounderPricing({ token, beta }: { token: string; beta: boolean }) {
  const [step, setStep] = useState<Step>("questions")
  const [answers, setAnswers] = useState<Record<PriceQuestionKey, string>>({
    tooCheap: "",
    good: "",
    expensive: "",
    tooExpensive: "",
  })
  const [selected, setSelected] = useState<FounderPlanId>("plus-anual")
  const [reserved, setReserved] = useState<FounderPlanId | null>(null)
  const [noneOpen, setNoneOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(path: string, body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      await apiPublic.post(path, { token, ...body })
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : "No hemos podido guardarlo. Inténtalo de nuevo.")
      return false
    } finally {
      setBusy(false)
    }
  }

  async function submitAnswers() {
    const toNumber = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")))
    const body = Object.fromEntries(PRICE_QUESTIONS.map((q) => [q.key, toNumber(answers[q.key])]))
    if (Object.values(body).some((n) => n !== null && (!Number.isFinite(n) || n < 0 || n > 500))) {
      setError("Escribe cada precio en euros al mes (por ejemplo, 5 o 4,50).")
      return
    }
    if (Object.values(body).every((n) => n === null) || (await send("/waitlist/pricing", body))) setStep("plans")
  }

  async function reserve() {
    if (await send("/waitlist/reservation", { choice: selected })) {
      setReserved(selected)
      setStep("reserved")
    }
  }

  async function decline(reason: FounderDeclineReason) {
    if (await send("/waitlist/reservation", { choice: "ninguno", reason })) setStep("declined")
  }

  async function cancel() {
    if (await send("/waitlist/reservation", { choice: "anular" })) {
      setReserved(null)
      setStep("plans")
    }
  }

  return (
    <div className="mt-10 border-t border-dashed border-[#DDD6C5] pt-8" data-testid="founder-pricing">
      {error && (
        <p role="alert" className="mb-4 rounded-xl border border-[#C65D38]/30 bg-[#FDEEE8] px-4 py-3 text-[13px] text-[#B5451B]">
          {error}
        </p>
      )}

      {step === "questions" && (
        <div>
          <h4 className="font-display text-2xl text-[#1A1612]">Una pregunta más: el precio</h4>
          <p className="mt-3 text-sm leading-relaxed text-[#4A4239]">
            Cuatro preguntas opcionales, en euros al mes y para todo tu hogar. Nos ayudan a poner un precio justo.
          </p>
          <div className="mt-6 space-y-5">
            {PRICE_QUESTIONS.map((q) => (
              <label key={q.key} className="block">
                <span className="text-[14px] leading-snug text-[#1A1612]">{q.text}</span>
                <span className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={500}
                    step="0.5"
                    name={q.key}
                    value={answers[q.key]}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                    placeholder="0"
                    className="w-28 rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-2 text-[15px] text-[#1A1612]"
                  />
                  <span className="text-[13px] text-[#7A7066]">€/mes</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              disabled={busy}
              onClick={submitAnswers}
              className="rounded-full bg-[#1A1612] px-6 py-3 text-[14px] font-medium text-[#FAF6EE] disabled:opacity-50"
            >
              Seguir
            </button>
            <button type="button" onClick={() => setStep("plans")} className="text-[13px] text-[#7A7066] underline">
              Prefiero no contestar
            </button>
          </div>
        </div>
      )}

      {step === "plans" && (
        <div>
          <h4 className="font-display text-2xl text-[#1A1612]">
            {FOUNDER_TITLE} <span className="font-italic italic text-[#C65D38]">· {FOUNDER_SUBTITLE}</span>
          </h4>
          <div className="mt-6 grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Planes">
            {FOUNDER_PLANS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected === p.id}
                data-testid={`plan-${p.id}`}
                onClick={() => setSelected(p.id)}
                className={`flex flex-col rounded-2xl border p-4 text-left transition-colors ${
                  selected === p.id ? "border-[#1A1612] bg-[#FFFEFA]" : "border-[#DDD6C5] bg-transparent"
                } ${p.featured ? "ring-2 ring-[#C65D38]/40" : ""}`}
              >
                {p.featured && (
                  <span className="mb-2 self-start rounded-full bg-[#C65D38] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#FAF6EE]">
                    Recomendada
                  </span>
                )}
                <span className="text-[15px] font-semibold text-[#1A1612]">{p.name}</span>
                <span className="mt-1 font-display text-2xl text-[#1A1612]">{p.price}</span>
                {p.note && <span className="text-[13px] text-[#C65D38]">«{p.note}»</span>}
                <span className="mt-1 text-[12px] text-[#7A7066]">{FOUNDER_HOUSEHOLD}</span>
                <ul className="mt-3 space-y-1 text-[13px] text-[#1A1612]">
                  {p.bullets.map((b) => (
                    <li key={b}>· {b}</li>
                  ))}
                </ul>
                <span className="mt-3 text-[11px] leading-snug text-[#7A7066]">{p.finePrint}</span>
              </button>
            ))}
          </div>
          <p className="mt-5 text-[13px] leading-relaxed text-[#4A4239]">{beta ? FOUNDER_FOOTER_BETA : FOUNDER_FOOTER}.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              disabled={busy}
              onClick={reserve}
              className="rounded-full bg-[#1A1612] px-6 py-3.5 text-[14px] font-medium text-[#FAF6EE] disabled:opacity-50"
            >
              {FOUNDER_CTA}
            </button>
            <button
              type="button"
              onClick={() => setNoneOpen((v) => !v)}
              aria-expanded={noneOpen}
              className="rounded-full border border-[#DDD6C5] px-6 py-3.5 text-[14px] text-[#1A1612]"
            >
              {FOUNDER_NONE}
            </button>
          </div>
          <p className="mt-3 text-[12px] text-[#7A7066]">{FOUNDER_RESERVE_NOTE}.</p>
          {noneOpen && (
            <div className="mt-5">
              <p className="text-[14px] text-[#1A1612]">¿Por qué?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {FOUNDER_DECLINE_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={busy}
                    onClick={() => decline(r)}
                    className="rounded-full border border-[#DDD6C5] px-4 py-2 text-[13px] text-[#1A1612] hover:border-[#1A1612]"
                  >
                    {FOUNDER_DECLINE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === "reserved" && reserved && (
        <div role="status">
          <h4 className="font-display text-2xl text-[#1A1612]">Plaza de fundador reservada</h4>
          <p className="mt-3 text-sm leading-relaxed text-[#4A4239]">
            {founderPlanById(reserved)!.name} · {founderPlanById(reserved)!.price}. No has pagado nada: te avisamos antes de
            cobrar y puedes anular la reserva cuando quieras.
          </p>
          <button type="button" disabled={busy} onClick={cancel} className="mt-4 text-[13px] text-[#7A7066] underline">
            Anular la reserva
          </button>
        </div>
      )}

      {step === "declined" && (
        <div role="status">
          <h4 className="font-display text-2xl text-[#1A1612]">Gracias, nos ayuda mucho</h4>
          <p className="mt-3 text-sm leading-relaxed text-[#4A4239]">
            Sigues en la lista igual. Si cambias de idea, te enseñaremos los planes antes de abrir.
          </p>
        </div>
      )}
    </div>
  )
}
