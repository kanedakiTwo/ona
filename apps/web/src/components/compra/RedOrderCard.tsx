"use client"

/**
 * Tarjeta de un pedido a una tienda de la Red (specs/shop-orders.md → «Red de
 * tiendas», ona-hq D-165): el hogar lo pide por Mimoia, con el 5 % ya
 * descontado. Tramo 1a: borrador → «Pedir» (aún sin cobro) → esperando a la tienda.
 */
import { useEffect, useRef, useState } from "react"
import { useIsMutating } from "@tanstack/react-query"
import { BadgePercent } from "lucide-react"
import { SHOP_KIND_LABELS, SHOP_ORDER_STATUS_LABELS, redMaxBody, type Shop, type ShopOrder } from "@ona/shared"
import { useCancelShopOrder, usePatchShopOrder } from "@/hooks/useShopOrders"
import { usePlaceRedOrder } from "@/hooks/useRed"
import { haptic } from "@/lib/pwa/haptics"
import { DraftBlockers, DraftFulfilment, DraftLines } from "./DraftParts"
import { eur, primaryBtn } from "./styles"

const CANCELLABLE = ["draft", "ordered", "accepted"]
/** 24.5 → «24,5»; no max → empty field. */
const maxText = (n: number | null | undefined) => (n != null ? String(n).replace(".", ",") : "")

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
          {cancel.error && (
            <p role="alert" className="mb-1 text-left text-[12px] text-[#C65D38]">
              {cancel.error.message}
            </p>
          )}
          <button
            type="button"
            disabled={cancel.isPending}
            className="text-[11px] text-[#A39A8E] enabled:hover:text-[#C65D38] disabled:opacity-40"
            onClick={() => {
              if (typeof window === "undefined" || window.confirm(`¿Cancelar el pedido a ${order.shop.name}?`)) cancel.mutate({ id: order.id })
            }}
          >
            {cancel.isPending ? "Cancelando…" : "Cancelar pedido"}
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
  const [max, setMax] = useState(maxText(red.maxEur))
  // Follow the server's max (a new line changes the computed one), except while the household types.
  const typing = useRef(false)
  useEffect(() => {
    if (!typing.current) setMax(maxText(red.maxEur))
  }, [red.maxEur])
  // Any edit of this order still on its way (max, lines, delivery): «Pedir» would send a max the server is about to change.
  const editing = useIsMutating({ predicate: (m) => (m.state.variables as { id?: string } | undefined)?.id === order.id }) > 0
  const blocked = order.blockers.length > 0
  const kindLower = SHOP_KIND_LABELS[order.shop.kind].toLowerCase()

  return (
    <div className="space-y-4">
      {red.ownShopJoined && (
        <p className="rounded-xl bg-[#2D6A4F]/5 px-3 py-2 text-[12px] text-[#2D6A4F]">
          Tu {kindLower} {order.shop.name} ya está en la Red: tus pedidos irán por Mimoia con −{red.terms.discountPct} %.
        </p>
      )}

      <DraftFulfilment order={order} offer={red.delivers ? ["recoger", "domicilio"] : ["recoger"]} />

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
            onFocus={() => {
              typing.current = true
            }}
            onBlur={() => {
              typing.current = false
              // Same builder the contract test runs against patchShopOrderSchema (redFlag.test.ts).
              const body = redMaxBody(max)
              // Unchanged (or cleared when it was never raised): just show the server's max again.
              if (body.maxEur === red.maxEur || (body.maxEur == null && !red.maxRaised)) return void setMax(maxText(red.maxEur))
              // Cleared = back to the computed max, which only the PATCH's answer carries.
              patch.mutate({ id: order.id, ...body }, { onSuccess: (o) => void (!typing.current && setMax(maxText(o.red?.maxEur))) })
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

      <DraftBlockers blockers={order.blockers} title="Antes de pedirlo" />

      <div className="space-y-1">
        <button
          type="button"
          disabled={blocked || red.maxEur == null || editing || place.isPending}
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
