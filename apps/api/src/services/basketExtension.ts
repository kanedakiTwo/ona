/**
 * «Enviar la cesta a la extensión del navegador» (specs/shop-orders.md):
 * quién lo ve, qué se hace con cada resultado que llega y el agregado de lo
 * que la extensión no encontró en su tabla (para hacerla crecer).
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { basketMayBeInCart, buildExtensionBasket, type BasketSendResult, type ShopOrderLine, type StoredBasketResult } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { shopOrders, users } from '../db/schema.js'
import { env } from '../config/env.js'

type Db = typeof defaultDb

/** Lista vacía = nadie (al revés que WhatsApp). Entradas: email exacto o `@dominio`. */
export function isBasketExtensionAllowed(email: string | null | undefined, allowed: readonly string[] = env.BASKET_EXTENSION_EMAILS): boolean {
  if (!email || allowed.length === 0) return false
  const e = email.trim().toLowerCase()
  return allowed.some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a))
}

export async function basketExtensionEnabledFor(userId: string, db: Db = defaultDb): Promise<boolean> {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  return isBasketExtensionAllowed(row?.email)
}

export type BasketDecision =
  | { action: 'save'; status: 'draft' | 'sent'; stored: StoredBasketResult }
  | { action: 'keep' }
  | { action: 'deshecho' }

/**
 * Qué hacer con un resultado que llega de la web (spec: «El registro de la
 * extensión» y «Rutas»): nunca pisa un envío bueno con uno vacío, un
 * `repetido` del envío vivo no cambia nada y uno de un envío deshecho se
 * contesta con `deshecho` para que la web empiece un envío nuevo.
 */
export function decideBasketResult(current: StoredBasketResult | null, status: string, incoming: BasketSendResult, now: Date): BasketDecision {
  if (incoming.envioId && current?.deshechos?.includes(incoming.envioId)) return { action: 'deshecho' }
  const live = !!current && basketMayBeInCart(current) && !current.deshechoAt
  // El mismo envío otra vez (repetido, o el POST se reintentó) no cambia nada ni cuenta doble.
  if (live && incoming.envioId && incoming.envioId === current!.envioId) return { action: 'keep' }
  if (live && !basketMayBeInCart(incoming)) return { action: 'keep' }
  const stored: StoredBasketResult = { ...incoming, recibidoAt: now.toISOString(), deshechoAt: null, deshechos: current?.deshechos ?? [] }
  return { action: 'save', status: basketMayBeInCart(incoming) || status === 'sent' ? 'sent' : 'draft', stored }
}

export interface BasketGap {
  name: string
  choice: string | null
  search: string
  estado: 'busqueda' | 'fallida'
  productoId: string | null
  producto: string | null
  veces: number
}

/** Puro: lo que llegó por búsqueda o falló, agrupado por línea de la lista y producto elegido. */
export function aggregateBasketGaps(rows: Array<{ lines: ShopOrderLine[]; result: StoredBasketResult }>): BasketGap[] {
  const out = new Map<string, BasketGap>()
  for (const { lines, result } of rows) {
    const basket = new Map(buildExtensionBasket(lines).map((b) => [b.key, b]))
    for (const r of result.lineas) {
      if (r.estado !== 'busqueda' && r.estado !== 'fallida') continue
      const b = basket.get(r.key)
      if (!b) continue
      const k = [b.name, b.choice ?? '', r.estado, r.productoId ?? ''].join('|')
      const g = out.get(k)
      if (g) g.veces += 1
      else out.set(k, { name: b.name, choice: b.choice, search: b.search, estado: r.estado, productoId: r.productoId ?? null, producto: r.producto ?? null, veces: 1 })
    }
  }
  return [...out.values()].sort((a, b) => b.veces - a.veces || a.name.localeCompare(b.name))
}

/**
 * Los resultados recibidos en los últimos `days` días. Manda `recibidoAt` del
 * resultado guardado, no `updated_at`: cualquier otro cambio en el pedido no
 * lo vuelve a meter en la ventana.
 */
export async function loadBasketGaps(days: number, db: Db = defaultDb): Promise<BasketGap[]> {
  const rows = await db
    .select({ lines: shopOrders.lines, result: shopOrders.extensionResult })
    .from(shopOrders)
    .where(
      and(
        isNotNull(shopOrders.extensionResult),
        sql`(${shopOrders.extensionResult}->>'recibidoAt')::timestamptz >= now() - make_interval(days => ${days})`,
      ),
    )
  return aggregateBasketGaps(rows.map((r) => ({ lines: r.lines as ShopOrderLine[], result: r.result as StoredBasketResult })))
}
