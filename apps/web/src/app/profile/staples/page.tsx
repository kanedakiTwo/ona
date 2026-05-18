"use client"

/**
 * /profile/staples — household recurring staples manager (PR 10B).
 *
 * Items here auto-pre-pend to every freshly generated shopping list (and to
 * regenerated lists). Toggle `active` to skip one without losing the row.
 * Any household member can add / edit / delete.
 */
import { useState } from "react"
import Link from "next/link"
import { ChevronLeft, Plus, Trash2 } from "lucide-react"
import type { Aisle, BuyableUnit } from "@ona/shared"
import { AISLES } from "@ona/shared"
import {
  useStaples,
  useAddStaple,
  usePatchStaple,
  useDeleteStaple,
  type Staple,
} from "@/hooks/useStaples"

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

export default function StaplesPage() {
  const { data: staples, isLoading } = useStaples()
  const add = useAddStaple()
  const patch = usePatchStaple()
  const del = useDeleteStaple()

  const [name, setName] = useState("")
  const [qty, setQty] = useState("1")
  const [unit, setUnit] = useState<BuyableUnit>("u")
  const [aisle, setAisle] = useState<Aisle>("otros")
  const [price, setPrice] = useState("")

  function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const quantity = Number(qty)
    if (!Number.isFinite(quantity) || quantity <= 0) return
    const pricePerUnit = price.trim() ? Number(price.replace(",", ".")) : null
    add.mutate(
      {
        name: trimmed,
        quantity,
        unit,
        aisle,
        pricePerUnit:
          pricePerUnit !== null && Number.isFinite(pricePerUnit) ? pricePerUnit : null,
      },
      {
        onSuccess: () => {
          setName("")
          setPrice("")
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
        <div className="mt-3 text-eyebrow">Lo de siempre</div>
        <h1 className="mt-1 font-display text-[2.2rem] leading-[0.95] text-[#1A1612]">
          <span className="italic text-[#C65D38]">Tus</span> básicos.
        </h1>
        <p className="mt-3 text-[12px] text-[#7A7066] max-w-md">
          Los items que necesitas todas las semanas (pan, café, leche…). Se añaden
          automáticamente a cada lista de la compra nueva. Pausa lo que no quieras
          esta semana sin perder la fila.
        </p>
      </header>

      <section className="px-5">
        <form
          onSubmit={handleAdd}
          className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-4 space-y-3"
        >
          <div className="text-eyebrow text-[#7A7066]">Nuevo básico</div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Leche, Pan, Café…"
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
          <button
            type="submit"
            disabled={!name.trim() || add.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
          >
            <Plus size={12} /> {add.isPending ? "Añadiendo…" : "Añadir básico"}
          </button>
        </form>
      </section>

      <section className="px-5 mt-8">
        <div className="text-eyebrow mb-3">
          Lista · {staples?.length ?? 0}
        </div>
        {isLoading ? (
          <div className="py-10 text-center font-italic italic text-[#7A7066]">Cargando…</div>
        ) : !staples || staples.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#DDD6C5] py-10 text-center">
            <p className="font-italic italic text-[#7A7066]">Aún no tienes básicos.</p>
            <p className="mt-1 text-[12px] text-[#A39A8E]">Empieza por la leche, el pan o el café.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#DDD6C5] rounded-2xl bg-[#FFFEFA] border border-[#DDD6C5]">
            {staples.map((s) => (
              <StapleRow
                key={s.id}
                staple={s}
                onToggle={() => patch.mutate({ id: s.id, patch: { active: !s.active } })}
                onDelete={() => {
                  if (typeof window === "undefined" || window.confirm(`¿Quitar "${s.name}" de tus básicos?`)) {
                    del.mutate({ id: s.id })
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

function StapleRow({
  staple,
  onToggle,
  onDelete,
}: {
  staple: Staple
  onToggle: () => void
  onDelete: () => void
}) {
  return (
    <li className={`flex items-center gap-3 px-4 py-3 ${staple.active ? "" : "opacity-50"}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={staple.active ? "Pausar" : "Activar"}
        className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${
          staple.active ? "bg-[#1A1612]" : "bg-[#DDD6C5]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left] ${
            staple.active ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] text-[#1A1612] capitalize">{staple.name}</div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
          {staple.quantity} {staple.unit} · {AISLE_LABEL[staple.aisle]}
          {staple.pricePerUnit != null && (
            <span> · {staple.pricePerUnit.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} / {staple.unit}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label="Eliminar básico"
        className="rounded-full border border-[#DDD6C5] p-1.5 text-[#7A7066] hover:border-[#C65D38] hover:text-[#C65D38]"
      >
        <Trash2 size={12} />
      </button>
    </li>
  )
}
