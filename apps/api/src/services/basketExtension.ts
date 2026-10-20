/**
 * «Enviar la cesta a la extensión del navegador» (specs/shop-orders.md):
 * quién lo ve, qué se hace con cada resultado que llega y lo que ven los
 * agentes (specs/metrics.md): los huecos de la tabla y un registro por envío,
 * siempre con el nombre recortado (`publicLineName`), nunca texto tecleado.
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm'
import {
  basketBaseName,
  basketMayBeInCart,
  basketSnapshot,
  buyRuleByKey,
  isLiveBasketSend,
  normalizeBuyName,
  type BasketLineOrigin,
  type BasketLineState,
  type BasketSendError,
  type BasketSendResult,
  type BasketSnapshotLine,
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
 * `cesta` es la foto de la cesta que se mandó (`basketSnapshot(order.lines)`):
 * se guarda la clave, el nombre, la elección y el origen de cada línea, para
 * saber qué era cada clave aunque las líneas cambien después.
 */
export function decideBasketResult(
  current: StoredBasketResult | null,
  status: string,
  incoming: BasketSendResult,
  now: Date,
  cesta?: ReadonlyArray<BasketSnapshotLine>,
): BasketDecision {
  if (status !== 'draft' && status !== 'sent') return { action: 'keep' }
  if (incoming.envioId && current?.deshechos?.includes(incoming.envioId)) return { action: 'deshecho' }
  if (incoming.envioId && incoming.envioId === current?.envioId) return { action: 'keep' }
  const live = isLiveBasketSend(current)
  if (live && !basketMayBeInCart(incoming)) return { action: 'keep' }
  const stored: StoredBasketResult = {
    ...incoming,
    recibidoAt: now.toISOString(),
    deshechoAt: null,
    deshechos: current?.deshechos ?? [],
    ...(cesta ? { cesta: cesta.map(snapshotLine) } : {}),
  }
  return { action: 'save', status: basketMayBeInCart(incoming) || status === 'sent' ? 'sent' : 'draft', stored }
}

/** Solo lo de la foto: clave, nombre, elección y, si lo hay, el origen con su `ruleKey`. */
function snapshotLine({ key, name, choice, origen, ruleKey }: BasketSnapshotLine): BasketSnapshotLine {
  return { key, name, choice, ...(origen ? { origen, ruleKey: ruleKey ?? null } : {}) }
}

// ─── Lo que ven los agentes (norma de privacidad: nada tecleado por un hogar) ───

/**
 * Texto que puede llegar a los agentes: hasta `max` caracteres, sin @, sin URLs y sin
 * cifras que parezcan un teléfono. Si no, null (falla cerrado).
 */
export function agentSafeText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  if (!t || t.length > max) return null
  if (/@|https?:|www\.|\d[\d\s.-]{5,}\d/i.test(t)) return null
  return t
}

/** Id de producto de la tienda que puede llegar a los agentes: letras, cifras, «_», «.» o «-»; si no, null. */
export function agentSafeId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_.-]{1,32}$/.test(raw) ? raw : null
}

/**
 * El nombre de una línea de la foto que puede llegar a los agentes:
 * - de una regla de compra: su clave (`ruleKey`), si la regla existe;
 * - de catálogo: el nombre de catálogo, sin « · varias presentaciones», si pasa `agentSafeText`;
 * - si no (tecleado, foto antigua sin origen, regla que ya no existe o nombre raro): null.
 */
export function publicLineName(l: Pick<BasketSnapshotLine, 'name' | 'origen' | 'ruleKey'>): string | null {
  if (l.origen === 'regla') return l.ruleKey && buyRuleByKey(l.ruleKey) ? l.ruleKey : null
  if (l.origen === 'catalogo') return agentSafeText(basketBaseName(l.name), 80)
  return null
}

