/**
 * Shops + shop orders persistence (specs/shop-orders.md). Everything is
 * household-scoped through the caller's primary household — any member can
 * manage the shops and the orders, same model as staples and the pantry.
 *
 * Order lifecycle:
 *   draft ──(user sends Mimoia's message)──▶ sent ──(shop reply pasted/forwarded)──▶ quoted
 *   quoted ──(user approves)──▶ approved ──(paid/collected)──▶ closed
 *   any open state ──▶ cancelled; web/phone shops go draft/sent ──▶ closed.
 * A reply can also be registered straight from `draft` (the user sent the
 * message but never tapped "enviado").
 */

import { randomBytes } from 'crypto'
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import { normalizeBuyName, resolveBuyRule, splitCompound } from '@ona/shared'
import type {
  BuyableUnit,
  DeliveryCheck,
  ShopFulfilment,
  QuoteSummary,
  Shop,
  ShopInput,
  ShopKind,
  ShopOrder,
  ShopOrderLine,
  ShopOrderStatus,
  ShopSnapshot,
  ShoppingItem,
  LineDecision,
} from '@ona/shared'
import { db as defaultDb } from '../../db/connection.js'
import { householdBuyPrefs, householdShops, shopOrders, shoppingLists } from '../../db/schema.js'
import { env } from '../../config/env.js'
import { getPrimaryHouseholdId } from '../scopeResolver.js'
import type { PriceMemory } from './estimate.js'
import { capForLines, draftOrdersFromItems, sumEstimate } from './draft.js'
import {
  buildConfirmationMessage,
  buildOrderMessage,
  isTooLongToPrefill,
  mailtoLink,
  shopSearchUrl,
  waLink,
} from './message.js'
import { assessQuote } from './validation.js'
import { buildLine, inputOf } from './lines.js'
import { capitalize, prettyName } from './format.js'
import { parseShopReply, type ParsedReply } from './quoteParser.js'

type Db = typeof defaultDb
type ShopRow = typeof householdShops.$inferSelect
type OrderRow = typeof shopOrders.$inferSelect

export class ShopOrderError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ShopOrderError'
    this.status = status
    this.code = code
  }
}

const OPEN_STATUSES: ShopOrderStatus[] = ['draft', 'sent', 'quoted', 'approved']

async function householdOf(userId: string, db: Db): Promise<string> {
  const hh = await getPrimaryHouseholdId(userId, db)
  if (!hh) throw new ShopOrderError(400, 'NO_HOUSEHOLD', 'Tu cuenta aún no tiene un hogar asignado.')
  return hh
}

// ─── Shops ───────────────────────────────────────────────────────

function toShop(r: ShopRow): Shop {
  return {
    id: r.id,
    householdId: r.householdId,
    name: r.name,
    kind: r.kind as Shop['kind'],
    channel: r.channel as Shop['channel'],
    whatsapp: r.whatsapp,
    email: r.email,
    webUrl: r.webUrl,
    phone: r.phone,
    customerName: r.customerName,
    fulfilment: r.fulfilment as Shop['fulfilment'],
    address: r.address,
    notes: r.notes,
    deliveryMinEur: r.deliveryMinEur ?? null,
    deliveryFeeEur: r.deliveryFeeEur ?? null,
    position: r.position,
    createdAt: r.createdAt.toISOString(),
  }
}

async function shopRows(householdId: string, db: Db): Promise<ShopRow[]> {
  return db.select().from(householdShops).where(eq(householdShops.householdId, householdId)).orderBy(asc(householdShops.position), asc(householdShops.createdAt))
}

export async function listShops(userId: string, db: Db = defaultDb): Promise<Shop[]> {
  const hh = await getPrimaryHouseholdId(userId, db)
  if (!hh) return []
  return (await shopRows(hh, db)).map(toShop)
}

