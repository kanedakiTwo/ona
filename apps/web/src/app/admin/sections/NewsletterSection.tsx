"use client"

/**
 * NewsletterSection — the Friday newsletter editor (PRO-1123, D-176).
 *
 * Marketing leaves its recommendation for the issue; Miguel starts from it,
 * corrects the letter and saves it as the template. The template takes
 * `{nombre}`, `{receta}` and `{porque}`, filled in for each person when the
 * email is composed. Then: a preview with 2–3 real people (admins only),
 * «Enviarme la prueba» to his own admin account's email, and «Programar» for
 * Friday 9:00 — only with the proof of the template saved that week.
 * Spec: specs/newsletter.md → «Editor en Admin».
 */

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

type NotReady = "sin_plantilla" | "plantilla_antigua" | "sin_prueba" | "ya_enviada"

interface Template {
  subject: string
  preheader?: string
  content: Record<string, unknown> & {
    preface?: string
    headline?: string
    intro?: string
    signoff?: string
  }
}

interface Draft {
  issueId: string
  recommendedAt: string | null
  savedAt: string | null
  proofSentAt: string | null
  scheduledFor: string | null
  sentAt: string | null
  sendResult: Record<string, number> | null
  ready: boolean
  notReady: NotReady | null
  recommendation?: Template | null
  template?: Template | null
}

interface Preview {
  to: string
  source: "user" | "waitlist"
  subject: string
  html: string
}

const NOT_READY_LABEL: Record<NotReady, string> = {
  sin_plantilla: "Falta guardar la plantilla.",
  plantilla_antigua: "La plantilla es de hace más de una semana: guárdala otra vez.",
  sin_prueba: "Falta que te mandes la prueba de lo guardado.",
  ya_enviada: "Este número ya ha salido.",
}

/** The letter's own fields; the rest of the issue (recipe, sections, button…) goes as JSON. */
const LETTER_FIELDS = ["preface", "headline", "intro", "signoff"] as const
type LetterField = (typeof LETTER_FIELDS)[number]

const PLACEHOLDERS = ["{nombre}", "{receta}", "{porque}"]

interface Form {
  subject: string
  preheader: string
  preface: string
  headline: string
  intro: string
  signoff: string
  rest: string
}

function toForm(t: Template | null | undefined): Form {
  const content = { ...(t?.content ?? {}) }
  const letter = Object.fromEntries(LETTER_FIELDS.map((k) => [k, (content[k] as string | undefined) ?? ""])) as Record<LetterField, string>
  for (const k of LETTER_FIELDS) delete content[k]
  return {
    subject: t?.subject ?? "",
    preheader: t?.preheader ?? "",
    ...letter,
    rest: Object.keys(content).length > 0 ? JSON.stringify(content, null, 2) : "",
  }
}

/** The template to save, or the reason the JSON doesn't read. */
function fromForm(f: Form): { template: Template } | { error: string } {
  let rest: Record<string, unknown> = {}
  if (f.rest.trim()) {
    try {
      const parsed = JSON.parse(f.rest)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "El resto del número tiene que ser un objeto JSON." }
      rest = parsed
    } catch {
      return { error: "El resto del número no es JSON válido." }
    }
  }
  const letter = Object.fromEntries(LETTER_FIELDS.flatMap((k) => (f[k].trim() ? [[k, f[k]]] : [])))
  return {
    template: {
      subject: f.subject,
      ...(f.preheader.trim() ? { preheader: f.preheader } : {}),
      content: { ...rest, ...letter },
    },
  }
}

/** The issue id of a Friday: its Madrid date (`2026-11-06`). */
function issueOf(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" })
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })

