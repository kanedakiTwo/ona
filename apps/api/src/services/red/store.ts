/**
 * Red de tiendas: the database side (ona-hq D-165). Settings, active shops,
 * the household's postal code and «al súper» answers, the household's own
 * shops that joined the Red (same WhatsApp) and the copies Mimoia assigns.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { DEFAULT_RED_SETTINGS, type RedKind, type RedSettings } from '@ona/shared'
import { db as defaultDb } from '../../db/connection.js'
import { households, householdShops, redSettings, redShops, shopOrders } from '../../db/schema.js'
import { redCandidates, type RedShopLite } from './assign.js'

type Db = typeof defaultDb
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
/** The db or a transaction; a function that opens its own transaction takes the real `Db`. */
type DbOrTx = Db | Tx
export type RedShopRow = typeof redShops.$inferSelect

export async function getRedSettings(db: Pick<Db, 'select'> = defaultDb): Promise<RedSettings> {
  const [row] = await db.select().from(redSettings).where(eq(redSettings.id, 1)).limit(1)
  if (!row) return DEFAULT_RED_SETTINGS
  return {
    discountPct: row.discountPct,
    commissionPct: row.commissionPct,
    commissionVatIncluded: row.commissionVatIncluded,
    marginKnownPct: row.marginKnownPct,
    marginReferencePct: row.marginReferencePct,
    marginWildFishExtraPct: row.marginWildFishExtraPct,
    termsVersion: row.termsVersion,
  }
}

/** Same numbers and conditions? (an order drafted with other terms is checked again at «Pedir»). */
export function sameTerms(a: RedSettings | null | undefined, b: RedSettings): boolean {
  if (!a) return false
  return (Object.keys(b) as Array<keyof RedSettings>).every((k) => a[k] === b[k])
}

export async function activeRedShops(db: DbOrTx = defaultDb): Promise<RedShopRow[]> {
  return db.select().from(redShops).where(eq(redShops.status, 'activa'))
}

export const toLite = (r: RedShopRow): RedShopLite => ({
  id: r.id, name: r.name, kind: r.kind, postalCode: r.postalCode, deliveryPostalCodes: r.deliveryPostalCodes ?? [], status: r.status, joinedAt: r.joinedAt,
})

export async function getHouseholdRed(householdId: string, db: DbOrTx = defaultDb): Promise<{ postalCode: string | null; choices: Partial<Record<RedKind, 'super'>> }> {
  const [row] = await db.select({ postalCode: households.postalCode, redChoices: households.redChoices }).from(households).where(eq(households.id, householdId)).limit(1)
  return { postalCode: row?.postalCode ?? null, choices: (row?.redChoices ?? {}) as Partial<Record<RedKind, 'super'>> }
}

/**
 * The household's own shops with a Red shop's WhatsApp (same kind) are
 * linked: from now on their orders go through the Red (design §5). The
 * household's own shop goes first, so a Red copy of that kind (and its
 * drafts) goes.
 */
export async function linkOwnShopsToRed(householdId: string, red: RedShopRow[], db: DbOrTx = defaultDb): Promise<number> {
  const byPhone = new Map(red.map((r) => [r.whatsapp, r]))
  const own = await db
    .select()
    .from(householdShops)
    .where(and(eq(householdShops.householdId, householdId), eq(householdShops.origin, 'propia'), isNull(householdShops.redShopId)))
  let linked = 0
  for (const s of own) {
    const r = s.whatsapp ? byPhone.get(s.whatsapp) : undefined
    if (!r || r.kind !== s.kind) continue
    await db.update(householdShops).set({ redShopId: r.id, updatedAt: new Date() }).where(eq(householdShops.id, s.id))
    await dropRedCopy(householdId, s.kind, db)
    linked++
  }
  return linked
}

type RedCopySource = Pick<RedShopRow, 'id' | 'name' | 'kind' | 'whatsapp' | 'address' | 'notes' | 'deliveryPostalCodes' | 'deliveryMinEur' | 'deliveryFeeEur'>

/**
 * Pure: the household_shops row of a Red copy (origin `red`). It delivers iff
 * the Red shop delivers to the household's postal code: then it carries the
 * fee (0 = free) and the minimum, otherwise both are null (pickup only).
 */
