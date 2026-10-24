"use client"

/**
 * «Tiendas de Mimoia» on /compra/tiendas (PRO-358, specs/shop-orders.md →
 * «Tiendas de Mimoia»): the shops of the Red that cover the household, by
 * kind, in the order the API gives (the ficha's: presupuesto, preferencias,
 * cercanía; never payment). The first time, it asks «¿En qué código postal
 * vivís?» (saved in the ficha). Choosing a shop asks «¿Ya le comprabas?»
 * with one tap; «Cómo funciona» is always in view.
 */
import { useState } from "react"
import { Info, MapPin } from "lucide-react"
import {
  NETWORK_FULFILMENT_LABELS,
  NETWORK_SHOP_KINDS,
  NETWORK_SHOP_TIER_LABELS,
  SHOP_KIND_LABELS,
  SHOP_NETWORK_NOTICE,
  isPostalCode,
  type HouseholdNetworkShop,
} from "@ona/shared"
import { useAdoptNetworkShop, useSetPostalCode, useShopNetwork } from "@/hooks/useShopNetwork"

const KIND_TITLES: Record<(typeof NETWORK_SHOP_KINDS)[number], string> = {
  fruteria: "Fruterías",
  carniceria: "Carnicerías",
  pescaderia: "Pescaderías",
  otra: "Otras tiendas",
}

function euros(n: number): string {
  return `${String(Math.round(n * 100) / 100).replace(".", ",")} €`
}

function amounts(s: HouseholdNetworkShop): string {
  return [
    s.deliveryMinEur != null ? `Pedido mínimo ${euros(s.deliveryMinEur)}` : "",
    s.deliveryFeeEur != null ? `envío ${euros(s.deliveryFeeEur)}` : "",
    s.freeDeliveryFromEur != null ? `gratis desde ${euros(s.freeDeliveryFromEur)}` : "",
  ]
    .filter(Boolean)
    .join(" · ")
}

function PostalCodeForm({ initial, onDone }: { initial?: string; onDone?: () => void }) {
  const save = useSetPostalCode()
  const [code, setCode] = useState(initial ?? "")
  const [error, setError] = useState<string | null>(null)
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const c = code.trim()
    if (!isPostalCode(c)) return setError("Escribe un código postal de 5 cifras")
    setError(null)
    save.mutate({ postalCode: c }, { onSuccess: () => onDone?.(), onError: (err) => setError(err.message) })
  }
  return (
    <form onSubmit={submit} className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-4" aria-label="Código postal">
      <label htmlFor="network-postal-code" className="font-display text-[18px] leading-tight text-[#1A1612]">
        ¿En qué código postal vivís?
      </label>
      <p className="mt-1 text-[12px] text-[#7A7066]">Para enseñarte las tiendas que llegan a tu casa. Se guarda en la ficha del hogar.</p>
      <div className="mt-3 flex items-end gap-2">
        <input
          id="network-postal-code"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="Ej: 28001"
          className="w-28 border-b border-[#DDD6C5] bg-transparent py-1.5 text-[16px] text-[#1A1612] outline-none focus:border-[#1A1612]"
        />
        <button type="submit" disabled={save.isPending} className="min-h-[44px] rounded-full bg-[#1A1612] px-5 text-[13px] text-[#FAF6EE] disabled:opacity-50">
          {save.isPending ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {error ? <p role="alert" className="mt-2 text-[12px] text-[#C65D38]">{error}</p> : null}
    </form>
  )
}

