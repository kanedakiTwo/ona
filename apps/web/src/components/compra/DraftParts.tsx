"use client"

/**
 * Las piezas del borrador que comparten la tarjeta de siempre (OrderCard) y la
 * de la Red (RedOrderCard), specs/shop-orders.md: la entrega (recoger o a
 * domicilio, con la dirección), las líneas con «¿Algo más?» y lo que falta
 * antes de enviarlo o de pedirlo.
 */
import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowRightLeft, ExternalLink, Plus, X } from "lucide-react"
import { capitalize, formatQty, prettyName, type ShopFulfilment, type Shop, type ShopOrder, type ShopOrderLine } from "@ona/shared"
import { usePatchShopOrder } from "@/hooks/useShopOrders"
import { ghostBtn } from "./styles"

export const lineName = (l: ShopOrderLine) => capitalize(prettyName(l.name))

/** "1 kg de manzanas" / "6 huevos" / "perejil" → what PATCH { add } takes. */
export function parseAddText(raw: string): { name: string; quantity?: number; unit?: "g" | "ml" | "u" } | null {
  const t = raw.trim()
  if (!t) return null
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*(kg|kilos?|g|gr|gramos?|l|litros?|ml|uds?|unidades?)?\s*(?:de\s+)?(.+)$/i)
  if (!m) return { name: t.slice(0, 80) }
  const n = Number(m[1].replace(",", "."))
  const u = (m[2] ?? "").toLowerCase()
  const name = m[3].trim().slice(0, 80)
  if (/^(kg|kilo)/.test(u)) return { name, quantity: n * 1000, unit: "g" }
  if (/^(g|gr|gramo)/.test(u)) return { name, quantity: n, unit: "g" }
  if (/^(l|litro)/.test(u)) return { name, quantity: n * 1000, unit: "ml" }
  if (u === "ml") return { name, quantity: n, unit: "ml" }
  return { name, quantity: n, unit: "u" }
}

const BOTH_FULFILMENTS: readonly ShopFulfilment[] = ["recoger", "domicilio"]

/**
 * Recoger o a domicilio, con la dirección. `offer` es lo que se puede elegir
 * (la Red solo ofrece «a domicilio» si la tienda llega a tu código postal); con
 * una sola opción, un texto en vez de un botón suelto. `children` va debajo
 * (el mínimo a domicilio de la tarjeta de siempre).
 */
export function DraftFulfilment({ order, offer = BOTH_FULFILMENTS, children }: { order: ShopOrder; offer?: readonly ShopFulfilment[]; children?: ReactNode }) {
  const patch = usePatchShopOrder()
  const [address, setAddress] = useState(order.address ?? "")
  // The server fills in the household's address on «A domicilio»: follow it, except while typing.
  const typing = useRef(false)
  useEffect(() => {
    if (!typing.current) setAddress(order.address ?? "")
  }, [order.address])
  const only = offer.length === 1 && order.fulfilment === offer[0] ? offer[0] : null

  return (
    <div className="space-y-2">
      {only ? (
        <p className="text-[12px] text-[#7A7066]">{only === "recoger" ? "Recoges en la tienda" : "A domicilio"}</p>
      ) : (
        <div className="flex gap-2" role="group" aria-label="Entrega">
          {offer.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={order.fulfilment === f}
              onClick={() => order.fulfilment !== f && patch.mutate({ id: order.id, fulfilment: f })}
              className={`rounded-full border px-3 py-1 text-[12px] ${order.fulfilment === f ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]" : "border-[#DDD6C5] text-[#1A1612]"}`}
            >
              {f === "recoger" ? "Recojo en tienda" : "A domicilio"}
            </button>
          ))}
        </div>
      )}
      {order.fulfilment === "domicilio" && (
        <input
          aria-label="Dirección de entrega"
          value={address}
          maxLength={200}
          placeholder="Dirección de entrega (calle, número, piso, localidad)"
          onChange={(e) => setAddress(e.target.value)}
          onFocus={() => {
            typing.current = true
          }}
          onBlur={() => {
            typing.current = false
            if (address.trim() !== (order.address ?? "")) patch.mutate({ id: order.id, address: address.trim() || null })
          }}
          className="w-full border-b border-[#DDD6C5] bg-transparent py-1 text-[13px] text-[#1A1612] outline-none focus:border-[#1A1612]"
        />
      )}
      {patch.error && <p role="alert" className="text-[11px] text-[#C65D38]">{patch.error.message}</p>}
      {children}
    </div>
  )
}

