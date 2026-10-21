"use client"

/**
 * «Enviar a <cadena>» en la tarjeta del súper (specs/shop-orders.md → «Enviar
 * a la extensión del navegador», experimento cerrado): la cesta va a la
 * extensión, que la suma al carro de la cadena en el navegador del usuario.
 * La cadena solo se nombra con la `etiqueta` que da la extensión.
 */
import { useEffect, useState } from "react"
import { Check, ExternalLink, ShoppingCart, Undo2 } from "lucide-react"
import { buildExtensionBasket, capitalize, isLiveBasketSend, prettyName, type BasketSendError, type ShopOrder } from "@ona/shared"
import { useCloseShopOrder } from "@/hooks/useShopOrders"
import { ExtensionNoAnswer, ExtensionStaleSend, useSendToExtension, useUndoExtensionSend } from "@/hooks/useBasketExtension"
import { ApiError } from "@/lib/api"
import { haptic } from "@/lib/pwa/haptics"
import { eur, ghostBtn as ghostBase, primaryBtn } from "./styles"

const ghostBtn = `${ghostBase} disabled:opacity-40`
const alertText = "text-[12px] text-[#C65D38]"
const sectionTitle = "text-[11px] uppercase tracking-[0.12em]"

/** El último envío no llegó al carro: por qué, para la persona. */
const SEND_RESULT_ERROR: Record<BasketSendError, (etiqueta: string) => string> = {
  sin_zona: (e) => `Elige tu código postal en ${e} y vuelve a pulsar.`,
  sin_sesion: (e) => `Entra en tu cuenta de ${e} en este navegador y vuelve a pulsar.`,
  contrato: (e) => `La web de ${e} no responde o ha cambiado; no hemos tocado tu carro.`,
  red: (e) => `La web de ${e} no responde o ha cambiado; no hemos tocado tu carro.`,
  verificacion: () => "Puede que algo no haya entrado; revisa tu carro.",
}

/** Por qué no entró una línea. */
const MOTIVO: Record<string, (etiqueta: string) => string> = {
  no_encontrado: (e) => `no aparece en ${e}`,
  no_publicado: () => "no está disponible",
  error: () => "no se ha podido añadir",
}

/** La web de la tienda, solo si es http(s): otra cosa (`javascript:`, `data:`…) no se pinta como enlace. */
function httpUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const { protocol } = new URL(url)
    return protocol === "http:" || protocol === "https:" ? url : null
  } catch {
    return null
  }
}

/** No hay respuesta de la extensión o no se ha podido guardar: volver a pulsar es seguro (spec). */
const SEND_UNKNOWN = new ExtensionNoAnswer().message

function sendErrorText(err: Error, etiqueta: string): string {
  if (err instanceof ExtensionNoAnswer || err instanceof ExtensionStaleSend) return err.message
  // El interruptor se apagó entre el estado y el envío: reintentar no sirve, y puede que algo haya entrado.
  if (err instanceof ApiError && err.status === 403)
    return `Esta función no está activada para tu cuenta. Revisa tu carro de ${etiqueta} por si ha entrado algo.`
  return SEND_UNKNOWN
}

/** Falló la llamada a la API (respuesta de error, sin red o tiempo agotado), no la extensión. */
function isApiFailure(err: Error): boolean {
  return err instanceof ApiError || err instanceof TypeError || err.name === "AbortError"
}

