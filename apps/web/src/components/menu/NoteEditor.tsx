"use client"

/**
 * Editable note dish.
 *
 * A note dish ("comemos fuera", "+ pan", …) is a freeform string the user
 * attaches to a meal slot. Render in `'card'` variant inside Vista día's
 * day stack (full-width bordered row, "Editar" affordance) and in `'inline'`
 * variant inside Vista semana's narrow column cards (compact dashed pill).
 *
 * Edit UX: click the text → input field replaces it → Enter to save, Esc to
 * cancel, blur also saves. Click is always `stopPropagation` so the
 * surrounding card's onClick (which would navigate to the first recipe) does
 * NOT fire — that was the "Las notas quedan asociados a otro plato" bug.
 */
import { useEffect, useRef, useState } from "react"
import { Check, Coffee, X } from "lucide-react"

interface Props {
  text: string
  /** Persist the new text. Caller is responsible for the patchDish mutation. */
  onSave: (text: string) => void
  onRemove?: () => void
  variant?: 'card' | 'inline'
  /** Max characters (server caps at 120, default here). */
  maxLength?: number
}

export function NoteEditor({ text, onSave, onRemove, variant = 'card', maxLength = 120 }: Props) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(text)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep local state in sync when the parent's `text` changes (server roundtrip
  // returns the new value, parent re-renders, we want to reflect it).
  useEffect(() => {
    setValue(text)
  }, [text])

  // Autofocus + select the existing text when entering edit mode.
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function save() {
    const trimmed = value.trim().slice(0, maxLength)
    if (trimmed && trimmed !== text) {
      onSave(trimmed)
    } else if (!trimmed) {
      // Empty save reverts to the original (so the dish doesn't get blanked).
      setValue(text)
    }
    setEditing(false)
  }
  function cancel() {
    setValue(text)
    setEditing(false)
  }

  if (variant === 'card') {
    return (
      <div
        className="flex items-center gap-3 rounded-xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] px-3 py-2.5"
        onClick={(e) => e.stopPropagation()}
      >
        <Coffee size={16} className="shrink-0 text-[#7A7066]" />
        {editing ? (
          <>
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value.slice(0, maxLength))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') cancel()
              }}
              onBlur={save}
              className="flex-1 rounded-md border border-[#DDD6C5] bg-[#FAF6EE] px-2 py-1 text-[13px] italic text-[#4A4239] focus:border-[#1A1612] focus:outline-none"
            />
            <button onClick={save} aria-label="Guardar nota" type="button">
              <Check size={14} className="text-[#2D6A4F]" />
            </button>
            <button onClick={cancel} aria-label="Cancelar" type="button">
              <X size={14} className="text-[#7A7066]" />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="flex-1 truncate text-left text-[13px] italic text-[#4A4239] hover:text-[#C65D38]"
              title="Editar nota"
            >
              {text}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
            >
              Editar
            </button>
            {onRemove && (
              <button onClick={onRemove} aria-label="Quitar" type="button">
                <X size={14} className="text-[#7A7066]" />
              </button>
            )}
          </>
        )}
      </div>
    )
  }

  // Inline variant — fits inside Vista semana's narrow column.
  return (
    <div
      className="flex w-full items-center gap-1 rounded-md border border-dashed border-[#DDD6C5] bg-[#FAF6EE]/60 px-1.5 py-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <Coffee size={10} className="shrink-0 text-[#7A7066]" />
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, maxLength))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') cancel()
          }}
          onBlur={save}
          className="min-w-0 flex-1 rounded-sm border border-[#DDD6C5] bg-[#FFFEFA] px-1 py-0 text-[11px] italic text-[#4A4239] focus:border-[#1A1612] focus:outline-none"
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-w-0 flex-1 truncate text-left text-[11px] italic text-[#4A4239] hover:text-[#C65D38]"
            title="Editar nota"
          >
            {text}
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Quitar"
              className="shrink-0 text-[#7A7066] hover:text-[#C65D38]"
            >
              <X size={10} />
            </button>
          )}
        </>
      )}
    </div>
  )
}
