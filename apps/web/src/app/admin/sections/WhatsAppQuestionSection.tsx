"use client"

/**
 * WhatsAppQuestionSection — «Pregunta única por WhatsApp» (PRO-1091).
 *
 * Customer Success's one question to a group of households: the question
 * (the template's `{{1}}`), the group (sign-up dates and days without
 * activity), the count before sending and one button. Each household gets
 * it once; BAJA, internal accounts and test households stay out. The answers
 * land in Opiniones. Spec: specs/whatsapp.md, specs/admin-dashboard.md.
 */

import { useState } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { FieldLabel, RequiredNote } from "@/components/FieldLabel"

type Reason = "ya_enviada" | "baja" | "interna" | "prueba" | "sin_whatsapp"

interface Preview {
  count: number
  excluded: Record<Reason, number>
  template: string | null
  configured: boolean
}

interface SendResult {
  sent: number
  failed: number
  skipped: number
  remaining: number
}

interface Question {
  id: string
  text: string
  createdAt: string
  sent: number
  failed: number
  answered: number
}

const REASON_LABEL: Record<Reason, [string, string]> = {
  ya_enviada: ["ya la recibió", "ya la recibieron"],
  baja: ["pidió BAJA", "pidieron BAJA"],
  interna: ["cuenta interna", "cuentas internas"],
  prueba: ["hogar de prueba", "hogares de prueba"],
  sin_whatsapp: ["sin WhatsApp", "sin WhatsApp"],
}

const MIN_CHARS = 10
const MAX_CHARS = 900

function isoDay(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" })
}

const hogares = (n: number) => `${n} ${n === 1 ? "hogar" : "hogares"}`

