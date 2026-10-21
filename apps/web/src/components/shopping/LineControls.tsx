"use client"

/**
 * PRO-292 — each line of /shopping is edited where it is, without opening
 * anything: the amount with − / + (or typed), the unit as a selector with
 * the ones that make sense for that product (`unitOptions` from the API:
 * g / ml / u when the ingredient converts), «Quitar» with «Deshacer», and a
 * «Añadir a la lista» field always on top. Menu lines go through
 * `PUT …/edit` (own amount, unit, «No lo compro»), manual lines through
 * PATCH / DELETE / POST. Staples are changed in Mis básicos.
 */
import { useEffect, useRef, useState } from "react"
import { AnimatePresence, motion } from "motion/react"
import { Minus, Plus, X } from "lucide-react"
import type { BuyableUnit } from "@ona/shared"
import { ingredientDisplayName } from "@ona/shared"
import {
  useAddShoppingItem,
  useDeleteShoppingItem,
  useEditMenuLine,
  usePatchShoppingItem,
  type ShoppingItem,
} from "@/hooks/useShopping"
import { haptic } from "@/lib/pwa/haptics"

export const UNIT_LABEL: Record<string, string> = { g: "g", ml: "ml", u: "unid.", cda: "cda", cdita: "cdita" }
const MANUAL_UNITS: BuyableUnit[] = ["u", "g", "ml"]

const isMenuLine = (i: ShoppingItem) => i.kind !== "manual" && i.kind !== "staple" && !!i.ingredientId

/** 12.5 → "12,5"; whole numbers as they are. */
export function formatAmount(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString("es-ES")
}

