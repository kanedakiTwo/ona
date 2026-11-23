"use client"

/**
 * «Cocinar ahora», question 4 (specs/cook-now.md): the pantry to confirm
 * before the proposal. Every change is saved at once (PATCH /pantry/:id); a
 * row at 0 stays at 0. «Añadir» searches the catalogue and asks where it is.
 * Fridge and freezer open, the cupboard folded.
 */
import { useId, useState } from "react"
import { Minus, Plus, Search } from "lucide-react"
import type { BuyableUnit, PantryLocation } from "@ona/shared"
import { groupPantryByLocation, ingredientDisplayName, PANTRY_LOCATION_LABELS, PANTRY_LOCATIONS } from "@ona/shared"
import { useAddPantry, useDeletePantry, usePantry, usePatchPantry, type PantryItem } from "@/hooks/usePantry"
import { useSearchIngredients } from "@/hooks/useIngredients"
import { useDebounced } from "@/components/recipes/WithWhatIHavePicker"
import { PILL_INK, PILL_OUTLINE, SUB_EYEBROW, SUB_INPUT, SUB_LIST, SubNotice } from "@/components/profile/SubPage"

/** − / + step: one unit or spoon, 50 g or ml. */
function stepOf(unit: BuyableUnit): number {
  return unit === "g" || unit === "ml" ? 50 : 1
}

export function PantryConfirmStep({ onPropose, proposing }: { onPropose: () => void; proposing: boolean }) {
  const { data: items, isLoading } = usePantry()
  const empty = !isLoading && (!items || items.length === 0)
  const [adding, setAdding] = useState(false)

  return (
    <div>
      <h2 className="font-serif-text text-[26px] font-[650] leading-tight text-ink lg:text-[32px]">
        {empty ? "¿Qué tienes en casa?" : "Confirma tu despensa"}
      </h2>
      <p className="mt-1 text-[14px] text-ink-soft">Cambia lo que no cuadre: se guarda al momento.</p>

      <div className="mt-5 space-y-5">
        {isLoading ? (
          <SubNotice>
            <p className="font-serif-text text-[18px] italic text-ink-mid">Cargando…</p>
          </SubNotice>
        ) : (
          groupPantryByLocation(items ?? []).map((group) =>
            group.location === "despensa" ? (
              <details key={group.location} className="group">
                <summary className={`${SUB_EYEBROW} flex min-h-[44px] cursor-pointer items-center`}>
                  {PANTRY_LOCATION_LABELS[group.location]} · {group.items.length}
                </summary>
                <ConfirmList items={group.items} />
              </details>
            ) : (
              <div key={group.location}>
                <h3 className={`${SUB_EYEBROW} mb-2`}>
                  {PANTRY_LOCATION_LABELS[group.location]} · {group.items.length}
                </h3>
                <ConfirmList items={group.items} />
              </div>
            ),
          )
        )}

        {adding || empty ? (
          <AddToPantry onDone={() => setAdding(false)} />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={PILL_OUTLINE}>
            <Plus size={16} aria-hidden="true" /> Añadir
          </button>
        )}
      </div>

      <div className="sticky bottom-[calc(5.5rem+var(--safe-bottom))] mt-6 bg-cream/95 py-3 backdrop-blur md:bottom-0">
        <button type="button" onClick={onPropose} disabled={proposing} className={`${PILL_INK} w-full md:w-auto`}>
          Proponme una receta
        </button>
      </div>
    </div>
  )
}

function ConfirmList({ items }: { items: PantryItem[] }) {
  return (
    <ul className={SUB_LIST}>
      {items.map((it) => (
        <ConfirmRow key={it.id} item={it} />
      ))}
    </ul>
  )
}

