"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BASKET_EXTENSION_PROTOCOL,
  basketSendResultSchema,
  buildExtensionBasket,
  extensionForHost,
  type BasketSendResult,
  type BasketUndoResult,
  type ShopOrder,
} from "@ona/shared"
import { api, apiFetch, ApiError } from "@/lib/api"
import { askExtension, BASKET_EXTENSION_IDS, hostOf, messageExtension, pingExtensions, SEND_TIMEOUT_MS, type ExtensionReply } from "@/lib/basketExtension"

/**
 * ¿Sale «Enviar a <etiqueta>» para la web de esta tienda? Con varias extensiones (una por cadena), la que
 * sabe llenar su host: su `extensionId` es al que van el envío y el deshacer.
 */
export function useBasketExtension(shopWebUrl: string | null) {
  const host = hostOf(shopWebUrl)
  const status = useQuery<{ enabled: boolean }>({
    queryKey: ["shop-extension-status"],
    queryFn: () => api.get<{ enabled: boolean }>("/shop-extension/status"),
    // Sin id de extensión en la build no hay a quién hablar: ni se pregunta (y los enlaces de Carrefour no esperan).
    // TODO(test): sin test; la web no tiene tests unitarios y los e2e se construyen con id.
    enabled: !!host && BASKET_EXTENSION_IDS.length > 0,
    staleTime: 5 * 60_000,
  })
  const ping = useQuery({
    queryKey: ["basket-extension-pings"],
    queryFn: pingExtensions,
    enabled: !!status.data?.enabled,
    staleTime: 60_000,
    retry: false,
  })
  const ext = extensionForHost(ping.data ?? [], host)
  return {
    available: !!(status.data?.enabled && ext),
    etiqueta: ext?.ping.etiqueta ?? null,
    /** La extensión que llena esta web (null si no hay). */
    extensionId: ext?.id ?? null,
    /** Se está comprobando (el estado o el ping): mientras tanto no se pinta nada de la extensión. */
    checking: status.isLoading || ping.isLoading,
  }
}

/**
 * La extensión no contestó a tiempo, se cortó o contestó algo que no es un
 * resultado: no sabemos qué ha pasado en el carro. El mensaje es para la persona.
 */
export class ExtensionNoAnswer extends Error {
  constructor(message = "No sabemos si ha entrado; abre tu carro. Si vuelves a pulsar no se duplica.") {
    super(message)
    this.name = "ExtensionNoAnswer"
  }
}

/**
 * Tras un envío deshecho («Ya lo he quitado yo»), el reenvío sigue trayendo
 * aquel envío (la extensión no lo olvidó). Volver a pulsar es seguro.
 */
export class ExtensionStaleSend extends Error {
  constructor() {
    super("No hemos podido rehacer el envío. Vuelve a pulsar.")
    this.name = "ExtensionStaleSend"
  }
}

type Saved = { order: ShopOrder; deshecho: boolean }

/** Tiempo máximo de cada llamada a la API de estas mutaciones. */
const API_TIMEOUT_MS = 20_000
/** Espera antes del segundo y del tercer intento. */
const RETRY_DELAYS_MS = [1_000, 3_000]

function postWithTimeout<T>(path: string, body: unknown): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT_MS)
  return apiFetch<T>(path, { method: "POST", body, signal: ctrl.signal }).finally(() => clearTimeout(timer))
}

/** Sin red, tiempo agotado o 5xx. Un 4xx no se arregla reintentando (permiso, validación, estado del pedido). */
function retryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500
  return err instanceof TypeError || (err instanceof DOMException && err.name === "AbortError")
}

/** Hasta 3 intentos. Repetir es seguro: el resultado lleva su `envioId` y deshacer dos veces da 409. */
async function postWithRetries<T>(path: string, body: unknown): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await postWithTimeout<T>(path, body)
    } catch (err) {
      if (i >= RETRY_DELAYS_MS.length || !retryable(err)) throw err
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[i]))
    }
  }
}

/**
 * Manda la cesta del pedido a la extensión. Devuelve su resultado solo si es un
 * resultado de envío válido; si no (sin respuesta, o p. ej. `{ ok: false, error: 'red' }`
 * cuando la extensión falla por dentro), null: no va a la API y se trata como sin respuesta.
 */
async function sendToExtension(order: ShopOrder, extensionId?: string | null): Promise<BasketSendResult | null> {
  const resp = await askExtension<unknown>(
    { protocolo: BASKET_EXTENSION_PROTOCOL, tipo: "enviar", pedidoId: order.id, lineas: buildExtensionBasket(order.lines) },
    SEND_TIMEOUT_MS,
    extensionId,
  )
  const parsed = basketSendResultSchema.safeParse(resp)
  return parsed.success ? parsed.data : null
}