function shopValues(input: Partial<ShopInput>) {
  const v: Partial<typeof householdShops.$inferInsert> = {}
  if (input.name !== undefined) v.name = input.name
  if (input.kind !== undefined) v.kind = input.kind
  if (input.channel !== undefined) v.channel = input.channel
  if (input.whatsapp !== undefined) v.whatsapp = input.whatsapp
  if (input.email !== undefined) v.email = input.email
  if (input.webUrl !== undefined) v.webUrl = input.webUrl
  if (input.phone !== undefined) v.phone = input.phone
  if (input.customerName !== undefined) v.customerName = input.customerName
  if (input.fulfilment !== undefined) v.fulfilment = input.fulfilment
  if (input.address !== undefined) v.address = input.address
  if (input.notes !== undefined) v.notes = input.notes
  if (input.deliveryMinEur !== undefined) v.deliveryMinEur = input.deliveryMinEur
  if (input.deliveryFeeEur !== undefined) v.deliveryFeeEur = input.deliveryFeeEur
  return v
}

export async function addShop(userId: string, input: ShopInput, db: Db = defaultDb): Promise<Shop> {
  const hh = await householdOf(userId, db)
  const existing = await shopRows(hh, db)
  if (existing.length >= 20) throw new ShopOrderError(400, 'TOO_MANY_SHOPS', 'Máximo 20 tiendas por hogar.')
  const [row] = await db
    .insert(householdShops)
    .values({ ...(shopValues(input) as typeof householdShops.$inferInsert), householdId: hh, position: existing.length })
    .returning()
  return toShop(row)
}

export async function patchShop(userId: string, id: string, input: Partial<ShopInput>, db: Db = defaultDb): Promise<Shop | null> {
  const hh = await householdOf(userId, db)
  const [row] = await db
    .update(householdShops)
    .set({ ...shopValues(input), updatedAt: new Date() })
    .where(and(eq(householdShops.id, id), eq(householdShops.householdId, hh)))
    .returning()
  return row ? toShop(row) : null
}

export async function deleteShop(userId: string, id: string, db: Db = defaultDb): Promise<boolean> {
  const hh = await householdOf(userId, db)
  // Drafts for that shop go with it; sent/closed orders keep their snapshot.
  await db.delete(shopOrders).where(and(eq(shopOrders.shopId, id), eq(shopOrders.householdId, hh), eq(shopOrders.status, 'draft')))
  const rows = await db.delete(householdShops).where(and(eq(householdShops.id, id), eq(householdShops.householdId, hh))).returning({ id: householdShops.id })
  return rows.length > 0
}

// ─── Orders: presentation ────────────────────────────────────────

function snapshotOf(shop: ShopRow): ShopSnapshot {
  return {
    name: shop.name,
    kind: shop.kind as ShopKind,
    channel: shop.channel as ShopSnapshot['channel'],
    whatsapp: shop.whatsapp,
    email: shop.email,
    webUrl: shop.webUrl,
    phone: shop.phone,
    deliveryMinEur: shop.deliveryMinEur ?? null,
    deliveryFeeEur: shop.deliveryFeeEur ?? null,
  }
}

// ─── Household choices ("jamón → serrano") ──────────────────────

export async function loadPrefs(householdId: string, db: Db = defaultDb): Promise<Record<string, string>> {
  const rows = await db.select().from(householdBuyPrefs).where(eq(householdBuyPrefs.householdId, householdId))
  return Object.fromEntries(rows.map((r) => [r.ruleKey, r.choice]))
}

async function savePref(householdId: string, ruleKey: string, choice: string, db: Db) {
  await db
    .insert(householdBuyPrefs)
    .values({ householdId, ruleKey, choice })
    .onConflictDoUpdate({ target: [householdBuyPrefs.householdId, householdBuyPrefs.ruleKey], set: { choice, updatedAt: new Date() } })
}

/** Why an order can't be sent yet — shown on the card and in chat; links stay null meanwhile. */
export function orderBlockers(lines: ShopOrderLine[], fulfilment: ShopFulfilment, address: string | null): string[] {
  const out: string[] = []
  for (const l of lines) {
    if (l.included === false) continue
    const name = capitalize(prettyName(l.name))
    if (l.needsChoice) out.push(`${name}: ${l.needsChoice.question}`)
    if (l.needsQuantity) out.push(`${name}: ¿cuánto? (por ejemplo ${l.needsQuantity.suggestion})`)
  }
  if (fulfilment === 'domicilio' && !address) out.push('Falta la dirección de entrega')
  return out
}

