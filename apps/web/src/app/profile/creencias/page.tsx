"use client"

/**
 * /profile/creencias — Personalize the assistant's nutritional philosophy.
 *
 * Mimoia ships with 5 default principles (see ONA_PRINCIPLES) plus a 10-
 * mandamientos knowledge base. Users can add their own principles which
 * get injected into the system prompt with an explicit override flag —
 * "RESPÉTALOS aunque entren en conflicto con tus 10 mandamientos por
 * defecto" — so a user's "creo en el ayuno intermitente" beats Mimoia's
 * default "ventana de alimentación es importante" if there's tension.
 *
 * Skin: "D · Luz y foto" (PRO-40). Each own principle is a paper row whose
 * "···" sheet holds "Eliminar principio"; at lg+ the defaults sit in a
 * second column.
 */
import { useState } from "react"
import { Plus, Sparkles, Trash2 } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { useUserMemory, useUpdateMemory, useDeleteMemoryFact } from "@/hooks/useUserMemory"
import { ONA_PRINCIPLES } from "@ona/shared"
import { MenuSheet, SheetAction } from "@/components/menu/MenuSheet"
import {
  Accent,
  MoreButton,
  PILL_INK,
  SUB_CARD,
  SUB_EYEBROW,
  SUB_INPUT,
  SUB_LIST,
  SubPage,
} from "@/components/profile/SubPage"

export default function BeliefsPage() {
  const { user } = useAuth()
  const { data: memory } = useUserMemory()
  const update = useUpdateMemory()
  const del = useDeleteMemoryFact()
  const [draft, setDraft] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheetIdx, setSheetIdx] = useState<number | null>(null)

  const principles = (memory?.nutrition_principles?.value as string[] | undefined) ?? []

  if (!user) {
    return (
      <div className="min-h-screen bg-cream p-6">
        <p className="text-ink">Necesitas iniciar sesión.</p>
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
    <SubPage
      eyebrow="Creencias nutricionales"
      title={
        <>
          Tu <Accent>filosofía</Accent>, no la de Mimoia
        </>
      }
      intro="Mimoia viene con unas creencias por defecto (resumen abajo). Puedes añadir las tuyas y el asistente las respetará por encima de las suyas cuando entren en conflicto."
    >
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        {/* User principles */}
        <section>
          <h2 className={SUB_EYEBROW}>Tus principios ({principles.length})</h2>
          {principles.length > 0 && (
            <ul className={`${SUB_LIST} mt-3`}>
              {principles.map((p, i) => (
                <li key={`${i}-${p.slice(0, 16)}`} className="flex items-start gap-2 py-2 pl-4 pr-2">
                  <span className="min-w-0 flex-1 py-2 text-[15px] leading-relaxed text-ink">{p}</span>
                  <MoreButton label={`Opciones del principio ${i + 1}`} onClick={() => setSheetIdx(i)} />
                </li>
              ))}
            </ul>
          )}

          <div className={`${SUB_CARD} mt-3 p-4`}>
            <label htmlFor="nuevo-principio" className={SUB_EYEBROW}>
              Añadir principio
            </label>
            <textarea
              id="nuevo-principio"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ej. Prefiero ayuno intermitente 16/8 — desayuno tarde."
              rows={2}
              maxLength={280}
              className={`${SUB_INPUT} mt-2 resize-none py-2.5`}
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[12px] tabular-nums text-ink-muted">{draft.trim().length} / 280</span>
              <button
                type="button"
                onClick={handleAdd}
                disabled={draft.trim().length < 3 || submitting}
                className={PILL_INK}
              >
                <Plus size={16} />
                Añadir
              </button>
            </div>
            {error ? <p className="mt-2 text-[13px] italic text-terracotta-deep">{error}</p> : null}
          </div>
        </section>

        {/* Mimoia defaults — informational, can't be removed (but a user
            principle that contradicts them wins). */}
        <section>
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-terracotta-deep" aria-hidden="true" />
            <h2 className={SUB_EYEBROW}>Principios por defecto de Mimoia</h2>
          </div>
          <p className="mt-1 text-[13px] text-ink-soft">
            El asistente sigue estos a menos que tus principios digan lo contrario.
          </p>
          <ul className={`${SUB_LIST} mt-3`}>
            {ONA_PRINCIPLES.map((p) => (
              <li key={p.id} className="px-4 py-3.5">
                <div className="font-serif-text text-[16px] font-[650] leading-snug text-ink">{p.title}</div>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{p.rationale}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <p className="mt-10 text-center text-[13px] text-ink-muted">
        O díctaselos al asistente: «recuerda que sigo dieta cetogénica»
      </p>

      <MenuSheet
        open={sheetIdx !== null}
        onClose={() => setSheetIdx(null)}
        eyebrow="Tu principio"
        title={<span className="line-clamp-2">{sheetIdx !== null ? (principles[sheetIdx] ?? "") : ""}</span>}
      >
        {sheetIdx !== null && (
          <SheetAction
            icon={Trash2}
            label="Eliminar principio"
            destructive
            disabled={submitting}
            onClick={() => {
              const i = sheetIdx
              setSheetIdx(null)
              handleRemove(i)
            }}
          />
        )}
      </MenuSheet>
    </SubPage>
  )
}
