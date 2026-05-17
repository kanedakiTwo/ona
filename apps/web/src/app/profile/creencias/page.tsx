"use client"

/**
 * /profile/creencias — Personalize the assistant's nutritional philosophy.
 *
 * ONA ships with 5 default principles (see ONA_PRINCIPLES) plus a 10-
 * mandamientos knowledge base. Users can add their own principles which
 * get injected into the system prompt with an explicit override flag —
 * "RESPÉTALOS aunque entren en conflicto con tus 10 mandamientos por
 * defecto" — so a user's "creo en el ayuno intermitente" beats ONA's
 * default "ventana de alimentación es importante" if there's tension.
 */
import { useState } from "react"
import Link from "next/link"
import { ChevronLeft, Plus, Sparkles, Trash2 } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { useUserMemory, useUpdateMemory, useDeleteMemoryFact } from "@/hooks/useUserMemory"
import { ONA_PRINCIPLES } from "@ona/shared"

export default function BeliefsPage() {
  const { user } = useAuth()
  const { data: memory } = useUserMemory()
  const update = useUpdateMemory()
  const del = useDeleteMemoryFact()
  const [draft, setDraft] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const principles = (memory?.nutrition_principles?.value as string[] | undefined) ?? []

  if (!user) {
    return (
      <div className="min-h-screen bg-[#FAF6EE] p-6">
        <p className="text-[#1A1612]">Necesitas iniciar sesión.</p>
      </div>
    )
  }

  function commit(next: string[]) {
    setSubmitting(true)
    setError(null)
    update.mutate(
      { key: "nutrition_principles", value: next },
      {
        onSettled: () => setSubmitting(false),
        onError: (e) => setError(e.message),
      },
    )
  }

  function handleAdd() {
    const trimmed = draft.trim()
    if (trimmed.length < 3) return
    if (trimmed.length > 280) {
      setError("Que sea más corto, por favor (máximo 280 caracteres).")
      return
    }
    commit([...principles, trimmed])
    setDraft("")
  }

  function handleRemove(idx: number) {
    const next = principles.filter((_, i) => i !== idx)
    if (next.length === 0) {
      del.mutate({ key: "nutrition_principles" })
      return
    }
    commit(next)
  }

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <div className="mx-auto max-w-[430px] px-5 pb-20 pt-8">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.15em] text-[#7A7066] hover:text-[#1A1612]"
        >
          <ChevronLeft size={14} />
          Volver al perfil
        </Link>

        <div className="mt-6">
          <div className="text-eyebrow text-[#C65D38]">Creencias nutricionales</div>
          <h1 className="mt-2 font-display text-[2.2rem] leading-[1.02] tracking-tight text-[#1A1612]">
            Tu <span className="font-italic italic text-[#C65D38]">filosofía</span>, no la de ONA
          </h1>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-[#7A7066]">
            ONA viene con unas creencias por defecto (resumen abajo). Puedes
            añadir las tuyas y el asistente las respetará por encima de las
            suyas cuando entren en conflicto.
          </p>
        </div>

        {/* User principles */}
        <section className="mt-10">
          <div className="text-eyebrow text-[#7A7066]">Tus principios ({principles.length})</div>
          <ul className="mt-3 space-y-2">
            {principles.map((p, i) => (
              <li
                key={`${i}-${p.slice(0, 16)}`}
                className="flex items-start justify-between gap-3 rounded-xl border border-[#2D6A4F] bg-[#2D6A4F]/5 px-4 py-3"
              >
                <span className="flex-1 text-[14px] leading-relaxed text-[#1A1612]">
                  {p}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(i)}
                  className="text-[#C65D38] transition-colors hover:text-[#1A1612] disabled:opacity-40"
                  disabled={submitting}
                  aria-label="Eliminar principio"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-3 rounded-xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] p-3">
            <label className="text-[11px] uppercase tracking-[0.12em] text-[#7A7066]">
              Añadir principio
            </label>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ej. Prefiero ayuno intermitente 16/8 — desayuno tarde."
              rows={2}
              maxLength={280}
              className="mt-2 w-full resize-none rounded-lg border border-[#DDD6C5] bg-[#FAF6EE] px-3 py-2 text-[14px] text-[#1A1612] placeholder:text-[#7A7066] focus:border-[#1A1612] focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-[#7A7066]">
                {draft.trim().length} / 280
              </span>
              <button
                type="button"
                onClick={handleAdd}
                disabled={draft.trim().length < 3 || submitting}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#2D6A4F] px-4 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#FAF6EE] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus size={11} />
                Añadir
              </button>
            </div>
            {error ? (
              <p className="mt-2 text-[11px] italic text-[#C65D38]">{error}</p>
            ) : null}
          </div>
        </section>

        {/* ONA defaults — informational, can't be removed (but a user
            principle that contradicts them wins). */}
        <section className="mt-12">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-[#C65D38]" />
            <div className="text-eyebrow text-[#7A7066]">Principios por defecto de ONA</div>
          </div>
          <p className="mt-1 text-[11px] text-[#7A7066]">
            El asistente sigue estos a menos que tus principios digan lo contrario.
          </p>
          <ul className="mt-3 space-y-2">
            {ONA_PRINCIPLES.map((p) => (
              <li
                key={p.id}
                className="rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3"
              >
                <div className="text-[13px] font-medium text-[#1A1612]">{p.title}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-[#7A7066]">
                  {p.rationale}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-12 text-center text-[11px] uppercase tracking-[0.12em] text-[#7A7066]">
          O díctaselos al asistente: «recuerda que sigo dieta cetogénica»
        </p>
      </div>
    </div>
  )
}
