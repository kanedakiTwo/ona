"use client"

/**
 * A closed order under «Pedidos cerrados» on /compra (specs/shop-orders.md,
 * PRO-288): one row (shop · date · total) that unfolds into what was asked
 * for. Sent through the browser extension → what went into the chain's cart
 * (product and units, as the extension reported it); otherwise → the lines
 * the shop got, without the ones removed or that the shop didn't have.
 * Read only: a closed order can't be changed.
 */
import { ChevronDown } from "lucide-react"
import { capitalize, formatQty, isLiveBasketSend, prettyName, type ShopOrder, type ShopOrderLine } from "@ona/shared"
import { eur } from "./styles"

const lineName = (l: Pick<ShopOrderLine, "name">) => capitalize(prettyName(l.name))
const lineText = (l: ShopOrderLine) => l.text || `${lineName(l)} · ${formatQty(l.quantity, l.unit)}`

export interface ClosedOrderTotal {
  eur: number | null
  label: string
}

/** The best total known: what was paid, else the chain's cart, else what the shop quoted. */
export function closedOrderTotal(o: ShopOrder): ClosedOrderTotal {
  if (o.finalTotalEur != null) return { eur: o.finalTotalEur, label: "Pagado" }
  const ext = o.extensionResult
  if (isLiveBasketSend(ext) && ext!.totalEur != null) return { eur: ext!.totalEur, label: "Total del carro" }
  if (o.quoteSummary?.totalEur != null) return { eur: o.quoteSummary.totalEur, label: "Según la tienda" }
  return { eur: null, label: "Sin total" }
}

/** Name of a basket key (l3, l3.2): the basket as it was sent, else the order line. */
function basketNames(o: ShopOrder): Map<string, string> {
  const names = new Map<string, string>()
  for (const l of o.lines) names.set(l.key, lineName(l))
  for (const l of o.lines) l.members?.forEach((m, i) => names.set(`${l.key}.${i + 1}`, lineName(m)))
  for (const c of o.extensionResult?.cesta ?? []) names.set(c.key, capitalize(prettyName(c.choice && !c.name.includes(c.choice) ? `${c.name} ${c.choice}` : c.name)))
  return names
}

function ExtensionBody({ order }: { order: ShopOrder }) {
  const r = order.extensionResult!
  const names = basketNames(order)
  const nameOf = (key: string) => names.get(key) ?? names.get(key.split(".")[0]) ?? "Un producto"
  const entered = r.lineas.filter((l) => l.estado === "tabla" || l.estado === "busqueda")
  const missed = r.lineas.filter((l) => l.estado === "fallida" || l.estado === "no_verificada")
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[#7A7066]">
        Enviado con la extensión del navegador: {r.anadidas} {r.anadidas === 1 ? "producto entró" : "productos entraron"} en el carro.
      </p>
      <ul className="space-y-1" data-testid="closed-order-lines">
        {entered.map((l) => (
          <li key={l.key} className="flex justify-between gap-3">
            <span className="min-w-0">
              <span className="text-[#1A1612]">{l.producto ?? nameOf(l.key)}</span>
              {l.producto ? <span className="block text-[11px] text-[#A39A8E]">para {nameOf(l.key).toLowerCase()}</span> : null}
            </span>
            <span className="shrink-0 text-[#7A7066]">{l.unidades ? `× ${l.unidades}` : ""}</span>
          </li>
        ))}
      </ul>
      {missed.length > 0 && <p className="text-[11px] text-[#A39A8E]">No entró: {missed.map((l) => nameOf(l.key)).join(", ")}.</p>}
    </div>
  )
}

function LinesBody({ order }: { order: ShopOrder }) {
  const asked = order.lines.filter((l) => l.included !== false && l.decision !== "remove" && l.verdict !== "no_hay")
  const left = order.lines.filter((l) => l.included !== false && (l.decision === "remove" || l.verdict === "no_hay"))
  if (!asked.length) return <p className="text-[11px] text-[#7A7066]">Este pedido no tenía productos.</p>
  return (
    <div className="space-y-2">
      <ul className="space-y-1" data-testid="closed-order-lines">
        {asked.map((l) => (
          <li key={l.key} className="flex justify-between gap-3">
            <span className="min-w-0 text-[#1A1612]">
              {lineText(l)}
              {l.quote?.substitute ? <span className="block text-[11px] text-[#A39A8E]">en su lugar: {l.quote.substitute}</span> : null}
            </span>
            <span className="shrink-0 text-[#7A7066]">{l.quote?.lineTotal != null ? eur(l.quote.lineTotal) : ""}</span>
          </li>
        ))}
      </ul>
      {left.length > 0 && <p className="text-[11px] text-[#A39A8E]">Se quedó fuera: {left.map(lineName).join(", ")}.</p>}
    </div>
  )
}

export function ClosedOrder({ order }: { order: ShopOrder }) {
  const total = closedOrderTotal(order)
  const date = new Date(order.closedAt ?? order.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" })
  const viaExtension = isLiveBasketSend(order.extensionResult)
  return (
    <li data-testid="closed-order">
      <details className="group rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] text-[12px] text-[#1A1612]">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 truncate">
            {order.shop.name} · {date}
          </span>
          <span className="flex shrink-0 items-center gap-1.5 text-[#7A7066]">
            {eur(total.eur)}
            <ChevronDown size={14} aria-hidden className="transition-transform group-open:rotate-180" />
          </span>
        </summary>
        <div className="border-t border-[#EFE9DC] px-3 pb-3 pt-2">
          {viaExtension ? <ExtensionBody order={order} /> : <LinesBody order={order} />}
          <p className="mt-2 flex justify-between border-t border-[#EFE9DC] pt-2 text-[11px] text-[#7A7066]" data-testid="closed-order-total">
            <span>{total.label}</span>
            <span>{total.eur != null ? eur(total.eur) : ""}</span>
          </p>
        </div>
      </details>
    </li>
  )
}
