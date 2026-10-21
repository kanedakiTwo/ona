/**
 * «Enviar la cesta a la extensión del navegador» (specs/shop-orders.md):
 * quién lo ve, qué se hace con cada resultado que llega y lo que ven los
 * agentes (specs/metrics.md): los huecos de la tabla y un registro por envío,
 * siempre con el nombre recortado (`publicLineName`), nunca texto tecleado.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
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
import { recipeIngredients, recipes, shopOrders, users } from '../db/schema.js'
import { env } from '../config/env.js'
import { madridParts } from './madridTime.js'

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
 * `cesta` (opcional) es la foto de la cesta que se mandó (`basketSnapshot` de las
 * líneas del pedido, con `ingredientsInSystemRecipes`): se guarda la clave, el
 * nombre, la elección y el origen de cada línea, para saber qué era cada clave
 * aunque las líneas cambien después. `saveBasketResult` no la pasa: decide antes
 * y, solo si guarda, la añade con `withBasketPhoto`.
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
  }
  return { action: 'save', status: basketMayBeInCart(incoming) || status === 'sent' ? 'sent' : 'draft', stored: cesta ? withBasketPhoto(stored, cesta) : stored }
}

/**
 * El resultado con la foto de la cesta (solo clave, nombre, elección y origen de cada línea).
 * `saveBasketResult` la añade después de decidir, para no hacer la consulta de la foto
 * (`ingredientsInSystemRecipes`) cuando no se guarda.
 */
export function withBasketPhoto(stored: StoredBasketResult, cesta: ReadonlyArray<BasketSnapshotLine>): StoredBasketResult {
  return { ...stored, cesta: cesta.map(snapshotLine) }
}

/** Solo lo de la foto: clave, nombre, elección y, si lo hay, el origen con su `ruleKey`. */
function snapshotLine({ key, name, choice, origen, ruleKey }: BasketSnapshotLine): BasketSnapshotLine {
  return { key, name, choice, ...(origen ? { origen, ruleKey: ruleKey ?? null } : {}) }
}

// ─── Lo que ven los agentes (norma de privacidad: nada tecleado por un hogar) ───

/**
 * Lo único que puede llevar un texto para los agentes, ya normalizado (`agentNormalize`): letras
 * del alfabeto latino, cifras y `, . ' ( ) % / + · × & ° € -`. Ni `:`, `!`, `¡`, comillas dobles,
 * `@`, saltos de línea, caracteres de control ni letras de otros alfabetos (una «c» cirílica o un
 * signo lisu que imitan a «c» y a «.»).
 */
const AGENT_TEXT = /^[\p{Script=Latin}0-9 ,.'()%/+·×&°€-]+$/u
/** Algo con forma de dominio, con o sin `www`: letra o cifra, punto y dos letras o más («lucia.eu», «bit.ly/abc»). */
const AGENT_DOMAIN = /[\p{L}\p{N}]\.\p{L}{2,}/u
/** 9 cifras o más pueden ser un teléfono, separadas como sea («600,123,456», «600/12/34/56»). */
const tooManyDigits = (t: string) => (t.match(/[0-9]/g) ?? []).length >= 9

/**
 * Comillas y rayas tipográficas a las del teclado (`\u2018 \u2019 \u02BC` → `'`, `\u2013 \u2014` → `-`) y
 * NFKC: «＠» o «６００» de ancho completo pasan a «@» y «600», y una letra con su tilde por separado
 * (NFD), a una sola.
 */
function agentNormalize(t: string): string {
  return t.replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u2013\u2014]/g, '-').normalize('NFKC')
}

/**
 * Texto que puede llegar a los agentes (nombre de catálogo, producto de la tienda): una lista
 * blanca (`AGENT_TEXT`) mirada sobre el texto normalizado, hasta `max` caracteres, sin `www`,
 * dominios ni 9 cifras o más. Si pasa, sale el texto tal cual (conserva «º»); si no, null (falla
 * cerrado). No para un nombre de persona con forma de comida («Tarta de la abuela Carmen»): eso
 * lo para el origen (`ingredientsInSystemRecipes`).
 */
export function agentSafeText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  const n = agentNormalize(t)
  if (!t || t.length > max || n.length > max) return null
  if (!AGENT_TEXT.test(n)) return null
  if (/www\./i.test(n) || AGENT_DOMAIN.test(n) || tooManyDigits(n)) return null
  return t
}

/**
 * Id de producto de la tienda que puede llegar a los agentes: letras, cifras, «_», «.» o «-», hasta
 * 32, y menos de 9 cifras (los de la tienda tienen 4 o 5; con 9 podría ser un teléfono). Si no, null.
 */
export function agentSafeId(raw: unknown): string | null {
  return typeof raw === 'string' && /^[A-Za-z0-9_.-]{1,32}$/.test(raw) && !tooManyDigits(raw) ? raw : null
}

/**
 * El nombre de una línea de la foto que puede llegar a los agentes:
 * - de una regla de compra: su clave (`ruleKey`), si la regla existe;
 * - de catálogo (un ingrediente de alguna receta del sistema, lo decide `saveBasketResult`): el
 *   nombre de catálogo, sin « · varias presentaciones», si pasa `agentSafeText`;
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Los ingredientes de `ids` que salen en alguna receta del sistema (`recipes.author_id` nulo).
 * Ojo: `author_id` es `on delete set null`, así que el criterio depende de que
 * `services/accountDeletion.ts` borre las recetas del usuario antes de borrar su cuenta; si dejara
 * de hacerlo, una receta de usuario pasaría por receta del sistema. Solo esos ingredientes cuentan
 * como `catalogo` en la foto de la cesta: un ingrediente que creó un usuario (`POST
 * /ingredients/auto-create`, el importador de recetas) puede llevar su texto. Lo usa
 * `saveBasketResult` al guardar, dentro de su transacción. Un id que no es un uuid no puede estar
 * en una receta: no se pregunta.
 */
