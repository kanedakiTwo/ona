"use client"

/**
 * Add / edit one of the household's shops (specs/shop-orders.md). The body
 * it sends is `buildShopPayload(form)` — contract-tested against the API's
 * `shopInputSchema` (apps/api/src/tests/shopOrderSkills.test.ts).
 */
import { useState } from "react"
import {
  EMPTY_SHOP_FORM,
  SHOP_CHANNELS,
  SHOP_CHANNEL_LABELS,
  SHOP_KINDS,
  SHOP_KIND_LABELS,
  buildShopPayload,
  shopInputSchema,
  type Shop,
  type ShopChannel,
  type ShopFormState,
} from "@ona/shared"
import { useSaveShop } from "@/hooks/useShopOrders"

function formFromShop(s: Shop): ShopFormState {
  return {
    name: s.name,
    kind: s.kind,
    channel: s.channel,
    whatsapp: s.whatsapp ? `+${s.whatsapp}` : "",
    email: s.email ?? "",
    webUrl: s.webUrl ?? "",
    phone: s.phone ? `+${s.phone}` : "",
    customerName: s.customerName ?? "",
    fulfilment: s.fulfilment,
    address: s.address ?? "",
    notes: s.notes ?? "",
  }
}

const CONTACT_FIELD: Record<ShopChannel, { key: "whatsapp" | "email" | "webUrl" | "phone"; label: string; placeholder: string; type: string }> = {
  whatsapp: { key: "whatsapp", label: "WhatsApp de la tienda", placeholder: "Ej: 638 015 827", type: "tel" },
  email: { key: "email", label: "Email de la tienda", placeholder: "pedidos@tienda.es", type: "email" },
  web: { key: "webUrl", label: "Web de la tienda", placeholder: "https://www.elcorteingles.es/supermercado/", type: "url" },
  telefono: { key: "phone", label: "Teléfono de la tienda", placeholder: "Ej: 916 339 217", type: "tel" },
}

const input =
  "w-full border-b border-[#DDD6C5] bg-transparent py-1.5 text-[14px] text-[#1A1612] outline-none focus:border-[#1A1612]"
const label = "block text-[10px] uppercase tracking-[0.14em] text-[#7A7066]"

export function ShopForm({ shop, onDone }: { shop?: Shop; onDone: () => void }) {
  const save = useSaveShop()
  const [form, setForm] = useState<ShopFormState>(shop ? formFromShop(shop) : EMPTY_SHOP_FORM)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof ShopFormState>(k: K, v: ShopFormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const contact = CONTACT_FIELD[form.channel]

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const body = buildShopPayload(form)
    const parsed = shopInputSchema.safeParse(body)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Revisa los datos")
      return
    }
    setError(null)
    save.mutate({ id: shop?.id, body: parsed.data }, { onSuccess: onDone, onError: (err) => setError(err.message) })
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-4" aria-label={shop ? "Editar tienda" : "Nueva tienda"}>
      <div>
        <label className={label} htmlFor="shop-name">Nombre</label>
        <input id="shop-name" className={input} value={form.name} maxLength={80} onChange={(e) => set("name", e.target.value)} placeholder="Ej: Frutería The Fruits of the World" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label} htmlFor="shop-kind">Tipo</label>
          <select id="shop-kind" className={input} value={form.kind} onChange={(e) => set("kind", e.target.value as ShopFormState["kind"])}>
            {SHOP_KINDS.map((k) => (
              <option key={k} value={k}>{SHOP_KIND_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="shop-channel">Cómo pides</label>
          <select id="shop-channel" className={input} value={form.channel} onChange={(e) => set("channel", e.target.value as ShopChannel)}>
            {SHOP_CHANNELS.map((c) => (
              <option key={c} value={c}>{SHOP_CHANNEL_LABELS[c]}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={label} htmlFor="shop-contact">{contact.label}</label>
        <input
          id="shop-contact"
          className={input}
          type={contact.type}
          inputMode={contact.type === "tel" ? "tel" : undefined}
          value={form[contact.key]}
          onChange={(e) => set(contact.key, e.target.value)}
          placeholder={contact.placeholder}
        />
      </div>

      <div>
        <label className={label} htmlFor="shop-customer">Tu nombre para la tienda</label>
        <input id="shop-customer" className={input} value={form.customerName} maxLength={80} onChange={(e) => set("customerName", e.target.value)} placeholder="Como te conocen: Miguel, Miguel Martín…" />
      </div>

      <fieldset>
        <legend className={label}>Entrega</legend>
        <div className="mt-2 flex gap-2">
          {(["recoger", "domicilio"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={form.fulfilment === f}
              onClick={() => set("fulfilment", f)}
              className={`rounded-full border px-4 py-1.5 text-[12px] transition-colors ${form.fulfilment === f ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]" : "border-[#DDD6C5] text-[#1A1612]"}`}
            >
              {f === "recoger" ? "Recojo en tienda" : "A domicilio"}
            </button>
          ))}
        </div>
      </fieldset>

      {form.fulfilment === "domicilio" && (
        <div>
          <label className={label} htmlFor="shop-address">Dirección de entrega</label>
          <input id="shop-address" className={input} value={form.address} maxLength={200} onChange={(e) => set("address", e.target.value)} placeholder="Calle, número, piso, localidad" />
        </div>
      )}

      <div>
        <label className={label} htmlFor="shop-notes">Notas (horario, pedido mínimo…)</label>
        <input id="shop-notes" className={input} value={form.notes} maxLength={300} onChange={(e) => set("notes", e.target.value)} placeholder="Ej: pedidos antes de las 14:00 para el día siguiente" />
      </div>

      {error && <p role="alert" className="text-[12px] text-[#C65D38]">{error}</p>}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-full bg-[#1A1612] px-5 py-2.5 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
        >
          {save.isPending ? "Guardando…" : shop ? "Guardar cambios" : "Añadir tienda"}
        </button>
        <button type="button" onClick={onDone} className="text-[12px] text-[#7A7066] hover:text-[#1A1612]">
          Cancelar
        </button>
      </div>
    </form>
  )
}
