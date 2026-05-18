"use client"

/**
 * PR 10A — bolt-on UI bits for the shopping page:
 *   - <ListTotalBanner />: prominent € total + "X sin precio" hint.
 *   - <AddManualItemForm />: inline form for free-text items.
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
    <div className="rounded-2xl bg-[#1A1612] p-4 text-[#FAF6EE] flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#C65D38]">
          <Wallet size={15} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#FAF6EE]/60">
            Total semanal estimado
          </div>
          <div className="font-display text-2xl leading-none mt-0.5">
            {pricedCount > 0 ? fmtEur(totalEur) : "—"}
          </div>
        </div>
      </div>
      <div className="text-right text-[10px] uppercase tracking-[0.12em] text-[#FAF6EE]/60">
        {pricedCount} con precio
        <br />
        {unpricedCount} sin precio
      </div>
    </div>
  )
}

export function AddManualItemForm({ listId }: { listId: string }) {
  const add = useAddShoppingItem()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [qty, setQty] = useState("1")
  const [unit, setUnit] = useState<BuyableUnit>("u")
  const [aisle, setAisle] = useState<Aisle>("otros")
  const [price, setPrice] = useState("")

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const quantity = Number(qty)
    if (!Number.isFinite(quantity) || quantity <= 0) return
    const pricePerUnit = price.trim() ? Number(price.replace(",", ".")) : null
    add.mutate(
      {
        listId,
        name: trimmed,
        quantity,
        unit,
        aisle,
        pricePerUnit: pricePerUnit !== null && Number.isFinite(pricePerUnit) ? pricePerUnit : null,
      },
      {
        onSuccess: () => {
          setName("")
          setQty("1")
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
        className="inline-flex items-center gap-2 rounded-full border border-dashed border-[#DDD6C5] bg-transparent px-4 py-2 text-[12px] uppercase tracking-[0.12em] text-[#7A7066] transition-all hover:border-[#1A1612] hover:text-[#1A1612]"
      >
        <Plus size={12} /> Añadir un item manual
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-4 space-y-3"
    >
      <div className="text-eyebrow text-[#7A7066]">Nuevo item manual</div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ej: Pan de molde integral"
        autoFocus
        maxLength={80}
        className="w-full border-b border-[#DDD6C5] bg-transparent py-1.5 text-[14px] outline-none focus:border-[#1A1612]"
      />
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.5}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          className="border-b border-[#DDD6C5] bg-transparent py-1.5 text-[13px] outline-none focus:border-[#1A1612]"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as BuyableUnit)}
          className="border-b border-[#DDD6C5] bg-transparent py-1.5 text-[13px] outline-none focus:border-[#1A1612]"
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
          className="border-b border-[#DDD6C5] bg-transparent py-1.5 text-[13px] outline-none focus:border-[#1A1612]"
        >
          {AISLES.map((a) => (
            <option key={a} value={a}>
              {AISLE_LABEL[a]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[#7A7066]">€</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.05}
          placeholder="precio por unidad (opcional)"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="flex-1 border-b border-[#DDD6C5] bg-transparent py-1.5 text-[13px] outline-none focus:border-[#1A1612]"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-1 rounded-full border border-[#DDD6C5] py-2 text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
        >
          Cerrar
        </button>
        <button
          type="submit"
          disabled={add.isPending || !name.trim()}
          className="flex-1 rounded-full bg-[#1A1612] py-2 text-[11px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
        >
          {add.isPending ? "Añadiendo…" : "Añadir"}
        </button>
      </div>
    </form>
  )
}

export function ItemPriceField({
  listId,
  item,
}: {
  listId: string
  item: ShoppingItem
}) {
  const patch = usePatchShoppingItem()
  const [draft, setDraft] = useState<string>(() =>
    item.pricePerUnit != null ? String(item.pricePerUnit) : "",
  )
  function commit() {
    const next = draft.trim()
    const parsed = next === "" ? null : Number(next.replace(",", "."))
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) return
    if (parsed === (item.pricePerUnit ?? null)) return
    patch.mutate({
      listId,
      itemId: item.id,
      patch: { pricePerUnit: parsed as number | null },
    })
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step={0.05}
      placeholder="€"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur()
      }}
      aria-label={`Precio por ${item.unit} de ${item.name}`}
      className="w-14 shrink-0 rounded-md border border-[#DDD6C5] bg-transparent px-1.5 py-1 text-right text-[11px] text-[#1A1612] tabular-nums outline-none focus:border-[#1A1612]"
    />
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
      className="shrink-0 rounded-full border border-[#DDD6C5] p-1.5 text-[#7A7066] hover:border-[#C65D38] hover:text-[#C65D38] disabled:opacity-40"
    >
      <Trash2 size={11} />
    </button>
  )
}
