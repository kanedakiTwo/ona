"use client"

import { useMemo, useState } from "react"
import { motion } from "motion/react"
import { Pencil, Plus, Trash2, Undo2, X } from "lucide-react"
import type { IngredientOverride, RecipeIngredient } from "@ona/shared"
import {
  formatQuantity,
  groupIngredientsBySection,
} from "@/lib/recipeView"

/**
 * Ingredient may carry rounding metadata when it came from the scaler
 * (`?servings=N`). The detail page passes the raw `recipe.ingredients`
 * array; we accept either shape.
 */
type DisplayIngredient = RecipeIngredient & {
  rounded?: boolean
  roundingNote?: string
}

interface Props {
  ingredients: DisplayIngredient[]
  /** Number to display next to the heading ("Para 4") */
  targetServings: number
  /** Eyebrow chapter number, e.g. "01" */
  chapter: string
  /**
   * User's household ingredient overrides. When non-empty, each entry is
   * applied on top of the recipe's original ingredients:
   *   - `remove` → original row rendered struck-through, faded.
   *   - `modify` → original quantity rendered struck-through, override
   *     quantity rendered next to it in terracotta.
   *   - `add`    → extra rows appended at the bottom with a subtle highlight.
   * Pass `null`/undefined on the public/read-only path (no edit affordance).
   */
  overrides?: IngredientOverride[] | null
  /**
   * Called when the user commits a structural change. The full list is sent
   * back so the parent can persist a single PATCH. Absence of this callback
   * hides the edit affordance entirely (read-only view).
   */
  onOverridesChange?: (next: IngredientOverride[]) => void
  /** Optional disabled state while a save is in flight. */
  saving?: boolean
}

/** UI-local helper that looks up the per-row override (if any). */
function findOverrideFor(
  ingredientId: string | undefined,
  overrides: IngredientOverride[],
): IngredientOverride | null {
  if (!ingredientId) return null
  for (const ov of overrides) {
    if (ov.kind === "remove" && ov.recipeIngredientId === ingredientId) return ov
    if (ov.kind === "modify" && ov.recipeIngredientId === ingredientId) return ov
  }
  return null
}