/** Home delivery minimum vs the estimate; honest when most of the basket has no price. */
export function deliveryCheck(lines: ShopOrderLine[], fulfilment: ShopFulfilment, shop: ShopSnapshot): DeliveryCheck | null {
  if (fulfilment !== 'domicilio') return null
  const live = lines.filter((l) => l.included !== false)
  const priced = live.filter((l) => l.estimateEur != null).length
  const estimate = sumEstimate(live)
  const min = shop.deliveryMinEur ?? null
  return {
    minEur: min,
    feeEur: shop.deliveryFeeEur ?? null,
    estimateEur: estimate,
    confident: live.length > 0 && priced / live.length >= 0.7,
    shortByEur: min != null && estimate != null ? Math.max(0, Math.round((min - estimate) * 100) / 100) : null,
  }
}

function contactLink(shop: ShopSnapshot, text: string | null, subject: string): string | null {
  switch (shop.channel) {
    case 'whatsapp':
      if (!shop.whatsapp) return null
      return text && !isTooLongToPrefill(text) ? waLink(shop.whatsapp, text) : `https://wa.me/${shop.whatsapp}`
    case 'email':
      return shop.email ? mailtoLink(shop.email, subject, text ?? '') : null
    case 'web':
      return shop.webUrl
    case 'telefono':
      return shop.phone ? `tel:+${shop.phone}` : null
  }
}

export function presentOrder(r: OrderRow): ShopOrder {
  const shop = r.shopSnapshot as ShopSnapshot
  const lines = r.lines as ShopOrderLine[]
  const messaging = shop.channel === 'whatsapp' || shop.channel === 'email'
  const fulfilment: ShopFulfilment = r.fulfilment === 'domicilio' ? 'domicilio' : 'recoger'
  const blockers = r.status === 'draft' ? orderBlockers(lines, fulfilment, r.address ?? null) : []
  const searchLinks: Record<string, string> = {}
  if (shop.channel === 'web') {
    for (const l of lines) {
      const url = shopSearchUrl(shop.webUrl, l.eci ?? l.name)
      if (url) searchLinks[l.key] = url
    }
  }
  const blocked = blockers.length > 0 && shop.channel !== 'web'
  return {
    id: r.id,
    shopId: r.shopId,
    shop,
    status: r.status as ShopOrderStatus,
    lines,
    estimateEur: r.estimateEur,
    capEur: r.capEur,
    messageText: r.messageText,
    shopReplyText: r.shopReplyText,
    quoteSummary: (r.quoteSummary as QuoteSummary | null) ?? null,
    confirmationText: r.confirmationText,
    finalTotalEur: r.finalTotalEur,
    links: {
      order: blocked ? null : contactLink(shop, r.messageText, 'Pedido'),
      confirmation: r.confirmationText && messaging ? contactLink(shop, r.confirmationText, 'Re: Pedido') : null,
      shortOrder: messaging && !blocked ? `${env.WEB_PUBLIC_URL}/c/${r.token}` : null,
      shortConfirmation: r.confirmationText && messaging ? `${env.WEB_PUBLIC_URL}/c/${r.token}?m=ok` : null,
      tooLong: messaging && isTooLongToPrefill(r.messageText),
    },
    fulfilment,
    address: r.address ?? null,
    blockers,
    delivery: deliveryCheck(lines, fulfilment, shop),
    searchLinks,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
    quotedAt: r.quotedAt?.toISOString() ?? null,
    approvedAt: r.approvedAt?.toISOString() ?? null,
    closedAt: r.closedAt?.toISOString() ?? null,
  }
}

/** Public short link → the wa.me / mailto it stands for. No side effects: link previews fetch it. */
export async function resolveShortLink(token: string, which: 'order' | 'confirmation', db: Db = defaultDb): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null
  const [row] = await db.select().from(shopOrders).where(eq(shopOrders.token, token)).limit(1)
  if (!row || row.status === 'cancelled' || row.status === 'closed') return null
  const o = presentOrder(row)
  // Only messaging links: a web shop's URL is user-typed and must not turn
  // Mimoia's domain into an open redirect.
  if (o.shop.channel !== 'whatsapp' && o.shop.channel !== 'email') return null
  return which === 'confirmation' ? o.links.confirmation : o.links.order
}

// ─── Orders: lifecycle ───────────────────────────────────────────