export function redCopyValues(red: RedCopySource, postalCode: string) {
  const delivers = (red.deliveryPostalCodes ?? []).includes(postalCode)
  return {
    name: red.name,
    kind: red.kind,
    channel: 'whatsapp',
    whatsapp: red.whatsapp,
    email: null,
    webUrl: null,
    phone: null,
    fulfilment: 'recoger',
    notes: [red.address, red.notes].filter(Boolean).join(' · ') || null,
    deliveryMinEur: delivers ? red.deliveryMinEur : null,
    deliveryFeeEur: delivers ? red.deliveryFeeEur ?? 0 : null,
    redShopId: red.id,
    origin: 'red',
  }
}

/**
 * Give the household a Red shop of that kind: a copy in household_shops
 * (origin `red`), or re-point the copy it already has. Its drafts go when the
 * Red shop changes (and so does its price memory) or its delivery does, since
 * a draft keeps the shop as it was. Two «Preparar» at once end in one copy
 * (the unique index on the Red copy of a kind). null = the household already
 * has 20 shops.
 */
export async function assignRedShop(householdId: string, red: RedShopRow, postalCode: string, db: DbOrTx = defaultDb): Promise<string | null> {
  const values = { ...redCopyValues(red, postalCode), updatedAt: new Date() }
  const [copy] = await db
    .select()
    .from(householdShops)
    .where(and(eq(householdShops.householdId, householdId), eq(householdShops.kind, red.kind), eq(householdShops.origin, 'red')))
    .limit(1)
  if (copy) {
    const otherShop = copy.redShopId !== red.id
    const otherDelivery = copy.deliveryFeeEur !== values.deliveryFeeEur || copy.deliveryMinEur !== values.deliveryMinEur
    if (otherShop || otherDelivery) await db.delete(shopOrders).where(and(eq(shopOrders.shopId, copy.id), eq(shopOrders.status, 'draft')))
    await db
      .update(householdShops)
      .set(otherShop ? { ...values, priceMemory: {} } : values)
      .where(eq(householdShops.id, copy.id))
    return copy.id
  }
  const all = await db.select({ id: householdShops.id }).from(householdShops).where(eq(householdShops.householdId, householdId))
  if (all.length >= 20) return null
  const [row] = await db
    .insert(householdShops)
    .values({ ...values, householdId, position: all.length })
    .onConflictDoUpdate({ target: [householdShops.householdId, householdShops.kind], targetWhere: sql`origin = 'red'`, set: values })
    .returning({ id: householdShops.id })
  return row.id
}

/** Remove the Red copy of a kind (and its drafts). */
async function dropRedCopy(householdId: string, kind: string, db: DbOrTx) {
  const copies = await db
    .select({ id: householdShops.id })
    .from(householdShops)
    .where(and(eq(householdShops.householdId, householdId), eq(householdShops.kind, kind), eq(householdShops.origin, 'red')))
  for (const c of copies) {
    await db.delete(shopOrders).where(and(eq(shopOrders.shopId, c.id), eq(shopOrders.status, 'draft')))
    await db.delete(householdShops).where(eq(householdShops.id, c.id))
  }
}

/**
 * «La sigo pidiendo en el súper»: remembered so it's asked once; any Red copy
 * of that kind goes. The answer is merged in the database, so two members
 * answering at once both count.
 */
export async function keepKindAtSuper(householdId: string, kind: RedKind, db: Db = defaultDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(households)
      .set({ redChoices: sql`${households.redChoices} || jsonb_build_object(${kind}::text, 'super')` })
      .where(eq(households.id, householdId))
    await dropRedCopy(householdId, kind, tx)
  })
}

/** The household picked a Red shop for that kind: forget any «al súper» for it (in the database, like keepKindAtSuper). */
export async function forgetSuperChoice(householdId: string, kind: RedKind, db: DbOrTx = defaultDb): Promise<void> {
  await db.update(households).set({ redChoices: sql`${households.redChoices} - ${kind}::text` }).where(eq(households.id, householdId))
}

/**
 * New postal code: saved, and every Red copy is checked again. The ones whose
 * shop doesn't cover it any more go; the rest get the delivery of the new one.
 */
export async function setHouseholdPostalCode(householdId: string, postalCode: string, db: Db = defaultDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(households).set({ postalCode }).where(eq(households.id, householdId))
    const copies = await tx.select().from(householdShops).where(and(eq(householdShops.householdId, householdId), eq(householdShops.origin, 'red')))
    if (!copies.length) return
    const red = await activeRedShops(tx)
    for (const c of copies) {
      const shop = red.find((r) => r.id === c.redShopId)
      const covers = shop && redCandidates(shop.kind as RedKind, postalCode, [toLite(shop)]).length > 0
      if (shop && covers) await assignRedShop(householdId, shop, postalCode, tx)
      else await dropRedCopy(householdId, c.kind, tx)
    }
  })
}