function ConfirmRow({ item }: { item: PantryItem }) {
  const patch = usePatchPantry()
  const del = useDeletePantry()
  const [draft, setDraft] = useState<string | null>(null)
  const step = stepOf(item.unit)
  const name = ingredientDisplayName(item.name)

  function save(quantity: number) {
    const q = Math.max(0, Math.round(quantity * 100) / 100)
    if (q !== item.quantity) patch.mutate({ id: item.id, patch: { quantity: q } })
  }
  function commitDraft() {
    if (draft == null) return
    const n = Number(draft.replace(",", "."))
    setDraft(null)
    if (Number.isFinite(n) && n >= 0) save(n)
  }

  return (
    <li className="flex min-h-[60px] items-center gap-1.5 py-2 pl-4 pr-2">
      <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{name}</span>
      <button
        type="button"
        aria-label={`Menos ${name}`}
        onClick={() => save(item.quantity - step)}
        disabled={item.quantity <= 0}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-mid hover:bg-cream-deep disabled:opacity-30"
      >
        <Minus size={16} aria-hidden="true" />
      </button>
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Cantidad de ${name}`}
        value={draft ?? String(item.quantity)}
        onFocus={() => setDraft(String(item.quantity))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur()
        }}
        className="h-11 w-[64px] shrink-0 rounded-xl border border-border-soft bg-paper px-1 text-center font-mono text-[14px] tabular-nums text-ink outline-none focus:border-ink"
      />
      <span className="w-8 shrink-0 font-mono text-[12px] text-ink-muted">{item.unit}</span>
      <button
        type="button"
        aria-label={`Más ${name}`}
        onClick={() => save(item.quantity + step)}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-mid hover:bg-cream-deep"
      >
        <Plus size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={() => del.mutate({ id: item.id })}
        className="min-h-[44px] shrink-0 rounded-full px-2 text-[13px] font-medium text-terracotta-deep hover:bg-warn-bg"
      >
        Quitar
      </button>
    </li>
  )
}

function AddToPantry({ onDone }: { onDone: () => void }) {
  const [query, setQuery] = useState("")
  const debounced = useDebounced(query, 200)
  const { data: results } = useSearchIngredients(debounced)
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [location, setLocation] = useState<PantryLocation>("nevera")
  const add = useAddPantry()
  const inputId = useId()
  const q = debounced.trim()
  const options = q.length >= 2 ? (results ?? []).slice(0, 8) : []

  if (picked) {
    return (
      <div className="rounded-[20px] border border-border-soft bg-paper p-4">
        <p className="text-[15px] text-ink">
          {picked.name} <span className="text-ink-soft">· 1 u</span>
        </p>
        <div className="mt-3" role="group" aria-label="Dónde está">
          <span className="mb-1 block text-[12px] font-medium text-ink-muted">Dónde está</span>
          <div className="flex flex-wrap gap-2">
            {PANTRY_LOCATIONS.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={location === l}
                onClick={() => setLocation(l)}
                className={`min-h-[40px] rounded-full border px-4 text-[14px] ${
                  location === l ? "border-ink bg-ink text-cream" : "border-border bg-paper text-ink-mid"
                }`}
              >
                {PANTRY_LOCATION_LABELS[l]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={add.isPending}
            onClick={() =>
              add.mutate(
                { name: picked.name, ingredientId: picked.id, quantity: 1, unit: "u", location },
                {
                  onSuccess: () => {
                    setPicked(null)
                    setQuery("")
                    onDone()
                  },
                },
              )
            }
            className={PILL_INK}
          >
            {add.isPending ? "Añadiendo…" : "Añadir a la despensa"}
          </button>
          <button type="button" onClick={() => setPicked(null)} className={PILL_OUTLINE}>
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      <label htmlFor={inputId} className="mb-1 block text-[12px] font-medium text-ink-muted">
        Añadir algo que tengas
      </label>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-soft" aria-hidden="true" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={options.length > 0}
          autoComplete="off"
          placeholder="huevos, calabacín…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${SUB_INPUT} pl-10`}
        />
      </div>
      {options.length > 0 && (
        <ul role="listbox" aria-label="Ingredientes" className={`${SUB_LIST} mt-1.5 max-h-64 overflow-y-auto`}>
          {options.map((r) => (
            <li key={r.id} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => setPicked({ id: r.id, name: r.name })}
                className="flex min-h-11 w-full items-center px-4 text-left text-[15px] text-ink hover:bg-cream-deep"
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