export function WhatsAppQuestionSection() {
  const qc = useQueryClient()
  const today = isoDay(new Date())
  const [text, setText] = useState("")
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)))
  const [to, setTo] = useState(today)
  const [inactiveDays, setInactiveDays] = useState("7")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [result, setResult] = useState<SendResult | null>(null)

  const questions = useQuery({
    queryKey: ["admin", "whatsapp-question"],
    queryFn: () => api.get<{ questions: Question[] }>("/admin/whatsapp-question"),
  })

  const group = () => ({ text, signedUpFrom: from, signedUpTo: to, inactiveDays: Number(inactiveDays) || 0 })
  const count = useMutation({
    mutationFn: () => api.post<Preview>("/admin/whatsapp-question/preview", group()),
    onSuccess: (p) => setPreview(p),
  })
  const send = useMutation({
    mutationFn: (expectedCount: number) => api.post<SendResult>("/admin/whatsapp-question/send", { ...group(), expectedCount }),
    onSuccess: (r) => {
      setResult(r)
      setPreview(null)
      qc.invalidateQueries({ queryKey: ["admin", "whatsapp-question"] })
    },
  })

  /** Any change to the question or the group asks for a new count. */
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPreview(null)
    setResult(null)
    send.reset()
  }

  const length = text.trim().length
  const validText = length >= MIN_CHARS && length <= MAX_CHARS
  const canSend = preview && preview.count > 0 && preview.configured && preview.template
  const confirmSend = () => {
    if (!preview) return
    const msg = `¿Enviar la pregunta a ${hogares(preview.count)} por WhatsApp?\n\n«${text.trim()}»\n\nCada hogar la recibe una sola vez. No se puede deshacer.`
    if (window.confirm(msg)) send.mutate(preview.count)
  }

  return (
    <section data-testid="whatsapp-question-section" className="space-y-8">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (validText) count.mutate()
        }}
        className="space-y-4 rounded-2xl border border-border-soft bg-paper p-4"
      >
        <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
          <FieldLabel as="span" required>Pregunta (va dentro de la plantilla aprobada en Meta)</FieldLabel>
          <textarea
            required
            value={text}
            onChange={(e) => edit(setText)(e.target.value)}
            rows={3}
            maxLength={MAX_CHARS}
            placeholder="¿Qué es lo que más os cuesta de planificar la semana?"
            className="rounded-lg border border-border px-3 py-2 text-[15px] leading-relaxed text-ink"
          />
          <span className="text-right text-[11px]">
            {length} / {MAX_CHARS}
          </span>
        </label>
        <fieldset className="grid gap-3 md:grid-cols-3">
          <legend className="mb-2 text-[12px] font-semibold text-ink">El grupo</legend>
          <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
            <FieldLabel as="span" required>Alta desde</FieldLabel>
            <input type="date" required value={from} max={to} onChange={(e) => edit(setFrom)(e.target.value)} className="rounded-lg border border-border px-3 py-2 text-[14px] text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
            <FieldLabel as="span" required>Alta hasta</FieldLabel>
            <input type="date" required value={to} min={from} onChange={(e) => edit(setTo)(e.target.value)} className="rounded-lg border border-border px-3 py-2 text-[14px] text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
            <FieldLabel as="span" optional>Días sin actividad (0 = da igual)</FieldLabel>
            <input
              type="number"
              min={0}
              max={365}
              value={inactiveDays}
              onChange={(e) => edit(setInactiveDays)(e.target.value)}
              className="rounded-lg border border-border px-3 py-2 text-[14px] text-ink"
            />
          </label>
        </fieldset>
        <RequiredNote />
        <button
          type="submit"
          disabled={!validText || !from || !to || count.isPending}
          className="min-h-[44px] rounded-full border border-ink px-5 text-[13px] font-semibold text-ink disabled:opacity-40"
        >
          {count.isPending ? "Contando…" : "Contar hogares"}
        </button>
        {!validText && length > 0 && (
          <p className="text-[12px] text-ink-muted">La pregunta necesita al menos {MIN_CHARS} caracteres.</p>
        )}
        {count.isError && <p className="text-[12px] text-warn-text">{(count.error as Error).message || "No se ha podido contar."}</p>}

        {preview && (
          <div data-testid="whatsapp-question-preview" className="space-y-3 border-t border-border-soft pt-4">
            <p className="text-[18px] text-ink">
              <strong data-testid="whatsapp-question-count">{preview.count}</strong> {preview.count === 1 ? "hogar la recibirá" : "hogares la recibirán"}
            </p>
            {Object.values(preview.excluded).some((n) => n > 0) && (
              <p className="text-[13px] text-ink-muted" data-testid="whatsapp-question-excluded">
                Fuera:{" "}
                {(Object.keys(REASON_LABEL) as Reason[])
                  .filter((r) => preview.excluded[r] > 0)
                  .map((r) => `${preview.excluded[r]} ${REASON_LABEL[r][preview.excluded[r] === 1 ? 0 : 1]}`)
                  .join(" · ")}
              </p>
            )}
            <p className="text-[13px] text-ink-muted">
              {preview.template ? (
                <>
                  Plantilla: <span className="font-mono">{preview.template}</span>
                </>
              ) : (
                <span className="text-warn-text">
                  Falta la plantilla «pregunta_unica» en WHATSAPP_TEMPLATES: no se puede enviar.
                </span>
              )}
              {!preview.configured && <span className="block text-warn-text">WhatsApp no está configurado en este entorno.</span>}
            </p>
            {preview.count > 200 && (
              <p className="text-[12px] text-ink-muted">Sale a 200 hogares por envío (Meta deja 250 conversaciones al día): pulsa otra vez mañana para el resto.</p>
            )}
            <button
              type="button"
              onClick={confirmSend}
              disabled={!canSend || send.isPending}
              className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-cream disabled:opacity-40"
            >
              {send.isPending ? "Enviando…" : `Enviar a ${hogares(preview.count)}`}
            </button>
          </div>
        )}
        {send.isError && <p className="text-[12px] text-warn-text">{(send.error as Error).message || "No se ha podido enviar."}</p>}
        {result && (
          <p data-testid="whatsapp-question-result" className="rounded-lg bg-cream px-3 py-2 text-[14px] text-ink">
            Enviada a {hogares(result.sent)}.
            {result.failed > 0 && ` ${result.failed} no se ${result.failed === 1 ? "ha" : "han"} podido enviar (no se reintentan).`}
            {result.remaining > 0 && ` Quedan ${hogares(result.remaining)}: vuelve a contar y enviar mañana.`} Las respuestas llegan a{" "}
            <Link href="/admin/opiniones" className="underline">
              Opiniones
            </Link>
            .
          </p>
        )}
      </form>

      <div className="space-y-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Preguntas enviadas</h2>
        {questions.data?.questions.length === 0 && <p className="text-[13px] text-ink-muted">Aún no se ha enviado ninguna.</p>}
        <ul className="space-y-3">
          {(questions.data?.questions ?? []).map((q) => (
            <li key={q.id} className="rounded-2xl border border-border-soft bg-paper p-4" data-testid="whatsapp-question-item">
              <p className="text-[15px] leading-relaxed text-ink">{q.text}</p>
              <p className="mt-2 text-[12px] text-ink-muted">
                {new Date(q.createdAt).toLocaleDateString("es-ES", { dateStyle: "medium" })} · {hogares(q.sent)}
                {q.failed > 0 ? ` · ${q.failed} sin enviar` : ""} · {q.answered} {q.answered === 1 ? "respuesta" : "respuestas"}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
