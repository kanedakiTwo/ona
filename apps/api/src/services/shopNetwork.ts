/**
 * «Tiendas de Mimoia» (PRO-358, D-123; specs/shop-orders.md → «Tiendas de
 * Mimoia»). The Red of shops Miguel keeps from /admin, and what a household
 * sees of it at /compra/tiendas: the shops that cover its postal code, in
 * the order its ficha says (presupuesto, preferencias, cercanía) and never by
 * payment (constitución §7). Choosing one asks «¿Ya le comprabas?»: «sí»
 * adds it as the household's own shop (it never counts), «no» adds it with
 * origin `red` (it counts). From there, orders work as with any other shop.
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  networkCoverageSchema,
  preferredFulfilment,
  rankNetworkShops,
  tierForBudget,
  type AdminNetworkShop,
  type HouseholdNetworkShop,
  type HouseholdNetworkView,
  type NetworkCoverage,
  type NetworkFulfilment,
  type NetworkShop,
  type NetworkShopInput,
  type NetworkShopStatus,
  type Shop,
} from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { householdShops, networkShops, profileFacts } from '../db/schema.js'
import { record } from './auditLog.js'
import { cookingStyleHousehold } from './profile/cookingStyle.js'
import { getPostalCode } from './profile/postalCode.js'
import { listShops, ShopOrderError } from './shopOrders/store.js'

type Db = typeof defaultDb
type NetworkRow = typeof networkShops.$inferSelect

const MAX_SHOPS = 20

function toCoverage(raw: unknown): NetworkCoverage {
  const parsed = networkCoverageSchema.safeParse(raw)
  return parsed.success ? parsed.data : { nationwide: false, areas: [] }
}

function toFulfilment(raw: unknown): NetworkFulfilment[] {
  return Array.isArray(raw) ? (raw.filter((x) => x === 'recogida' || x === 'reparto' || x === 'envio') as NetworkFulfilment[]) : []
}

export function toNetworkShop(r: NetworkRow): NetworkShop {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as NetworkShop['kind'],
    tier: r.tier as NetworkShop['tier'],
    coverage: toCoverage(r.coverage),
    channel: r.channel as NetworkShop['channel'],
    whatsapp: r.whatsapp,
    email: r.email,
    webUrl: r.webUrl,
    phone: r.phone,
    fulfilment: toFulfilment(r.fulfilment),
    deliveryMinEur: r.deliveryMinEur ?? null,
    deliveryFeeEur: r.deliveryFeeEur ?? null,
    freeDeliveryFromEur: r.freeDeliveryFromEur ?? null,
    notes: r.notes,
    status: r.status as NetworkShopStatus,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

function forHousehold(s: NetworkShop): HouseholdNetworkShop {
  const { status: _s, createdAt: _c, updatedAt: _u, ...rest } = s
  return rest
}

// ─── Admin ───────────────────────────────────────────────────────

function networkValues(input: NetworkShopInput) {
  return {
    name: input.name,
    kind: input.kind,
    tier: input.tier,
    coverage: input.coverage,
    channel: input.channel,
    whatsapp: input.whatsapp ?? null,
    email: input.email ?? null,
    webUrl: input.webUrl ?? null,
    phone: input.phone ?? null,
    fulfilment: [...new Set(input.fulfilment)],
    deliveryMinEur: input.deliveryMinEur ?? null,
    deliveryFeeEur: input.deliveryFeeEur ?? null,
    freeDeliveryFromEur: input.freeDeliveryFromEur ?? null,
    notes: input.notes ?? null,
    status: input.status,
  }
}

/**
 * Every shop of the Red with how many households chose it from the Red
 * (origin `red`). A household that said «sí, ya le compraba» never counts.
 */
export async function listNetworkShopsAdmin(db: Db = defaultDb): Promise<AdminNetworkShop[]> {
  const rows = await db.select().from(networkShops).orderBy(asc(networkShops.kind), asc(networkShops.name))
  const counts = await db
    .select({ id: householdShops.networkShopId, n: sql<number>`count(distinct ${householdShops.householdId})::int` })
    .from(householdShops)
    .where(eq(householdShops.origin, 'red'))
    .groupBy(householdShops.networkShopId)
  const byId = new Map(counts.map((c) => [c.id, Number(c.n)]))
  return rows.map((r) => ({ ...toNetworkShop(r), households: byId.get(r.id) ?? 0 }))
}

export async function createNetworkShop(adminId: string, input: NetworkShopInput, db: Db = defaultDb): Promise<NetworkShop> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(networkShops).values(networkValues(input)).returning()
    await record({ adminId, action: 'network_shop.create', targetType: 'network_shop', targetId: row.id, payload: { created: { name: row.name, kind: row.kind } } }, tx)
    return toNetworkShop(row)
  })
}

/** Full-form edit (`input`) or just the status (`{ status }`). null = no such shop. */
export async function updateNetworkShop(
  adminId: string,
  id: string,
  patch: { input: NetworkShopInput } | { status: NetworkShopStatus },
  db: Db = defaultDb,
): Promise<NetworkShop | null> {
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(networkShops).where(eq(networkShops.id, id)).limit(1)
    if (!before) return null
    const values = 'input' in patch ? networkValues(patch.input) : { status: patch.status }
    const [row] = await tx.update(networkShops).set({ ...values, updatedAt: new Date() }).where(eq(networkShops.id, id)).returning()
    const action = 'input' in patch ? 'network_shop.update' : 'network_shop.status'
    const b = toNetworkShop(before)
    const a = toNetworkShop(row)
    const changed = Object.fromEntries(
      (Object.keys(values) as Array<keyof NetworkShop>)
        .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
        .map((k) => [k, { before: b[k], after: a[k] }]),
    )
    await record({ adminId, action, targetType: 'network_shop', targetId: id, payload: changed }, tx)
    return a
  })
}