export function NewsletterSection() {
  const qc = useQueryClient()
  const list = useQuery({
    queryKey: ["admin", "newsletter-drafts"],
    queryFn: () => api.get<{ drafts: Draft[]; nextFriday: string }>("/admin/newsletter/drafts"),
  })
  const [issueId, setIssueId] = useState("")
  useEffect(() => {
    if (!issueId && list.data) setIssueId(issueOf(list.data.nextFriday))
  }, [issueId, list.data])

  const validIssue = /^[a-z0-9][a-z0-9-]{0,63}$/.test(issueId)
  const draft = useQuery({
    queryKey: ["admin", "newsletter-draft", issueId],
    queryFn: () => api.get<{ draft: Draft | null; nextFriday: string }>(`/admin/newsletter/drafts/${issueId}`),
    enabled: validIssue,
  })
  const d = draft.data?.draft ?? null

  const [form, setForm] = useState<Form>(toForm(null))
  const [dirty, setDirty] = useState(false)
  const [previews, setPreviews] = useState<Preview[] | null>(null)
  const [proofTo, setProofTo] = useState<string | null>(null)
  // A new issue (or a fresh read after saving) refills the form with its
  // template; a background refetch never overwrites unsaved changes.
  useEffect(() => {
    if (!draft.data || dirty) return
    setForm(toForm(draft.data.draft?.template ?? null))
  }, [draft.data, dirty])
  useEffect(() => {
    setDirty(false)
    setPreviews(null)
    setProofTo(null)
  }, [issueId])

  const edit = (k: keyof Form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setDirty(true)
    setPreviews(null)
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin", "newsletter-draft", issueId] })
    qc.invalidateQueries({ queryKey: ["admin", "newsletter-drafts"] })
  }
  const built = useMemo(() => fromForm(form), [form])
  const save = useMutation({
    mutationFn: (t: Template) => api.put<{ draft: Draft }>(`/admin/newsletter/drafts/${issueId}/template`, t),
    onSuccess: (r) => {
      // What was saved is what the form shows from now on.
      qc.setQueryData<{ draft: Draft | null; nextFriday: string }>(["admin", "newsletter-draft", issueId], (old) => ({
        nextFriday: old?.nextFriday ?? "",
        draft: r.draft,
      }))
      setProofTo(null)
      setDirty(false)
      refresh()
    },
  })
  const preview = useMutation({
    mutationFn: () => api.post<{ previews: Preview[] }>(`/admin/newsletter/drafts/${issueId}/preview`),
    onSuccess: (r) => setPreviews(r.previews),
  })
  const proof = useMutation({
    mutationFn: () => api.post<{ status: string; to: string | null }>(`/admin/newsletter/drafts/${issueId}/proof`),
    onSuccess: (r) => {
      setProofTo(r.status === "sent" ? r.to : null)
      refresh()
    },
  })
  const schedule = useMutation({
    mutationFn: () => api.post<{ draft: Draft }>(`/admin/newsletter/drafts/${issueId}/schedule`),
    onSuccess: refresh,
  })
  const unschedule = useMutation({
    mutationFn: () => api.delete<{ draft: Draft }>(`/admin/newsletter/drafts/${issueId}/schedule`),
    onSuccess: refresh,
  })

  const letterText = [form.subject, form.preface, form.headline, form.intro, form.signoff].join(" ")
  const personal = PLACEHOLDERS.some((p) => letterText.includes(p))
  const saved = !!d?.savedAt && !dirty
  const sent = !!d?.sentAt
  const err = (m: { isError: boolean; error: unknown }) =>
    m.isError ? <p className="text-[12px] text-warn-text">{(m.error as Error).message || "No se ha podido."}</p> : null

  const field = (k: keyof Form, label: string, rows = 1, hint?: string) => (
    <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
      {label}
      {rows === 1 ? (
        <input
          value={form[k]}
          onChange={(e) => edit(k)(e.target.value)}
          disabled={sent}
          className="rounded-lg border border-border px-3 py-2 text-[15px] text-ink"
        />
      ) : (
        <textarea
          value={form[k]}
          onChange={(e) => edit(k)(e.target.value)}
          rows={rows}
          disabled={sent}
          className={`rounded-lg border border-border px-3 py-2 text-ink ${k === "rest" ? "font-mono text-[12px]" : "text-[15px] leading-relaxed"}`}
        />
      )}
      {hint && <span className="text-[11px]">{hint}</span>}
    </label>
  )

  return (
    <section data-testid="newsletter-section" className="space-y-6">
      <div className="space-y-2">
        <label className="flex flex-col gap-1 text-[12px] text-ink-muted">
          Número (la fecha del viernes)
          <input
            value={issueId}
            onChange={(e) => setIssueId(e.target.value.trim().toLowerCase())}
            placeholder="2026-11-06"
            className="rounded-lg border border-border px-3 py-2 text-[15px] text-ink"
          />
        </label>
        {(list.data?.drafts.length ?? 0) > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {list.data!.drafts.map((x) => (
              <button
                key={x.issueId}
                type="button"
                onClick={() => setIssueId(x.issueId)}
                className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-[13px] ${
                  x.issueId === issueId ? "border-ink bg-ink text-cream" : "border-border-soft bg-paper text-ink-mid"
                }`}
              >
                {x.issueId}
                {x.sentAt ? " · enviado" : x.scheduledFor ? " · programado" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {validIssue && draft.isSuccess && (
        <>
          <div data-testid="newsletter-recommendation" className="space-y-2 rounded-2xl border border-border-soft bg-paper p-4">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">La recomendación de Marketing</h2>
            {d?.recommendation ? (
              <>
                <p className="text-[15px] font-semibold text-ink">{d.recommendation.subject}</p>
                {d.recommendation.content.intro && (
                  <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-mid">{d.recommendation.content.intro}</p>
                )}
                <button
                  type="button"
                  disabled={sent}
                  onClick={() => {
                    setForm(toForm(d.recommendation))
                    setDirty(true)
                    setPreviews(null)
                  }}
                  className="min-h-[44px] rounded-full border border-ink px-5 text-[13px] font-semibold text-ink disabled:opacity-40"
                >
                  Empezar desde la recomendación
                </button>
              </>
            ) : (
              <p className="text-[13px] text-ink-muted">Marketing aún no ha dejado su recomendación para este número.</p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              if ("template" in built) save.mutate(built.template)
            }}
            className="space-y-4 rounded-2xl border border-border-soft bg-paper p-4"
          >
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Tu carta</h2>
            <p className="text-[12px] text-ink-muted">
              Huecos para cada persona: <span className="font-mono">{"{nombre}"}</span> (si no lo sabemos, se quita con su coma),{" "}
              <span className="font-mono">{"{receta}"}</span> (la que le hemos elegido) y <span className="font-mono">{"{porque}"}</span> (por qué
              se la hemos elegido, con lo que sabemos de su casa, nunca de su salud).
            </p>
            {field("subject", "Asunto")}
            {field("preheader", "Preheader (lo que se ve tras el asunto)")}
            {field("preface", "Saludo", 2)}
            {field("headline", "Titular (*palabra* en cursiva)")}
            {field("intro", "Carta", 8)}
            {field("signoff", "Despedida", 2)}
            {field("rest", "El resto del número (JSON: receta, recetas, secciones, botón…)", 10)}
            {!personal && (
              <p data-testid="newsletter-not-personal" className="text-[12px] text-warn-text">
                La carta no lleva ningún hueco: saldría igual para todos.
              </p>
            )}
            {"error" in built && <p className="text-[12px] text-warn-text">{built.error}</p>}
            <button
              type="submit"
              disabled={sent || !form.subject.trim() || "error" in built || save.isPending}
              className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-cream disabled:opacity-40"
            >
              {save.isPending ? "Guardando…" : "Guardar plantilla"}
            </button>
            {err(save)}
            {d?.savedAt && (
              <p className="text-[12px] text-ink-muted" data-testid="newsletter-saved">
                {dirty ? "Tienes cambios sin guardar." : `Guardada el ${when(d.savedAt)}.`}
              </p>
            )}
          </form>

          <div className="space-y-3 rounded-2xl border border-border-soft bg-paper p-4">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Antes de que salga</h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => preview.mutate()}
                disabled={!saved || preview.isPending}
                className="min-h-[44px] rounded-full border border-ink px-5 text-[13px] font-semibold text-ink disabled:opacity-40"
              >
                {preview.isPending ? "Preparando…" : "Ver vista previa"}
              </button>
              <button
                type="button"
                onClick={() => proof.mutate()}
                disabled={!saved || sent || proof.isPending}
                className="min-h-[44px] rounded-full border border-ink px-5 text-[13px] font-semibold text-ink disabled:opacity-40"
              >
                {proof.isPending ? "Enviando…" : "Enviarme la prueba"}
              </button>
            </div>
            {err(preview)}
            {err(proof)}
            {proof.isSuccess && !proofTo && (
              <p className="text-[12px] text-warn-text">La prueba no ha salido (¿falta el correo en este entorno?): no cuenta como vista.</p>
            )}
            {proofTo && (
              <p data-testid="newsletter-proof-sent" className="rounded-lg bg-cream px-3 py-2 text-[14px] text-ink">
                Prueba enviada a {proofTo}, con tu propio caso.
              </p>
            )}

            {d && !sent && (
              <div className="space-y-2 border-t border-border-soft pt-3">
                {d.scheduledFor ? (
                  <>
                    <p data-testid="newsletter-scheduled" className="text-[14px] text-ink">
                      Programada para el {when(d.scheduledFor)}.
                    </p>
                    <button
                      type="button"
                      onClick={() => unschedule.mutate()}
                      disabled={unschedule.isPending}
                      className="min-h-[44px] rounded-full border border-ink px-5 text-[13px] font-semibold text-ink disabled:opacity-40"
                    >
                      Desprogramar
                    </button>
                  </>
                ) : (
                  <>
                    {!d.ready && d.notReady && <p className="text-[12px] text-ink-muted">{NOT_READY_LABEL[d.notReady]}</p>}
                    <button
                      type="button"
                      onClick={() => schedule.mutate()}
                      disabled={!d.ready || dirty || schedule.isPending}
                      className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] font-semibold text-cream disabled:opacity-40"
                    >
                      {schedule.isPending ? "Programando…" : "Programar para el viernes a las 9:00"}
                    </button>
                  </>
                )}
                {err(schedule)}
                {err(unschedule)}
              </div>
            )}
            {sent && (
              <p data-testid="newsletter-sent" className="text-[14px] text-ink">
                Salió el {when(d!.sentAt!)}
                {d!.sendResult ? ` · ${d!.sendResult.sent ?? 0} enviados` : ""}.
              </p>
            )}
          </div>

          {previews && (
            <div data-testid="newsletter-previews" className="space-y-4">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Así le llega a…</h2>
              {previews.length === 0 && <p className="text-[13px] text-ink-muted">Aún no hay nadie apuntado a la newsletter.</p>}
              {previews.map((p, i) => (
                <figure key={i} className="space-y-2" data-testid="newsletter-preview">
                  <figcaption className="text-[12px] text-ink-muted">
                    {p.to} · {p.source === "user" ? "cuenta" : "lista de espera"} · <span className="text-ink">{p.subject}</span>
                  </figcaption>
                  {/* The email as is, without scripts or links that work: the preview is for reading. */}
                  <iframe title={`Vista previa ${i + 1}`} srcDoc={p.html} sandbox="" className="h-[560px] w-full rounded-xl border border-border-soft bg-cream" />
                </figure>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
