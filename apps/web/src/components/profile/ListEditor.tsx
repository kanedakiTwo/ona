"use client"

/**
 * A list of short words to keep or change («Quién come», PRO-1203): what is
 * saved as chips with «Quitar», the usual ones to add with a tap, a box for
 * another one and «Guardar» once something changed. What is typed and not
 * added yet counts («Guardar» without Enter), as in `RestrictionsPicker`.
 */
import { useEffect, useState } from "react"
import { Plus, X } from "lucide-react"
import { PILL_INK, SUB_INPUT } from "@/components/profile/SubPage"
import { withTyped } from "@/lib/restrictionText"

export function ListEditor({
  saved,
  presets = [],
  placeholder,
  addLabel,
  emptyText,
  disabled,
  saving,
  onSave,
  testId,
}: {
  saved: string[]
  presets?: readonly string[]
  placeholder: string
  /** Name of the free-text box («Otra alergia o dieta», «Otra cosa que no le gusta»). */
  addLabel: string
  emptyText: string
  disabled?: boolean
  saving?: boolean
  onSave: (values: string[]) => void
  testId?: string
}) {
  const [items, setItems] = useState<string[]>(saved)
  const [typed, setTyped] = useState("")
  const savedKey = saved.join("\u0000")
  useEffect(() => {
    setItems(saved)
    setTyped("")
    // Only when what is saved changes (after a save or a reload).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey])

  const next = withTyped(items, typed)
  const dirty = next.join("\u0000") !== savedKey

  function add(value: string) {
    const t = value.trim().toLowerCase()
    if (t && !items.includes(t)) setItems([...items, t])
    setTyped("")
  }

  return (
    <fieldset disabled={disabled} className={disabled ? "opacity-50" : ""} data-testid={testId}>
      {items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((r) => (
            <span
              key={r}
              className="inline-flex h-10 items-center gap-0.5 rounded-full bg-ink pl-3.5 pr-0.5 text-[13px] text-cream"
            >
              {r}
              <button
                type="button"
                onClick={() => setItems(items.filter((x) => x !== r))}
                className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-cream/15"
                aria-label={`Quitar ${r}`}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[13px] italic text-ink-muted">{emptyText}</p>
      )}
      {presets.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {presets
            .filter((r) => !items.includes(r))
            .map((r) => (
              <button
                type="button"
                key={r}
                onClick={() => add(r)}
                className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-dashed border-border bg-transparent px-3.5 text-[13px] text-ink-muted hover:border-ink hover:text-ink"
              >
                <Plus size={12} /> {r}
              </button>
            ))}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={typed}
          aria-label={addLabel}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add(typed)
            }
          }}
          placeholder={placeholder}
          className={`${SUB_INPUT} flex-1`}
        />
      </div>
      {dirty && (
        <button type="button" onClick={() => onSave(next)} disabled={saving} className={`${PILL_INK} mt-3`}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
      )}
    </fieldset>
  )
}
