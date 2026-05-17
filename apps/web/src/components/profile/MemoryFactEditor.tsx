"use client"

/**
 * Per-fact inline editor for /profile/memoria. The shape of each memory key
 * is fixed (see MEMORY_VALUE_SCHEMAS in @ona/shared); we dispatch by the
 * key name to render the appropriate input. The editor commits on
 * "Guardar" (calls onSave) and bails on "Cancelar". The parent owns the
 * mutation hook + busy state.
 *
 * Why per-key inputs instead of a generic JSON textarea: the user is on
 * mobile, and editing `{ lunes: 20, martes: 25, … }` as raw JSON is hostile.
 * Each value type gets the smallest sensible mobile-first UI.
 */
import { useState } from "react"
import { Plus, X } from "lucide-react"
import type { MemoryKey } from "@ona/shared"

interface Props {
  memoryKey: MemoryKey
  initial: unknown
  onSave: (next: unknown) => void
  onCancel: () => void
  disabled?: boolean
}

const WEEKDAYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"] as const
const MEAL_TIMES_KEYS = ["breakfast", "lunch", "snack", "dinner"] as const
const MEAL_TIMES_LABELS: Record<(typeof MEAL_TIMES_KEYS)[number], string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  snack: "Merienda",
  dinner: "Cena",
}

// Enum option lists (mirror MEMORY_VALUE_SCHEMAS in @ona/shared).
const SEX_OPTIONS = [
  { value: "male", label: "Hombre" },
  { value: "female", label: "Mujer" },
  { value: "other", label: "Otro / prefiero no decir" },
]
const ACTIVITY_OPTIONS = [
  { value: "none", label: "Ninguna" },
  { value: "light", label: "Ligera" },
  { value: "moderate", label: "Moderada" },
  { value: "high", label: "Alta" },
]
const COOKING_SKILL_OPTIONS = [
  { value: "easy", label: "Básico" },
  { value: "medium", label: "Medio" },
  { value: "advanced", label: "Avanzado" },
]

export function MemoryFactEditor({ memoryKey, initial, onSave, onCancel, disabled }: Props) {
  // Dispatch by key. Each branch maintains its own local draft state.
  switch (memoryKey) {
    case "physical.sex":
      return (
        <EnumEditor
          options={SEX_OPTIONS}
          initial={initial as string | null}
          onSave={onSave}
          onCancel={onCancel}
          disabled={disabled}
        />
      )
    case "physical.activity_level":
      return (
        <EnumEditor
          options={ACTIVITY_OPTIONS}
          initial={initial as string | null}
          onSave={onSave}
          onCancel={onCancel}
          disabled={disabled}
        />
      )
    case "cooking_skill":
      return (
        <EnumEditor
          options={COOKING_SKILL_OPTIONS}
          initial={initial as string | null}
          onSave={onSave}
          onCancel={onCancel}
          disabled={disabled}
        />
      )

    case "physical.age":
      return <NumberEditor initial={initial as number | null} min={2} max={120} onSave={onSave} onCancel={onCancel} disabled={disabled} suffix="años" />
    case "physical.height_cm":
      return <NumberEditor initial={initial as number | null} min={50} max={250} onSave={onSave} onCancel={onCancel} disabled={disabled} suffix="cm" />
    case "physical.weight_kg":
      return <NumberEditor initial={initial as number | null} min={15} max={300} onSave={onSave} onCancel={onCancel} disabled={disabled} suffix="kg" step={0.5} />
    case "household.adults":
      return <NumberEditor initial={initial as number | null} min={1} max={20} onSave={onSave} onCancel={onCancel} disabled={disabled} suffix="adultos" />
    case "household.kids_2_to_10":
      return <NumberEditor initial={initial as number | null} min={0} max={20} onSave={onSave} onCancel={onCancel} disabled={disabled} suffix="niños 2-10" />
    case "weekly_budget_eur":
      return <NumberEditor initial={initial as number | null} min={0} max={5000} onSave={onSave} onCancel={onCancel} disabled={disabled} suffix="€/semana" step={5} />

    case "restrictions":
    case "dislikes":
    case "equipment":
    case "notes":
    case "nutrition_principles":
      return (
        <StringArrayEditor
          initial={(initial as string[] | null) ?? []}
          placeholder={
            memoryKey === "restrictions"
              ? "Ej. sin gluten, sin lactosa"
              : memoryKey === "dislikes"
                ? "Ej. cilantro"
                : memoryKey === "equipment"
                  ? "Ej. horno"
                  : memoryKey === "nutrition_principles"
                    ? "Ej. Ayuno intermitente 16/8"
                    : "Añadir nota"
          }
          minLen={memoryKey === "nutrition_principles" ? 3 : 1}
          maxLen={memoryKey === "nutrition_principles" ? 280 : 60}
          onSave={onSave}
          onCancel={onCancel}
          disabled={disabled}
        />
      )

    case "time_available":
      return (
        <RecordEditor
          fields={WEEKDAYS.map((d) => ({ key: d, label: capitalize(d) }))}
          initial={(initial as Record<string, number> | null) ?? {}}
          unit="min"
          min={0}
          max={480}
          onSave={onSave}
          onCancel={onCancel}
          disabled={disabled}
        />
      )
    case "meal_times":
      return (
        <TimeRecordEditor
          fields={MEAL_TIMES_KEYS.map((k) => ({ key: k, label: MEAL_TIMES_LABELS[k] }))}
          initial={(initial as Record<string, string> | null) ?? {}}
          onSave={onSave}
          onCancel={onCancel}
          disabled={disabled}
        />
      )
    case "cuisine_bias":
      return (
        <CuisineEditor
          initial={(initial as Record<string, number> | null) ?? {}}
          onSave={onSave}
          onCancel={onCancel}
          disabled={disabled}
        />
      )

    default:
      return (
        <p className="text-[12px] italic text-[#7A7066]">
          Edición no disponible para esta clave. Pídeselo al asistente.
        </p>
      )
  }
}

