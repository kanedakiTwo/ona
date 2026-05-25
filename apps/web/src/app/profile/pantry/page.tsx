"use client"

/**
 * /profile/pantry — household pantry register (PR 11).
 *
 * Quantities auto-decrement when someone in the household marks a recipe
 * cooked (POST /cook-logs). This page is for manual control: add what you
 * just bought, edit quantities, set expiry dates.
 */
import { useState } from "react"
import Link from "next/link"
import { ChevronLeft, Plus, Trash2 } from "lucide-react"
import type { BuyableUnit } from "@ona/shared"
import {
  usePantry,
  useAddPantry,
  usePatchPantry,
  useDeletePantry,
  type PantryItem,
} from "@/hooks/usePantry"

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
  if (diffDays < 0) return { label: `Caducado ${label}`, tone: "bg-[#C65D38] text-[#FAF6EE]" }
  if (diffDays <= 3) return { label: `Caduca ${label}`, tone: "bg-[#C65D38]/15 text-[#C65D38]" }
  if (diffDays <= 7) return { label: `Caduca ${label}`, tone: "bg-[#F2EDE0] text-[#7A7066]" }
  return { label, tone: "bg-[#F2EDE0] text-[#7A7066]" }
}

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
    <div className="bg-[#FAF6EE] min-h-screen pb-24">
      <header className="px-5 pt-8 pb-6">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-eyebrow text-[#7A7066] hover:text-[#C65D38]"
        >
          <ChevronLeft size={14} /> Volver al perfil
        </Link>
        <div className="mt-3 text-eyebrow">Lo que hay en casa</div>
        <h1 className="mt-1 font-display text-[2.2rem] leading-[0.95] text-[#1A1612]">
          Tu <span className="italic text-[#C65D38]">despensa</span>.
        </h1>
        <p className="mt-3 text-[12px] text-[#7A7066] max-w-md">
          Lo que tienes en casa con cantidad y caducidad. Cuando marques una
          receta como cocinada, las cantidades bajan automáticamente.
        </p>
      </header>

      <section className="px-5">
        <form
          onSubmit={handleAdd}
          className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-4 space-y-3"
        >
          <div className="text-eyebrow text-[#7A7066]">Nuevo item</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Arroz, Yogur natural…"
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
            <input
              type="date"
              value={exp}
              onChange={(e) => setExp(e.target.value)}
              className="border-b border-[#DDD6C5] bg-transparent py-1.5 text-[13px] outline-none focus:border-[#1A1612]"
              aria-label="Caducidad (opcional)"
            />
          </div>
          <button
            type="submit"
            disabled={!name.trim() || add.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
          >
            <Plus size={12} /> {add.isPending ? "Añadiendo…" : "Añadir a despensa"}
          </button>
        </form>
      </section>

      <section className="px-5 mt-8">
        <div className="text-eyebrow mb-3">
          Despensa · {items?.length ?? 0}
        </div>
        {isLoading ? (
          <div className="py-10 text-center font-italic italic text-[#7A7066]">Cargando…</div>
        ) : !items || items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#DDD6C5] py-10 text-center">
            <p className="font-italic italic text-[#7A7066]">Despensa vacía.</p>
            <p className="mt-1 text-[12px] text-[#A39A8E]">Añade lo que tengas guardado.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#DDD6C5] rounded-2xl bg-[#FFFEFA] border border-[#DDD6C5]">
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
  )
}

function PantryRow({ item, onDelete }: { item: PantryItem; onDelete: () => void }) {
  const patch = usePatchPantry()
  const [qtyDraft, setQtyDraft] = useState<string>(String(item.quantity))
  const [expDraft, setExpDraft] = useState<string>(item.expiresAt ?? "")
  const pill = expiryPill(item.expiresAt)

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
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-[14px] text-[#1A1612] capitalize">{item.name}</div>
        {pill && (
          <span
            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.12em] ${pill.tone}`}
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
        className="w-16 shrink-0 rounded-md border border-[#DDD6C5] bg-transparent px-1.5 py-1 text-right text-[12px] tabular-nums outline-none focus:border-[#1A1612]"
      />
      <span className="text-[11px] tabular-nums text-[#7A7066] shrink-0">{item.unit}</span>
      <input
        type="date"
        value={expDraft}
        onChange={(e) => setExpDraft(e.target.value)}
        onBlur={commitExp}
        aria-label="Caducidad"
        className="rounded-md border border-[#DDD6C5] bg-transparent px-1.5 py-1 text-[11px] text-[#7A7066] outline-none focus:border-[#1A1612]"
      />
      <button
        type="button"
        onClick={onDelete}
        aria-label="Eliminar"
        className="shrink-0 rounded-full border border-[#DDD6C5] p-1.5 text-[#7A7066] hover:border-[#C65D38] hover:text-[#C65D38]"
      >
        <Trash2 size={12} />
      </button>
    </li>
  )
}
