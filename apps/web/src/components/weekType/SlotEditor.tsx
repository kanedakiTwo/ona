"use client"

/**
 * «Tu semana tipo» (D-182 §4): the panel of one slot — a sheet on mobile, the
 * right column on desktop. Every change is saved at once (one slot).
 */
import { useState } from "react"
import { ArrowDown, ArrowUp, Minus, Plus, X } from "lucide-react"
import {
  DISH_TYPES,
  DISH_TYPE_FAMILIES,
  DISH_TYPE_FAMILY_LABELS,
  FIXED_ITEM_UNITS,
  FIXED_UNIT_LABELS,
  WEEK_TYPE_MAX_OPTIONS,
  firstMenuWeeks,
  taperAllowedAt,
  weekTypeOptionLabel,
  weekTypePreview,
  weekTypeSlotAt,
  weekTypeSlotFromView,
  weekTypeSlotView,
  type FixedItemUnit,
  type Meal,
  type WeekTypeDays,
  type WeekTypeOption,
  type WeekTypeSlot,
  type WeekTypeSlotView,
} from "@ona/shared"
import { RecipePickerSheet } from "@/components/menu/RecipePickerSheet"
import { FieldLabel, RequiredNote } from "@/components/FieldLabel"
import { DishTypeIcon, iconOfOption } from "./DishTypeIcon"
import { DAY_NAMES, MEAL_NAMES } from "./WeekTypeGrid"

const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted"
const CHIP = "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors focus-visible:outline-2 focus-visible:outline-ink"
const INPUT = "min-h-[44px] w-full rounded-xl border border-border-soft bg-paper px-3 text-[15px] text-ink placeholder:text-ink-light focus:border-ink focus:outline-none"

const shortDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short", timeZone: "UTC" })

