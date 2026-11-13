"use client"

/**
 * EmailQuestionSection — «Pregunta por correo» (PRO-1197).
 *
 * The one email Miguel sends to the households that left the beta (14 days
 * without activity). Subject, sender and footer are fixed; the body is the
 * approved text, pasted here (each person's «Hola, Nombre:» goes on top).
 * The exact count and why the rest are out, the email as it will go, and one
 * button that asks to confirm. Each household gets it once, ever.
 * Spec: specs/admin-dashboard.md.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

type Reason = "activo" | "interna" | "prueba" | "suspendida" | "baja" | "ya_enviada"

interface Status {
  count: number
  excluded: Record<Reason, number>
  configured: boolean
  inactiveDays: number
  sent: number
  failed: number
  lastSentAt: string | null
  email: { subject: string; from: string; footer: string; minChars: number; maxChars: number }
}

interface SendResult {
  sent: number
  failed: number
  skipped: number
}

const REASON_LABEL: Record<Reason, [string, string]> = {
  activo: ["activo", "activos"],
  interna: ["con cuenta interna", "con cuentas internas"],
  prueba: ["de prueba", "de prueba"],
  suspendida: ["con cuenta suspendida", "con cuentas suspendidas"],
  baja: ["pidió BAJA o «No, gracias»", "pidieron BAJA o «No, gracias»"],
  ya_enviada: ["ya lo recibió", "ya lo recibieron"],
}

const hogares = (n: number) => `${n} ${n === 1 ? "hogar" : "hogares"}`

/** The body as the API sends it (services/emailQuestion.ts `cleanBody`): tidy paragraphs, no pasted greeting. */
function cleanBody(raw: string): string {
  const paras = raw
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.split("\n").map((l) => l.trim()).join("\n").trim())
    .filter(Boolean)
  if (paras.length > 0 && /^hola\b[^\n]{0,40}:$/i.test(paras[0])) paras.shift()
  return paras.join("\n\n")
}

export function EmailQuestionSection() {
  const qc = useQueryClient()
  const [body, setBody] = useState("")
  const status = useQuery({
    queryKey: ["admin", "email-question"],
    queryFn: () => api.get<Status>("/admin/email-question"),
  })
  const send = useMutation({
    mutationFn: (expectedCount: number) => api.post<SendResult>("/admin/email-question/send", { body, expectedCount }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["admin", "email-question"] }),
  })

  const s = status.data
  const text = cleanBody(body)
  const validBody = !!s && text.length >= s.email.minChars && text.length <= s.email.maxChars
  const confirmSend = () => {
    if (!s || s.count === 0 || !validBody) return
    const msg = `¿Enviar «${s.email.subject}» a ${hogares(s.count)}?\n\nUn correo a cada uno, de «${s.email.from}». Cada hogar lo recibe una sola vez. No se puede deshacer.`
    if (window.confirm(msg)) send.mutate(s.count)
  }

  if (status.isLoading) return <p className="text-[13px] text-ink-muted">Contando hogares…</p>
  if (status.isError || !s) return <p className="text-[13px] text-warn-text">No se ha podido contar.</p>

  return (
    <section data-testid="email-question-section" className="space-y-6">
      <div className="space-y-3 rounded-2xl border border-border-soft bg-paper p-4">
        <p className="text-[18px] text-ink">
          <strong data-testid="email-question-count">{s.count}</strong> {s.count === 1 ? "hogar lo recibirá" : "hogares lo recibirán"}
        </p>
        <p className="text-[13px] text-ink-muted">Hogares sin actividad en {s.inactiveDays} días.</p>
        {Object.values(s.excluded).some((n) => n > 0) && (
          <p className="text-[13px] text-ink-muted" data-testid="email-question-excluded">
            Fuera:{" "}
            {(Object.keys(REASON_LABEL) as Reason[])
              .filter((r) => s.excluded[r] > 0)
              .map((r) => `${hogares(s.excluded[r])} ${REASON_LABEL[r][s.excluded[r] === 1 ? 0 : 1]}`)
              .join(" · ")}
          </p>
        )}
        {!s.configured && <p className="text-[13px] text-warn-text">El correo no está configurado en este entorno (RESEND_API_KEY): no se puede enviar.</p>}
        {s.sent + s.failed > 0 && (
          <p data-testid="email-question-sent" className="rounded-lg bg-cream px-3 py-2 text-[14px] text-ink">
            Ya enviado a {hogares(s.sent)}
            {s.lastSentAt ? ` (${new Date(s.lastSentAt).toLocaleDateString("es-ES", { dateStyle: "medium" })})` : ""}.
            {s.failed > 0 && ` ${s.failed} no se ${s.failed === 1 ? "ha" : "han"} podido enviar (no se reintentan).`}
          </p>
        )}
        <button
          type="button"
          onClick={confirmSend}
          disabled={s.count === 0 || !s.configured || !validBody || send.isPending}
          className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-cream disabled:opacity-40"
        >
          {send.isPending ? "Enviando…" : `Pregunta por correo a ${hogares(s.count)}`}
        </button>
        {s.count > 0 && !validBody && <p className="text-[12px] text-ink-muted">Pega abajo el texto del correo para poder enviarlo.</p>}
        {send.isError && <p className="text-[12px] text-warn-text">{(send.error as Error).message || "No se ha podido enviar."}</p>}
        {send.data && (
          <p data-testid="email-question-result" className="text-[14px] text-ink">
            Enviado a {hogares(send.data.sent)}.
            {send.data.failed > 0 && ` ${send.data.failed} no se ${send.data.failed === 1 ? "ha" : "han"} podido enviar (no se reintentan).`} Las respuestas
            llegan a hola@.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">El correo</h2>
        <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
          Texto del correo (pega el aprobado; el «Hola, Nombre:» y el pie los pone Mimoia)
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              send.reset()
            }}
            rows={10}
            maxLength={s.email.maxChars + 200}
            className="rounded-lg border border-border px-3 py-2 text-[15px] leading-relaxed text-ink"
          />
          <span className="text-right text-[11px]">
            {text.length} / {s.email.maxChars}
          </span>
        </label>
        {!validBody && text.length > 0 && <p className="text-[12px] text-ink-muted">El texto necesita al menos {s.email.minChars} caracteres.</p>}
        <div data-testid="email-question-preview" className="rounded-2xl border border-border-soft bg-paper p-4 text-[14px] text-ink">
          <p className="text-[13px] text-ink-muted">
            De: {s.email.from} · Asunto: <span data-testid="email-question-subject">{s.email.subject}</span>
          </p>
          <p className="mt-3 whitespace-pre-line leading-relaxed">{`Hola, Nombre:\n\n${text || "…"}`}</p>
          <p className="mt-4 border-t border-border-soft pt-3 text-[12px] text-ink-muted">{s.email.footer}</p>
        </div>
      </div>
    </section>
  )
}