async function loadOrder(userId: string, id: string, db: Db): Promise<{ row: OrderRow; householdId: string }> {
  const hh = await householdOf(userId, db)
  const [row] = await db.select().from(shopOrders).where(and(eq(shopOrders.id, id), eq(shopOrders.householdId, hh))).limit(1)
  if (!row) throw new ShopOrderError(404, 'NOT_FOUND', 'Pedido no encontrado.')
  return { row, householdId: hh }
}

function requireStatus(row: OrderRow, allowed: ShopOrderStatus[], what: string) {
  if (!allowed.includes(row.status as ShopOrderStatus)) {
    throw new ShopOrderError(409, 'BAD_STATUS', `No se puede ${what}: el pedido está ${row.status}.`)
  }
}

async function update(id: string, values: Partial<typeof shopOrders.$inferInsert>, db: Db): Promise<ShopOrder> {
  const [row] = await db.update(shopOrders).set({ ...values, updatedAt: new Date() }).where(eq(shopOrders.id, id)).returning()
  return presentOrder(row)
}

export async function listOrders(userId: string, opts: { includeClosed?: boolean } = {}, db: Db = defaultDb): Promise<ShopOrder[]> {
  const hh = await getPrimaryHouseholdId(userId, db)
  if (!hh) return []
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const statuses: ShopOrderStatus[] = opts.includeClosed ? [...OPEN_STATUSES, 'closed'] : OPEN_STATUSES
  const rows = await db
    .select()
    .from(shopOrders)
    .where(and(eq(shopOrders.householdId, hh), inArray(shopOrders.status, statuses), gte(shopOrders.createdAt, since)))
    .orderBy(desc(shopOrders.createdAt))
  return rows.map(presentOrder)
}

export async function getOrder(userId: string, id: string, db: Db = defaultDb): Promise<ShopOrder> {
  return presentOrder((await loadOrder(userId, id, db)).row)
}

/** The order in the customer's voice; `customerName` is null when the shop was deleted meanwhile. */
function messageFor(
  customerName: string | null,
  shop: Pick<ShopSnapshot, 'kind' | 'channel'>,
  lines: ShopOrderLine[],
  fulfilment: ShopFulfilment,
  address: string | null,
): string {
  return buildOrderMessage({ kind: shop.kind, channel: shop.channel, customerName, fulfilment, address, lines })
}

const identity = (l: ShopOrderLine) => l.ruleKey ?? `name:${normalizeBuyName(l.name)}`
const sourcesOf = (l: ShopOrderLine) => l.sourceItemIds ?? (l.sourceItemId ? [l.sourceItemId] : [])

/**
 * Pure: fresh draft lines + the previous drafts → lines that keep the user's
 * edits (added products, picks, amounts, ticks, notes) and their delivery.
 */
export function carryDraftEdits(
  fresh: Array<{ shopId: string; kind: ShopKind; lines: ShopOrderLine[]; priceMemory: PriceMemory }>,
  old: Array<{ shopId: string; lines: ShopOrderLine[]; fulfilment: string | null; address: string | null }>,
  shops: Array<{ id: string; kind: ShopKind; priceMemory: PriceMemory }>,
  prefs: Record<string, string>,
): Array<{ shopId: string; lines: ShopOrderLine[]; fulfilment: string | null; address: string | null }> {
  const out = new Map(fresh.map((f) => [f.shopId, { shopId: f.shopId, lines: [...f.lines], fulfilment: null as string | null, address: null as string | null }]))
  for (const o of old) {
    const shop = shops.find((s) => s.id === o.shopId)
    if (!shop) continue
    let target = out.get(o.shopId)
    if (!target) {
      target = { shopId: o.shopId, lines: [], fulfilment: null, address: null }
      out.set(o.shopId, target)
    }
    target.fulfilment = o.fulfilment
    target.address = o.address
    const edited = new Map(o.lines.filter((l) => sourcesOf(l).length).map((l) => [identity(l), l]))
    target.lines = target.lines.map((l) => {
      const prev = edited.get(identity(l))
      if (!prev) return l
      const input = inputOf(l)
      if (prev.choice && !prev.needsChoice) input.choice = prev.choice
      if (prev.quantitySource === 'user' && l.quantitySource === 'default') {
        input.quantity = prev.quantity
        input.unit = prev.unit
        input.quantitySource = 'user'
      }
      if (prev.maybeHave && prev.included !== undefined) input.included = prev.included
      if (prev.note) input.note = prev.note
      return buildLine(input, shop.kind, prefs, shop.priceMemory)
    })
    for (const added of o.lines.filter((l) => !sourcesOf(l).length)) {
      const key = `l${target.lines.reduce((m, l) => Math.max(m, Number(l.key.replace(/\D/g, '')) || 0), 0) + 1}`
      target.lines.push(buildLine({ ...inputOf(added), key }, shop.kind, prefs, shop.priceMemory))
    }
  }
  return [...out.values()]
}

