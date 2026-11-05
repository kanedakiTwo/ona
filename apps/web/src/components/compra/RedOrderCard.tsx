"use client"

/**
 * Tarjeta de un pedido a una tienda de la Red (specs/shop-orders.md → «Red de
 * tiendas», ona-hq D-165): el hogar lo pide por Mimoia, con el 5 % ya
 * descontado. Tramo 1a: borrador → «Pedir» (aún sin cobro) → esperando a la tienda.
 */
import { useEffect, useState } from "react"
import { BadgePercent } from "lucide-react"
import { SHOP_KIND_LABELS, SHOP_ORDER_STATUS_LABELS, redMaxBody, type Shop, type ShopOrder } from "@ona/shared"
import { useCancelShopOrder, usePatchShopOrder } from "@/hooks/useShopOrders"
import { usePlaceRedOrder } from "@/hooks/useRed"
import { haptic } from "@/lib/pwa/haptics"
import { DraftLines } from "./OrderCard"
import { eur, primaryBtn } from "./styles"

const CANCELLABLE = ["draft", "ordered", "accepted"]

export function RedOrderCard({ order, shops, highlight = false }: { order: ShopOrder; shops: Shop[]; highlight?: boolean }) {
  const red = order.red!
  const cancel = useCancelShopOrder()
  return (
    <article
      id={`pedido-${order.id}`}
      className={`rounded-2xl border bg-[#FFFEFA] ${highlight ? "border-[#2D6A4F]" : "border-[#DDD6C5]"}`}
      data-testid={`order-${order.shop.kind}`}
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#C65D38]">{SHOP_KIND_LABELS[order.shop.kind]} · de la Red</div>
          <h2 className="font-display text-[20px] leading-tight text-[#1A1612]">{order.shop.name}</h2>
          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-[#2D6A4F]/10 px-2 py-0.5 text-[11px] text-[#2D6A4F]" data-testid="red-discount">
            <BadgePercent size={12} aria-hidden /> −{red.terms.discountPct} % ya descontado
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-[#F2EDE0] px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
          {SHOP_ORDER_STATUS_LABELS[order.status]}
        </span>
      </header>

      <div className="px-4 pb-4 pt-3">
        {order.status === "draft" && <RedDraftBody order={order} shops={shops} />}
        {order.status === "ordered" && (
          <p className="text-[13px] text-[#1A1612]" data-testid="red-ordered">
            Pedido a {order.shop.name}, como mucho {eur(order.red?.maxEur)}. Te avisamos cuando lo acepte.
          </p>
        )}
        {!["draft", "ordered"].includes(order.status) && <p className="text-[12px] text-[#7A7066]">{SHOP_ORDER_STATUS_LABELS[order.status]}.</p>}
      </div>

      {CANCELLABLE.includes(order.status) && (
        <footer className="border-t border-[#EFE8D8] px-4 py-2 text-right">
          <button
            type="button"
            className="text-[11px] text-[#A39A8E] hover:text-[#C65D38]"
            onClick={() => {
              if (typeof window === "undefined" || window.confirm(`¿Cancelar el pedido a ${order.shop.name}?`)) cancel.mutate({ id: order.id })
            }}
          >
            Cancelar pedido
          </button>
        </footer>
      )}
    </article>
  )
}

function RedDraftBody({ order, shops }: { order: ShopOrder; shops: Shop[] }) {
  const red = order.red!
  const patch = usePatchShopOrder()
  const place = usePlaceRedOrder()
  const [max, setMax] = useState(red.maxEur != null ? String(red.maxEur).replace(".", ",") : "")
  const [address, setAddress] = useState(order.address ?? "")
  useEffect(() => setMax(red.maxEur != null ? String(red.maxEur).replace(".", ",") : ""), [red.maxEur])
  const blocked = order.blockers.length > 0
  const kindLower = SHOP_KIND_LABELS[order.shop.kind].toLowerCase()

  return (
    <div className="space-y-4">
      {red.ownShopJoined && (
        <p className="rounded-xl bg-[#2D6A4F]/5 px-3 py-2 text-[12px] text-[#2D6A4F]">
          Tu {kindLower} {order.shop.name} ya está en la Red: tus pedidos irán por Mimoia con −{red.terms.discountPct} %.
        </p>
      )}

      <div className="space-y-2">
        <div className="flex gap-2" role="group" aria-label="Entrega">
          {(["recoger", "domicilio"] as const)
            .filter((f) => f === "recoger" || red.delivers)
            .map((f) => (
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
        {order.fulfilment === "domicilio" && (
          <input
            aria-label="Dirección de entrega"
            value={address}
            maxLength={200}
            placeholder="Dirección de entrega (calle, número, piso, localidad)"
            onChange={(e) => setAddress(e.target.value)}
            onBlur={() => address.trim() !== (order.address ?? "") && patch.mutate({ id: order.id, address: address.trim() || null })}
            className="w-full border-b border-[#DDD6C5] bg-transparent py-1 text-[13px] text-[#1A1612] outline-none focus:border-[#1A1612]"
          />
        )}
      </div>

      <DraftLines order={order} shops={shops} />

      <div className="space-y-1 rounded-xl bg-[#F7F2E7] px-3 py-3 text-[13px] text-[#1A1612]" data-testid="red-totals">
        <p>
          Previsto: ≈{eur(red.estimateEur)}
          {red.feeEur != null && ` + envío ${eur(red.feeEur)}`}
        </p>
        <label className="flex items-center gap-2">
          Como mucho:
          <input
            inputMode="decimal"
            aria-label="Como mucho, en euros"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            onBlur={() => {
              // Same builder the contract test runs against patchShopOrderSchema (redFlag.test.ts).
              const body = redMaxBody(max)
              if (body.maxEur !== red.maxEur) patch.mutate({ id: order.id, ...body })
            }}
            placeholder="—"
            className="w-16 border-b border-[#DDD6C5] bg-transparent py-0.5 text-right text-[13px] outline-none focus:border-[#1A1612]"
          />
          €
        </label>
        <p className="text-[11px] text-[#7A7066]">
          Se cobra lo que pese de verdad, nunca más de ese máximo. Puedes subirlo si quieres margen.
        </p>
        {patch.error && <p role="alert" className="text-[11px] text-[#C65D38]">{patch.error.message}</p>}
      </div>

      {blocked && (
        <ul className="space-y-0.5 rounded-xl border border-[#C65D38]/40 px-3 py-2 text-[12px] text-[#C65D38]" data-testid="blockers">
          <li className="text-[10px] uppercase tracking-[0.12em]">Antes de pedirlo</li>
          {order.blockers.map((b) => (
            <li key={b}>· {b}</li>
          ))}
        </ul>
      )}

      <div className="space-y-1">
        <button
          type="button"
          disabled={blocked || red.maxEur == null || place.isPending}
          onClick={() => {
            haptic.light()
            place.mutate({ id: order.id, maxEur: red.maxEur! })
          }}
          className={primaryBtn}
        >
          {place.isPending ? "Pidiendo…" : `Pedir · como mucho ${eur(red.maxEur)}`}
        </button>
        <p className="text-[11px] text-[#7A7066]">En pruebas: todavía no se cobra nada.</p>
        {place.error && <p role="alert" className="text-[12px] text-[#C65D38]">{place.error.message}</p>}
      </div>
    </div>
  )
}
