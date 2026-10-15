"use client"

/**
 * FeedbackSection — what beta users tell us (specs/feedback.md): from the
 * «Opinión» button, the web chat or WhatsApp (Mimo's leave_feedback), newest
 * first, with who and from where. The agents read the same list without
 * identity for the morning brief.
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

interface FeedbackItem {
  id: string
  channel: "app" | "chat" | "whatsapp"
  text: string
  page: string | null
  createdAt: string
  username?: string
  email?: string
}

const CHANNEL_LABEL: Record<FeedbackItem["channel"], string> = {
  app: "Botón de la app",
  chat: "Mimo en la web",
  whatsapp: "Mimo por WhatsApp",
}

export function FeedbackSection() {
  const [days, setDays] = useState(30)
  const q = useQuery({
    queryKey: ["admin", "feedback", days],
    queryFn: () => api.get<{ count: number; items: FeedbackItem[] }>(`/admin/feedback?days=${days}`),
  })
  return (
    <section data-testid="feedback-section" className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDays(d)}
            aria-pressed={days === d}
            className={`rounded-full border px-3 py-1.5 ${days === d ? "border-ink bg-ink text-cream" : "border-border bg-paper text-ink"}`}
          >
            Últimos {d} días
          </button>
        ))}
        {q.data && <span className="ml-1">{q.data.count} opiniones</span>}
      </div>
      {q.isLoading && <p className="text-eyebrow">Cargando…</p>}
      {q.data?.count === 0 && <p className="text-[14px] text-ink-muted">Aún no ha llegado ninguna opinión en este periodo.</p>}
      <ul className="space-y-3">
        {(q.data?.items ?? []).map((f) => (
          <li key={f.id} className="rounded-2xl border border-border-soft bg-paper p-4" data-testid="feedback-item">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{f.text}</p>
            <p className="mt-2 text-[12px] text-ink-muted">
              {f.username ?? "—"}
              {f.email ? ` · ${f.email}` : ""} · {CHANNEL_LABEL[f.channel]}
              {f.page ? ` · ${f.page}` : ""} · {new Date(f.createdAt).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
