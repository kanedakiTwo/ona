"use client"

/**
 * /profile/pantry — household pantry register (PR 11).
 *
 * Quantities auto-decrement when someone in the household marks a recipe
 * cooked (POST /cook-logs). This page is for manual control: add what you
 * just bought, edit quantities, set expiry dates.
 *
 * Skin: "D · Luz y foto" (PRO-40). Quantity stays editable inline in each
 * row; the expiry date and "Quitar de la despensa" live in the row's "···"
 * sheet. At lg+ the add form is a left column and the list fills the rest.
 */
import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import type { BuyableUnit } from "@ona/shared"
import { ingredientDisplayName } from "@ona/shared"
import {
  usePantry,
  useAddPantry,
  usePatchPantry,
  useDeletePantry,
  type PantryItem,
} from "@/hooks/usePantry"
import { MenuSheet, SheetAction } from "@/components/menu/MenuSheet"
import {
  Accent,
  MoreButton,
  PILL_INK,
  SUB_CARD,
  SUB_EYEBROW,
  SUB_INPUT,
  SUB_LIST,
  SubNotice,
  SubPage,
} from "@/components/profile/SubPage"

const UNIT_OPTIONS: { value: BuyableUnit; label: string }[] = [
  { value: "u", label: "unidades" },
  { value: "g", label: "g" },
  { value: "ml", label: "ml" },
  { value: "cda", label: "cda" },
  { value: "cdita", label: "cdita" },
]

function expiryPill(expiresAt: string | null): { label: string; tone: string } | null {
  if (!expiresAt) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(expiresAt + 'T00:00:00')
  const diffDays = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  const label = d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" })
  if (diffDays < 0) return { label: `Caducado ${label}`, tone: "bg-terracotta-deep text-cream" }
  if (diffDays <= 3) return { label: `Caduca ${label}`, tone: "bg-warn-bg text-terracotta-deep" }
  if (diffDays <= 7) return { label: `Caduca ${label}`, tone: "bg-cream-deep text-ink-muted" }
  return { label, tone: "bg-cream-deep text-ink-muted" }
}

const FIELD_LABEL = "mb-1 block text-[12px] font-medium text-ink-muted"