function undoErrorText(err: Error, etiqueta: string, manual: boolean): string {
  if (err instanceof ExtensionNoAnswer) return err.message
  // Sin `manual`, la API solo se llama cuando la extensión ya ha restado.
  if (!manual && isApiFailure(err)) return "Lo hemos quitado de tu carro, pero no hemos podido guardarlo. Vuelve a pulsar."
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

/** `extensionId`: la extensión que llena la web de esta tienda (useBasketExtension). */
export function ExtensionSendPanel({ order, etiqueta, extensionId }: { order: ShopOrder; etiqueta: string; extensionId: string | null }) {
  const send = useSendToExtension()
  const basket = buildExtensionBasket(order.lines)
  // Nada que mandar (p. ej. todo «probablemente lo tienes» sin marcar): sin botón.
  if (basket.length === 0) return null

  const r = order.extensionResult
  // El último envío no dejó nada en el carro (y no se deshizo): se dice por qué encima del botón.
  const prev = r && !r.deshechoAt && !isLiveBasketSend(r) ? r : null
  const names = basketNames(order, basket)
  const nameList = (ls: Array<{ key: string }>) => ls.map((l) => names.get(l.key) ?? "un producto").join(", ")
  const fallidas = prev && !prev.error ? prev.lineas.filter((l) => l.estado === "fallida") : []
  // Falló la búsqueda (`error`): no es que no estén. Si fallaron todas así, es la web de la cadena.
  const errored = fallidas.filter((l) => l.motivo === "error")
  const notFound = fallidas.filter((l) => l.motivo !== "error")
  const allErrored = !!prev && errored.length > 0 && errored.length === prev.lineas.length
  const showPrev = !send.isPending && !send.error

  return (
    <div className="space-y-2 border-t border-[#EFE8D8] pt-3" data-testid="basket-extension">
      {showPrev && r?.deshechoAt && <p className="text-[12px] text-[#7A7066]">Envío deshecho; puedes volver a enviarlo.</p>}
      {showPrev && prev?.error && (
        <p role="alert" className={alertText}>
          {SEND_RESULT_ERROR[prev.error](etiqueta)}
        </p>
      )}
      {showPrev && allErrored && (
        <p role="alert" className={alertText}>
          {SEND_RESULT_ERROR.red(etiqueta)}
        </p>
      )}
      {showPrev && notFound.length > 0 && (
        <p role="alert" className={alertText}>
          No hemos encontrado estos productos en {etiqueta}: {nameList(notFound)}.
        </p>
      )}
      {showPrev && errored.length > 0 && !allErrored && (
        <p role="alert" className={alertText}>
          No se han podido añadir (la búsqueda de {etiqueta} falló): {nameList(errored)}. Añádelos a mano.
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
          send.mutate({ order, extensionId })
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

/**
 * Por qué hay que quitarlo a mano: en este navegador no hay nada que deshacer
 * (otro navegador, otro miembro del hogar) o la web de la cadena ha cambiado.
 */
type ManualReason = "nada" | "contrato"

/**
 * `onBusyChange`: la tarjeta desactiva «Cancelar pedido» mientras se deshace o se cierra.
 * `extensionId`: la que llena la web de esta tienda, si se sabe; si no (null), deshacer pregunta a todas.
 */
export function ExtensionSentBody({
  order,
  etiqueta,
  extensionId,
  onBusyChange,
}: {
  order: ShopOrder
  etiqueta: string
  extensionId: string | null
  onBusyChange?: (busy: boolean) => void
}) {
  const undo = useUndoExtensionSend()
  const close = useCloseShopOrder()
  const [manual, setManual] = useState<ManualReason | null>(null)
  // Tras cerrar, hasta que llega el pedido cerrado, nada más.
  const busy = undo.isPending || close.isPending || close.isSuccess
  useEffect(() => {
    onBusyChange?.(busy)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])
  const r = order.extensionResult
  if (!r) return null

  const names = basketNames(order)
  const nameOf = (key: string) => names.get(key) ?? "Un producto"
  const anadido = r.lineas.filter((l) => l.estado === "tabla" || l.estado === "busqueda")
  const revisar = r.lineas.filter((l) => l.estado === "busqueda")
  const dudosas = r.lineas.filter((l) => l.estado === "no_verificada")
  const fallidas = r.lineas.filter((l) => l.estado === "fallida")
  const cartUrl = httpUrl(order.shop.webUrl)
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
          <p className="text-[11px] text-[#7A7066]">
            No sabemos si han entrado: revísalos en tu carro. Al cerrar el pedido seguirán en tu lista: márcalos allí si estaban.
          </p>
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
                {nameOf(l.key)} — {(MOTIVO[l.motivo ?? "error"] ?? MOTIVO.error)(etiqueta)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div>
        <div className="flex flex-wrap items-center gap-3">
          {cartUrl && (
            <a href={cartUrl} target="_blank" rel="noopener noreferrer" className={primaryBtn}>
              <ExternalLink size={14} /> Abrir el carro
            </a>
          )}
          <button
            type="button"
            className={ghostBtn}
            disabled={busy}
            onClick={() => {
              // Un intento nuevo: lo que dijo el anterior («Ya lo he quitado yo») ya no vale.
              setManual(null)
              undo.mutate(
                { order, extensionId },
                {
                  onSuccess: (x) => setManual(x.manualNeeded ? "nada" : null),
                  // La web de la cadena ha cambiado: se puede quitar a mano.
                  onError: (err) => setManual(!isApiFailure(err) && err.message === "contrato" ? "contrato" : null),
                },
              )
            }}
          >
            <Undo2 size={12} /> {undo.isPending && !undoingManual ? "Quitando…" : "Quitar lo que añadió Mimoia"}
          </button>
          <button type="button" className={ghostBtn} disabled={busy} onClick={() => close.mutate({ id: order.id })}>
            <Check size={12} /> {close.isPending ? "Cerrando…" : "Ya está pedido"}
          </button>
        </div>
        {/* Siempre montado: así el lector de pantalla anuncia el aviso al aparecer. */}
        <p className="text-[11px] text-[#7A7066] [&:not(:empty)]:mt-2" aria-live="polite">
          {undo.isPending && !undoingManual ? `Puede tardar un poco. No cierres la pestaña de ${etiqueta}.` : ""}
        </p>
      </div>
      {/* Antes del bloque manual: «También puedes quitarlo a mano…» se refiere a este aviso. */}
      {undo.error && (
        <p role="alert" className={alertText}>
          {undoErrorText(undo.error, etiqueta, !!undo.variables?.manual)}
        </p>
      )}
      {anadido.length > 0 && (
        // Para quitarlo a mano hay que saber qué es: abierto cuando toca hacerlo.
        <details open={manual !== null} className="rounded-xl bg-[#F7F2E7] px-3 py-2" data-testid="basket-extension-added">
          <summary className="cursor-pointer text-[12px] text-[#7A7066]">Lo que añadió Mimoia</summary>
          <ul className="mt-1 divide-y divide-[#EFE8D8]">
            {anadido.map((l) => (
              <li key={l.key} className="py-1.5 text-[12px] text-[#1A1612]">
                {l.producto ?? nameOf(l.key)}
                {l.unidades ? ` × ${l.unidades}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {manual && (
        <div className="space-y-1">
          <p className="text-[12px] text-[#7A7066]">
            {manual === "nada"
              ? `En este navegador no hay nada que quitar. Puedes quitarlo desde el navegador que lo envió o a mano en tu carro de ${etiqueta}. Cuando ya no esté, pulsa «Ya lo he quitado yo».`
              : `También puedes quitarlo a mano en tu carro de ${etiqueta}. Cuando ya no esté, pulsa «Ya lo he quitado yo».`}
          </p>
          <button type="button" className={ghostBtn} disabled={busy} onClick={() => undo.mutate({ order, manual: true })}>
            <Check size={12} /> {undoingManual ? "Un momento…" : "Ya lo he quitado yo"}
          </button>
        </div>
      )}
      {close.error && (
        <p role="alert" className={alertText}>
          No hemos podido cerrarlo. Vuelve a intentarlo.
        </p>
      )}
    </div>
  )
}
