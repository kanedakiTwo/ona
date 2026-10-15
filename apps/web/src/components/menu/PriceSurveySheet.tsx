"use client"

/**
 * Beta price survey (specs/billing.md): from day 7 after sign-up, once,
 * until launch day, a sheet on /menu asks the four price questions (€/month,
 * whole household, each optional). «Enviar» or «Ahora no» close it for good.
 * The API decides when (`GET /price-survey` → `show`).
 */
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { PriceQuestionKey } from "@ona/shared"
import { api } from "@/lib/api"

type Survey =
  | { show: false }
  | { show: true; title: string; intro: string; questions: Array<{ key: PriceQuestionKey; text: string }> }

const EMPTY: Record<PriceQuestionKey, string> = { tooCheap: "", good: "", expensive: "", tooExpensive: "" }

export function PriceSurveySheet() {
  const qc = useQueryClient()
  const survey = useQuery<Survey>({ queryKey: ["price-survey"], queryFn: () => api.get<Survey>("/price-survey"), staleTime: 5 * 60_000 })
  const [open, setOpen] = useState(false)
  const [answers, setAnswers] = useState(EMPTY)
  const [error, setError] = useState<string | null>(null)
  const [thanks, setThanks] = useState(false)

  // Let the menu paint first, and never on top of another sheet (the
  // install prompt, first steps…): wait until no other modal is open.
  useEffect(() => {
    if (!survey.data?.show || open) return
    const t = setInterval(() => {
      if (!document.querySelector('[role="dialog"][aria-modal="true"]')) {
        setOpen(true)
        clearInterval(t)
      }
    }, 1500)
    return () => clearInterval(t)
  }, [survey.data?.show, open])

  const done = () => qc.setQueryData(["price-survey"], { show: false })
  const send = useMutation({
    mutationFn: (body: Record<PriceQuestionKey, number | null>) => api.post("/price-survey", body),
    onSuccess: () => setThanks(true),
    onError: (e) => setError(e instanceof Error ? e.message : "No hemos podido guardarlo. Inténtalo de nuevo."),
  })
  const dismiss = useMutation({
    mutationFn: () => api.post("/price-survey/dismiss", {}),
    onSettled: () => {
      setOpen(false)
      done()
    },
  })

  if (!open || !survey.data?.show) return null
  const s = survey.data

  function submit() {
    const toNumber = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")))
    const body = Object.fromEntries(s.questions.map((q) => [q.key, toNumber(answers[q.key])])) as Record<PriceQuestionKey, number | null>
    if (Object.values(body).some((n) => n !== null && (!Number.isFinite(n) || n < 0 || n > 500))) {
      setError("Escribe cada precio en euros al mes (por ejemplo, 5 o 4,50).")
      return
    }
    setError(null)
    send.mutate(body)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/30 md:items-center" data-testid="price-survey">
      <div role="dialog" aria-modal="true" aria-labelledby="price-survey-title" className="max-h-[92vh] w-full max-w-[430px] overflow-y-auto rounded-t-3xl bg-cream p-6 pb-[calc(1.5rem+var(--safe-bottom,0px))] shadow-2xl md:rounded-3xl">
        {thanks ? (
          <div role="status">
            <h2 id="price-survey-title" className="font-display text-[26px] leading-tight text-ink">¡Gracias!</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-mid">Nos ayuda muchísimo a poner un precio justo.</p>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                done()
              }}
              className="mt-6 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-ink px-6 text-[15px] font-medium text-cream"
            >
              Cerrar
            </button>
          </div>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Beta · 1 minuto</p>
            <h2 id="price-survey-title" className="mt-1 font-display text-[26px] leading-tight text-ink">{s.title}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-mid">{s.intro}</p>
            <p className="mt-2 text-[13px] text-ink-muted">En euros al mes, para todo tu hogar. Contesta solo las que quieras.</p>
            <div className="mt-5 space-y-4">
              {s.questions.map((q) => (
                <label key={q.key} className="block">
                  <span className="text-[14px] leading-snug text-ink">{q.text}</span>
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
                      className="w-28 rounded-xl border border-border bg-paper px-3 py-2 text-[15px] text-ink"
                    />
                    <span className="text-[13px] text-ink-muted">€/mes</span>
                  </span>
                </label>
              ))}
            </div>
            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-warn-bg px-4 py-3 text-[13px] text-terracotta-deep">
                {error}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                disabled={send.isPending}
                onClick={submit}
                className="inline-flex min-h-[48px] items-center justify-center rounded-full bg-ink px-6 text-[15px] font-medium text-cream disabled:opacity-50"
              >
                Enviar
              </button>
              <button
                type="button"
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate()}
                className="inline-flex min-h-[44px] items-center justify-center text-[14px] text-ink-muted underline underline-offset-4"
              >
                Ahora no
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