/** The household's delivery address: this shop's, else any other shop's. */
function addressFor(shop: Pick<ShopRow, 'address'> | null, all: ShopRow[]): string | null {
  return shop?.address ?? all.find((s) => s.address)?.address ?? null
}

export interface PrepareResult {
  orders: ShopOrder[]
  unassigned: Array<{ name: string; quantity: number; unit: string; kind: ShopKind }>
  skipped: Array<{ name: string; reason: string }>
  /** Pantry staples the recipes use and Mimoia assumed at home ("¿Te falta algo de esto?"). */
  pantry: string[]
  hasShops: boolean
}

/**
 * Draft one order per shop from the user's current shopping list. Replaces
 * the household's previous drafts; never touches orders already sent, and
 * leaves out items that are already in one of them (no double ordering).
 */
export async function prepareOrders(userId: string, opts: { listId?: string } = {}, db: Db = defaultDb): Promise<PrepareResult> {
  const hh = await householdOf(userId, db)
  const shops = await shopRows(hh, db)
  const listWhere = opts.listId
    ? and(eq(shoppingLists.id, opts.listId), eq(shoppingLists.userId, userId))
    : eq(shoppingLists.userId, userId)
  const [list] = await db.select().from(shoppingLists).where(listWhere).orderBy(desc(shoppingLists.createdAt)).limit(1)
  const items = ((list?.items as ShoppingItem[] | undefined) ?? [])

  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000)
  const active = await db
    .select({ lines: shopOrders.lines })
    .from(shopOrders)
    .where(and(eq(shopOrders.householdId, hh), inArray(shopOrders.status, ['sent', 'quoted', 'approved']), gte(shopOrders.createdAt, since)))
  const alreadyOrdered = new Set(
    active.flatMap((o) => (o.lines as ShopOrderLine[]).flatMap((l) => l.sourceItemIds ?? (l.sourceItemId ? [l.sourceItemId] : []))),
  )
  const prefs = await loadPrefs(hh, db)

  const draft = draftOrdersFromItems(
    items,
    shops.map((s) => ({ ...s, kind: s.kind as ShopKind, priceMemory: (s.priceMemory ?? {}) as PriceMemory })),
    { alreadyOrdered, prefs },
  )

  // Re-preparing keeps what the user did on the drafts: added products,
  // picks, amounts, ticks, notes, pickup/delivery and address.
  const oldDrafts = await db.select().from(shopOrders).where(and(eq(shopOrders.householdId, hh), eq(shopOrders.status, 'draft')))
  const carried = carryDraftEdits(
    draft.byShop.map((g) => ({ shopId: g.shop.id, kind: g.kind, lines: g.lines, priceMemory: g.shop.priceMemory })),
    oldDrafts.filter((o) => o.shopId).map((o) => ({ shopId: o.shopId!, lines: o.lines as ShopOrderLine[], fulfilment: o.fulfilment, address: o.address })),
    shops.map((s) => ({ id: s.id, kind: s.kind as ShopKind, priceMemory: (s.priceMemory ?? {}) as PriceMemory })),
    prefs,
  )
  await db.delete(shopOrders).where(and(eq(shopOrders.householdId, hh), eq(shopOrders.status, 'draft')))

  const orders: ShopOrder[] = []
  const groups = carried.map((c) => ({ ...c, shop: shops.find((s) => s.id === c.shopId)! })).filter((g) => g.shop && g.lines.length)
  for (const g of groups) {
    const estimate = sumEstimate(g.lines)
    const fulfilment: ShopFulfilment = (g.fulfilment ?? g.shop.fulfilment) === 'domicilio' ? 'domicilio' : 'recoger'
    const address = fulfilment === 'domicilio' ? g.address ?? addressFor(g.shop, shops) : null
    const [row] = await db
      .insert(shopOrders)
      .values({
        householdId: hh,
        userId,
        shopId: g.shop.id,
        shopSnapshot: snapshotOf(g.shop),
        status: 'draft',
        token: randomBytes(12).toString('base64url'),
        lines: g.lines,
        estimateEur: estimate,
        capEur: capForLines(g.lines),
        fulfilment,
        address,
        messageText: messageFor(g.shop.customerName, snapshotOf(g.shop), g.lines, fulfilment, address),
      })
      .returning()
    orders.push(presentOrder(row))
  }
  return { orders, unassigned: draft.unassigned, skipped: draft.skipped, pantry: draft.pantry, hasShops: shops.length > 0 }
}

