"use client"

/**
 * One shop order on /compra (specs/shop-orders.md), by status:
 *   draft    → review lines, notes, cap → send from the user's own WhatsApp / mail
 *              (web shops: checklist with a search link per product)
 *   sent     → paste the shop's reply
 *   quoted   → ok / revisar / no hay per line; the user decides the doubtful ones
 *   approved → send the confirmation; close when collected
 */
import { useState } from "react"
import { ArrowRightLeft, Check, Copy, ExternalLink, Globe, Mail, MessageCircle, Phone, X } from "lucide-react"
import {
  SHOP_KIND_LABELS,
  SHOP_ORDER_STATUS_LABELS,
  capitalize,
  formatQty,
  prettyName,
  type LineDecision,
  type Shop,
  type ShopOrder,
  type ShopOrderLine,
} from "@ona/shared"
import {
  useApproveShopOrder,
  useCancelShopOrder,
  useCloseShopOrder,
  useMarkShopOrderSent,
  usePatchShopOrder,
  useSubmitShopReply,
} from "@/hooks/useShopOrders"
import { haptic } from "@/lib/pwa/haptics"

const eur = (n: number | null | undefined) => (n == null ? "—" : `${String(Math.round(n * 100) / 100).replace(".", ",")} €`)
const lineName = (l: ShopOrderLine) => capitalize(prettyName(l.name))

function parseEuros(s: string): number | null {
  const n = Number(s.replace(",", ".").replace(/[^\d.]/g, ""))
  return s.trim() && Number.isFinite(n) && n > 0 ? n : null
}

const STATUS_TONE: Record<ShopOrder["status"], string> = {
  draft: "bg-[#F2EDE0] text-[#7A7066]",
  sent: "bg-[#1A1612] text-[#FAF6EE]",
  quoted: "bg-[#C65D38] text-[#FAF6EE]",
  approved: "bg-[#2D6A4F] text-[#FAF6EE]",
  closed: "bg-[#F2EDE0] text-[#7A7066]",
  cancelled: "bg-[#F2EDE0] text-[#A39A8E]",
}

const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
const ghostBtn = "inline-flex items-center gap-1.5 text-[12px] text-[#7A7066] hover:text-[#1A1612]"

function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={ghostBtn}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          /* clipboard blocked — nothing to do */
        }
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />} {done ? "Copiado" : label}
    </button>
  )
}

