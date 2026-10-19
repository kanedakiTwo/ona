/**
 * «Enviar la cesta a la extensión del navegador» (specs/shop-orders.md):
 * quién lo ve, qué se hace con cada resultado que llega y el agregado de lo
 * que la extensión no encontró en su tabla (para hacerla crecer).
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import {
  basketMayBeInCart,
  basketSearch,
  buildExtensionBasket,
  extensionKey,
  type BasketLine,
  type BasketSendResult,
  type ShopOrderLine,
  type StoredBasketResult,
} from '@ona/shared'
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
 * extensión» y «Rutas»):
 * - un pedido que no está en `draft` ni en `sent` no se toca;
 * - uno de un envío deshecho se contesta con `deshecho`, para que la web
 *   empiece un envío nuevo;
 * - el mismo `envioId` otra vez (un `repetido` o un POST reintentado) no
 *   cambia nada ni cuenta doble, esté vivo el guardado o no;
 * - nunca pisa un envío vivo con uno sin nada en el carro.
 *
 * `cesta` es la cesta que se mandó, la de `buildExtensionBasket(order.lines)`:
 * se guarda su clave, nombre y elección para que el agregado de huecos sepa
 * qué era cada clave aunque las líneas cambien después.
 */
export function decideBasketResult(
  current: StoredBasketResult | null,
  status: string,
  incoming: BasketSendResult,
  now: Date,
  cesta?: ReadonlyArray<Pick<BasketLine, 'key' | 'name' | 'choice'>>,
): BasketDecision {
  if (status !== 'draft' && status !== 'sent') return { action: 'keep' }
  if (incoming.envioId && current?.deshechos?.includes(incoming.envioId)) return { action: 'deshecho' }
  if (incoming.envioId && incoming.envioId === current?.envioId) return { action: 'keep' }
  const live = !!current && basketMayBeInCart(current) && !current.deshechoAt
  if (live && !basketMayBeInCart(incoming)) return { action: 'keep' }
  const stored: StoredBasketResult = {
    ...incoming,
    recibidoAt: now.toISOString(),
    deshechoAt: null,
    deshechos: current?.deshechos ?? [],
    ...(cesta ? { cesta: cesta.map(({ key, name, choice }) => ({ key, name, choice })) } : {}),
  }
  return { action: 'save', status: basketMayBeInCart(incoming) || status === 'sent' ? 'sent' : 'draft', stored }
}

export interface BasketGap {
  name: string
  choice: string | null
  search: string
  estado: 'busqueda' | 'fallida'
  productoId: string | null
  producto: string | null
  motivo: 'no_encontrado' | 'no_publicado' | 'error' | null
  veces: number
}

/**
 * Puro: lo que llegó por búsqueda o falló, agrupado por producto de la lista
 * (`extensionKey`: «Detergente» y «detergente» van juntos; se muestra el primer
 * nombre visto), producto elegido, estado y motivo. Cada clave se lee en la
 * foto de la cesta guardada con el resultado; los resultados de antes de la
 * foto, en las líneas actuales del pedido. Las claves que ya no están se saltan.
 */
export function aggregateBasketGaps(rows: Array<{ lines: ShopOrderLine[]; result: StoredBasketResult }>): BasketGap[] {
  const out = new Map<string, BasketGap>()
  for (const { lines, result } of rows) {
    const sent: ReadonlyArray<Pick<BasketLine, 'key' | 'name' | 'choice'>> = result.cesta ?? buildExtensionBasket(lines)
    const basket = new Map(sent.map((b) => [b.key, b]))
    for (const r of result.lineas) {
      if (r.estado !== 'busqueda' && r.estado !== 'fallida') continue
      const b = basket.get(r.key)
      if (!b) continue
      const k = [extensionKey(b.name, b.choice), r.productoId ?? '', r.estado, r.motivo ?? ''].join('|')
      const g = out.get(k)
      if (g) g.veces += 1
      else
        out.set(k, {
          name: b.name,
          choice: b.choice,
          search: basketSearch(b.name, b.choice),
          estado: r.estado,
          productoId: r.productoId ?? null,
          producto: r.producto ?? null,
          motivo: r.motivo ?? null,
          veces: 1,
        })
    }
  }
  return [...out.values()].sort((a, b) => b.veces - a.veces || a.name.localeCompare(b.name))
}

export async function loadBasketGaps(days: number, db: Db = defaultDb): Promise<BasketGap[]> {
  const rows = await db
    .select({ lines: shopOrders.lines, result: shopOrders.extensionResult })
    .from(shopOrders)
    .where(
      and(
        isNotNull(shopOrders.extensionResult),
        // Solo se castea lo que tiene forma de fecha ISO: un valor raro deja fuera la fila, no tumba la consulta.
        sql`(case when ${shopOrders.extensionResult}->>'recibidoAt' ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}' then (${shopOrders.extensionResult}->>'recibidoAt')::timestamptz end) >= now() - make_interval(days => ${days})`,
      ),
    )
  return aggregateBasketGaps(rows.map((r) => ({ lines: r.lines as ShopOrderLine[], result: r.result as StoredBasketResult })))
}