function parseAmount(text: string): number | null {
  const n = Number(text.trim().replace(",", "."))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** What one tap of − / + moves: 1 unit, 25 / 50 / 100 g or ml as the amount grows, half a spoon. */
export function amountStep(q: number, unit: BuyableUnit): number {
  if (unit === "u") return 1
  if (unit === "g" || unit === "ml") return q < 250 ? 25 : q < 1000 ? 50 : 100
  return 0.5
}

/** One tap up or down from `q`, never under one step. */
export function stepAmount(q: number, unit: BuyableUnit, dir: 1 | -1): number {
  const step = amountStep(dir === 1 ? q : q - 1e-9, unit)
  const min = amountStep(0, unit)
  const next = dir === 1 ? Math.floor(q / step + 1e-9) * step + step : Math.ceil(q / step - 1e-9) * step - step
  return Math.max(min, Math.round(next * 100) / 100)
}

/** «2 paquetes» with a new number: «3 paquetes». */
function withLeadingNumber(text: string, n: number): string {
  const m = text.match(/^\s*\d+(?:[.,]\d+)?\s*/)
  return m ? `${formatAmount(n)} ${text.slice(m[0].length)}`.trim() : `${formatAmount(n)} ${text}`
}
function leadingNumber(text: string): number {
  const m = text.match(/^\s*(\d+(?:[.,]\d+)?)/)
  const n = m ? Number(m[1].replace(",", ".")) : NaN
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * − [amount] + [unit] of a line. Taps are gathered for a moment and sent
 * once, so «+ + +» is one write, not three.
 */
export function LineAmount({ item, listId, busy }: { item: ShoppingItem; listId: string; busy?: boolean }) {
  const editLine = useEditMenuLine()
  const patch = usePatchShoppingItem()
  const name = ingredientDisplayName(item.name)
  const menu = isMenuLine(item)
  const textual = !menu && !!item.amountText
  const serverQty = textual ? leadingNumber(item.amountText!) : item.quantity
  const [draft, setDraft] = useState(formatAmount(serverQty))
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current && !timer.current) setDraft(formatAmount(serverQty))
  }, [serverQty, item.unit])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const pending = editLine.isPending || patch.isPending
  const fail = { onError: (e: Error) => setError(e.message || "No se ha podido guardar.") , onSuccess: () => setError(null) }

  function send(q: number) {
    if (Math.abs(q - serverQty) < 1e-9) return
    if (menu) editLine.mutate({ listId, itemId: item.id, quantity: q }, fail)
    else if (textual) patch.mutate({ listId, itemId: item.id, patch: { amountText: withLeadingNumber(item.amountText!, q) } }, fail)
    else patch.mutate({ listId, itemId: item.id, patch: { quantity: q } }, fail)
  }

  function schedule(q: number) {
    setDraft(formatAmount(q))
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      send(q)
    }, 600)
  }

  function tap(dir: 1 | -1) {
    haptic.light()
    const now = parseAmount(draft) ?? serverQty
    schedule(stepAmount(now, textual ? "u" : item.unit, dir))
  }

  function commitTyped() {
    editing.current = false
    const q = parseAmount(draft)
    if (q == null) {
      setDraft(formatAmount(serverQty))
      return
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    send(q)
  }

  function changeUnit(unit: BuyableUnit) {
    if (unit === item.unit) return
    haptic.light()
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (menu) editLine.mutate({ listId, itemId: item.id, unit }, fail)
    else patch.mutate({ listId, itemId: item.id, patch: { unit, ...(item.amountText ? { amountText: null } : {}) } }, fail)
  }

  if (item.kind === "staple") {
    return (
      <span className="font-mono text-[13px] text-ink-muted tabular-nums" data-testid="line-amount">
        {formatAmount(item.quantity)} {UNIT_LABEL[item.unit] ?? item.unit}
      </span>
    )
  }

  const options = menu
    ? item.unitOptions && item.unitOptions.length > 0 ? item.unitOptions : [item.unit]
    : [...new Set<BuyableUnit>([...MANUAL_UNITS, item.unit])]
  const current = parseAmount(draft) ?? serverQty
  const atMin = current <= amountStep(0, textual ? "u" : item.unit) + 1e-9
  const btn =
    "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors before:absolute before:-inset-1.5 hover:border-ink disabled:cursor-not-allowed disabled:opacity-35"

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-1" data-testid="line-amount">
        <button type="button" className={btn} onClick={() => tap(-1)} disabled={busy || atMin} aria-label={`Menos ${name}`}>
          <Minus size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          maxLength={8}
          disabled={busy}
          onFocus={() => (editing.current = true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTyped}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur()
          }}
          aria-label={`Cantidad de ${name}`}
          className="h-8 w-[52px] rounded-lg border border-border bg-paper px-1 text-center font-mono text-[14px] text-ink tabular-nums outline-none focus:border-ink"
        />
        <button type="button" className={btn} onClick={() => tap(1)} disabled={busy} aria-label={`Más ${name}`}>
          <Plus size={14} strokeWidth={2.2} aria-hidden="true" />
        </button>
        {textual ? (
          <span className="ml-1 truncate text-[13px] text-ink-muted">{item.amountText!.replace(/^\s*\d+(?:[.,]\d+)?\s*/, "")}</span>
        ) : options.length > 1 ? (
          <select
            value={item.unit}
            disabled={busy || pending}
            onChange={(e) => changeUnit(e.target.value as BuyableUnit)}
            aria-label={`Unidad de ${name}`}
            className="ml-0.5 h-8 w-[64px] shrink-0 rounded-lg border border-border bg-paper px-1 text-[13px] text-ink outline-none focus:border-ink"
          >
            {options.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u] ?? u}
              </option>
            ))}
          </select>
        ) : (
          <span className="ml-1 text-[13px] text-ink-muted">{UNIT_LABEL[item.unit] ?? item.unit}</span>
        )}
      </div>
      {error && (
        <p className="mt-0.5 text-[12px] text-terracotta-deep" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** The × that takes a line off the list (with «Deshacer», see `useRemoveWithUndo`). */
export function RemoveLineButton({ item, onRemove, busy }: { item: ShoppingItem; onRemove: () => void; busy?: boolean }) {
  if (item.kind === "staple") return null
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={busy}
      aria-label={`Quitar ${ingredientDisplayName(item.name)}`}
      className="-mr-2 flex h-11 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-terracotta-deep disabled:opacity-40"
    >
      <X size={17} aria-hidden="true" />
    </button>
  )
}

/**
 * «Quitar» + «Deshacer». A menu line is left out of this shopping («No lo
 * compro», PRO-175) and put back; a manual line is deleted and added again
 * with the same name, amount, aisle and price.
 */
export function useRemoveWithUndo(listId: string) {
  const editLine = useEditMenuLine()
  const del = useDeleteShoppingItem()
  const add = useAddShoppingItem()
  const [last, setLast] = useState<ShoppingItem | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function remove(item: ShoppingItem) {
    haptic.light()
    if (isMenuLine(item)) editLine.mutate({ listId, itemId: item.id, skipped: true })
    else if (item.kind === "manual") del.mutate({ listId, itemId: item.id })
    else return
    setLast(item)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setLast(null), 7000)
  }

  function undo() {
    const item = last
    if (!item) return
    haptic.light()
    setLast(null)
    if (isMenuLine(item)) {
      editLine.mutate({ listId, itemId: item.id, skipped: false })
      return
    }
    const typedNoAmount = item.quantitySource === "default" && !item.amountText
    add.mutate({
      listId,
      name: item.name,
      ...(item.amountText ? { amountText: item.amountText } : typedNoAmount ? {} : { quantity: item.quantity, unit: item.unit }),
      aisle: item.aisle,
      pricePerUnit: item.pricePerUnit ?? null,
    })
  }

  const toast = (
    <AnimatePresence>
      {last && (
        <motion.div
          key={last.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.2 }}
          role="status"
          data-testid="shopping-undo"
          className="fixed inset-x-4 bottom-[calc(5.5rem+var(--safe-bottom,0px))] z-40 mx-auto flex max-w-[420px] items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-2.5 text-cream shadow-lg md:bottom-6"
        >
          <span className="min-w-0 truncate text-[14px]">Quitado: {ingredientDisplayName(last.name)}</span>
          <button
            type="button"
            onClick={undo}
            className="min-h-[40px] shrink-0 rounded-full px-3 text-[14px] font-semibold text-cream underline underline-offset-2 hover:text-cream-deep"
          >
            Deshacer
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return { remove, toast }
}

/** «Añadir a la lista», always on top of the list: a name and Enter. The aisle comes from the buy rules. */
export function AddToListField({ listId, disabled }: { listId: string; disabled?: boolean }) {
  const add = useAddShoppingItem()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    haptic.light()
    add.mutate(
      { listId, name: trimmed.slice(0, 80) },
      {
        onSuccess: () => {
          setName("")
          setError(null)
        },
        onError: () => setError("No se ha podido añadir. Prueba otra vez."),
      },
    )
  }

  return (
    <form onSubmit={submit} className="mb-4" data-testid="shopping-add-field">
      <div className="flex items-center gap-2 rounded-full border border-border bg-paper py-1 pl-4 pr-1 focus-within:border-ink">
        <Plus size={16} className="shrink-0 text-ink-muted" aria-hidden="true" />
        <input
          type="text"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Añadir a la lista: pan, café…"
          aria-label="Añadir a la lista"
          enterKeyHint="done"
          className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-light"
        />
        <button
          type="submit"
          disabled={disabled || add.isPending || !name.trim()}
          aria-label="Añadir producto"
          className="h-10 shrink-0 rounded-full bg-ink px-4 text-[14px] font-semibold text-cream transition-colors hover:bg-ink-mid disabled:opacity-40"
        >
          Añadir
        </button>
      </div>
      {error && (
        <p className="mt-1 pl-4 text-[13px] text-terracotta-deep" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