export function OrderCard({ order, shops }: { order: ShopOrder; shops: Shop[] }) {
  const cancel = useCancelShopOrder()
  return (
    <article className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA]" data-testid={`order-${order.shop.kind}`}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#C65D38]">{SHOP_KIND_LABELS[order.shop.kind]}</div>
          <h2 className="font-display text-[20px] leading-tight text-[#1A1612]">{order.shop.name}</h2>
          <div className="mt-0.5 text-[11px] text-[#7A7066]">
            {order.lines.length} {order.lines.length === 1 ? "producto" : "productos"}
            {order.estimateEur != null && ` · ≈${eur(order.estimateEur)}`}
            {order.capEur != null && ` · tope ${eur(order.capEur)}`}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] ${STATUS_TONE[order.status]}`}>
          {SHOP_ORDER_STATUS_LABELS[order.status]}
        </span>
      </header>

      <div className="px-4 pb-4 pt-3">
        {order.status === "draft" && <DraftBody order={order} shops={shops} />}
        {order.status === "sent" && <SentBody order={order} />}
        {order.status === "quoted" && <QuotedBody order={order} />}
        {order.status === "approved" && <ApprovedBody order={order} />}
        {order.status === "closed" && (
          <p className="text-[12px] text-[#7A7066]">Cerrado{order.finalTotalEur != null ? ` · pagaste ${eur(order.finalTotalEur)}` : ""}.</p>
        )}
      </div>

      {["draft", "sent", "quoted", "approved"].includes(order.status) && (
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

// ─── draft ─────────────────────────────────────────────────────

function DraftBody({ order, shops }: { order: ShopOrder; shops: Shop[] }) {
  const patch = usePatchShopOrder()
  const markSent = useMarkShopOrderSent()
  const close = useCloseShopOrder()
  const [cap, setCap] = useState(order.capEur != null ? String(order.capEur).replace(".", ",") : "")
  const others = shops.filter((s) => s.id !== order.shopId)
  const wantsNotes = order.shop.kind === "carniceria" || order.shop.kind === "pescaderia"
  const { channel } = order.shop

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-[#EFE8D8]">
        {order.lines.map((l) => (
          <li key={l.key} className="py-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[14px] text-[#1A1612]">
                {lineName(l)} <span className="text-[#7A7066]">· {formatQty(l.quantity, l.unit)}</span>
                {l.volatile && <span className="ml-1 text-[10px] uppercase tracking-[0.1em] text-[#C65D38]">lonja</span>}
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
            {wantsNotes && (
              <input
                aria-label={`Nota para ${lineName(l)}`}
                defaultValue={l.note ?? ""}
                maxLength={120}
                placeholder={order.shop.kind === "pescaderia" ? "Ej: en lomos, sin espinas" : "Ej: picada, en filetes finos"}
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

      {channel !== "web" && (
        <label className="flex items-center gap-2 text-[12px] text-[#7A7066]">
          Tope del pedido: hasta
          <input
            inputMode="decimal"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            onBlur={() => {
              const v = parseEuros(cap)
              if (v !== order.capEur) patch.mutate({ id: order.id, capEur: v })
            }}
            placeholder="—"
            className="w-16 border-b border-[#DDD6C5] bg-transparent py-0.5 text-right text-[13px] text-[#1A1612] outline-none focus:border-[#1A1612]"
            aria-label="Tope del pedido en euros"
          />
          €
        </label>
      )}

      <details className="rounded-xl bg-[#F7F2E7] px-3 py-2">
        <summary className="cursor-pointer text-[12px] text-[#7A7066]">{channel === "web" ? "Ver la lista" : "Ver el mensaje"}</summary>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-[#1A1612]">{order.messageText}</pre>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        {channel === "whatsapp" && order.links.order && (
          <a href={order.links.order} target="_blank" rel="noopener noreferrer" onClick={() => { haptic.light(); markSent.mutate({ id: order.id }) }} className={primaryBtn}>
            <MessageCircle size={14} /> Enviar por WhatsApp
          </a>
        )}
        {channel === "email" && order.links.order && (
          <a href={order.links.order} onClick={() => markSent.mutate({ id: order.id })} className={primaryBtn}>
            <Mail size={14} /> Enviar por email
          </a>
        )}
        {channel === "telefono" && order.links.order && (
          <a href={order.links.order} onClick={() => markSent.mutate({ id: order.id })} className={primaryBtn}>
            <Phone size={14} /> Llamar
          </a>
        )}
        {channel === "web" && order.links.order && (
          <a href={order.links.order} target="_blank" rel="noopener noreferrer" className={primaryBtn}>
            <Globe size={14} /> Abrir su web
          </a>
        )}
        <CopyButton text={order.messageText} label={channel === "web" ? "Copiar lista" : "Copiar mensaje"} />
        {(channel === "web" || channel === "telefono") && (
          <button type="button" className={ghostBtn} onClick={() => close.mutate({ id: order.id })}>
            <Check size={12} /> Ya está pedido
          </button>
        )}
      </div>
      {order.links.tooLong && (
        <p className="text-[11px] text-[#C65D38]">El pedido es largo para escribirlo solo: copia el mensaje y pégalo en el chat que se abre.</p>
      )}
    </div>
  )
}

// ─── sent ──────────────────────────────────────────────────────

function ReplyForm({ order, cta = "Revisar respuesta" }: { order: ShopOrder; cta?: string }) {
  const submit = useSubmitShopReply()
  const [text, setText] = useState("")
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim().length >= 2) submit.mutate({ id: order.id, text: text.trim() }, { onSuccess: () => setText("") })
      }}
    >
      <label className="block text-[12px] text-[#7A7066]" htmlFor={`reply-${order.id}`}>
        Pega aquí lo que te ha contestado {order.shop.name}:
      </label>
      <textarea
        id={`reply-${order.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder="Ej: La merluza está a 24 €/kg, te salen 1,4 kg. Mejillón hoy no hay. Total unos 37 €."
        className="w-full rounded-xl border border-[#DDD6C5] bg-transparent p-3 text-[13px] text-[#1A1612] outline-none focus:border-[#1A1612]"
      />
      {submit.error && <p role="alert" className="text-[12px] text-[#C65D38]">{submit.error.message}</p>}
      <button type="submit" disabled={text.trim().length < 2 || submit.isPending} className={primaryBtn}>
        {submit.isPending ? "Leyendo la respuesta…" : cta}
      </button>
    </form>
  )
}