/** Las líneas del borrador y «¿Algo más?»: las mismas en la tarjeta de siempre y en la de la Red. */
export function DraftLines({ order, shops }: { order: ShopOrder; shops: Shop[] }) {
  const patch = usePatchShopOrder()
  const [extra, setExtra] = useState("")
  const others = shops.filter((s) => s.id !== order.shopId)
  const wantsNotes = order.shop.kind === "carniceria" || order.shop.kind === "pescaderia"

  return (
    <>
      <ul className="divide-y divide-[#EFE8D8]">
        {order.lines.map((l) => (
          <li key={l.key} className={`py-2 ${l.included === false ? "opacity-60" : ""}`} data-testid={`line-${l.key}`}>
            <div className="flex items-center gap-2">
              {l.maybeHave && (
                <input
                  type="checkbox"
                  aria-label={`Incluir ${lineName(l)}`}
                  checked={l.included !== false}
                  onChange={(e) => patch.mutate({ id: order.id, lines: [{ key: l.key, include: e.target.checked }] })}
                />
              )}
              <span className="min-w-0 flex-1 text-[14px] text-[#1A1612]">
                {l.text ?? `${lineName(l)} · ${formatQty(l.quantity, l.unit)}`}
                {l.volatile && <span className="ml-1 text-[10px] uppercase tracking-[0.1em] text-[#C65D38]">lonja</span>}
                {l.maybeHave && <span className="block text-[11px] text-[#7A7066]">probablemente lo tienes</span>}
              </span>
              {order.searchLinks[l.key] && (
                <a href={order.searchLinks[l.key]} target="_blank" rel="noopener noreferrer" className={ghostBtn} aria-label={`Buscar ${lineName(l)} en ${order.shop.name}`}>
                  Buscar <ExternalLink size={11} />
                </a>
              )}
              {others.length > 0 && (
                <span className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[#A39A8E] hover:text-[#1A1612]">
                  <ArrowRightLeft size={13} aria-hidden />
                  <select
                    aria-label={`Mover ${lineName(l)} a otra tienda`}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    value=""
                    onChange={(e) => e.target.value && patch.mutate({ id: order.id, lines: [{ key: l.key, moveToShopId: e.target.value }] })}
                  >
                    <option value="">Mover a…</option>
                    {others.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </span>
              )}
              <button
                type="button"
                aria-label={`Quitar ${lineName(l)}`}
                onClick={() => patch.mutate({ id: order.id, lines: [{ key: l.key, remove: true }] })}
                className="rounded-full p-1 text-[#A39A8E] hover:text-[#C65D38]"
              >
                <X size={14} />
              </button>
            </div>
            {l.options && l.options.length > 1 && (
              <div className="mt-1 flex flex-wrap gap-1.5" role="group" aria-label={l.needsChoice?.question ?? `Opciones de ${lineName(l)}`}>
                {l.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={l.choice === o}
                    onClick={() => l.choice !== o && patch.mutate({ id: order.id, lines: [{ key: l.key, choice: o }] })}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] ${l.choice === o ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]" : l.needsChoice ? "border-[#C65D38] text-[#C65D38]" : "border-[#DDD6C5] text-[#1A1612]"}`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}
            {l.needsQuantity && <QuantityAsk order={order} line={l} />}
            {wantsNotes && !l.needsQuantity && (
              <input
                aria-label={`Nota para ${lineName(l)}`}
                defaultValue={l.note ?? ""}
                maxLength={120}
                placeholder={order.shop.kind === "pescaderia" ? "Preparación: en lomos, sin espinas…" : "Preparación: picada, en filetes finos…"}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v !== (l.note ?? "")) patch.mutate({ id: order.id, lines: [{ key: l.key, note: v || null }] })
                }}
                className="mt-1 w-full border-b border-dashed border-[#DDD6C5] bg-transparent py-0.5 text-[12px] text-[#1A1612] outline-none placeholder:text-[#A39A8E] focus:border-[#1A1612]"
              />
            )}
          </li>
        ))}
      </ul>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const item = parseAddText(extra)
          if (item) patch.mutate({ id: order.id, add: [item] }, { onSuccess: () => setExtra("") })
        }}
      >
        <input
          aria-label={`Añadir algo más a ${order.shop.name}`}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          maxLength={80}
          placeholder="¿Algo más? Ej: 1 kg de manzanas"
          className="min-w-0 flex-1 border-b border-[#DDD6C5] bg-transparent py-1 text-[13px] text-[#1A1612] outline-none placeholder:text-[#A39A8E] focus:border-[#1A1612]"
        />
        <button type="submit" disabled={!extra.trim() || patch.isPending} className={ghostBtn}>
          <Plus size={12} /> Añadir
        </button>
      </form>
    </>
  )
}

/** Lo que falta antes de enviarlo (tus tiendas) o de pedirlo (la Red). */
export function DraftBlockers({ blockers, title }: { blockers: string[]; title: string }) {
  if (blockers.length === 0) return null
  return (
    <ul className="space-y-0.5 rounded-xl border border-[#C65D38]/40 px-3 py-2 text-[12px] text-[#C65D38]" data-testid="blockers">
      <li className="text-[10px] uppercase tracking-[0.12em]">{title}</li>
      {blockers.map((b) => (
        <li key={b}>· {b}</li>
      ))}
    </ul>
  )
}


function QuantityAsk({ order, line }: { order: ShopOrder; line: ShopOrderLine }) {
  const patch = usePatchShopOrder()
  const [g, setG] = useState("")
  const ask = line.needsQuantity!
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[#C65D38]">
      ¿Cuánto?
      <button type="button" className="rounded-full border border-[#C65D38] px-2.5 py-0.5" onClick={() => patch.mutate({ id: order.id, lines: [{ key: line.key, quantity: ask.grams, unit: "g" }] })}>
        {ask.suggestion}
      </button>
      <input
        aria-label={`Gramos de ${lineName(line)}`}
        inputMode="numeric"
        value={g}
        onChange={(e) => setG(e.target.value)}
        onBlur={() => {
          const n = Number(g.replace(",", "."))
          if (n > 0) patch.mutate({ id: order.id, lines: [{ key: line.key, quantity: n, unit: "g" }] })
        }}
        placeholder="otra (g)"
        className="w-20 border-b border-[#DDD6C5] bg-transparent py-0.5 text-[12px] text-[#1A1612] outline-none focus:border-[#1A1612]"
      />
    </div>
  )
}