export interface PublicBasketLine {
  name: string | null
  /** Solo una opción fija de la regla (serrano, dorada…); nunca la que se tecleó. */
  choice: string | null
  /** `tecleado` también cuando el nombre no puede salir (`publicLineName` null). */
  origen: BasketLineOrigin
}

/** La línea tal como la ven los agentes: `publicLineName`, la elección si es una opción de su regla, y el origen. */
export function publicBasketLine(l: Pick<BasketSnapshotLine, 'name' | 'choice' | 'origen' | 'ruleKey'>): PublicBasketLine {
  const name = publicLineName(l)
  if (name === null || !l.origen) return { name: null, choice: null, origen: 'tecleado' }
  return { name, choice: l.origen === 'regla' ? ruleOption(name, l.choice) : null, origen: l.origen }
}

/** La elección escrita como la regla, si es una de sus opciones fijas; si no, null. */
function ruleOption(ruleKey: string, choice: string | null): string | null {
  if (!choice) return null
  const c = normalizeBuyName(choice)
  return buyRuleByKey(ruleKey)?.choice?.options.find((o) => normalizeBuyName(o) === c) ?? null
}

type ExtensionRow = { lines: ShopOrderLine[]; result: StoredBasketResult }

/** La foto de un resultado, por clave: la guardada o, si es de antes de la foto, la de las líneas actuales. */
function snapshotByKey({ lines, result }: ExtensionRow): Map<string, BasketSnapshotLine> {
  return new Map((result.cesta ?? basketSnapshot(lines)).map((b) => [b.key, b]))
}

export interface BasketGap extends PublicBasketLine {
  estado: 'busqueda' | 'fallida'
  productoId: string | null
  producto: string | null
  motivo: 'no_encontrado' | 'no_publicado' | 'error' | null
  veces: number
}

/**
 * Puro: lo que llegó por búsqueda o falló, agrupado por la línea pública
 * (origen, nombre normalizado y elección), producto, estado y motivo. Nunca
 * lleva el texto tecleado ni su búsqueda. Cada clave se lee en la foto de la
 * cesta; los resultados de antes de la foto, en las líneas actuales del
 * pedido. Las claves que ya no están se saltan.
 */
export function aggregateBasketGaps(rows: ExtensionRow[]): BasketGap[] {
  const out = new Map<string, BasketGap>()
  for (const row of rows) {
    const basket = snapshotByKey(row)
    for (const r of row.result.lineas) {
      if (r.estado !== 'busqueda' && r.estado !== 'fallida') continue
      const b = basket.get(r.key)
      if (!b) continue
      const pub = publicBasketLine(b)
      const productoId = agentSafeId(r.productoId)
      const k = JSON.stringify([pub.origen, pub.name && normalizeBuyName(pub.name), pub.choice, productoId, r.estado, r.motivo ?? null])
      const g = out.get(k)
      if (g) g.veces += 1
      else out.set(k, { ...pub, estado: r.estado, productoId, producto: agentSafeText(r.producto, 160), motivo: r.motivo ?? null, veces: 1 })
    }
  }
  return [...out.values()].sort(
    (a, b) => b.veces - a.veces || Number(a.name === null) - Number(b.name === null) || (a.name ?? '').localeCompare(b.name ?? ''),
  )
}

/**
 * Los resultados recibidos en los últimos `days` días, con las líneas de su
 * pedido. Se filtra por `recibidoAt` del resultado guardado, no por
 * `updated_at` del pedido: cualquier cambio posterior en el pedido (editarlo,
 * cerrarlo) lo volvería a meter en la ventana.
 */
async function loadExtensionResults(days: number, db: Db): Promise<ExtensionRow[]> {
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
  return rows.map((r) => ({ lines: r.lines as ShopOrderLine[], result: r.result as StoredBasketResult }))
}

export async function loadBasketGaps(days: number, db: Db = defaultDb): Promise<BasketGap[]> {
  return aggregateBasketGaps(await loadExtensionResults(days, db))
}
