"use client"

/**
 * PR 10A — bolt-on UI bits for the shopping page:
 *   - <ListTotalBanner />: prominent € total + "X sin precio" hint.
 *   - <AddManualItemForm />: form for free-text items (inline, or `embedded`
 *     in the /shopping "···" → «Añadir a mano» sheet).
 *   - <ItemPriceField />: tiny inline € input attached to each item row.
 *   - <ItemDeleteButton />: only for manual items.
 *
 * The existing /shopping page already handles check / stock / aisle
 * grouping. These pieces add: enter prices, see the total, write your own
 * items. PR 10B (next) layers staples + drag-reorder + history on top.
 */
import { useState } from "react"
import { Plus, Trash2, Wallet } from "lucide-react"
import type { Aisle, BuyableUnit } from "@ona/shared"
import { AISLES } from "@ona/shared"
import {
  useAddShoppingItem,
  useDeleteShoppingItem,
  useListTotal,
  usePatchShoppingItem,
  type ShoppingItem,
} from "@/hooks/useShopping"

const UNIT_OPTIONS: { value: BuyableUnit; label: string }[] = [
  { value: "u", label: "unidades" },
  { value: "g", label: "g" },
  { value: "ml", label: "ml" },
  { value: "cda", label: "cda" },
  { value: "cdita", label: "cdita" },
]

const AISLE_LABEL: Record<Aisle, string> = {
  produce: "Frutería",
  proteinas: "Proteínas",
  lacteos: "Lácteos",
  panaderia: "Panadería",
  despensa: "Despensa",
  congelados: "Congelados",
  otros: "Otros",
}

function fmtEur(n: number): string {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR" })
}

export function ListTotalBanner({ listId }: { listId: string }) {
  const { data } = useListTotal(listId)
  if (!data) return null
  const { totalEur, pricedCount, unpricedCount } = data
  if (pricedCount === 0 && unpricedCount === 0) return null
  return (
    <div className="flex items-center justify-between gap-4 rounded-[20px] border border-border-soft bg-paper px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream-deep text-terracotta-deep">
          <Wallet size={17} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
            Total semanal estimado
          </div>
          <div className="mt-0.5 font-serif-text text-[26px] font-[650] leading-none text-ink tabular-nums">
            {pricedCount > 0 ? fmtEur(totalEur) : "—"}
          </div>
        </div>
      </div>
      <div className="text-right text-[12px] leading-snug text-ink-muted">
        {pricedCount} con precio
        <br />
        {unpricedCount} sin precio
      </div>
    </div>
  )
}

export function AddManualItemForm({
  listId,
  embedded = false,
  onClose,
}: {
  listId: string
  /** Rendered inside a sheet (the "···" → Añadir a mano): always open, no own eyebrow/card. */
  embedded?: boolean
  /** Called by "Cerrar" when embedded. */
  onClose?: () => void
}) {
  const add = useAddShoppingItem()
  const [open, setOpen] = useState(embedded)
  const [name, setName] = useState("")
  // Empty = "no amount": the shop order then writes "1 calabacín" or asks how much jamón.
  const [qty, setQty] = useState("")
  const [unit, setUnit] = useState<BuyableUnit>("u")
  const [aisle, setAisle] = useState<Aisle>("otros")
  const [price, setPrice] = useState("")

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const quantity = qty.trim() ? Number(qty.replace(",", ".")) : null
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) return
    // The manual-add form now asks for the **total** price for the line
    // (matching the new inline price input behaviour). Convert to
    // per-unit so the wire shape stays the same.
    const totalParsed = price.trim() ? Number(price.replace(",", ".")) : null
    const pricePerUnit =
      totalParsed !== null && Number.isFinite(totalParsed) && totalParsed >= 0
        ? totalParsed / (quantity ?? 1)
        : null
    add.mutate(
      {
        listId,
        name: trimmed,
        ...(quantity !== null ? { quantity, unit } : {}),
        aisle,
        pricePerUnit,
      },
      {
        onSuccess: () => {
          setName("")
          setQty("")
          setPrice("")
          // keep unit + aisle — next add likely shares them
        },
      },
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-dashed border-border bg-transparent px-4 text-[14px] text-ink-mid transition-colors hover:border-ink hover:text-ink"
      >
        <Plus size={12} /> Añadir un item manual
      </button>
    )
  }

  const field =
    "h-11 w-full rounded-xl border border-border bg-paper px-3 text-[15px] text-ink outline-none placeholder:text-ink-light focus:border-ink"
  return (
    <form
      onSubmit={handleSubmit}
      className={embedded ? "space-y-3" : "space-y-3 rounded-[20px] border border-border-soft bg-paper p-4"}
    >
      {!embedded && <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Nuevo item manual</div>}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ej: Pan de molde integral"
        autoFocus
        maxLength={80}
        className={field}
      />
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.5}
          value={qty}
          placeholder="Cantidad"
          aria-label="Cantidad (opcional)"
          onChange={(e) => setQty(e.target.value)}
          className={field}
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as BuyableUnit)}
          aria-label="Unidad"
          className={field}
        >
          {UNIT_OPTIONS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
        <select
          value={aisle}
          onChange={(e) => setAisle(e.target.value as Aisle)}
          aria-label="Pasillo"
          className={field}
        >
          {AISLES.map((a) => (
            <option key={a} value={a}>
              {AISLE_LABEL[a]}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2">
        <span className="text-[14px] text-ink-muted">€</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.05}
          placeholder="precio total estimado (opcional, e.g. 1,80)"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className={`${field} flex-1`}
        />
      </label>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => (embedded ? onClose?.() : setOpen(false))}
          className="min-h-[44px] flex-1 rounded-full border border-border bg-paper text-[14px] font-medium text-ink-mid transition-colors hover:border-ink hover:text-ink"
        >
          Cerrar
        </button>
        <button
          type="submit"
          disabled={add.isPending || !name.trim()}
          className="min-h-[44px] flex-1 rounded-full bg-ink text-[14px] font-semibold text-cream transition-colors hover:bg-ink-mid disabled:opacity-40"
        >
          {add.isPending ? "Añadiendo…" : "Añadir"}
        </button>
      </div>
    </form>
  )
}