// ─── Household ───────────────────────────────────────────────────

/** Weekly budget and adults from the household's ficha (facts about the household, in force). */
async function budgetFacts(householdId: string, db: Db): Promise<{ budget: number | null; adults: number | null }> {
  const rows = await db
    .select({ type: profileFacts.type, value: profileFacts.value })
    .from(profileFacts)
    .where(and(
      eq(profileFacts.householdId, householdId),
      inArray(profileFacts.type, ['weekly_budget_eur', 'household.adults']),
      eq(profileFacts.status, 'active'),
      isNull(profileFacts.subjectPersonId),
    ))
    .orderBy(sql`${profileFacts.updatedAt} DESC`)
  const num = (t: string) => {
    const v = rows.find((r) => r.type === t)?.value
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  return { budget: num('weekly_budget_eur'), adults: num('household.adults') }
}

/**
 * What `/compra/tiendas` shows: the household's postal code (null = ask it)
 * and the active shops of the Red that cover it and that it doesn't have
 * yet, in order. Without a postal code, only the ones that ship to all Spain.
 */
export async function householdNetworkView(userId: string, db: Db = defaultDb): Promise<HouseholdNetworkView> {
  const hh = await cookingStyleHousehold(userId, db)
  if (!hh) return { postalCode: null, canEdit: false, shops: [] }
  const [postalCode, own, rows, budget] = await Promise.all([
    getPostalCode(hh.householdId, db),
    listShops(userId, db),
    db.select().from(networkShops).where(eq(networkShops.status, 'activa')),
    budgetFacts(hh.householdId, db),
  ])
  const have = new Set(own.map((s) => s.networkShopId).filter(Boolean))
  const candidates = rows.map(toNetworkShop).filter((s) => !have.has(s.id))
  const ranked = rankNetworkShops(candidates, {
    postalCode,
    tier: tierForBudget(budget.budget, budget.adults),
    fulfilment: preferredFulfilment(own),
  })
  return { postalCode, canEdit: hh.canEdit, shops: ranked.map(({ closeness: _c, ...s }) => forHousehold(s)) }
}

/**
 * Pure: the household's copy of a shop of the Red. «Sí, ya le compraba» →
 * origin `propia` (never counts); «no» → `red`. Picks up in the shop when it
 * can; otherwise home delivery to the address the household already gave
 * another shop (if none, the order card asks for it before sending).
 */
export function householdShopFromNetwork(
  s: NetworkShop,
  opts: { alreadyCustomer: boolean; address: string | null },
): Omit<typeof householdShops.$inferInsert, 'householdId' | 'position'> {
  const pickup = s.fulfilment.includes('recogida')
  return {
    name: s.name,
    kind: s.kind,
    channel: s.channel,
    whatsapp: s.whatsapp,
    email: s.email,
    webUrl: s.webUrl,
    phone: s.phone,
    fulfilment: pickup ? 'recoger' : 'domicilio',
    address: pickup ? null : opts.address,
    notes: s.notes ? s.notes.slice(0, 300) : null,
    deliveryMinEur: s.deliveryMinEur,
    deliveryFeeEur: s.deliveryFeeEur,
    networkShopId: s.id,
    origin: opts.alreadyCustomer ? 'propia' : 'red',
  }
}

/**
 * Add a shop of the Red to the household, with the answer to «¿Ya le
 * comprabas?». It has to be active, cover the household (as listed in
 * `householdNetworkView`) and not be one of its shops already.
 */
export async function adoptNetworkShop(userId: string, networkShopId: string, alreadyCustomer: boolean, db: Db = defaultDb): Promise<Shop> {
  const hh = await cookingStyleHousehold(userId, db)
  if (!hh) throw new ShopOrderError(400, 'NO_HOUSEHOLD', 'Tu cuenta aún no tiene un hogar asignado.')
  if (!hh.canEdit) throw new ShopOrderError(403, 'CHILD', 'Solo los adultos del hogar pueden añadir tiendas.')
  const view = await householdNetworkView(userId, db)
  const s = view.shops.find((x) => x.id === networkShopId)
  if (!s) {
    const own = await listShops(userId, db)
    if (own.some((o) => o.networkShopId === networkShopId)) throw new ShopOrderError(409, 'ALREADY_ADDED', 'Ya está entre tus tiendas.')
    throw new ShopOrderError(404, 'NOT_AVAILABLE', 'Esta tienda no está disponible para tu zona.')
  }
  const [row] = await db.select().from(networkShops).where(eq(networkShops.id, networkShopId)).limit(1)
  return db.transaction(async (tx) => {
    const existing = await tx.select().from(householdShops).where(eq(householdShops.householdId, hh.householdId))
    if (existing.length >= MAX_SHOPS) throw new ShopOrderError(400, 'TOO_MANY_SHOPS', `Máximo ${MAX_SHOPS} tiendas por hogar.`)
    if (existing.some((e) => e.networkShopId === networkShopId)) throw new ShopOrderError(409, 'ALREADY_ADDED', 'Ya está entre tus tiendas.')
    const address = existing.find((e) => e.address)?.address ?? null
    const [inserted] = await tx
      .insert(householdShops)
      .values({ ...householdShopFromNetwork(toNetworkShop(row), { alreadyCustomer, address }), householdId: hh.householdId, position: existing.length })
      .returning()
    const shops = await listShops(userId, tx as unknown as Db)
    return shops.find((x) => x.id === inserted.id)!
  })
}