function NetworkShopCard({ shop, canEdit }: { shop: HouseholdNetworkShop; canEdit: boolean }) {
  const adopt = useAdoptNetworkShop()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const choose = (alreadyCustomer: boolean) =>
    adopt.mutate({ id: shop.id, alreadyCustomer }, { onError: (err) => setError(err.message) })
  const money = amounts(shop)
  return (
    <li data-testid="network-shop" className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#C65D38]">
            {SHOP_KIND_LABELS[shop.kind]} <span className="ml-1 normal-case tracking-normal text-[#7A7066]">· {NETWORK_SHOP_TIER_LABELS[shop.tier]}</span>
          </div>
          <div className="font-display text-[18px] leading-tight text-[#1A1612]">{shop.name}</div>
          <div className="mt-1 text-[12px] text-[#7A7066]">{shop.fulfilment.map((f) => NETWORK_FULFILMENT_LABELS[f]).join(" · ")}</div>
          {money ? <div className="mt-0.5 text-[11px] text-[#A39A8E]">{money}</div> : null}
          {shop.notes ? <div className="mt-0.5 text-[11px] text-[#A39A8E]">{shop.notes}</div> : null}
        </div>
        {canEdit && !asking ? (
          <button
            onClick={() => setAsking(true)}
            aria-label={`Elegir ${shop.name}`}
            className="min-h-[44px] shrink-0 rounded-full border border-[#1A1612] px-4 text-[13px] text-[#1A1612] hover:bg-[#1A1612] hover:text-[#FAF6EE]"
          >
            Elegir
          </button>
        ) : null}
      </div>
      {asking ? (
        <div className="mt-3 border-t border-[#EFE8D8] pt-3" role="group" aria-label="¿Ya le comprabas?">
          <p className="text-[14px] text-[#1A1612]">¿Ya le comprabas?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button disabled={adopt.isPending} onClick={() => choose(true)} className="min-h-[44px] rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-4 text-[13px] text-[#1A1612] disabled:opacity-50">
              Sí, ya le compraba
            </button>
            <button disabled={adopt.isPending} onClick={() => choose(false)} className="min-h-[44px] rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-4 text-[13px] text-[#1A1612] disabled:opacity-50">
              No, es nueva
            </button>
            <button disabled={adopt.isPending} onClick={() => setAsking(false)} className="min-h-[44px] px-3 text-[13px] text-[#7A7066]">
              Cancelar
            </button>
          </div>
          {error ? <p role="alert" className="mt-2 text-[12px] text-[#C65D38]">{error}</p> : null}
        </div>
      ) : null}
    </li>
  )
}

export function ShopNetworkSection() {
  const { data, isLoading } = useShopNetwork()
  const [editingCode, setEditingCode] = useState(false)
  if (isLoading || !data) return null
  const byKind = NETWORK_SHOP_KINDS.map((k) => ({ kind: k, shops: data.shops.filter((s) => s.kind === k) })).filter((g) => g.shops.length)

  return (
    // A region, not a <section>: the household's own shops are the page's `section li` (compra-orden-tiendas.spec.ts).
    <div role="region" className="mt-10 px-5 space-y-4" aria-labelledby="network-title" data-testid="shop-network">
      <div>
        <div className="text-eyebrow">Para lo que te falte</div>
        <h2 id="network-title" className="mt-1 font-display text-[1.6rem] leading-[1] text-[#1A1612]">
          Tiendas de <span className="italic text-[#C65D38]">Mimoia</span>
        </h2>
      </div>

      <aside className="flex gap-2 rounded-2xl bg-[#F2EDE0] px-4 py-3" aria-label="Cómo funciona">
        <Info size={14} className="mt-0.5 shrink-0 text-[#7A7066]" aria-hidden />
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#7A7066]">Cómo funciona</div>
          <p className="mt-0.5 text-[12px] text-[#1A1612]">{SHOP_NETWORK_NOTICE}</p>
        </div>
      </aside>

      {data.postalCode === null || editingCode ? (
        data.canEdit ? <PostalCodeForm initial={data.postalCode ?? undefined} onDone={() => setEditingCode(false)} /> : null
      ) : (
        <div className="flex items-center gap-1.5 text-[12px] text-[#7A7066]">
          <MapPin size={12} aria-hidden /> Para el {data.postalCode}
          {data.canEdit ? (
            <button onClick={() => setEditingCode(true)} className="ml-1 underline hover:text-[#C65D38]">
              Cambiar
            </button>
          ) : null}
        </div>
      )}

      {byKind.length === 0 ? (
        <p className="text-[13px] italic text-[#7A7066]">
          {data.postalCode ? "Aún no hay tiendas de Mimoia que lleguen a tu zona." : "Dinos tu código postal para ver las que llegan a tu casa."}
        </p>
      ) : (
        byKind.map((g) => (
          <div key={g.kind}>
            <h3 className="mb-2 text-[11px] uppercase tracking-[0.14em] text-[#7A7066]">{KIND_TITLES[g.kind]}</h3>
            <ul className="space-y-3">
              {g.shops.map((s) => (
                <NetworkShopCard key={s.id} shop={s} canEdit={data.canEdit} />
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  )
}
