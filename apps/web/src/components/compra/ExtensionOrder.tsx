"use client"

/**
 * «Enviar a <cadena>» en la tarjeta del súper (specs/shop-orders.md → «Enviar
 * a la extensión del navegador», experimento cerrado): la cesta va a la
 * extensión, que la suma al carro de la cadena en el navegador del usuario.
 * La cadena solo se nombra con la `etiqueta` que da la extensión.
 */
import { useState } from "react"
import { Check, ExternalLink, ShoppingCart, Undo2 } from "lucide-react"
import { basketMayBeInCart, buildExtensionBasket, capitalize, prettyName, type BasketSendError, type ShopOrder } from "@ona/shared"
import { useCloseShopOrder } from "@/hooks/useShopOrders"
import { ExtensionNoAnswer, ExtensionStaleSend, useSendToExtension, useUndoExtensionSend } from "@/hooks/useBasketExtension"
import { ApiError } from "@/lib/api"
import { haptic } from "@/lib/pwa/haptics"

const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
const ghostBtn = "inline-flex items-center gap-1.5 text-[12px] text-[#7A7066] hover:text-[#1A1612] disabled:opacity-40"
const alertText = "text-[12px] text-[#C65D38]"
const sectionTitle = "text-[11px] uppercase tracking-[0.12em]"
const eur = (n: number) => `${String(Math.round(n * 100) / 100).replace(".", ",")} €`

/** El último envío no llegó al carro: por qué, para la persona. */
const SEND_RESULT_ERROR: Record<BasketSendError, (etiqueta: string) => string> = {
  sin_zona: (e) => `Elige tu código postal en ${e} y vuelve a pulsar.`,
  sin_sesion: (e) => `Entra en tu cuenta de ${e} en este navegador y vuelve a pulsar.`,
  contrato: (e) => `La web de ${e} no responde o ha cambiado; no hemos tocado tu carro.`,
  red: (e) => `La web de ${e} no responde o ha cambiado; no hemos tocado tu carro.`,
  verificacion: () => "Puede que algo no haya entrado; revisa tu carro.",
}

const MOTIVO: Record<string, string> = {
  no_encontrado: "no lo hemos encontrado",
  no_publicado: "no está disponible",
  error: "no hemos podido añadirlo",
}

/** No hay respuesta de la extensión o no se ha podido guardar: volver a pulsar es seguro (spec). */
const SEND_UNKNOWN = "No sabemos si ha entrado; abre tu carro. Si vuelves a pulsar no se duplica."

function sendErrorText(err: Error, etiqueta: string): string {
  if (err instanceof ExtensionNoAnswer || err instanceof ExtensionStaleSend) return err.message
  // El interruptor se apagó entre el estado y el envío: reintentar no sirve, y puede que algo haya entrado.
  if (err instanceof ApiError && err.status === 403)
    return `Esta función no está activada para tu cuenta. Revisa tu carro de ${etiqueta} por si ha entrado algo.`
  return SEND_UNKNOWN
}

function undoErrorText(err: Error, etiqueta: string): string {
  if (err instanceof ExtensionNoAnswer) return err.message
  if (err.message === "sin_sesion") return `Entra en tu cuenta de ${etiqueta} en este navegador y vuelve a intentarlo.`
  return "No hemos podido deshacerlo. Vuelve a intentarlo."
}

/**
 * Nombre para la persona de cada clave de la cesta (l3, l3.2). Manda la cesta
 * tal como se mandó (`cesta` del resultado), porque las líneas pueden haber
 * cambiado después; si no está (resultados antiguos), la de ahora.
 */
function basketNames(order: ShopOrder, basket = buildExtensionBasket(order.lines)): Map<string, string> {
  const all = [...basket, ...(order.extensionResult?.cesta ?? [])]
  return new Map(all.map((b) => [b.key, capitalize(prettyName(b.name))]))
}

export function ExtensionSendPanel({ order, etiqueta }: { order: ShopOrder; etiqueta: string }) {
  const send = useSendToExtension()
  const basket = buildExtensionBasket(order.lines)
  // Nada que mandar (p. ej. todo «probablemente lo tienes» sin marcar): sin botón.
  if (basket.length === 0) return null

  const r = order.extensionResult
  // El último envío no dejó nada en el carro (y no se deshizo): se dice por qué encima del botón.
  const prev = r && !r.deshechoAt && !basketMayBeInCart(r) ? r : null
  const names = basketNames(order, basket)
  const notFound = prev && !prev.error ? prev.lineas.filter((l) => l.estado === "fallida") : []
  const showPrev = !send.isPending && !send.error

  return (
    <div className="space-y-2 border-t border-[#EFE8D8] pt-3" data-testid="basket-extension">
      {showPrev && prev?.error && (
        <p role="alert" className={alertText}>
          {SEND_RESULT_ERROR[prev.error](etiqueta)}
        </p>
      )}
      {showPrev && notFound.length > 0 && (
        <p role="alert" className={alertText}>
          No hemos encontrado estos productos en {etiqueta}: {notFound.map((l) => names.get(l.key) ?? "un producto").join(", ")}.
        </p>
      )}
      {send.error && (
        <p role="alert" className={alertText}>
          {sendErrorText(send.error, etiqueta)}
        </p>
      )}
      <button
        type="button"
        className={primaryBtn}
        disabled={send.isPending}
        onClick={() => {
          haptic.light()
          send.mutate({ order })
        }}
      >
        <ShoppingCart size={14} /> {send.isPending ? `Enviando a ${etiqueta}…` : `Enviar a ${etiqueta}`}
      </button>
      <p className="text-[11px] text-[#7A7066]" aria-live="polite">
        {send.isPending
          ? `Puede tardar un minuto. No cierres la pestaña de ${etiqueta}.`
          : `Se suma a lo que ya tengas en tu carro de ${etiqueta}. Lo revisas y pagas allí.`}
      </p>
    </div>
  )
}