function postResult(orderId: string, result: BasketSendResult): Promise<Saved> {
  return postWithRetries<Saved>(`/shop-orders/${orderId}/extension-result`, result)
}

export function useSendToExtension() {
  const qc = useQueryClient()
  return useMutation<Saved, Error, { order: ShopOrder; extensionId?: string | null }>({
    mutationFn: async ({ order, extensionId }) => {
      let result = await sendToExtension(order, extensionId)
      if (!result) throw new ExtensionNoAnswer()
      let saved = await postResult(order.id, result)
      if (saved.deshecho) {
        // El envío que recordaba la extensión ya se deshizo («Ya lo he quitado yo»): se olvida y va uno nuevo.
        await askExtension({ protocolo: BASKET_EXTENSION_PROTOCOL, tipo: "olvidar", pedidoId: order.id }, 5_000, extensionId)
        result = await sendToExtension(order, extensionId)
        if (!result) throw new ExtensionNoAnswer()
        saved = await postResult(order.id, result)
        // Sigue llegando el envío deshecho (la extensión no lo olvidó): no se queda en silencio.
        if (saved.deshecho) throw new ExtensionStaleSend()
      }
      return saved
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["shop-orders"] }),
  })
}

/**
 * 409 de `extension-undo` cuando ya no queda nada que deshacer: el envío ya estaba
 * deshecho (NO_EXTENSION_SEND) o el pedido ya no está enviado (BAD_STATUS, p. ej.
 * ha vuelto a borrador por el primer toque de un doble toque o porque otro miembro
 * del hogar lo deshizo antes).
 */
function alreadyUndone(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && (err.code === "NO_EXTENSION_SEND" || err.code === "BAD_STATUS")
}

/**
 * `deshacer` a la extensión que envió. Si no se sabe cuál (otro navegador, o el interruptor apagado y sin
 * `ping`: deshacer no lo mira), se pregunta a todas en el orden de la build y vale la primera que tenga ese
 * envío; las demás contestan `nada_que_deshacer`. Con un solo id, es preguntar a esa.
 */
// TODO(test): el e2e se construye con un solo id; falta un e2e con dos (una extensión que sabe el host y otra no),
// para el `ping` a todas, la elección por host y este deshacer en orden. La lógica pura tiene test
// (apps/api/src/tests/basketExtensionIds.test.ts).
async function undoInExtension(order: ShopOrder, extensionId: string | null | undefined) {
  const msg = { protocolo: BASKET_EXTENSION_PROTOCOL, tipo: "deshacer", pedidoId: order.id } as const
  if (extensionId) return messageExtension<BasketUndoResult>(msg, SEND_TIMEOUT_MS, extensionId)
  let reply: ExtensionReply<BasketUndoResult> = { kind: "none" }
  for (const id of BASKET_EXTENSION_IDS) {
    const r = await messageExtension<BasketUndoResult>(msg, SEND_TIMEOUT_MS, id)
    if (r.kind === "timeout") return r
    if (r.kind === "answer") {
      reply = r
      if (r.value.ok || r.value.error !== "nada_que_deshacer") return r
    }
  }
  return reply
}

/** `isPending` sirve para desactivar los botones mientras espera. */
export function useUndoExtensionSend() {
  const qc = useQueryClient()
  return useMutation<{ manualNeeded: boolean }, Error, { order: ShopOrder; manual?: boolean; extensionId?: string | null }>({
    mutationFn: async ({ order, manual, extensionId }) => {
      if (!manual) {
        const reply = await undoInExtension(order, extensionId)
        // Sin extensión en este navegador (otro miembro del hogar, el móvil): se ofrece «Ya lo he quitado yo».
        if (reply.kind === "none") return { manualNeeded: true }
        // Tarda demasiado: puede que siga restando. No es «sin extensión».
        if (reply.kind === "timeout") throw new ExtensionNoAnswer("No sabemos si se ha quitado; mira tu carro.")
        const r = reply.value
        if (!r.ok) {
          if (r.error === "nada_que_deshacer") return { manualNeeded: true }
          throw new Error(r.error)
        }
      }
      try {
        await postWithRetries<ShopOrder>(`/shop-orders/${order.id}/extension-undo`, { manual: !!manual })
      } catch (err) {
        // Ya estaba deshecho: es un éxito, sin mensaje de error; `onSettled` refresca el pedido.
        if (!alreadyUndone(err)) throw err
      }
      return { manualNeeded: false }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["shop-orders"] }),
  })
}
