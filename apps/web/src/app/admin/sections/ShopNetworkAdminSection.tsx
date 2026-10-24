"use client"

/**
 * ShopNetworkAdminSection — «Tiendas de Mimoia» (PRO-358,
 * specs/shop-orders.md → «Tiendas de Mimoia»): the Red of shops Mimoia
 * recommends. Alta, edición, «No acepta hogares nuevos» and baja, each one
 * in the audit log. Per shop, how many households chose it from the Red
 * (those who said «sí, ya le compraba» never count). The body it sends is
 * `buildNetworkShopPayload(form)`, contract-tested against
 * `networkShopInputSchema` (apps/api/src/tests/shopNetwork.test.ts).
 */
import { useState } from "react"
import {
  EMPTY_NETWORK_SHOP_FORM,
  NETWORK_FULFILMENTS,
  NETWORK_FULFILMENT_LABELS,
  NETWORK_SHOP_KINDS,
  NETWORK_SHOP_STATUS_LABELS,
  NETWORK_SHOP_TIERS,
  NETWORK_SHOP_TIER_LABELS,
  SHOP_CHANNELS,
  SHOP_CHANNEL_LABELS,
  SHOP_KIND_LABELS,
  buildNetworkShopPayload,
  coverageSummary,
  networkShopForm,
  networkShopInputSchema,
  parseCoverageText,
  type AdminNetworkShop,
  type NetworkShopFormState,
  type NetworkShopStatus,
  type ShopChannel,
} from "@ona/shared"
import { useAdminShopNetwork, useSaveNetworkShop } from "@/hooks/useShopNetwork"

const CONTACT: Record<ShopChannel, { key: "whatsapp" | "email" | "webUrl" | "phone"; label: string; type: string }> = {
  whatsapp: { key: "whatsapp", label: "WhatsApp de la tienda", type: "tel" },
  email: { key: "email", label: "Email de la tienda", type: "email" },
  web: { key: "webUrl", label: "Web de la tienda", type: "url" },
  telefono: { key: "phone", label: "Teléfono de la tienda", type: "tel" },
}

const input = "w-full rounded-lg border border-border-soft bg-cream px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
const label = "block text-[11px] uppercase tracking-[0.12em] text-ink-muted mb-1"