// ─── Enum editor ─────────────────────────────────────────────

function EnumEditor({
  options,
  initial,
  onSave,
  onCancel,
  disabled,
}: {
  options: Array<{ value: string; label: string }>
  initial: string | null
  onSave: (next: unknown) => void
  onCancel: () => void
  disabled?: boolean
}) {
  const [value, setValue] = useState(initial ?? options[0].value)
  return (
    <EditorFrame onSave={() => onSave(value)} onCancel={onCancel} disabled={disabled}>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-full rounded-lg border border-[#DDD6C5] bg-[#FAF6EE] px-3 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </EditorFrame>
  )
}

// ─── Number editor ───────────────────────────────────────────

function NumberEditor({
  initial,
  min,
  max,
  suffix,
  step = 1,
  onSave,
  onCancel,
  disabled,
}: {
  initial: number | null
  min: number
  max: number
  suffix?: string
  step?: number
  onSave: (next: unknown) => void
  onCancel: () => void
  disabled?: boolean
}) {
  const [value, setValue] = useState<string>(String(initial ?? min))
  const numeric = Number(value)
  const valid = Number.isFinite(numeric) && numeric >= min && numeric <= max

  return (
    <EditorFrame
      onSave={() => onSave(numeric)}
      onCancel={onCancel}
      disabled={disabled || !valid}
    >
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          min={min}
          max={max}
          step={step}
          inputMode="decimal"
          className="flex-1 rounded-lg border border-[#DDD6C5] bg-[#FAF6EE] px-3 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
        />
        {suffix ? <span className="text-[12px] text-[#7A7066]">{suffix}</span> : null}
      </div>
      {!valid ? (
        <p className="mt-1 text-[10px] italic text-[#C65D38]">
          Entre {min} y {max}
        </p>
      ) : null}
    </EditorFrame>
  )
}

// ─── String-array editor (chips + add) ───────────────────────

function StringArrayEditor({
  initial,
  placeholder,
  minLen,
  maxLen,
  onSave,
  onCancel,
  disabled,
}: {
  initial: string[]
  placeholder: string
  minLen: number
  maxLen: number
  onSave: (next: unknown) => void
  onCancel: () => void
  disabled?: boolean
}) {
  const [items, setItems] = useState<string[]>(initial)
  const [draft, setDraft] = useState("")

  function add() {
    const t = draft.trim()
    if (t.length < minLen || t.length > maxLen) return
    if (items.includes(t)) return // dedupe
    setItems([...items, t])
    setDraft("")
  }

  return (
    <EditorFrame
      onSave={() => onSave(items)}
      onCancel={onCancel}
      disabled={disabled}
    >
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="text-[12px] italic text-[#7A7066]">Vacío</span>
        ) : (
          items.map((it, i) => (
            <span
              key={`${i}-${it}`}
              className="inline-flex items-center gap-1 rounded-full bg-[#2D6A4F] px-2.5 py-1 text-[11px] text-[#FAF6EE]"
            >
              {it}
              <button
                type="button"
                onClick={() => setItems(items.filter((_, idx) => idx !== i))}
                aria-label={`Quitar ${it}`}
                className="hover:opacity-70"
              >
                <X size={10} />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              add()
            }
          }}
          placeholder={placeholder}
          maxLength={maxLen}
          className="flex-1 rounded-lg border border-[#DDD6C5] bg-[#FAF6EE] px-3 py-2 text-[14px] text-[#1A1612] placeholder:text-[#7A7066] focus:border-[#1A1612] focus:outline-none"
        />
        <button
          type="button"
          onClick={add}
          disabled={draft.trim().length < minLen}
          className="rounded-full bg-[#1A1612] p-2 text-[#FAF6EE] disabled:opacity-30"
          aria-label="Añadir"
        >
          <Plus size={12} />
        </button>
      </div>
    </EditorFrame>
  )
}

