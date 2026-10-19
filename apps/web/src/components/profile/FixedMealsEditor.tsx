"use client"

/**
 * Comidas fijas (PRO-218) in Perfil → Plantilla semanal. A meal of some days
 * that is always the same («Yogur con cereales» for breakfast) with its
 * things per person: the menu doesn't plan it, the day shows «Fijo: …» and
 * the shopping list adds the week's amounts. Saved with «Guardar cambios».
 */
import { useState } from "react"
import { Plus, Trash2, X } from "lucide-react"
import {
  COOKING_WEEKDAYS,
  FIXED_ITEM_UNITS,
  FIXED_MEALS,
  FIXED_MEAL_LABELS,
  FIXED_UNIT_LABELS,
  fixedItemsText,
  fixedMealSchema,
  type CookingWeekday,
  type FixedItemUnit,
  type FixedMeal,
  type FixedMealType,
} from "@ona/shared"

const DAY_SHORT: Record<CookingWeekday, string> = { lunes: "L", martes: "M", miercoles: "X", jueves: "J", viernes: "V", sabado: "S", domingo: "D" }
const DAY_NAME: Record<CookingWeekday, string> = { lunes: "lunes", martes: "martes", miercoles: "miércoles", jueves: "jueves", viernes: "viernes", sabado: "sábado", domingo: "domingo" }

const INPUT = "min-h-[44px] w-full rounded-xl border border-border-soft bg-paper px-3 text-[15px] text-ink focus:border-ink focus:outline-none"

interface DraftItem {
  name: string
  quantity: string
  unit: FixedItemUnit
}

function daysText(days: CookingWeekday[]): string {
  if (days.length === 7) return "todos los días"
  return days.map((d) => DAY_NAME[d]).join(", ")
}

export function FixedMealsEditor({ value, onChange }: { value: FixedMeal[]; onChange: (next: FixedMeal[]) => void }) {
  const [open, setOpen] = useState(false)
  const free = FIXED_MEALS.filter((m) => !value.some((f) => f.meal === m))
  const [meal, setMeal] = useState<FixedMealType>(free[0] ?? "breakfast")
  const [days, setDays] = useState<CookingWeekday[]>([...COOKING_WEEKDAYS])
  const [label, setLabel] = useState("")
  const [items, setItems] = useState<DraftItem[]>([{ name: "", quantity: "1", unit: "u" }])
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setOpen(false)
    setDays([...COOKING_WEEKDAYS])
    setLabel("")
    setItems([{ name: "", quantity: "1", unit: "u" }])
    setError(null)
  }

  function add() {
    const parsed = fixedMealSchema.safeParse({
      meal,
      days,
      label,
      items: items
        .filter((i) => i.name.trim())
        .map((i) => ({ name: i.name.trim(), quantity: Number(i.quantity.replace(",", ".")), unit: i.unit })),
    })
    if (!parsed.success) {
      setError("Pon un nombre, al menos un día y una cosa con su cantidad por persona.")
      return
    }
    onChange([...value.filter((f) => f.meal !== meal), parsed.data])
    reset()
  }

  return (
    <section className="mt-5" aria-label="Comidas fijas">
      <h3 className="text-[14px] font-medium text-ink">Comidas fijas</h3>
      <p className="mt-1 text-[13px] leading-snug text-ink-muted">
        Si una comida es siempre la misma (el desayuno de yogur con cereales), márcala aquí: no la planifico, la verás como
        «Fijo: …» y lo suyo va solo a la lista de la compra. Cantidades por persona.
      </p>

      {value.length > 0 && (
        <ul className="mt-3 divide-y divide-border-soft rounded-2xl border border-border-soft bg-paper" data-testid="fixed-meals">
          {value.map((f) => (
            <li key={f.meal} className="flex items-start gap-3 py-2.5 pl-4 pr-2">
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-medium text-ink">
                  {FIXED_MEAL_LABELS[f.meal]}: {f.label}
                </div>
                <div className="text-[12px] text-ink-muted">
                  {daysText(f.days)} · {fixedItemsText(f.items)}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Quitar ${FIXED_MEAL_LABELS[f.meal].toLowerCase()} fijo`}
                onClick={() => onChange(value.filter((x) => x.meal !== f.meal))}
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center text-ink-muted hover:text-ink"
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!open && free.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setMeal(free[0])
            setOpen(true)
          }}
          className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border-soft px-4 text-[14px] font-medium text-ink hover:bg-cream-deep"
        >
          <Plus size={16} aria-hidden="true" /> Añadir comida fija
        </button>
      )}

      {open && (
        <div className="mt-3 space-y-3 rounded-2xl border border-border-soft bg-paper p-4">
          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Comida</span>
            <select className={`${INPUT} mt-1`} value={meal} onChange={(e) => setMeal(e.target.value as FixedMealType)} aria-label="Comida fija">
              {free.map((m) => (
                <option key={m} value={m}>
                  {FIXED_MEAL_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Días</span>
            <div className="mt-1 flex gap-1.5">
              {COOKING_WEEKDAYS.map((d) => {
                const on = days.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    aria-label={DAY_NAME[d]}
                    onClick={() => setDays(on ? days.filter((x) => x !== d) : COOKING_WEEKDAYS.filter((x) => x === d || days.includes(x)))}
                    className={`h-10 w-10 rounded-full text-[13px] font-semibold ${on ? "bg-ink text-cream" : "border border-border-soft text-ink-muted"}`}
                  >
                    {DAY_SHORT[d]}
                  </button>
                )
              })}
            </div>
          </div>
          <label className="block">
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Nombre</span>
            <input className={`${INPUT} mt-1`} value={label} maxLength={60} placeholder="Yogur con cereales" onChange={(e) => setLabel(e.target.value)} />
          </label>
          <div>
            <span className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">Qué lleva, por persona</span>
            <ul className="mt-1 space-y-2">
              {items.map((it, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    className={`${INPUT} flex-1`}
                    aria-label={`Cosa ${i + 1}`}
                    placeholder={i === 0 ? "yogur" : i === 1 ? "cereales" : "galletas"}
                    value={it.name}
                    maxLength={60}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  />
                  <input
                    className={`${INPUT} w-20`}
                    aria-label={`Cantidad ${i + 1}`}
                    inputMode="decimal"
                    value={it.quantity}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                  />
                  <select
                    className={`${INPUT} w-28`}
                    aria-label={`Unidad ${i + 1}`}
                    value={it.unit}
                    onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, unit: e.target.value as FixedItemUnit } : x)))}
                  >
                    {FIXED_ITEM_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {FIXED_UNIT_LABELS[u]}
                      </option>
                    ))}
                  </select>
                  {items.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Quitar cosa ${i + 1}`}
                      onClick={() => setItems(items.filter((_, j) => j !== i))}
                      className="inline-flex h-11 w-9 shrink-0 items-center justify-center text-ink-muted"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {items.length < 10 && (
              <button
                type="button"
                onClick={() => setItems([...items, { name: "", quantity: "1", unit: "u" }])}
                className="mt-2 inline-flex min-h-[40px] items-center gap-1 text-[13px] font-medium text-terracotta-deep"
              >
                <Plus size={14} aria-hidden="true" /> Otra cosa
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-[13px] text-terracotta-deep">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={add} className="min-h-[44px] rounded-full bg-ink px-4 text-[14px] font-medium text-cream">
              Marcar como fija
            </button>
            <button type="button" onClick={reset} className="min-h-[44px] rounded-full px-4 text-[14px] text-ink-mid">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
