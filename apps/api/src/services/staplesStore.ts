/**
 * household_staples business logic (PR 10B).
 *
 * Scope: every operation is keyed by household; we always reach for the
 * caller's primary household via `getPrimaryHouseholdId`. If the user has
 * no primary household yet (impossible after migration 0011 but defensive)
 * the read returns `[]` and writes throw.
 *
 * See [specs/shopping.md] for the user-facing rules.
 */

import { and, asc, eq } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { householdStaples } from '../db/schema.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'
import type { StapleSnapshot } from './shoppingList.js'
import type { Aisle, BuyableUnit } from '@ona/shared'

type Db = typeof defaultDb

export interface StapleRow {
  id: string
  householdId: string
  name: string
  quantity: number
  unit: BuyableUnit
  aisle: Aisle
  pricePerUnit: number | null
  active: boolean
  createdAt: string
}

export class NoHouseholdError extends Error {
  constructor() {
    super('Tu cuenta aún no tiene un hogar asignado.')
    this.name = 'NoHouseholdError'
  }
}

function toRow(r: typeof householdStaples.$inferSelect): StapleRow {
  return {
    id: r.id,
    householdId: r.householdId,
    name: r.name,
    quantity: r.quantity,
    unit: r.unit as BuyableUnit,
    aisle: r.aisle as Aisle,
    pricePerUnit: r.pricePerUnit ?? null,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function listStaplesForUser(
  userId: string,
  db: Db = defaultDb,
): Promise<StapleRow[]> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return []
  const rows = await db
    .select()
    .from(householdStaples)
    .where(eq(householdStaples.householdId, householdId))
    .orderBy(asc(householdStaples.createdAt))
  return rows.map(toRow)
}

/** Active = `active=true` only — what the aggregator should fold in. */
export async function listActiveStaplesForHousehold(
  householdId: string,
  db: Db = defaultDb,
): Promise<StapleSnapshot[]> {
  const rows = await db
    .select()
    .from(householdStaples)
    .where(
      and(eq(householdStaples.householdId, householdId), eq(householdStaples.active, true)),
    )
  return rows.map((r) => ({
    name: r.name,
    quantity: r.quantity,
    unit: r.unit as BuyableUnit,
    aisle: r.aisle as Aisle,
    pricePerUnit: r.pricePerUnit ?? null,
  }))
}

export interface AddStapleInput {
  name: string
  quantity?: number
  unit?: BuyableUnit
  aisle?: Aisle
  pricePerUnit?: number | null
}

export async function addStapleForUser(
  userId: string,
  input: AddStapleInput,
  db: Db = defaultDb,
): Promise<StapleRow> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) throw new NoHouseholdError()
  const [inserted] = await db
    .insert(householdStaples)
    .values({
      householdId,
      name: input.name.trim(),
      quantity: input.quantity ?? 1,
      unit: input.unit ?? 'u',
      aisle: input.aisle ?? 'otros',
      pricePerUnit: input.pricePerUnit ?? null,
      active: true,
    })
    .returning()
  return toRow(inserted)
}

export interface PatchStapleInput {
  name?: string
  quantity?: number
  unit?: BuyableUnit
  aisle?: Aisle
  pricePerUnit?: number | null
  active?: boolean
}

export async function patchStapleForUser(
  userId: string,
  stapleId: string,
  patch: PatchStapleInput,
  db: Db = defaultDb,
): Promise<StapleRow | null> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return null

  // Build update body — undefined fields are skipped.
  const update: Partial<typeof householdStaples.$inferInsert> = {}
  if (patch.name !== undefined) update.name = patch.name.trim()
  if (patch.quantity !== undefined) update.quantity = patch.quantity
  if (patch.unit !== undefined) update.unit = patch.unit
  if (patch.aisle !== undefined) update.aisle = patch.aisle
  if (patch.pricePerUnit !== undefined) update.pricePerUnit = patch.pricePerUnit
  if (patch.active !== undefined) update.active = patch.active

  const [updated] = await db
    .update(householdStaples)
    .set(update)
    .where(
      and(eq(householdStaples.id, stapleId), eq(householdStaples.householdId, householdId)),
    )
    .returning()
  return updated ? toRow(updated) : null
}

export async function deleteStapleForUser(
  userId: string,
  stapleId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return false
  const result = await db
    .delete(householdStaples)
    .where(
      and(eq(householdStaples.id, stapleId), eq(householdStaples.householdId, householdId)),
    )
    .returning({ id: householdStaples.id })
  return result.length > 0
}