export interface OrderPatch {
  lines?: Array<{
    key: string
    remove?: boolean
    note?: string | null
    quantity?: number
    unit?: BuyableUnit
    moveToShopId?: string
    choice?: string
    include?: boolean
  }>
  add?: Array<{ name: string; quantity?: number; unit?: BuyableUnit; note?: string | null }>
  fulfilment?: ShopFulfilment
  address?: string | null
  capEur?: number | null
}

function nextKey(lines: ShopOrderLine[]): string {
  const max = lines.reduce((m, l) => Math.max(m, Number(l.key.replace(/\D/g, '')) || 0), 0)
  return `l${max + 1}`
}

/** Lines the user adds to a draft ("y 1 kg de manzanas"); "Fruta (…)" splits. */
function addedLines(adds: NonNullable<OrderPatch['add']>, existing: ShopOrderLine[], kind: ShopKind, prefs: Record<string, string>, memory: PriceMemory): ShopOrderLine[] {
  const out: ShopOrderLine[] = []
  for (const a of adds) {
    for (const name of splitCompound(a.name) ?? [a.name]) {
      const hasQty = a.quantity != null && !splitCompound(a.name)
      out.push(
        buildLine(
          {
            key: nextKey([...existing, ...out]),
            sourceItemIds: [],
            ingredientId: null,
            name,
            quantity: hasQty ? a.quantity! : 1,
            unit: hasQty ? a.unit ?? 'u' : 'u',
            quantitySource: hasQty ? 'user' : 'default',
            notes: [],
            note: a.note ?? null,
            choice: resolveBuyRule(name)?.preset ?? null,
            included: true,
          },
          kind,
          prefs,
          memory,
        ),
      )
    }
  }
  return out
}

/**
 * Edit a draft: drop / annotate / resize lines, pick an option ("serrano"),
 * tick a "probablemente lo tienes" line, move a line to another shop, add
 * things, switch pickup ↔ delivery (+ address), change the cap.
 */
export async function patchOrder(userId: string, id: string, patch: OrderPatch, db: Db = defaultDb): Promise<ShopOrder> {
  const { row, householdId } = await loadOrder(userId, id, db)
  requireStatus(row, ['draft'], 'editar')
  const snap = row.shopSnapshot as ShopSnapshot
  const kind = snap.kind
  const allShops = await shopRows(householdId, db)
  const shop = allShops.find((s) => s.id === row.shopId) ?? null
  const memory = (shop?.priceMemory ?? {}) as PriceMemory
  const prefs = await loadPrefs(householdId, db)
  let lines = [...(row.lines as ShopOrderLine[])]
  const moves = new Map<string, ShopOrderLine[]>()
  for (const p of patch.lines ?? []) {
    const idx = lines.findIndex((l) => l.key === p.key)
    if (idx < 0) continue
    if (p.remove) {
      lines.splice(idx, 1)
      continue
    }
    if (p.moveToShopId && p.moveToShopId !== row.shopId) {
      const [moved] = lines.splice(idx, 1)
      moves.set(p.moveToShopId, [...(moves.get(p.moveToShopId) ?? []), moved])
      continue
    }
    const input = inputOf(lines[idx])
    if (p.note !== undefined) input.note = p.note || null
    if (p.quantity !== undefined) {
      input.quantity = p.quantity
      input.unit = p.unit ?? (input.quantitySource === 'default' ? 'g' : input.unit)
      input.quantitySource = 'user'
    }
    if (p.include !== undefined) input.included = p.include
    if (p.choice !== undefined) {
      input.choice = p.choice
      const ruleKey = lines[idx].ruleKey
      if (ruleKey) {
        prefs[ruleKey] = p.choice
        await savePref(householdId, ruleKey, p.choice, db)
      }
    }
    lines[idx] = buildLine(input, kind, prefs, memory)
  }
  if (patch.add?.length) lines = [...lines, ...addedLines(patch.add, lines, kind, prefs, memory)]

  for (const [shopId, moved] of moves) await appendToShopDraft(userId, householdId, shopId, moved, prefs, db)

  const fulfilment: ShopFulfilment = patch.fulfilment ?? (row.fulfilment === 'domicilio' ? 'domicilio' : 'recoger')
  let address = patch.address !== undefined ? patch.address || null : row.address ?? null
  if (fulfilment === 'domicilio' && !address) address = addressFor(shop, allShops)
  const estimate = sumEstimate(lines)
  const values: Partial<typeof shopOrders.$inferInsert> = {
    lines,
    estimateEur: estimate,
    fulfilment,
    address,
    messageText: messageFor(shop?.customerName ?? null, snap, lines, fulfilment, address),
  }
  if (patch.capEur !== undefined) values.capEur = patch.capEur
  else if ((patch.lines?.length || patch.add?.length) && row.capEur == null) values.capEur = capForLines(lines)
  return update(row.id, values, db)
}