/**
 * Inline price input. The user types the **total** they paid (or expect
 * to pay) for the whole line — e.g. "1,80" for the 550 g of brócoli —
 * instead of having to compute price-per-gram themselves. Internally we
 * still store `pricePerUnit` (= total / quantity) so the backend totals
 * computation and the rest of the codebase stay unchanged.
 */
export function ItemPriceField({
  listId,
  item,
}: {
  listId: string
  item: ShoppingItem
}) {
  const patch = usePatchShoppingItem()
  // The displayed value is the total cost rounded to 2 decimals.
  const displayTotal =
    item.pricePerUnit != null && item.quantity > 0
      ? (item.pricePerUnit * item.quantity).toFixed(2).replace(/\.?0+$/, "")
      : ""
  const [draft, setDraft] = useState<string>(displayTotal)
  function commit() {
    const next = draft.trim()
    const total = next === "" ? null : Number(next.replace(",", "."))
    if (total !== null && (!Number.isFinite(total) || total < 0)) return
    const nextPricePerUnit =
      total !== null && item.quantity > 0 ? total / item.quantity : null
    const prevPricePerUnit = item.pricePerUnit ?? null
    if (
      (nextPricePerUnit === null && prevPricePerUnit === null) ||
      (nextPricePerUnit !== null &&
        prevPricePerUnit !== null &&
        Math.abs(nextPricePerUnit - prevPricePerUnit) < 1e-6)
    ) {
      return
    }
    patch.mutate({
      listId,
      itemId: item.id,
      patch: { pricePerUnit: nextPricePerUnit },
    })
  }
  return (
    // The label is the 44 px hit area; the field itself is 36 px.
    <label className="relative inline-flex h-11 shrink-0 items-center">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={0.1}
        placeholder="—"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur()
        }}
        aria-label={`Precio total estimado de ${item.name}`}
        title="Precio total que pagas (o esperas pagar) por esta línea"
        className="h-9 w-[72px] rounded-xl border border-border bg-paper px-2 pr-5 text-right font-mono text-[13px] text-ink tabular-nums outline-none transition-colors placeholder:text-ink-light focus:border-ink focus:bg-cream-deep"
      />
      <span className="pointer-events-none absolute right-2 text-[12px] text-ink-muted">€</span>
    </label>
  )
}

export function ItemDeleteButton({
  listId,
  itemId,
}: {
  listId: string
  itemId: string
}) {
  const del = useDeleteShoppingItem()
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof window === "undefined" || window.confirm("¿Quitar este item de la lista?")) {
          del.mutate({ listId, itemId })
        }
      }}
      disabled={del.isPending}
      aria-label="Eliminar item manual"
      className="-mx-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-terracotta-deep disabled:opacity-40"
    >
      <Trash2 size={15} />
    </button>
  )
}