// ─── Numeric record (time_available — weekday → minutes) ─────

function RecordEditor({
  fields,
  initial,
  unit,
  min,
  max,
  onSave,
  onCancel,
  disabled,
}: {
  fields: Array<{ key: string; label: string }>
  initial: Record<string, number>
  unit?: string
  min: number
  max: number
  onSave: (next: unknown) => void
  onCancel: () => void
  disabled?: boolean
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, String(initial[f.key] ?? "")])),
  )

  function update(key: string, raw: string) {
    setValues({ ...values, [key]: raw })
  }

  function build(): Record<string, number> {
    const out: Record<string, number> = {}
    for (const f of fields) {
      const n = Number(values[f.key])
      if (Number.isFinite(n) && n >= min && n <= max) out[f.key] = n
    }
    return out
  }

  return (
    <EditorFrame onSave={() => onSave(build())} onCancel={onCancel} disabled={disabled}>
      <div className="space-y-1.5">
        {fields.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-2">
            <span className="w-24 text-[12px] text-[#7A7066]">{f.label}</span>
            <input
              type="number"
              value={values[f.key]}
              onChange={(e) => update(f.key, e.target.value)}
              min={min}
              max={max}
              inputMode="numeric"
              className="flex-1 rounded-lg border border-[#DDD6C5] bg-[#FAF6EE] px-2 py-1 text-[13px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
            />
            {unit ? <span className="text-[11px] text-[#7A7066]">{unit}</span> : null}
          </div>
        ))}
      </div>
    </EditorFrame>
  )
}

// ─── Time record (meal_times — meal → HH:MM) ─────────────────

function TimeRecordEditor({
  fields,
  initial,
  onSave,
  onCancel,
  disabled,
}: {
  fields: Array<{ key: string; label: string }>
  initial: Record<string, string>
  onSave: (next: unknown) => void
  onCancel: () => void
  disabled?: boolean
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? ""])),
  )
  const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

  function build(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const f of fields) {
      const v = values[f.key]
      if (HHMM.test(v)) out[f.key] = v
    }
    return out
  }

  return (
    <EditorFrame onSave={() => onSave(build())} onCancel={onCancel} disabled={disabled}>
      <div className="space-y-1.5">
        {fields.map((f) => (
          <div key={f.key} className="flex items-center justify-between gap-2">
            <span className="w-24 text-[12px] text-[#7A7066]">{f.label}</span>
            <input
              type="time"
              value={values[f.key]}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              className="flex-1 rounded-lg border border-[#DDD6C5] bg-[#FAF6EE] px-2 py-1 text-[13px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
            />
          </div>
        ))}
      </div>
    </EditorFrame>
  )
}

// ─── Cuisine bias ────────────────────────────────────────────

function CuisineEditor({
  initial,
  onSave,
  onCancel,
  disabled,
}: {
  initial: Record<string, number>
  onSave: (next: unknown) => void
  onCancel: () => void
  disabled?: boolean
}) {
  // The cuisine list is open-ended; we seed with the most common ones the
  // assistant asks about + whatever's already in the value blob.
  const seeded = [
    "mediterranea",
    "asiatica",
    "mexicana",
    "italiana",
    "india",
    "americana",
    "francesa",
  ]
  const initialKeys = Object.keys(initial)
  const keys = Array.from(new Set([...seeded, ...initialKeys]))
  const [values, setValues] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {}
    for (const k of keys) out[k] = initial[k] ?? 50
    return out
  })

  return (
    <EditorFrame onSave={() => onSave(values)} onCancel={onCancel} disabled={disabled}>
      <div className="space-y-2.5">
        {keys.map((k) => (
          <div key={k}>
            <div className="flex items-center justify-between text-[11px] text-[#7A7066]">
              <span className="capitalize">{k}</span>
              <span>{values[k]}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={values[k]}
              onChange={(e) => setValues({ ...values, [k]: Number(e.target.value) })}
              className="w-full accent-[#2D6A4F]"
            />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
        0 = no me gusta · 100 = mi favorita
      </p>
    </EditorFrame>
  )
}

// ─── Common frame ────────────────────────────────────────────

function EditorFrame({
  children,
  onSave,
  onCancel,
  disabled,
}: {
  children: React.ReactNode
  onSave: () => void
  onCancel: () => void
  disabled?: boolean
}) {
  return (
    <div className="mt-3">
      {children}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={disabled}
          className="rounded-full bg-[#2D6A4F] px-4 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#FAF6EE] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Guardar
        </button>
      </div>
    </div>
  )
}

function capitalize(s: string) {
  return s[0].toUpperCase() + s.slice(1)
}