function SentBody({ order }: { order: ShopOrder }) {
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[#7A7066]">
        Enviado. Cuando te conteste, pega aquí su respuesta o reenvíasela a ONA por WhatsApp.
      </p>
      <ReplyForm order={order} />
      {order.links.order && (
        <a href={order.links.order} target="_blank" rel="noopener noreferrer" className={ghostBtn}>
          <MessageCircle size={12} /> Volver a abrir el chat
        </a>
      )}
    </div>
  )
}

// ─── quoted ────────────────────────────────────────────────────

const VERDICT: Record<string, { label: string; tone: string }> = {
  ok: { label: "OK", tone: "text-[#2D6A4F]" },
  revisar: { label: "Revisar", tone: "text-[#C65D38]" },
  no_hay: { label: "No hay", tone: "text-[#A39A8E]" },
}

function QuotedBody({ order }: { order: ShopOrder }) {
  const approve = useApproveShopOrder()
  const s = order.quoteSummary
  const [decisions, setDecisions] = useState<Record<string, LineDecision | null>>(() =>
    Object.fromEntries(order.lines.map((l) => [l.key, l.decision])),
  )
  const [cap, setCap] = useState(order.capEur != null ? String(order.capEur).replace(".", ",") : "")
  const [again, setAgain] = useState(false)
  const pending = order.lines.filter((l) => l.verdict === "revisar" && !decisions[l.key])

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[#F7F2E7] px-3 py-2 text-[12px] text-[#1A1612]">
        <div>
          Total: <strong>{eur(s?.totalEur)}</strong>
          {order.capEur != null && <span className={s?.overCap ? "text-[#C65D38]" : "text-[#7A7066]"}> · tope {eur(order.capEur)}{s?.overCap ? " (lo supera)" : ""}</span>}
        </div>
        {s?.pickupText && <div className="text-[#7A7066]">Recogida/entrega: {s.pickupText}</div>}
        {s?.paymentText && <div className="text-[#7A7066]">Pago: {s.paymentText}</div>}
        {s?.notes && <div className="text-[#7A7066]">{s.notes}</div>}
      </div>

      <ul className="divide-y divide-[#EFE8D8]">
        {order.lines.map((l) => {
          const v = VERDICT[l.verdict ?? "revisar"]
          const price = l.quote?.lineTotal != null ? eur(l.quote.lineTotal) : l.quote?.pricePerKg ? `${eur(l.quote.pricePerKg)}/kg` : null
          return (
            <li key={l.key} className="py-2" data-testid={`quote-line-${l.key}`}>
              <div className="flex items-baseline gap-2">
                <span className={`w-14 shrink-0 text-[10px] uppercase tracking-[0.1em] ${v.tone}`}>{v.label}</span>
                <span className="min-w-0 flex-1 text-[14px] text-[#1A1612]">
                  {lineName(l)}
                  {l.quote?.quantityText && <span className="text-[#7A7066]"> · {l.quote.quantityText}</span>}
                </span>
                {price && <span className="text-[13px] text-[#1A1612]">{price}</span>}
              </div>
              {l.reasons.length > 0 && l.verdict !== "no_hay" && <p className="ml-16 text-[11px] text-[#7A7066]">{l.reasons.join(" ")}</p>}
              {l.verdict !== "no_hay" && (
                <div className="ml-16 mt-1 flex gap-2" role="group" aria-label={`Qué hago con ${lineName(l)}`}>
                  {(["keep", "remove"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={decisions[l.key] === d}
                      onClick={() => setDecisions((x) => ({ ...x, [l.key]: d }))}
                      className={`rounded-full border px-3 py-0.5 text-[11px] ${decisions[l.key] === d ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]" : "border-[#DDD6C5] text-[#1A1612]"}`}
                    >
                      {d === "keep" ? (l.quote?.status === "sustituto" ? `Vale, ${l.quote.substitute ?? "el sustituto"}` : "Mantener") : "Quitar"}
                    </button>
                  ))}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <label className="flex items-center gap-2 text-[12px] text-[#7A7066]">
        Si el total pasa de
        <input
          inputMode="decimal"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          placeholder="—"
          aria-label="Tope del pedido en euros"
          className="w-16 border-b border-[#DDD6C5] bg-transparent py-0.5 text-right text-[13px] text-[#1A1612] outline-none focus:border-[#1A1612]"
        />
        €, que me avisen
      </label>

      {pending.length > 0 && (
        <p className="text-[11px] text-[#C65D38]">Decide qué haces con: {pending.map(lineName).join(", ")}.</p>
      )}
      {approve.error && <p role="alert" className="text-[12px] text-[#C65D38]">{approve.error.message}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending.length > 0 || approve.isPending}
          className={primaryBtn}
          onClick={() => {
            const ds = Object.fromEntries(Object.entries(decisions).filter(([, d]) => d)) as Record<string, LineDecision>
            approve.mutate({ id: order.id, decisions: ds, capEur: parseEuros(cap) })
          }}
        >
          <Check size={14} /> {approve.isPending ? "Confirmando…" : "Aprobar pedido"}
        </button>
        <button type="button" className={ghostBtn} onClick={() => setAgain((x) => !x)}>
          {again ? "Cerrar" : "Ha cambiado algo: pegar otra respuesta"}
        </button>
      </div>
      {again && <ReplyForm order={order} cta="Volver a revisar" />}
      {order.shopReplyText && (
        <details className="text-[12px] text-[#7A7066]">
          <summary className="cursor-pointer">Lo que dijo la tienda</summary>
          <p className="mt-1 whitespace-pre-wrap">{order.shopReplyText}</p>
        </details>
      )}
    </div>
  )
}

// ─── approved ──────────────────────────────────────────────────

function ApprovedBody({ order }: { order: ShopOrder }) {
  const close = useCloseShopOrder()
  const [paid, setPaid] = useState("")
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-[#7A7066]">Envía la confirmación a la tienda. Pagas directamente allí.</p>
      {order.confirmationText && (
        <pre className="whitespace-pre-wrap rounded-xl bg-[#F7F2E7] px-3 py-2 font-sans text-[12px] text-[#1A1612]">{order.confirmationText}</pre>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {order.links.confirmation && (
          <a href={order.links.confirmation} target="_blank" rel="noopener noreferrer" className={primaryBtn}>
            {order.shop.channel === "email" ? <Mail size={14} /> : <MessageCircle size={14} />} Enviar confirmación
          </a>
        )}
        {order.confirmationText && <CopyButton text={order.confirmationText} />}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[#EFE8D8] pt-3">
        <label className="flex items-center gap-2 text-[12px] text-[#7A7066]">
          Pagado
          <input
            inputMode="decimal"
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            placeholder="—"
            aria-label="Importe pagado en euros"
            className="w-16 border-b border-[#DDD6C5] bg-transparent py-0.5 text-right text-[13px] text-[#1A1612] outline-none focus:border-[#1A1612]"
          />
          €
        </label>
        <button type="button" className={ghostBtn} onClick={() => close.mutate({ id: order.id, finalTotalEur: parseEuros(paid) })}>
          <Check size={12} /> Ya lo tengo, cerrar pedido
        </button>
      </div>
    </div>
  )
}
