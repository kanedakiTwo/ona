/**
 * Mensajes entre la web de Mimoia y la extensión del navegador que suma la
 * cesta del súper al carro de la cadena (specs/shop-orders.md → «Enviar a la
 * extensión del navegador»). La extensión lleva una copia de estos tipos:
 * cualquier cambio sube `BASKET_EXTENSION_PROTOCOL`.
 */
import { z } from 'zod'
import { basketMayBeInCart } from '../buy/extensionBasket.js'

export const BASKET_EXTENSION_PROTOCOL = 1 as const

export interface BasketLine {
  /** Clave de la línea del pedido (l3) o del grupo de una línea fusionada (l3.2). */
  key: string
  /** Nombre de la lista, sin « · varias presentaciones». */
  name: string
  /** Opción elegida (serrano, dorada…) si la regla la tiene. */
  choice: string | null
  quantity: number
  unit: 'g' | 'ml' | 'u' | 'cda' | 'cdita'
  /**
   * Gramos o ml a comprar. Línea: los de la regla si hay regla (los sugeridos
   * si falta la cantidad); si no, quantity si es g/ml; si no, null. Grupo de
   * una línea fusionada: los de una línea con su cantidad y la regla de la
   * línea (`toOrderQty`, redondeados a la unidad de compra); si no salen, los
   * de su cantidad (`orderQtyInGrams`), o null.
   */
  grams: number | null
  /** Piezas a comprar si la regla es por pieza («1 cabeza de ajos»); si no, null. */
  piezas: number | null
  /** Texto de búsqueda en la tienda: name, más « » + choice si el nombre no la lleva ya. */
  search: string
}

export type BasketMessage =
  | { protocolo: 1; tipo: 'ping' }
  | { protocolo: 1; tipo: 'enviar'; pedidoId: string; lineas: BasketLine[] }
  | { protocolo: 1; tipo: 'deshacer'; pedidoId: string }
  | { protocolo: 1; tipo: 'olvidar'; pedidoId: string }

export interface BasketPing {
  ok: true
  protocolo: 1
  version: string
  /** Hosts de las webs de tienda que sabe llenar (se compara con el host de `shop.webUrl`). */
  hosts: string[]
  /** Nombre de la cadena para el botón («Enviar a …»). */
  etiqueta: string
}

export const BASKET_LINE_STATES = ['tabla', 'busqueda', 'fallida', 'no_verificada'] as const
export type BasketLineState = (typeof BASKET_LINE_STATES)[number]
export const BASKET_SEND_ERRORS = ['sin_zona', 'sin_sesion', 'contrato', 'verificacion', 'red'] as const
export type BasketSendError = (typeof BASKET_SEND_ERRORS)[number]

export const basketSendResultSchema = z
  .object({
    envioId: z.string().max(64),
    ok: z.boolean(),
    error: z.enum(BASKET_SEND_ERRORS).optional(),
    repetido: z.literal(true).optional(),
    lineas: z
      .array(
        z.object({
          key: z.string().min(1).max(16),
          estado: z.enum(BASKET_LINE_STATES),
          productoId: z.string().max(32).optional(),
          producto: z.string().max(160).optional(),
          unidades: z.number().int().min(0).max(999).optional(),
          motivo: z.enum(['no_encontrado', 'no_publicado', 'error']).optional(),
        }),
      )
      .max(200),
    anadidas: z.number().int().min(0).max(200),
    totalEur: z.number().min(0).max(100000).nullable(),
    bajoMinimo: z.boolean(),
    version: z.string().max(32),
    contrato: z.string().max(64),
  })
  // Si puede haber algo en el carro, el envío necesita su id: con él se reconoce un reintento y se deshace.
  .refine((r) => r.envioId !== '' || !basketMayBeInCart(r), {
    message: 'envioId vacío en un envío que puede haber tocado el carro',
    path: ['envioId'],
  })
export type BasketSendResult = z.infer<typeof basketSendResultSchema>

export type BasketUndoResult =
  | { ok: true; restadas: number }
  | { ok: false; error: 'nada_que_deshacer' | 'sin_sesion' | 'contrato' | 'red' }

/** Lo que guarda la API en `shop_orders.extension_result`. */
export interface StoredBasketResult extends BasketSendResult {
  recibidoAt: string
  /** Cuándo se deshizo el envío vivo (null si no). */
  deshechoAt: string | null
  /** envioId de los envíos de este pedido que se deshicieron. */
  deshechos: string[]
  /**
   * La cesta tal como se mandó (clave, nombre y elección de cada línea), para
   * saber qué era cada clave aunque las líneas del pedido cambien después.
   * Falta en los resultados guardados antes de existir.
   */
  cesta?: Array<{ key: string; name: string; choice: string | null }>
}