export async function ingredientsInSystemRecipes(ids: readonly string[], db: Pick<Db, 'select'>): Promise<Set<string>> {
  const uuids = [...new Set(ids.filter((id) => UUID.test(id)))]
  if (uuids.length === 0) return new Set()
  const rows = await db
    .select({ id: recipeIngredients.ingredientId })
    .from(recipeIngredients)
    .innerJoin(recipes, eq(recipeIngredients.recipeId, recipes.id))
    .where(and(inArray(recipeIngredients.ingredientId, uuids), isNull(recipes.authorId)))
    .groupBy(recipeIngredients.ingredientId)
  return new Set(rows.map((r) => r.id))
}

type ExtensionRow = { lines: ShopOrderLine[]; result: StoredBasketResult }

/**
 * La foto de un resultado, por clave: la guardada o, si es de antes de la foto, la de las líneas
 * actuales, donde solo cuentan las reglas (no se comprobó al guardar si cada ingrediente sale en
 * una receta del sistema: el resto, `tecleado`).
 */
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

export interface BasketSendForAgents {
  /** `recibidoAt` del resultado. */
  fecha: string
  ok: boolean
  error: BasketSendError | null
  anadidas: number
  deshecho: boolean
  /** null si la versión de la extensión no lo manda. */
  duracionMs: number | null
  lineas: Array<
    PublicBasketLine & {
      estado: BasketLineState
      motivo: 'no_encontrado' | 'no_publicado' | 'error' | null
      producto: string | null
      unidades: number | null
    }
  >
}

/**
 * Puro: un registro por resultado guardado, del más reciente al más antiguo:
 * fecha, ok, error, añadidas, deshecho, duración y cada línea pública con su
 * estado, motivo, producto de la tienda y unidades. Sin hogar, usuario,
 * `envioId`, total del carro ni texto tecleado. Una clave que ya no está en la
 * foto ni en las líneas sale como `tecleado`.
 */
export function basketSendsForAgents(rows: ExtensionRow[]): BasketSendForAgents[] {
  return rows
    .map((row) => {
      const { result } = row
      const basket = snapshotByKey(row)
      return {
        fecha: result.recibidoAt,
        ok: result.ok,
        error: result.error ?? null,
        anadidas: result.anadidas,
        deshecho: !!result.deshechoAt,
        duracionMs: result.duracionMs ?? null,
        lineas: result.lineas.map((r) => {
          const b = basket.get(r.key)
          return {
            ...(b ? publicBasketLine(b) : { name: null, choice: null, origen: 'tecleado' as const }),
            estado: r.estado,
            motivo: r.motivo ?? null,
            producto: agentSafeText(r.producto, 160),
            unidades: r.unidades ?? null,
          }
        }),
      }
    })
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
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

export async function loadBasketSends(days: number, db: Db = defaultDb): Promise<BasketSendForAgents[]> {
  return basketSendsForAgents(await loadExtensionResults(days, db))
}

// ─── Lo que ve el token de métricas (PRO-322, norma 12.3) ────────

/** Producto de la tienda que puede llegar al token: hasta 80 caracteres y 12 palabras. */
export const TOKEN_PRODUCT_MAX_CHARS = 80
export const TOKEN_PRODUCT_MAX_WORDS = 12

/**
 * El producto de la tienda para el token de métricas: el de `agentSafeText` (ya pasó la lista
 * blanca), y además como mucho 80 caracteres y 12 palabras; si no, null y `filtrado` (un texto
 * largo con letras y signos puede llevar instrucciones). Sin producto, null sin contarlo.
 */
export function tokenProducto(raw: string | null): { producto: string | null; filtrado: boolean } {
  if (raw == null) return { producto: null, filtrado: false }
  const words = raw.trim().split(/\s+/).filter(Boolean).length
  const ok = raw.length <= TOKEN_PRODUCT_MAX_CHARS && words <= TOKEN_PRODUCT_MAX_WORDS
  return ok ? { producto: raw, filtrado: false } : { producto: null, filtrado: true }
}

/** Fecha ISO → día en Europe/Madrid (`AAAA-MM-DD`); lo que no es una fecha, null. */
export function tokenDay(iso: string): string | null {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : madridParts(d).isoDate
}

export interface BasketSendForToken extends Omit<BasketSendForAgents, 'fecha'> {
  /** Día del envío en Europe/Madrid, sin hora. */
  fecha: string | null
}

/**
 * GET /admin/extension-sends con el token de métricas (no con la sesión de admin): la fecha solo
 * por día y el producto acotado (`tokenProducto`), con cuántos se quitaron (`productosFiltrados`).
 */
export function basketSendsForToken(sends: BasketSendForAgents[]): { sends: BasketSendForToken[]; productosFiltrados: number } {
  let productosFiltrados = 0
  const out = sends.map((s) => ({
    ...s,
    fecha: tokenDay(s.fecha),
    lineas: s.lineas.map((l) => {
      const p = tokenProducto(l.producto)
      if (p.filtrado) productosFiltrados++
      return { ...l, producto: p.producto }
    }),
  }))
  return { sends: out, productosFiltrados }
}

/** GET /admin/extension-gaps con el token de métricas: el producto acotado igual que en los envíos. */
export function basketGapsForToken(gaps: BasketGap[]): { gaps: BasketGap[]; productosFiltrados: number } {
  let productosFiltrados = 0
  const out = gaps.map((g) => {
    const p = tokenProducto(g.producto)
    if (p.filtrado) productosFiltrados++
    return { ...g, producto: p.producto }
  })
  return { gaps: out, productosFiltrados }
}