async function appendToShopDraft(userId: string, householdId: string, shopId: string, moved: ShopOrderLine[], prefs: Record<string, string>, db: Db) {
  const allShops = await shopRows(householdId, db)
  const shop = allShops.find((s) => s.id === shopId)
  if (!shop) throw new ShopOrderError(404, 'SHOP_NOT_FOUND', 'Esa tienda no existe.')
  const kind = shop.kind as ShopKind
  const memory = (shop.priceMemory ?? {}) as PriceMemory
  const [existing] = await db.select().from(shopOrders).where(and(eq(shopOrders.shopId, shopId), eq(shopOrders.householdId, householdId), eq(shopOrders.status, 'draft'))).limit(1)
  const merged = [...((existing?.lines as ShopOrderLine[] | undefined) ?? [])]
  for (const l of moved) merged.push(buildLine({ ...inputOf(l), key: nextKey(merged) }, kind, prefs, memory))
  const fulfilment: ShopFulfilment = existing ? (existing.fulfilment === 'domicilio' ? 'domicilio' : 'recoger') : shop.fulfilment === 'domicilio' ? 'domicilio' : 'recoger'
  const address = existing ? existing.address ?? null : fulfilment === 'domicilio' ? addressFor(shop, allShops) : null
  const values = {
    lines: merged,
    estimateEur: sumEstimate(merged),
    capEur: existing?.capEur ?? capForLines(merged),
    fulfilment,
    address,
    messageText: messageFor(shop.customerName, snapshotOf(shop), merged, fulfilment, address),
  }
  if (existing) await db.update(shopOrders).set({ ...values, updatedAt: new Date() }).where(eq(shopOrders.id, existing.id))
  else await db.insert(shopOrders).values({ ...values, householdId, userId, shopId, shopSnapshot: snapshotOf(shop), status: 'draft', token: randomBytes(12).toString('base64url') })
}

export async function markSent(userId: string, id: string, db: Db = defaultDb): Promise<ShopOrder> {
  const { row } = await loadOrder(userId, id, db)
  requireStatus(row, ['draft', 'sent'], 'marcar como enviado')
  return update(row.id, { status: 'sent', sentAt: row.sentAt ?? new Date() }, db)
}

type Parser = (input: Parameters<typeof parseShopReply>[0]) => Promise<ParsedReply | null>