export function SlotEditor({
  days,
  day,
  meal,
  defaultDiners,
  onSave,
}: {
  days: WeekTypeDays
  day: number
  meal: Meal
  defaultDiners: number
  /** Write a slot (this one, or another day's when copying). */
  onSave: (day: number, meal: Meal, slot: WeekTypeSlot) => void
}) {
  const slot = weekTypeSlotAt(days, day, meal)
  const view = weekTypeSlotView(slot)
  const thisWeek = firstMenuWeeks().weeks[0]
  const [adding, setAdding] = useState(false)
  const mealName = MEAL_NAMES[meal]

  const saveView = (next: Partial<WeekTypeSlotView>) => onSave(day, meal, weekTypeSlotFromView(slot, { ...view, ...next }, thisWeek))
  const saveSlot = (patch: Partial<WeekTypeSlot>) => {
    const next: WeekTypeSlot = { ...slot, ...patch }
    for (const k of Object.keys(next) as Array<keyof WeekTypeSlot>) if (next[k] === undefined) delete next[k]
    onSave(day, meal, next)
  }
  const options = view.options
  const hasTaper = options.some((o) => o.kind === "taper")
  const add = (o: WeekTypeOption) => {
    setAdding(false)
    saveView({ options: o.kind === "taper" ? [o] : [...options, o].slice(0, WEEK_TYPE_MAX_OPTIONS), every: 1 })
  }
  const move = (i: number, by: number) => {
    const next = [...options]
    const [o] = next.splice(i, 1)
    next.splice(i + by, 0, o)
    saveView({ options: next })
  }
  const diners = slot.diners ?? defaultDiners
  const explain = view.off
    ? `Este día no hay ${mealName}: no sale en el menú ni en la compra.`
    : options.length === 0
      ? "Libre: Mimo pone la receta que mejor encaje."
      : options.length === 1
        ? view.every > 1
          ? `Una semana sí y ${view.every === 2 ? "otra no" : `${view.every - 1} no`}: las demás, cualquier receta.`
          : "Cada semana."
        : view.together
          ? `Todas en la misma ${mealName}, un plato cada una.`
          : "Una cada semana, por orden."

  return (
    <div className="space-y-5" data-testid="wt-panel">
      <p className="text-[14px] leading-snug text-ink-soft">{explain}</p>

      {!view.off && (
        <>
          {options.length > 1 && (
            <div className="inline-flex rounded-full border border-border-soft bg-paper p-1" role="group" aria-label="Cómo se reparten">
              {[
                { label: "Por turnos", together: false },
                { label: "Juntos", together: true },
              ].map((m) => (
                <button
                  key={m.label}
                  type="button"
                  aria-pressed={view.together === m.together}
                  onClick={() => saveView({ together: m.together })}
                  className={`min-h-[40px] rounded-full px-4 text-[13px] font-medium ${view.together === m.together ? "bg-ink text-cream" : "text-ink-mid"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {options.length === 1 && !hasTaper && (
            <div>
              <div className={EYEBROW}>Cada cuánto</div>
              <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Cada cuántas semanas">
                {[1, 2, 3, 4].map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={view.every === n}
                    onClick={() => saveView({ every: n })}
                    className={`${CHIP} ${view.every === n ? "border-ink bg-ink text-cream" : "border-border bg-paper text-ink"}`}
                  >
                    {n === 1 ? "Cada semana" : `Cada ${n}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className={EYEBROW}>{options.length > 1 && !view.together ? "Por orden, una cada semana" : "Qué se pone"}</div>
            {options.length === 0 ? (
              <p className="mt-2 rounded-2xl border border-dashed border-border px-4 py-3 text-[14px] text-ink-mid">
                <strong className="font-medium text-ink">Cualquier receta</strong> que encaje.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border-soft rounded-2xl border border-border-soft bg-paper">
                {options.map((o, i) => {
                  const label = weekTypeOptionLabel(o)
                  return (
                    <li key={i} className="flex items-center gap-2 py-1.5 pl-3 pr-1">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cream-deep text-ink">
                        <DishTypeIcon type={iconOfOption(o)} size={20} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium text-ink">{label}</span>
                        {options.length > 1 && !view.together && <span className="block text-[12px] text-ink-muted">Semana {i + 1}</span>}
                      </span>
                      {options.length > 1 && (
                        <>
                          <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${label}`} className="flex h-10 w-9 items-center justify-center text-ink-mid disabled:opacity-30">
                            <ArrowUp size={16} aria-hidden="true" />
                          </button>
                          <button type="button" disabled={i === options.length - 1} onClick={() => move(i, 1)} aria-label={`Bajar ${label}`} className="flex h-10 w-9 items-center justify-center text-ink-mid disabled:opacity-30">
                            <ArrowDown size={16} aria-hidden="true" />
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => saveView({ options: options.filter((_, j) => j !== i), every: 1 })}
                        aria-label={`Quitar ${label}`}
                        className="flex h-10 w-10 items-center justify-center text-ink-mid hover:text-ink"
                      >
                        <X size={18} aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
            {!hasTaper && options.length < WEEK_TYPE_MAX_OPTIONS && !adding && (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="mt-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border-soft bg-paper px-4 text-[14px] font-medium text-ink hover:bg-cream-deep"
              >
                <Plus size={16} aria-hidden="true" /> Añadir
              </button>
            )}
            {adding && (
              <OptionPicker
                canTaper={options.length === 0 && taperAllowedAt(day, meal)}
                onAdd={add}
                onCancel={() => setAdding(false)}
                title={`${DAY_NAMES[day]} · ${mealName}`}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stepper
              label="Comensales"
              value={diners}
              min={1}
              max={24}
              hint={slot.diners ? "Solo en este hueco" : "Los de casa"}
              onChange={(n) => saveSlot({ diners: n === defaultDiners ? undefined : n })}
            />
            <Stepper label="Platos" value={slot.dishes ?? 1} min={1} max={3} onChange={(n) => saveSlot({ dishes: n > 1 ? (n as 2 | 3) : undefined })} />
          </div>

          <div>
            <div className={EYEBROW}>Así lo pondría Mimo</div>
            <ul className="mt-2 space-y-1" data-testid="wt-preview">
              {weekTypePreview(slot, thisWeek, 4).map((w, i) => (
                <li key={w.weekStart} className="flex justify-between gap-3 text-[13px]">
                  <span className="text-ink-muted">{i === 0 ? "Esta semana" : `Semana del ${shortDate(w.weekStart)}`}</span>
                  <span className="text-right font-medium text-ink">{w.label}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className={EYEBROW}>Igual otros días</div>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Copiar a otros días">
              {DAY_NAMES.map((name, d) =>
                d === day ? null : (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onSave(d, meal, { ...slot })}
                    aria-label={`Copiar al ${name.toLowerCase()}`}
                    className={`${CHIP} border-border bg-paper text-ink-mid hover:text-ink`}
                  >
                    {name.slice(0, 3)}
                  </button>
                ),
              )}
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => (view.off ? saveSlot({ off: undefined, offWhenFree: undefined }) : saveSlot({ off: true, offWhenFree: undefined }))}
        aria-pressed={view.off}
        className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink hover:bg-cream-deep"
      >
        {view.off ? `Hay ${mealName} este día` : `No hay ${mealName} este día`}
      </button>
    </div>
  )
}

function Stepper({ label, value, min, max, hint, onChange }: { label: string; value: number; min: number; max: number; hint?: string; onChange: (n: number) => void }) {
  return (
    <div>
      <div className={EYEBROW}>{label}</div>
      <div className="mt-1.5 flex items-center gap-1 rounded-full border border-border-soft bg-paper p-1">
        <button type="button" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={`Menos ${label.toLowerCase()}`} className="flex h-9 w-9 items-center justify-center rounded-full text-ink disabled:opacity-30">
          <Minus size={14} aria-hidden="true" />
        </button>
        <span className="flex-1 text-center text-[15px] font-medium tabular-nums text-ink" aria-label={`${label}: ${value}`}>
          {value}
        </span>
        <button type="button" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={`Más ${label.toLowerCase()}`} className="flex h-9 w-9 items-center justify-center rounded-full text-ink disabled:opacity-30">
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>
      {hint && <div className="mt-1 text-[11px] text-ink-muted">{hint}</div>}
    </div>
  )
}

/** The dish types by family, one chip each (the slot panel's «+ Añadir» and the menu's «Guardar en mi semana tipo»). */
export function DishTypeChips({ onPick, disabled }: { onPick: (type: string) => void; disabled?: boolean }) {
  return (
    <>
      {DISH_TYPE_FAMILIES.map((fam) => (
        <div key={fam}>
          <div className={EYEBROW}>{DISH_TYPE_FAMILY_LABELS[fam]}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DISH_TYPES.filter((t) => t.family === fam).map((t) => (
              <button key={t.key} type="button" disabled={disabled} onClick={() => onPick(t.key)} className={`${CHIP} border-border bg-cream text-ink hover:border-ink disabled:opacity-50`}>
                <DishTypeIcon type={t.key} size={16} /> {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

/** «+ Añadir»: a concrete recipe (search), the dish types by family, and the wildcards. */
function OptionPicker({ canTaper, onAdd, onCancel, title }: { canTaper: boolean; onAdd: (o: WeekTypeOption) => void; onCancel: () => void; title: string }) {
  const [recipeOpen, setRecipeOpen] = useState(false)
  const [fixedOpen, setFixedOpen] = useState(false)
  return (
    <div className="mt-3 space-y-4 rounded-2xl border border-border-soft bg-paper p-3" data-testid="wt-picker">
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-medium text-ink">Añadir</span>
        <button type="button" onClick={onCancel} className="min-h-[40px] px-2 text-[13px] text-ink-mid underline underline-offset-2">
          Cerrar
        </button>
      </div>
      <div>
        <div className={EYEBROW}>Una receta concreta</div>
        <button type="button" onClick={() => setRecipeOpen(true)} className={`${CHIP} mt-2 border-border bg-cream text-ink`}>
          <DishTypeIcon type="recipe" size={16} /> Buscar una receta
        </button>
      </div>
      <DishTypeChips onPick={(type) => onAdd({ kind: "type", type })} />
      <div>
        <div className={EYEBROW}>Comodines</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onAdd({ kind: "any" })} className={`${CHIP} border-border bg-cream text-ink hover:border-ink`}>
            <DishTypeIcon type="any" size={16} /> Cualquier receta
          </button>
          {canTaper && (
            <button type="button" onClick={() => onAdd({ kind: "taper" })} className={`${CHIP} border-border bg-cream text-ink hover:border-ink`}>
              <DishTypeIcon type="taper" size={16} /> Táper de la cena
            </button>
          )}
          <button type="button" onClick={() => setFixedOpen(true)} className={`${CHIP} border-border bg-cream text-ink hover:border-ink`}>
            <DishTypeIcon type="fixed" size={16} /> Algo fijo sin receta
          </button>
        </div>
        {fixedOpen && <FixedForm onAdd={onAdd} />}
      </div>
      <RecipePickerSheet
        open={recipeOpen}
        onClose={() => setRecipeOpen(false)}
        title="Una receta concreta"
        subtitle={title}
        onPick={(r) => {
          setRecipeOpen(false)
          onAdd({ kind: "recipe", recipeId: r.id, name: r.name })
        }}
      />
    </div>
  )
}

/** «Algo fijo sin receta»: its name and, if it is bought, what it carries per person (to the list). */
function FixedForm({ onAdd }: { onAdd: (o: WeekTypeOption) => void }) {
  const [label, setLabel] = useState("")
  const [items, setItems] = useState<Array<{ name: string; quantity: string; unit: FixedItemUnit }>>([{ name: "", quantity: "1", unit: "u" }])
  const valid = label.trim().length > 0
  return (
    <div className="mt-3 space-y-3">
      <label className="block">
        <FieldLabel as="span" required className={EYEBROW}>
          Nombre
        </FieldLabel>
        <input className={`${INPUT} mt-1`} value={label} maxLength={60} placeholder="Yogur con cereales" onChange={(e) => setLabel(e.target.value)} aria-required="true" />
      </label>
      {/* The rows are optional: the empty ones are left out on «Poner». */}
      <div data-field-group>
        <span data-field-group-label>
          <FieldLabel as="span" optional className={EYEBROW}>
            Qué lleva por persona, para la compra
          </FieldLabel>
        </span>
        <ul className="mt-1 space-y-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-center gap-2">
              <input className={`${INPUT} flex-1`} aria-label={`Cosa ${i + 1}`} placeholder="yogur" value={it.name} maxLength={60} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input className={`${INPUT} w-16`} aria-label={`Cantidad ${i + 1}`} inputMode="decimal" value={it.quantity} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              <select className={`${INPUT} w-24`} aria-label={`Unidad ${i + 1}`} value={it.unit} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, unit: e.target.value as FixedItemUnit } : x)))}>
                {FIXED_ITEM_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {FIXED_UNIT_LABELS[u]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
        {items.length < 10 && (
          <button type="button" onClick={() => setItems([...items, { name: "", quantity: "1", unit: "u" }])} className="mt-2 inline-flex min-h-[40px] items-center gap-1 text-[13px] font-medium text-terracotta-deep">
            <Plus size={14} aria-hidden="true" /> Otra cosa
          </button>
        )}
      </div>
      <RequiredNote />
      <button
        type="button"
        disabled={!valid}
        onClick={() =>
          onAdd({
            kind: "fixed",
            label: label.trim(),
            items: items
              .filter((i) => i.name.trim() && Number(i.quantity.replace(",", ".")) > 0)
              .map((i) => ({ name: i.name.trim(), quantity: Number(i.quantity.replace(",", ".")), unit: i.unit })),
          })
        }
        className="min-h-[44px] rounded-full bg-ink px-5 text-[14px] font-medium text-cream disabled:opacity-40"
      >
        Poner «{label.trim() || "…"}»
      </button>
    </div>
  )
}