export function IngredientsSection({
  ingredients,
  targetServings,
  chapter,
  overrides,
  onOverridesChange,
  saving,
}: Props) {
  const groups = groupIngredientsBySection(ingredients)
  const safeOverrides = overrides ?? []
  const adds = useMemo(
    () => safeOverrides.filter((ov): ov is Extract<IngredientOverride, { kind: "add" }> => ov.kind === "add"),
    [safeOverrides],
  )
  const editable = !!onOverridesChange
  const [editing, setEditing] = useState(false)
  const [editingRow, setEditingRow] = useState<string | null>(null)
  const [addingRow, setAddingRow] = useState(false)

  function pushOverride(next: IngredientOverride) {
    if (!onOverridesChange) return
    // Drop any prior remove/modify for the same target so the latest wins;
    // adds are independent (different additions can coexist).
    const filtered = safeOverrides.filter((ov) => {
      if (next.kind === "remove" && ov.kind === "remove" && ov.recipeIngredientId === next.recipeIngredientId) return false
      if (next.kind === "remove" && ov.kind === "modify" && ov.recipeIngredientId === next.recipeIngredientId) return false
      if (next.kind === "modify" && ov.kind === "remove" && ov.recipeIngredientId === next.recipeIngredientId) return false
      if (next.kind === "modify" && ov.kind === "modify" && ov.recipeIngredientId === next.recipeIngredientId) return false
      return true
    })
    onOverridesChange([...filtered, next])
  }

  function clearOverrideFor(recipeIngredientId: string) {
    if (!onOverridesChange) return
    onOverridesChange(
      safeOverrides.filter((ov) =>
        ov.kind === "add"
          ? true
          : ov.recipeIngredientId !== recipeIngredientId,
      ),
    )
  }

  function removeAddAt(index: number) {
    if (!onOverridesChange) return
    let addIdx = -1
    onOverridesChange(
      safeOverrides.filter((ov) => {
        if (ov.kind !== "add") return true
        addIdx += 1
        return addIdx !== index
      }),
    )
  }

  let runningIdx = 0

  return (
    <section className="mt-10">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="text-eyebrow text-[#7A7066]">Capítulo {chapter}</div>
          <h2 className="font-display text-[1.6rem] leading-tight text-[#1A1612]">
            <span className="font-italic italic">Ingredientes</span>
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
            Para {targetServings}
          </span>
          {editable && (
            <button
              type="button"
              onClick={() => {
                setEditing((v) => !v)
                setEditingRow(null)
                setAddingRow(false)
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors ${
                editing
                  ? "bg-[#1A1612] text-[#FAF6EE]"
                  : "border border-[#DDD6C5] text-[#7A7066] hover:border-[#1A1612] hover:text-[#1A1612]"
              }`}
              aria-pressed={editing}
            >
              <Pencil size={11} />
              {editing ? "Listo" : "Editar"}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.section && (
              <h3 className="mb-2 font-italic italic text-[14px] text-[#4A4239]">
                {group.section}
              </h3>
            )}
            <ul className="divide-y divide-dashed divide-[#DDD6C5] border-y border-dashed border-[#DDD6C5]">
              {group.ingredients.map((ing) => {
                const i = runningIdx++
                const ov = findOverrideFor(ing.id, safeOverrides)
                const removed = ov?.kind === "remove"
                const modified = ov?.kind === "modify"
                const effectiveQuantity = modified && ov.quantity != null ? ov.quantity : ing.quantity
                const effectiveUnit = modified && ov.unit != null ? ov.unit : ing.unit
                const isEditingRow = editing && editingRow === (ing.id ?? `idx-${i}`)
                return (
                  <motion.li
                    key={ing.id ?? i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.03, duration: 0.4 }}
                    className={`flex items-baseline justify-between gap-3 py-3 ${
                      removed ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span
                        className={`text-[15px] capitalize ${
                          removed
                            ? "text-[#1A1612] line-through decoration-[#C65D38] decoration-1"
                            : "text-[#1A1612]"
                        }`}
                      >
                        {ing.ingredientName ?? "Ingrediente"}
                      </span>
                      {ing.optional && (
                        <span className="rounded-full bg-[#F2EDE0] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[#7A7066]">
                          opcional
                        </span>
                      )}
                      {ing.note && (
                        <span className="text-[12px] italic text-[#A39A8E]">
                          {ing.note}
                        </span>
                      )}
                      {ing.roundingNote && (
                        <span className="text-[10px] text-[#A39A8E]">
                          ({ing.roundingNote})
                        </span>
                      )}
                      {modified && ov.note && (
                        <span className="text-[10px] italic text-[#C65D38]">
                          {ov.note}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {modified ? (
                        <span className="flex items-baseline gap-1 whitespace-nowrap font-mono text-[11px]">
                          <span className="text-[#7A7066]/60 line-through">
                            {formatQuantity(ing.quantity, ing.unit)}
                          </span>
                          <span className="text-[#C65D38]">
                            {formatQuantity(effectiveQuantity, effectiveUnit)}
                          </span>
                        </span>
                      ) : (
                        <span
                          className={`font-mono whitespace-nowrap text-[11px] tracking-tight ${
                            removed ? "text-[#7A7066]/60 line-through" : "text-[#7A7066]"
                          }`}
                        >
                          {formatQuantity(ing.quantity, ing.unit)}
                        </span>
                      )}
                      {editing && ing.id && (
                        <div className="flex items-center gap-1">
                          {(removed || modified) && (
                            <button
                              type="button"
                              onClick={() => clearOverrideFor(ing.id!)}
                              disabled={saving}
                              aria-label="Deshacer cambios en este ingrediente"
                              className="rounded-full p-1 text-[#7A7066] hover:bg-[#F2EDE0] hover:text-[#1A1612] disabled:opacity-30"
                            >
                              <Undo2 size={12} />
                            </button>
                          )}
                          {!removed && (
                            <>
                              <button
                                type="button"
                                onClick={() =>
                                  setEditingRow((cur) =>
                                    cur === ing.id ? null : ing.id!,
                                  )
                                }
                                disabled={saving}
                                aria-label={`Editar cantidad de ${ing.ingredientName ?? "ingrediente"}`}
                                className="rounded-full p-1 text-[#7A7066] hover:bg-[#F2EDE0] hover:text-[#1A1612] disabled:opacity-30"
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  pushOverride({
                                    kind: "remove",
                                    recipeIngredientId: ing.id!,
                                  })
                                }
                                disabled={saving}
                                aria-label={`Quitar ${ing.ingredientName ?? "ingrediente"}`}
                                className="rounded-full p-1 text-[#C65D38] hover:bg-[#FDEEE8] disabled:opacity-30"
                              >
                                <Trash2 size={12} />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {isEditingRow && ing.id && (
                      <div className="basis-full pl-1 pt-2">
                        <ModifyRowEditor
                          initialQuantity={effectiveQuantity}
                          initialUnit={effectiveUnit}
                          onCancel={() => setEditingRow(null)}
                          onSave={(q, u, note) => {
                            pushOverride({
                              kind: "modify",
                              recipeIngredientId: ing.id!,
                              quantity: q,
                              unit: u,
                              note: note || null,
                            })
                            setEditingRow(null)
                          }}
                        />
                      </div>
                    )}
                  </motion.li>
                )
              })}
            </ul>
          </div>
        ))}

        {/* Added rows — flat list at the bottom, highlighted */}
        {adds.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-dashed border-[#2D6A4F]/40 bg-[#2D6A4F]/5 p-3">
            <li className="mb-1 text-[10px] uppercase tracking-[0.15em] text-[#2D6A4F]">
              Añadidos por ti
            </li>
            {adds.map((ov, i) => (
              <li
                key={`add-${i}`}
                className="flex items-baseline justify-between gap-3 py-1.5"
              >
                <span className="text-[15px] capitalize text-[#1A1612]">
                  {ov.label}
                </span>
                <div className="flex items-center gap-2">
                  {ov.quantity != null && ov.unit && (
                    <span className="font-mono whitespace-nowrap text-[11px] text-[#2D6A4F]">
                      {formatQuantity(ov.quantity, ov.unit)}
                    </span>
                  )}
                  {editing && (
                    <button
                      type="button"
                      onClick={() => removeAddAt(i)}
                      disabled={saving}
                      aria-label={`Quitar ${ov.label}`}
                      className="rounded-full p-1 text-[#C65D38] hover:bg-[#FDEEE8] disabled:opacity-30"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* + Añadir at the bottom — only in edit mode */}
        {editable && editing && (
          <div>
            {addingRow ? (
              <AddRowEditor
                onCancel={() => setAddingRow(false)}
                onSave={(label, q, u) => {
                  if (!onOverridesChange) return
                  const next: IngredientOverride = {
                    kind: "add",
                    label,
                    ...(q != null ? { quantity: q } : {}),
                    ...(u ? { unit: u } : {}),
                  }
                  onOverridesChange([...safeOverrides, next])
                  setAddingRow(false)
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingRow(true)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#DDD6C5] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#2D6A4F] transition-colors hover:border-[#2D6A4F] hover:bg-[#2D6A4F]/5 disabled:opacity-40"
              >
                <Plus size={12} /> Añadir ingrediente
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Inline editors ───────────────────────────────────────────

// Mirrors the canonical `UNITS` enum from `@ona/shared`. Kept inline here so
// the <select> picker is decoupled from the shared package's structure but
// the TS check below catches drift.
const UNIT_OPTIONS = [
  "g", "ml", "u", "cda", "cdita", "pizca", "al_gusto",
] as const

function ModifyRowEditor({
  initialQuantity,
  initialUnit,
  onCancel,
  onSave,
}: {
  initialQuantity: number
  initialUnit: string
  onCancel: () => void
  onSave: (quantity: number, unit: (typeof UNIT_OPTIONS)[number], note: string) => void
}) {
  const [qty, setQty] = useState(String(initialQuantity))
  const [unit, setUnit] = useState<(typeof UNIT_OPTIONS)[number]>(
    (UNIT_OPTIONS as readonly string[]).includes(initialUnit)
      ? (initialUnit as (typeof UNIT_OPTIONS)[number])
      : "g",
  )
  const [note, setNote] = useState("")
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] p-2">
      <input
        type="number"
        min={0}
        step={0.5}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        className="w-20 rounded border border-[#DDD6C5] bg-transparent px-2 py-1 text-[13px] tabular-nums focus:border-[#1A1612] focus:outline-none"
        aria-label="Cantidad"
      />
      <select
        value={unit}
        onChange={(e) => setUnit(e.target.value as (typeof UNIT_OPTIONS)[number])}
        className="rounded border border-[#DDD6C5] bg-transparent px-2 py-1 text-[12px] focus:border-[#1A1612] focus:outline-none"
        aria-label="Unidad"
      >
        {UNIT_OPTIONS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="nota opcional"
        maxLength={120}
        className="flex-1 rounded border border-[#DDD6C5] bg-transparent px-2 py-1 text-[12px] italic focus:border-[#1A1612] focus:outline-none"
      />
      <button
        type="button"
        onClick={() => {
          const n = Number(qty)
          if (!Number.isFinite(n) || n < 0) return
          onSave(n, unit, note.trim())
        }}
        className="rounded-full bg-[#1A1612] px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-[#FAF6EE]"
      >
        Guardar
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
      >
        Cancelar
      </button>
    </div>
  )
}

function AddRowEditor({
  onCancel,
  onSave,
}: {
  onCancel: () => void
  onSave: (label: string, quantity: number | null, unit: (typeof UNIT_OPTIONS)[number] | null) => void
}) {
  const [label, setLabel] = useState("")
  const [qty, setQty] = useState("")
  const [unit, setUnit] = useState<(typeof UNIT_OPTIONS)[number]>("g")
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[#2D6A4F]/50 bg-[#2D6A4F]/5 p-2">
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Ingrediente nuevo"
        maxLength={120}
        autoFocus
        className="flex-1 min-w-[180px] rounded border border-[#DDD6C5] bg-[#FFFEFA] px-2 py-1 text-[13px] focus:border-[#2D6A4F] focus:outline-none"
      />
      <input
        type="number"
        min={0}
        step={0.5}
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder="cantidad"
        className="w-24 rounded border border-[#DDD6C5] bg-[#FFFEFA] px-2 py-1 text-[13px] tabular-nums focus:border-[#2D6A4F] focus:outline-none"
        aria-label="Cantidad"
      />
      <select
        value={unit}
        onChange={(e) => setUnit(e.target.value as (typeof UNIT_OPTIONS)[number])}
        className="rounded border border-[#DDD6C5] bg-[#FFFEFA] px-2 py-1 text-[12px] focus:border-[#2D6A4F] focus:outline-none"
        aria-label="Unidad"
      >
        {UNIT_OPTIONS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          const trimmed = label.trim()
          if (!trimmed) return
          const n = qty === "" ? null : Number(qty)
          const finalQty = n != null && Number.isFinite(n) && n >= 0 ? n : null
          onSave(trimmed, finalQty, finalQty != null ? unit : null)
        }}
        disabled={!label.trim()}
        className="rounded-full bg-[#2D6A4F] px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
      >
        Añadir
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
      >
        Cancelar
      </button>
    </div>
  )
}