/** The shop answered: parse its reply, assess every line against estimate, band and cap. */
export async function submitQuote(userId: string, id: string, text: string, deps: { parse?: Parser } = {}, db: Db = defaultDb): Promise<ShopOrder> {
  const { row } = await loadOrder(userId, id, db)
  requireStatus(row, ['draft', 'sent', 'quoted'], 'registrar la respuesta')
  const snap = row.shopSnapshot as ShopSnapshot
  const lines = row.lines as ShopOrderLine[]
  const parse = deps.parse ?? ((i) => parseShopReply(i))
  const parsed = await parse({ text, kind: snap.kind, lines })
  if (!parsed) throw new ShopOrderError(502, 'PARSE_FAILED', 'No he podido leer la respuesta de la tienda. Inténtalo otra vez en un momento.')
  const withQuotes = lines.map((l) => ({ ...l, quote: parsed.lines[l.key] ?? null }))
  const { lines: assessed, summary } = assessQuote(withQuotes, {
    totalEur: parsed.totalEur,
    capEur: row.capEur,
    pickupText: parsed.pickupText,
    paymentText: parsed.paymentText,
    notes: parsed.notes,
  })
  return update(
    row.id,
    {
      status: 'quoted',
      sentAt: row.sentAt ?? new Date(),
      quotedAt: new Date(),
      shopReplyText: text.slice(0, 4000),
      lines: assessed,
      quoteSummary: summary,
      confirmationText: null,
    },
    db,
  )
}

/**
 * The user approves the quote. Undecided lines are kept (the user approved
 * the quote minus what they removed); "no hay" lines are dropped. Builds the
 * confirmation the user sends the shop and remembers the €/kg it quoted.
 */
export async function approveOrder(
  userId: string,
  id: string,
  body: { decisions?: Record<string, LineDecision>; capEur?: number | null },
  db: Db = defaultDb,
): Promise<ShopOrder> {
  const { row } = await loadOrder(userId, id, db)
  requireStatus(row, ['quoted', 'approved'], 'aprobar')
  const decisions = body.decisions ?? {}
  const lines = (row.lines as ShopOrderLine[]).map((l) => ({
    ...l,
    decision: (l.verdict === 'no_hay' ? 'remove' : decisions[l.key] ?? l.decision ?? 'keep') as LineDecision,
  }))
  const capEur = body.capEur !== undefined ? body.capEur : row.capEur
  const confirmationText = buildConfirmationMessage({ lines, capEur })

  if (row.shopId) {
    const [shop] = await db.select().from(householdShops).where(eq(householdShops.id, row.shopId)).limit(1)
    if (shop) {
      const memory = { ...((shop.priceMemory ?? {}) as PriceMemory) }
      const at = new Date().toISOString().slice(0, 10)
      for (const l of lines) {
        if (l.decision === 'keep' && l.ingredientId && l.quote?.status === 'ok' && l.quote.pricePerKg) {
          memory[l.ingredientId] = { pricePerKg: l.quote.pricePerKg, at }
        }
      }
      await db.update(householdShops).set({ priceMemory: memory, updatedAt: new Date() }).where(eq(householdShops.id, shop.id))
    }
  }
  return update(row.id, { status: 'approved', approvedAt: new Date(), lines, capEur, confirmationText }, db)
}

/** Done (collected / delivered / ordered on the web). Ticks the bought items off the list. */
export async function closeOrder(userId: string, id: string, body: { finalTotalEur?: number | null }, db: Db = defaultDb): Promise<ShopOrder> {
  const { row } = await loadOrder(userId, id, db)
  requireStatus(row, OPEN_STATUSES, 'cerrar')
  const bought = new Set(
    (row.lines as ShopOrderLine[])
      .filter((l) => l.included !== false && l.decision !== 'remove' && l.verdict !== 'no_hay')
      .flatMap((l) => l.sourceItemIds ?? (l.sourceItemId ? [l.sourceItemId] : [])),
  )
  if (bought.size) {
    const [list] = await db.select().from(shoppingLists).where(eq(shoppingLists.userId, userId)).orderBy(desc(shoppingLists.createdAt)).limit(1)
    if (list) {
      const items = (list.items as ShoppingItem[]).map((i) => (bought.has(i.id) ? { ...i, checked: true } : i))
      await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, list.id))
    }
  }
  return update(row.id, { status: 'closed', closedAt: new Date(), finalTotalEur: body.finalTotalEur ?? null }, db)
}

export async function cancelOrder(userId: string, id: string, db: Db = defaultDb): Promise<ShopOrder> {
  const { row } = await loadOrder(userId, id, db)
  requireStatus(row, OPEN_STATUSES, 'cancelar')
  return update(row.id, { status: 'cancelled' }, db)
}
