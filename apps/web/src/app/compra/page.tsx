"use client"

/**
 * /compra — "Compra en mis tiendas" (specs/shop-orders.md).
 *
 * ONA splits what's left on the shopping list for the next 7 days into one
 * order per shop (frutería, carnicería, pescadería, súper). The user sends
 * each one from their own WhatsApp / email, pastes the shop's reply, ONA
 * checks it against the estimate and the cap, the user approves, and pays
 * the shop directly. ONA never messages a shop nor handles money.
 */
import { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ChevronLeft, RefreshCw, Store } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { usePrepareShopOrders, useShopOrders, useShops, type PrepareResult } from "@/hooks/useShopOrders"
import { OrderCard } from "@/components/compra/OrderCard"
import { haptic } from "@/lib/pwa/haptics"

/** Same order as a walk through the neighbourhood: fresh first, súper last. */
const KIND_ORDER = ["fruteria", "carniceria", "pescaderia", "supermercado", "otra"]

function ExpiredLinkBanner() {
  const params = useSearchParams()
  if (params.get("enlace") !== "caducado") return null
  return (
    <div className="mx-5 mb-4 rounded-xl bg-[#C65D38]/10 px-3 py-2 text-[12px] text-[#C65D38]">
      Ese enlace ya no vale (el pedido se cerró o se canceló). Prepara los pedidos de nuevo.
    </div>
  )
}

export default function CompraPage() {
  const { user, isLoading: authLoading } = useAuth()
  const { data: shops } = useShops()
  const { data: orders, isLoading } = useShopOrders(true)
  const prepare = usePrepareShopOrders()
  const [result, setResult] = useState<PrepareResult | null>(null)

  if (authLoading) return <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE] text-eyebrow">Cargando...</div>
  if (!user) return null

  const open = (orders ?? []).filter((o) => o.status !== "closed").sort((a, b) => KIND_ORDER.indexOf(a.shop.kind) - KIND_ORDER.indexOf(b.shop.kind))
  const closed = (orders ?? []).filter((o) => o.status === "closed")
  const hasDrafts = open.some((o) => o.status === "draft")
  const noShops = shops !== undefined && shops.length === 0

  return (
    <div className="bg-[#FAF6EE] min-h-screen pb-24 lg:mx-auto lg:max-w-[900px]">
      <header className="px-5 pt-8 pb-5">
        <div className="flex items-baseline justify-between">
          <Link href="/shopping" className="inline-flex items-center gap-1 text-eyebrow text-[#7A7066] hover:text-[#C65D38]">
            <ChevronLeft size={14} /> Lista
          </Link>
          <Link href="/compra/tiendas" className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[#7A7066] hover:text-[#1A1612]">
            <Store size={12} /> Tus tiendas{shops?.length ? ` (${shops.length})` : ""}
          </Link>
        </div>
        <h1 className="mt-3 font-display text-[2.4rem] leading-[0.95] text-[#1A1612]">
          Pide a tus <span className="font-italic italic text-[#C65D38]">tiendas</span>.
        </h1>
        <p className="mt-3 max-w-md text-[12px] text-[#7A7066]">
          ONA prepara un pedido por tienda con lo que te falta para los próximos 7 días. Tú lo envías desde tu WhatsApp,
          la tienda te dice qué hay y cuánto cuesta, lo apruebas y pagas en la tienda.
        </p>
      </header>

      <Suspense>
        <ExpiredLinkBanner />
      </Suspense>

      {noShops ? (
        <section className="px-5">
          <div className="rounded-2xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] px-6 py-10 text-center">
            <p className="font-display text-xl text-[#1A1612]">
              Primero, <span className="font-italic italic">tus tiendas</span>.
            </p>
            <p className="mx-auto mt-2 max-w-xs text-[13px] text-[#7A7066]">Tu frutería, tu carnicería, tu pescadería y tu súper, con su WhatsApp o su web.</p>
            <Link href="/compra/tiendas" className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[13px] font-medium text-[#FAF6EE]">
              <Store size={14} /> Añadir tiendas
            </Link>
          </div>
        </section>
      ) : (
        <section className="px-5 space-y-4">
          <button
            type="button"
            disabled={prepare.isPending || !shops}
            onClick={() => {
              haptic.light()
              prepare.mutate({}, { onSuccess: setResult })
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1A1612] py-4 text-[13px] uppercase tracking-[0.14em] text-[#FAF6EE] disabled:opacity-50"
          >
            <RefreshCw size={14} className={prepare.isPending ? "animate-spin" : ""} />
            {prepare.isPending ? "Preparando…" : hasDrafts ? "Rehacer los pedidos" : "Preparar los pedidos"}
          </button>
          {prepare.error && <p role="alert" className="text-[12px] text-[#C65D38]">{prepare.error.message}</p>}

          {result && (result.skipped.length > 0 || result.unassigned.length > 0 || result.orders.length === 0) && (
            <div className="rounded-xl bg-[#F7F2E7] px-3 py-2 text-[12px] text-[#7A7066]">
              {result.orders.length === 0 && <p>No queda nada pendiente en la lista para estos días.</p>}
              {result.skipped.length > 0 && (
                <p>No incluido (lo das por tenido o ya está pedido): {result.skipped.map((s) => s.name).join(", ")}.</p>
              )}
              {result.unassigned.length > 0 && (
                <p className="text-[#C65D38]">Sin tienda donde pedirlo: {result.unassigned.map((u) => u.name).join(", ")}. Añade un súper en tus tiendas.</p>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="py-10 text-center font-italic italic text-[#7A7066]">Cargando…</div>
          ) : (
            open.map((o) => <OrderCard key={o.id} order={o} shops={shops ?? []} />)
          )}

          {closed.length > 0 && (
            <details className="pt-4">
              <summary className="cursor-pointer text-eyebrow text-[#7A7066]">Pedidos cerrados · {closed.length}</summary>
              <ul className="mt-3 space-y-2">
                {closed.map((o) => (
                  <li key={o.id} className="flex justify-between rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-2 text-[12px] text-[#1A1612]">
                    <span>{o.shop.name} · {new Date(o.closedAt ?? o.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>
                    <span className="text-[#7A7066]">{o.finalTotalEur != null ? `${String(o.finalTotalEur).replace(".", ",")} €` : "—"}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
    </div>
  )
}
