"use client"

/**
 * /profile/staples — household recurring staples manager (PR 10B).
 *
 * Items here auto-pre-pend to every freshly generated shopping list (and to
 * regenerated lists). Toggle `active` to skip one without losing the row.
 * Any household member can add / edit / delete.
 *
 * Skin: "D · Luz y foto" (PRO-40). The pause switch stays inline in each
 * row; "Quitar de tus básicos" lives in the row's "···" sheet. At lg+ the
 * add form is a left column and the list fills the rest.
 */
import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import type { Aisle, BuyableUnit } from "@ona/shared"
import { AISLES, ingredientDisplayName } from "@ona/shared"
import {
  useStaples,
  useAddStaple,
  usePatchStaple,
  useDeleteStaple,
  type Staple,
} from "@/hooks/useStaples"
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

const AISLE_LABEL: Record<Aisle, string> = {
  produce: "Frutería",
  proteinas: "Proteínas",
  lacteos: "Lácteos",
  panaderia: "Panadería",
  despensa: "Despensa",
  congelados: "Congelados",
  otros: "Otros",
}

const FIELD_LABEL = "mb-1 block text-[12px] font-medium text-ink-muted"

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
    <SubPage
      eyebrow="Lo de siempre"
      title={
        <>
          <Accent>Tus</Accent> básicos.
        </>
      }
      intro="Los items que necesitas todas las semanas (pan, café, leche…). Se añaden automáticamente a cada lista de la compra nueva. Pausa lo que no quieras esta semana sin perder la fila."
    >
      <div className="grid gap-8 lg:grid-cols-[360px_1fr] lg:items-start lg:gap-10">
        <section className="lg:sticky lg:top-6">
          <form onSubmit={handleAdd} className={`${SUB_CARD} space-y-3 p-4`}>
            <h2 className={SUB_EYEBROW}>Nuevo básico</h2>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Leche, Pan, Café…"
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
              <label>
                <span className={FIELD_LABEL}>Pasillo</span>
                <select
                  value={aisle}
                  onChange={(e) => setAisle(e.target.value as Aisle)}
                  className={SUB_INPUT}
                >
                  {AISLES.map((a) => (
                    <option key={a} value={a}>
                      {AISLE_LABEL[a]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className={FIELD_LABEL}>Precio € (opcional)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.05}
                  placeholder="precio por unidad (opcional)"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={SUB_INPUT}
                />
              </label>
            </div>
            <button type="submit" disabled={!name.trim() || add.isPending} className={`${PILL_INK} w-full`}>
              <Plus size={16} /> {add.isPending ? "Añadiendo…" : "Añadir básico"}
            </button>
          </form>
        </section>

        <section>
          <h2 className={`${SUB_EYEBROW} mb-3`}>Lista · {staples?.length ?? 0}</h2>
          {isLoading ? (
            <SubNotice>
              <p className="font-serif-text text-[18px] italic text-ink-mid">Cargando…</p>
            </SubNotice>
          ) : !staples || staples.length === 0 ? (
            <SubNotice dashed>
              <p className="font-serif-text text-[18px] italic text-ink-mid">Aún no tienes básicos.</p>
              <p className="mt-1 text-[14px] text-ink-soft">Empieza por la leche, el pan o el café.</p>
            </SubNotice>
          ) : (
            <ul className={SUB_LIST}>
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
    </SubPage>
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
  const [sheetOpen, setSheetOpen] = useState(false)
  const displayName = ingredientDisplayName(staple.name)
  return (
    <li className="flex min-h-[64px] items-center gap-2 py-2 pl-2 pr-2">
      <button
        type="button"
        onClick={onToggle}
        aria-label={staple.active ? "Pausar" : "Activar"}
        aria-pressed={staple.active}
        className="flex h-11 w-12 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ink"
      >
        <span
          aria-hidden="true"
          className={`relative inline-block h-6 w-10 rounded-full transition-colors ${
            staple.active ? "bg-ink" : "bg-border"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow transition-[left] ${
              staple.active ? "left-[18px]" : "left-0.5"
            }`}
          />
        </span>
      </button>
      <div className={`min-w-0 flex-1 ${staple.active ? "" : "opacity-50"}`}>
        <div className="truncate text-[15px] text-ink">{displayName}</div>
        <div className="text-[12px] text-ink-muted">
          <span className="font-mono tabular-nums">
            {staple.quantity} {staple.unit}
          </span>{" "}
          · {AISLE_LABEL[staple.aisle]}
          {staple.pricePerUnit != null && (
            <span>
              {" "}
              · {staple.pricePerUnit.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} / {staple.unit}
            </span>
          )}
        </div>
      </div>
      <MoreButton label={`Opciones de ${displayName}`} onClick={() => setSheetOpen(true)} />

      <MenuSheet open={sheetOpen} onClose={() => setSheetOpen(false)} eyebrow="Tus básicos" title={displayName}>
        <SheetAction
          icon={Trash2}
          label="Quitar de tus básicos"
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
