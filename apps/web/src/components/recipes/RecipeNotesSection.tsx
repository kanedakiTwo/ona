"use client"

/**
 * "Mis notas" — household-shared personal notes block on the recipe detail
 * page. 1-5 star rating + free-form notes + free-form substitutions. PR 7.
 *
 * Inline-edit pattern: tap the rating stars to set/clear; tap the text
 * blocks to edit, blur to save. Per-(household, recipe) row; any household
 * member can read or write.
 */
import { useEffect, useState } from "react"
import { Pencil, Star } from "lucide-react"
import { useRecipeNotes, useSaveRecipeNotes } from "@/hooks/useRecipeNotes"

interface Props {
  recipeId: string
}

export function RecipeNotesSection({ recipeId }: Props) {
  const { data, isLoading } = useRecipeNotes(recipeId)
  const save = useSaveRecipeNotes(recipeId)

  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState("")
  const [editingSubs, setEditingSubs] = useState(false)
  const [subsDraft, setSubsDraft] = useState("")

  useEffect(() => {
    if (data) {
      setNotesDraft(data.notes ?? "")
      setSubsDraft(data.substitutions ?? "")
    }
  }, [data])

  const rating = data?.rating ?? null

  function setRating(next: number) {
    const value = next === rating ? null : next
    save.mutate({ rating: value })
  }

  function saveNotes() {
    const next = notesDraft.trim()
    const current = data?.notes ?? null
    setEditingNotes(false)
    if (next === (current ?? "")) return
    save.mutate({ notes: next === "" ? null : next })
  }

  function saveSubs() {
    const next = subsDraft.trim()
    const current = data?.substitutions ?? null
    setEditingSubs(false)
    if (next === (current ?? "")) return
    save.mutate({ substitutions: next === "" ? null : next })
  }

  if (isLoading) {
    return (
      <section className="mt-10 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-5">
        <div className="text-eyebrow text-[#7A7066]">Tus notas</div>
        <p className="mt-2 font-italic italic text-[#7A7066]">Cargando…</p>
      </section>
    )
  }

  return (
    <section className="mt-10 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-eyebrow text-[#7A7066]">Tus notas</div>
        {data?.lastEditedByUsername && (
          <div className="text-[10px] uppercase tracking-[0.1em] text-[#A39A8E]">
            editado por {data.lastEditedByUsername}
          </div>
        )}
      </div>

      {/* Rating */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066] mb-2">
          Valoración
        </div>
        <div className="flex items-center gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => {
            const filled = rating != null && n <= rating
            return (
              <button
                key={n}
                type="button"
                onClick={() => setRating(n)}
                disabled={save.isPending}
                aria-label={`${n} de 5`}
                className="rounded-full p-1 transition-all hover:scale-110 disabled:opacity-50"
              >
                <Star
                  size={22}
                  className={filled ? "fill-[#C65D38] text-[#C65D38]" : "text-[#DDD6C5]"}
                  strokeWidth={1.5}
                />
              </button>
            )
          })}
          {rating != null && (
            <button
              type="button"
              onClick={() => save.mutate({ rating: null })}
              className="ml-2 text-[10px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
            >
              Quitar
            </button>
          )}
        </div>
      </div>

      {/* Notes */}
      <NoteField
        label="Notas personales"
        placeholder="Le va un toque de comino. Mejor con caldo casero."
        value={data?.notes ?? null}
        draft={notesDraft}
        editing={editingNotes}
        onDraftChange={setNotesDraft}
        onStartEdit={() => setEditingNotes(true)}
        onCancel={() => {
          setNotesDraft(data?.notes ?? "")
          setEditingNotes(false)
        }}
        onSave={saveNotes}
      />

      {/* Substitutions */}
      <NoteField
        label="Sustituciones tuyas"
        placeholder="Sin cebolla, con puerro. La nata por leche evaporada."
        value={data?.substitutions ?? null}
        draft={subsDraft}
        editing={editingSubs}
        onDraftChange={setSubsDraft}
        onStartEdit={() => setEditingSubs(true)}
        onCancel={() => {
          setSubsDraft(data?.substitutions ?? "")
          setEditingSubs(false)
        }}
        onSave={saveSubs}
      />
    </section>
  )
}

function NoteField({
  label,
  placeholder,
  value,
  draft,
  editing,
  onDraftChange,
  onStartEdit,
  onCancel,
  onSave,
}: {
  label: string
  placeholder: string
  value: string | null
  draft: string
  editing: boolean
  onDraftChange: (s: string) => void
  onStartEdit: () => void
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066] mb-2">{label}</div>
      {editing ? (
        <div>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full rounded-md border border-[#DDD6C5] bg-transparent p-2 text-[13px] outline-none focus:border-[#1A1612]"
            placeholder={placeholder}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full border border-[#DDD6C5] px-4 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={onSave}
              className="rounded-full bg-[#1A1612] px-4 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#FAF6EE]"
            >
              Guardar
            </button>
          </div>
        </div>
      ) : value ? (
        <button
          type="button"
          onClick={onStartEdit}
          className="group text-left w-full"
        >
          <p className="text-[13px] text-[#1A1612] whitespace-pre-wrap leading-relaxed">{value}</p>
          <div className="mt-1 inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-[#A39A8E] group-hover:text-[#1A1612]">
            <Pencil size={10} /> Editar
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={onStartEdit}
          className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#DDD6C5] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:border-[#1A1612] hover:text-[#1A1612]"
        >
          <Pencil size={10} /> Añadir
        </button>
      )}
    </div>
  )
}
