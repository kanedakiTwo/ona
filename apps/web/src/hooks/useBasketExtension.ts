"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BASKET_EXTENSION_PROTOCOL,
  basketSendResultSchema,
  buildExtensionBasket,
  type BasketSendResult,
  type BasketUndoResult,
  type ShopOrder,
} from "@ona/shared"
import { api, ApiError } from "@/lib/api"
import { askExtension, hostOf, pingExtension, SEND_TIMEOUT_MS } from "@/lib/basketExtension"

/** ¿Sale «Enviar a <etiqueta>» para la web de esta tienda? */
export function useBasketExtension(shopWebUrl: string | null) {
  const status = useQuery<{ enabled: boolean }>({
    queryKey: ["shop-extension-status"],
    queryFn: () => api.get<{ enabled: boolean }>("/shop-extension/status"),
    staleTime: 5 * 60_000,
  })
  const ping = useQuery({
    queryKey: ["basket-extension-ping"],
    queryFn: pingExtension,
    enabled: !!status.data?.enabled,
    staleTime: 60_000,
    retry: false,
  })
  const host = hostOf(shopWebUrl)
  const p = ping.data ?? null
  return { available: !!(status.data?.enabled && p && host && p.hosts.includes(host)), etiqueta: p?.etiqueta ?? null }
}

/**
 * La extensión no contestó (tiempo agotado o se cortó) o contestó algo que no
 * es un resultado de envío: no sabemos qué ha pasado en el carro.
 */
export class ExtensionNoAnswer extends Error {
  constructor() {
    super("sin_respuesta")
  }
}

type Saved = { order: ShopOrder; deshecho: boolean }

/**
 * Manda la cesta del pedido a la extensión. Devuelve su resultado solo si es un
 * resultado de envío válido; si no (sin respuesta, o p. ej. `{ ok: false, error: 'red' }`
 * cuando la extensión falla por dentro), null: no va a la API y se trata como sin respuesta.
 */
async function sendToExtension(order: ShopOrder): Promise<BasketSendResult | null> {
  const resp = await askExtension<unknown>(
    { protocolo: BASKET_EXTENSION_PROTOCOL, tipo: "enviar", pedidoId: order.id, lineas: buildExtensionBasket(order.lines) },
    SEND_TIMEOUT_MS,
  )
  const parsed = basketSendResultSchema.safeParse(resp)
  return parsed.success ? parsed.data : null
}

async function postResult(orderId: string, result: BasketSendResult): Promise<Saved> {
  let last: unknown = null
  for (let i = 0; i < 3; i++) {
    try {
      return await api.post<Saved>(`/shop-orders/${orderId}/extension-result`, result)
    } catch (err) {
      last = err
      // Un 4xx no se arregla reintentando (permiso, validación, estado del pedido).
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) break
    }
  }
  throw last
}

export function useSendToExtension() {
  const qc = useQueryClient()
  return useMutation<Saved, Error, { order: ShopOrder }>({
    mutationFn: async ({ order }) => {
      let result = await sendToExtension(order)
      if (!result) throw new ExtensionNoAnswer()
      let saved = await postResult(order.id, result)
      if (saved.deshecho) {
        // El envío que recordaba la extensión ya se deshizo («Ya lo he quitado yo»): se olvida y va uno nuevo.
        await askExtension({ protocolo: BASKET_EXTENSION_PROTOCOL, tipo: "olvidar", pedidoId: order.id }, 5_000)
        result = await sendToExtension(order)
        if (!result) throw new ExtensionNoAnswer()
        saved = await postResult(order.id, result)
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

/** `isPending` sirve para desactivar los botones mientras espera. */
export function useUndoExtensionSend() {
  const qc = useQueryClient()
  return useMutation<{ manualNeeded: boolean }, Error, { order: ShopOrder; manual?: boolean }>({
    mutationFn: async ({ order, manual }) => {
      if (!manual) {
        const r = await askExtension<BasketUndoResult>({ protocolo: BASKET_EXTENSION_PROTOCOL, tipo: "deshacer", pedidoId: order.id }, 60_000)
        // Sin extensión en este navegador (otro miembro del hogar, el móvil): se ofrece «Ya lo he quitado yo».
        if (!r) return { manualNeeded: true }
        if (!r.ok) {
          if (r.error === "nada_que_deshacer") return { manualNeeded: true }
          throw new Error(r.error)
        }
      }
      try {
        await api.post<ShopOrder>(`/shop-orders/${order.id}/extension-undo`, { manual: !!manual })
      } catch (err) {
        // Ya estaba deshecho: es un éxito, sin mensaje de error; `onSettled` refresca el pedido.
        if (!alreadyUndone(err)) throw err
      }
      return { manualNeeded: false }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["shop-orders"] }),
  })
}