function NetworkShopForm({ shop, onDone }: { shop?: AdminNetworkShop; onDone: () => void }) {
  const save = useSaveNetworkShop()
  const [form, setForm] = useState<NetworkShopFormState>(shop ? networkShopForm(shop) : EMPTY_NETWORK_SHOP_FORM)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof NetworkShopFormState>(k: K, v: NetworkShopFormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const contact = CONTACT[form.channel]
  const coverageErrors = parseCoverageText(form.coverageText).errors

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (coverageErrors.length) return setError(`No entiendo esta línea de la cobertura: «${coverageErrors[0]}»`)
    const parsed = networkShopInputSchema.safeParse(buildNetworkShopPayload(form))
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Revisa los datos")
    setError(null)
    save.mutate({ id: shop?.id, body: parsed.data }, { onSuccess: onDone, onError: (err) => setError(err.message) })
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-border-soft bg-paper p-4" aria-label={shop ? "Editar tienda de Mimoia" : "Nueva tienda de Mimoia"}>
      <div>
        <label className={label} htmlFor="ns-name">Nombre</label>
        <input id="ns-name" className={input} value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="ns-kind">Tipo</label>
          <select id="ns-kind" className={input} value={form.kind} onChange={(e) => set("kind", e.target.value as NetworkShopFormState["kind"])}>
            {NETWORK_SHOP_KINDS.map((k) => <option key={k} value={k}>{SHOP_KIND_LABELS[k]}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ns-tier">Escalón</label>
          <select id="ns-tier" className={input} value={form.tier} onChange={(e) => set("tier", e.target.value as NetworkShopFormState["tier"])}>
            {NETWORK_SHOP_TIERS.map((t) => <option key={t} value={t}>{NETWORK_SHOP_TIER_LABELS[t]}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={label} htmlFor="ns-coverage">Cobertura (una zona por línea)</label>
        <textarea
          id="ns-coverage"
          className={`${input} min-h-[72px]`}
          value={form.coverageText}
          onChange={(e) => set("coverageText", e.target.value)}
          placeholder={"Boadilla del Monte: 28660, 28669\n28223\n286"}
        />
        <p className="mt-1 text-[11px] text-ink-muted">Códigos postales (5 cifras) o el principio de uno («28» = toda la provincia). Un municipio, con sus códigos.</p>
        <label className="mt-2 flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={form.nationwide} onChange={(e) => set("nationwide", e.target.checked)} /> Toda España (envía por paquetería)
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="ns-channel">Canal</label>
          <select id="ns-channel" className={input} value={form.channel} onChange={(e) => set("channel", e.target.value as ShopChannel)}>
            {SHOP_CHANNELS.map((c) => <option key={c} value={c}>{SHOP_CHANNEL_LABELS[c]}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="ns-contact">{contact.label}</label>
          <input id="ns-contact" type={contact.type} className={input} value={form[contact.key]} onChange={(e) => set(contact.key, e.target.value)} />
        </div>
      </div>
      <fieldset>
        <legend className={label}>Cómo entrega</legend>
        <div className="flex flex-wrap gap-3">
          {NETWORK_FULFILMENTS.map((f) => (
            <label key={f} className="flex items-center gap-1.5 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={form.fulfilment.includes(f)}
                onChange={(e) => set("fulfilment", e.target.checked ? [...form.fulfilment, f] : form.fulfilment.filter((x) => x !== f))}
              />
              {NETWORK_FULFILMENT_LABELS[f]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={label} htmlFor="ns-min">Pedido mínimo €</label>
          <input id="ns-min" inputMode="decimal" className={input} value={form.deliveryMin} onChange={(e) => set("deliveryMin", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="ns-fee">Gastos de envío €</label>
          <input id="ns-fee" inputMode="decimal" className={input} value={form.deliveryFee} onChange={(e) => set("deliveryFee", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="ns-free">Envío gratis desde €</label>
          <input id="ns-free" inputMode="decimal" className={input} value={form.freeDeliveryFrom} onChange={(e) => set("freeDeliveryFrom", e.target.value)} />
        </div>
      </div>
      <div>
        <label className={label} htmlFor="ns-notes">Notas para el hogar (horario y lo demás)</label>
        <textarea id="ns-notes" className={`${input} min-h-[56px]`} maxLength={300} value={form.notes} onChange={(e) => set("notes", e.target.value)} />
      </div>
      {error ? <p role="alert" className="text-[12px] text-terracotta-deep">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] text-cream disabled:opacity-50">
          {save.isPending ? "Guardando…" : shop ? "Guardar cambios" : "Dar de alta"}
        </button>
        <button type="button" onClick={onDone} className="min-h-[44px] px-4 text-[13px] text-ink-muted">Cancelar</button>
      </div>
    </form>
  )
}

function StatusButtons({ shop }: { shop: AdminNetworkShop }) {
  const save = useSaveNetworkShop()
  const to = (status: NetworkShopStatus) => save.mutate({ id: shop.id, body: { status } })
  const btn = "min-h-[36px] rounded-full border border-border-soft px-3 text-[12px] text-ink hover:border-ink disabled:opacity-50"
  return (
    <div className="flex flex-wrap gap-1.5">
      {shop.status === "activa" ? (
        <button className={btn} disabled={save.isPending} onClick={() => to("sin_nuevos")}>No acepta hogares nuevos</button>
      ) : (
        <button className={btn} disabled={save.isPending} onClick={() => to("activa")}>Volver a activar</button>
      )}
      {shop.status !== "baja" ? (
        <button
          className={btn}
          disabled={save.isPending}
          onClick={() => {
            if (typeof window === "undefined" || window.confirm(`¿Dar de baja ${shop.name}? Los hogares que ya la tienen la conservan como tienda suya.`)) to("baja")
          }}
        >
          Dar de baja
        </button>
      ) : null}
    </div>
  )
}

export function ShopNetworkAdminSection() {
  const q = useAdminShopNetwork()
  const [editing, setEditing] = useState<AdminNetworkShop | "new" | null>(null)
  return (
    <section data-testid="shop-network-admin" className="space-y-4">
      <p className="max-w-md text-[13px] text-ink-muted">
        Las tiendas que recomienda Mimoia. Cada hogar ve las que llegan a su código postal, en el orden de su ficha (presupuesto, preferencias,
        cercanía), nunca por lo que pagan. «Hogares» cuenta solo a quien no les compraba antes.
      </p>
      {editing === "new" ? (
        <NetworkShopForm onDone={() => setEditing(null)} />
      ) : (
        <button onClick={() => setEditing("new")} className="min-h-[44px] rounded-full bg-ink px-5 text-[13px] text-cream">
          Nueva tienda
        </button>
      )}
      {q.isLoading && <p className="text-eyebrow">Cargando…</p>}
      {q.data?.length === 0 && <p className="text-[14px] text-ink-muted">Aún no hay ninguna tienda en la Red.</p>}
      <ul className="space-y-2">
        {(q.data ?? []).map((s) =>
          editing !== "new" && editing?.id === s.id ? (
            <li key={s.id}>
              <NetworkShopForm shop={s} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={s.id} data-testid="admin-network-shop" className="rounded-2xl border border-border-soft bg-paper p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-terracotta-deep">
                    {SHOP_KIND_LABELS[s.kind]} · {NETWORK_SHOP_TIER_LABELS[s.tier]} · {NETWORK_SHOP_STATUS_LABELS[s.status]}
                  </p>
                  <p className="text-[15px] font-medium text-ink">{s.name}</p>
                  <p className="mt-1 text-[12px] text-ink-muted">{coverageSummary(s.coverage)}</p>
                  <p className="text-[12px] text-ink-muted">{s.fulfilment.map((f) => NETWORK_FULFILMENT_LABELS[f]).join(" · ")}</p>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[20px] font-semibold leading-none text-ink" data-testid="network-shop-households">{s.households}</div>
                  <div className="text-[11px] text-ink-muted">{s.households === 1 ? "hogar" : "hogares"}</div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <button onClick={() => setEditing(s)} className="min-h-[36px] rounded-full border border-border-soft px-3 text-[12px] text-ink hover:border-ink">Editar</button>
                <StatusButtons shop={s} />
              </div>
            </li>
          ),
        )}
      </ul>
    </section>
  )
}