export default function PantryPage() {
  const { data: items, isLoading } = usePantry()
  const add = useAddPantry()
  const del = useDeletePantry()

  const [name, setName] = useState("")
  const [qty, setQty] = useState("1")
  const [unit, setUnit] = useState<BuyableUnit>("u")
  const [exp, setExp] = useState("")

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const quantity = Number(qty)
    if (!Number.isFinite(quantity) || quantity < 0) return
    add.mutate(
      {
        name: trimmed,
        quantity,
        unit,
        expiresAt: exp || null,
      },
      {
        onSuccess: () => {
          setName("")
          setQty("1")
          setExp("")
        },
      },
    )
  }

  return (
    <SubPage
      eyebrow="Lo que hay en casa"
      title={
        <>
          Tu <Accent>despensa</Accent>.
        </>
      }
      intro="Lo que tienes en casa con cantidad y caducidad. Cuando marques una receta como cocinada, las cantidades bajan automáticamente."
    >
      <div className="grid gap-8 lg:grid-cols-[360px_1fr] lg:items-start lg:gap-10">
        <section className="lg:sticky lg:top-6">
          <form onSubmit={handleAdd} className={`${SUB_CARD} space-y-3 p-4`}>
            <h2 className={SUB_EYEBROW}>Nuevo item</h2>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Arroz, Yogur natural…"
              maxLength={80}
              aria-label="Nombre"
              className={SUB_INPUT}
            />
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className={FIELD_LABEL}>Cantidad</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.5}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className={SUB_INPUT}
                />
              </label>
              <label>
                <span className={FIELD_LABEL}>Unidad</span>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value as BuyableUnit)}
                  className={SUB_INPUT}
                >
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u.value} value={u.value}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className={FIELD_LABEL}>Caducidad (opcional)</span>
              <input
                type="date"
                value={exp}
                onChange={(e) => setExp(e.target.value)}
                className={SUB_INPUT}
                aria-label="Caducidad (opcional)"
              />
            </label>
            <button type="submit" disabled={!name.trim() || add.isPending} className={`${PILL_INK} w-full`}>
              <Plus size={16} /> {add.isPending ? "Añadiendo…" : "Añadir a despensa"}
            </button>
          </form>
        </section>

        <section>
          <h2 className={`${SUB_EYEBROW} mb-3`}>Despensa · {items?.length ?? 0}</h2>
          {isLoading ? (
            <SubNotice>
              <p className="font-serif-text text-[18px] italic text-ink-mid">Cargando…</p>
            </SubNotice>
          ) : !items || items.length === 0 ? (
            <SubNotice dashed>
              <p className="font-serif-text text-[18px] italic text-ink-mid">Despensa vacía.</p>
              <p className="mt-1 text-[14px] text-ink-soft">Añade lo que tengas guardado.</p>
            </SubNotice>
          ) : (
            <ul className={SUB_LIST}>
              {items.map((it) => (
                <PantryRow
                  key={it.id}
                  item={it}
                  onDelete={() => {
                    if (typeof window === "undefined" || window.confirm(`¿Quitar "${it.name}" de la despensa?`)) {
                      del.mutate({ id: it.id })
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </SubPage>
  )
}

function PantryRow({ item, onDelete }: { item: PantryItem; onDelete: () => void }) {
  const patch = usePatchPantry()
  const [qtyDraft, setQtyDraft] = useState<string>(String(item.quantity))
  const [expDraft, setExpDraft] = useState<string>(item.expiresAt ?? "")
  const [sheetOpen, setSheetOpen] = useState(false)
  const pill = expiryPill(item.expiresAt)
  const displayName = ingredientDisplayName(item.name)

  function commitQty() {
    const n = Number(qtyDraft.replace(",", "."))
    if (!Number.isFinite(n) || n < 0) {
      setQtyDraft(String(item.quantity))
      return
    }
    if (n === item.quantity) return
    patch.mutate({ id: item.id, patch: { quantity: n } })
  }
  function commitExp() {
    if ((expDraft || null) === item.expiresAt) return
    patch.mutate({ id: item.id, patch: { expiresAt: expDraft || null } })
  }

  return (
    <li className="flex min-h-[64px] items-center gap-2 py-2 pl-4 pr-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] text-ink">{displayName}</div>
        {pill && (
          <span
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${pill.tone}`}
          >
            {pill.label}
          </span>
        )}
      </div>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={0.5}
        value={qtyDraft}
        onChange={(e) => setQtyDraft(e.target.value)}
        onBlur={commitQty}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
        }}
        aria-label="Cantidad"
        className="min-h-[44px] w-[72px] shrink-0 rounded-xl border border-border-soft bg-paper px-2 text-right font-mono text-[14px] tabular-nums text-ink outline-none focus:border-ink"
      />
      <span className="w-9 shrink-0 font-mono text-[12px] tabular-nums text-ink-muted">{item.unit}</span>
      <MoreButton label={`Opciones de ${displayName}`} onClick={() => setSheetOpen(true)} />

      <MenuSheet
        open={sheetOpen}
        onClose={() => {
          commitExp()
          setSheetOpen(false)
        }}
        eyebrow="Despensa"
        title={displayName}
      >
        <label className="mb-3 block px-3">
          <span className="mb-1 block text-[12px] font-medium text-ink-muted">Caducidad</span>
          <input
            type="date"
            value={expDraft}
            onChange={(e) => setExpDraft(e.target.value)}
            onBlur={commitExp}
            aria-label="Caducidad"
            className="min-h-[44px] w-full rounded-xl border border-border-soft bg-paper px-3.5 text-[15px] text-ink outline-none focus:border-ink"
          />
        </label>
        <SheetAction
          icon={Trash2}
          label="Quitar de la despensa"
          destructive
          onClick={() => {
            setSheetOpen(false)
            onDelete()
          }}
        />
      </MenuSheet>
    </li>
  )
}
