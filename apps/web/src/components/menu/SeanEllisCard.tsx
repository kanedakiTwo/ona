"use client"

/**
 * The Sean Ellis survey (PRO-334, specs/feedback.md): once, a card on /menu
 * for the beta adults who have used Mimoia for two weeks and don't talk to
 * Mimo on WhatsApp (there Mimo asks it). One of four answers and an
 * optional «¿Por qué?»; «Enviar» or «Ahora no» close it for good. The API
 * decides who sees it and sends the text (`GET /sean-ellis`).
 */
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

type Answer = "muy" | "algo" | "nada" | "ya_no"
type Survey =
  | { show: false }
  | { show: true; question: string; options: Array<{ key: Answer; label: string }>; why: string }

export function SeanEllisCard() {
  const qc = useQueryClient()
  const survey = useQuery<Survey>({
    queryKey: ["sean-ellis"],
    queryFn: () => api.get<Survey>("/sean-ellis"),
    staleTime: 5 * 60_000,
    retry: false,
  })
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [why, setWhy] = useState("")
  const [thanks, setThanks] = useState(false)
  const close = () => qc.setQueryData<Survey>(["sean-ellis"], { show: false })
  const send = useMutation({
    mutationFn: () => api.post("/sean-ellis", { answer, why: why.trim() || undefined, channel: "app" }),
    onSuccess: () => setThanks(true),
  })
  const dismiss = useMutation({
    mutationFn: () => api.post("/sean-ellis/dismiss", {}),
    onSettled: close,
  })

  const data = survey.data
  if (!data?.show || dismiss.isPending) return null

  if (thanks) {
    return (
      <section
        data-testid="sean-ellis"
        role="status"
        className="mx-5 mt-3 flex items-center justify-between gap-3 rounded-[18px] border border-border-soft bg-paper p-[18px] lg:mx-0"
      >
        <p className="m-0 text-[15px] leading-[1.5] text-ink">¡Gracias! Nos ayuda a decidir qué mejorar.</p>
        <button type="button" onClick={close} className="min-h-[44px] shrink-0 rounded-full border border-border px-[18px] text-[14px] text-ink">
          Cerrar
        </button>
      </section>
    )
  }

  return (
    <section
      data-testid="sean-ellis"
      aria-labelledby="sean-ellis-title"
      className="mx-5 mt-3 flex flex-col gap-3 rounded-[18px] border border-border-soft bg-paper p-[18px] lg:mx-0"
    >
      <p className="m-0 text-[11.2px] font-medium uppercase tracking-[0.18em] text-terracotta-deep">Una pregunta rápida</p>
      <h2 id="sean-ellis-title" className="m-0 font-display text-[20px] font-[650] leading-[1.15] text-ink">
        {data.question}
      </h2>
      <div role="radiogroup" aria-labelledby="sean-ellis-title" className="flex flex-col gap-2">
        {data.options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={answer === o.key}
            onClick={() => setAnswer(o.key)}
            className={`min-h-[44px] rounded-xl border px-4 py-2 text-left text-[15px] ${
              answer === o.key ? "border-ink bg-ink text-cream" : "border-border bg-cream text-ink"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {answer && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] text-ink-mid">{data.why} (opcional)</span>
          <textarea
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            maxLength={2000}
            rows={2}
            className="rounded-xl border border-border bg-cream px-3 py-2 text-[15px] text-ink"
          />
        </label>
      )}
      {send.isError && (
        <p role="alert" className="m-0 text-[13px] text-terracotta-deep">
          No hemos podido guardarlo. Inténtalo de nuevo.
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!answer || send.isPending}
          onClick={() => send.mutate()}
          className="flex min-h-[48px] flex-1 items-center justify-center rounded-full bg-ink text-[15px] font-medium text-cream disabled:opacity-50"
        >
          Enviar
        </button>
        <button
          type="button"
          onClick={() => dismiss.mutate()}
          className="min-h-[48px] rounded-full border border-border px-[18px] text-[15px] text-ink"
        >
          Ahora no
        </button>
      </div>
    </section>
  )
}