export function ExtensionSentBody({ order, etiqueta }: { order: ShopOrder; etiqueta: string }) {
  const undo = useUndoExtensionSend()
  const close = useCloseShopOrder()
  /** La extensión de este navegador no puede deshacerlo (otro navegador u otro miembro del hogar). */
  const [manual, setManual] = useState(false)
  const r = order.extensionResult
  if (!r) return null

  const names = basketNames(order)
  const nameOf = (key: string) => names.get(key) ?? "Un producto"
  const revisar = r.lineas.filter((l) => l.estado === "busqueda")
  const dudosas = r.lineas.filter((l) => l.estado === "no_verificada")
  const fallidas = r.lineas.filter((l) => l.estado === "fallida")
  const busy = undo.isPending || close.isPending
  const undoingManual = undo.isPending && !!undo.variables?.manual

  return (
    <div className="space-y-3" data-testid="basket-extension-sent">
      <p className="text-[13px] text-[#1A1612]">
        {r.anadidas > 0
          ? `${r.anadidas} ${r.anadidas === 1 ? "producto" : "productos"} en tu carro de ${etiqueta}${r.totalEur != null ? ` · total del carro: ${eur(r.totalEur)}` : ""}`
          : `No sabemos qué ha entrado en tu carro de ${etiqueta}: revísalo.`}
      </p>
      {r.bajoMinimo && <p className={alertText}>Tu carro no llega al pedido mínimo de {etiqueta}: añade algo más allí.</p>}
      {/* Con líneas sin confirmar, ya lo dice su lista («Sin confirmar»), con los nombres. */}
      {r.error === "verificacion" && r.anadidas > 0 && dudosas.length === 0 && (
        <p className={alertText}>{SEND_RESULT_ERROR.verificacion(etiqueta)}</p>
      )}

      {revisar.length > 0 && (
        <section>
          <h3 className={`${sectionTitle} text-[#C65D38]`}>Revísalo</h3>
          <p className="text-[11px] text-[#7A7066]">Los hemos buscado en {etiqueta} y hemos puesto lo primero que salía.</p>
          <ul className="divide-y divide-[#EFE8D8]">
            {revisar.map((l) => (
              <li key={l.key} className="py-1.5 text-[12px] text-[#1A1612]">
                {nameOf(l.key)}
                {l.producto ? ` → ${l.producto}` : ""}
                {l.unidades ? ` × ${l.unidades}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      {dudosas.length > 0 && (
        <section>
          <h3 className={`${sectionTitle} text-[#7A7066]`}>Sin confirmar</h3>
          <p className="text-[11px] text-[#7A7066]">No sabemos si han entrado: revísalas en tu carro.</p>
          <ul className="divide-y divide-[#EFE8D8]">
            {dudosas.map((l) => (
              <li key={l.key} className="py-1.5 text-[12px] text-[#1A1612]">
                {nameOf(l.key)}
              </li>
            ))}
          </ul>
        </section>
      )}
      {fallidas.length > 0 && (
        <section>
          <h3 className={`${sectionTitle} text-[#7A7066]`}>No han entrado</h3>
          <ul className="divide-y divide-[#EFE8D8]">
            {fallidas.map((l) => (
              <li key={l.key} className="py-1.5 text-[12px] text-[#1A1612]">
                {nameOf(l.key)} — {MOTIVO[l.motivo ?? "error"] ?? MOTIVO.error}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {order.shop.webUrl && (
          <a href={order.shop.webUrl} target="_blank" rel="noopener noreferrer" className={primaryBtn}>
            <ExternalLink size={14} /> Abrir el carro
          </a>
        )}
        <button
          type="button"
          className={ghostBtn}
          disabled={busy}
          onClick={() => {
            // Un intento nuevo: lo que dijo el anterior («Ya lo he quitado yo») ya no vale.
            setManual(false)
            undo.mutate({ order }, { onSuccess: (x) => setManual(x.manualNeeded) })
          }}
        >
          <Undo2 size={12} /> {undo.isPending && !undoingManual ? "Quitando…" : "Quitar lo que añadió Mimoia"}
        </button>
        <button type="button" className={ghostBtn} disabled={busy} onClick={() => close.mutate({ id: order.id })}>
          <Check size={12} /> {close.isPending ? "Cerrando…" : "Ya está pedido"}
        </button>
      </div>
      {undo.isPending && !undoingManual && (
        <p className="text-[11px] text-[#7A7066]" aria-live="polite">
          Puede tardar un poco. No cierres la pestaña de {etiqueta}.
        </p>
      )}
      {manual && (
        <div className="space-y-1">
          <p className="text-[12px] text-[#7A7066]">
            Solo se puede deshacer desde el navegador que lo envió. Quita los productos en tu carro de {etiqueta}.
          </p>
          <button type="button" className={ghostBtn} disabled={busy} onClick={() => undo.mutate({ order, manual: true })}>
            <Check size={12} /> {undoingManual ? "Un momento…" : "Ya lo he quitado yo"}
          </button>
        </div>
      )}
      {undo.error && (
        <p role="alert" className={alertText}>
          {undoErrorText(undo.error, etiqueta)}
        </p>
      )}
      {close.error && (
        <p role="alert" className={alertText}>
          No hemos podido cerrarlo. Vuelve a intentarlo.
        </p>
      )}
    </div>
  )
}
