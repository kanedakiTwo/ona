/**
 * pantry_items business logic (PR 11).
 *
 *   - CRUD over the household's pantry register.
 *   - `decrementForRecipe(householdId, recipeId, scaleFactor)` — called
 *     from `POST /cook-logs` to auto-deduct ingredients the household
 *     just used.
 *
 * Scope: household-shared (one truth per household). Any member can edit.
 *
 * v1 rule on unit conversion: we only deduct when the pantry row's unit
 * matches the recipe ingredient's unit exactly. Cross-unit math via
 * `density` / `unitWeight` lands in a follow-up — the no-op is silent so
 * the cook-log flow never fails, but the result returns a `skipped[]`
 * array the UI can surface.
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { pantryItems, recipeIngredients, recipes, ingredients } from '../db/schema.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'
import type { Aisle, BuyableUnit } from '@ona/shared'

type Db = typeof defaultDb

// ─── pure helpers (unit-tested) ──────────────────────────────────────────

export interface PantrySnapshot {
  quantity: number
  unit: string
}

export interface DeductInput {
  quantity: number
  unit: string
}

export interface DeductResult {
  changed: boolean
  newQuantity: number
  /** Null on success; reason string when no-op. */
  reason: string | null
}

/** Round to 3 decimals to dodge 0.999… artifacts from JS arithmetic. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}

/**
 * Pure reducer — subtract `deduct.quantity` from `current.quantity` when
 * units match. No-ops silently (no throw) when:
 *   - units don't match (cross-unit conversion deferred)
 *   - deduct quantity ≤ 0
 *   - current quantity is already 0
 * Result is clamped at 0 on the low end.
 */
export function applyPantryDeduct(
  current: PantrySnapshot,
  deduct: DeductInput,
): DeductResult {
  if (deduct.quantity <= 0) {
    return { changed: false, newQuantity: current.quantity, reason: 'deduct quantity must be positive' }
  }
  if (current.quantity <= 0) {
    return { changed: false, newQuantity: current.quantity, reason: 'pantry empty' }
  }
  if (current.unit !== deduct.unit) {
    return {
      changed: false,
      newQuantity: current.quantity,
      reason: `unidad ${deduct.unit} no coincide con la despensa (${current.unit})`,
    }
  }
  const next = Math.max(0, current.quantity - deduct.quantity)
  return { changed: true, newQuantity: round3(next), reason: null }
}

// ─── DB-backed CRUD ──────────────────────────────────────────────────────

export interface PantryRow {
  id: string
  householdId: string
  ingredientId: string | null
  name: string
  quantity: number
  unit: BuyableUnit
  expiresAt: string | null
  lastUpdatedAt: string
  createdAt: string
}

function toRow(r: typeof pantryItems.$inferSelect): PantryRow {
  return {
    id: r.id,
    householdId: r.householdId,
    ingredientId: r.ingredientId ?? null,
    name: r.name,
    quantity: r.quantity,
    unit: r.unit as BuyableUnit,
    expiresAt: r.expiresAt ?? null,
    lastUpdatedAt: r.lastUpdatedAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }
}

export class NoHouseholdError extends Error {
  constructor() {
    super('Tu cuenta aún no tiene un hogar asignado.')
    this.name = 'NoHouseholdError'
  }
}

export async function listPantryForUser(
  userId: string,
  db: Db = defaultDb,
): Promise<PantryRow[]> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return []
  const rows = await db
    .select()
    .from(pantryItems)
    .where(eq(pantryItems.householdId, householdId))
    .orderBy(pantryItems.name)
  return rows.map(toRow)
}

export interface AddPantryInput {
  name: string
  quantity?: number
  unit?: BuyableUnit
  ingredientId?: string | null
  expiresAt?: string | null
}

export async function addPantryForUser(
  userId: string,
  input: AddPantryInput,
  db: Db = defaultDb,
): Promise<PantryRow> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) throw new NoHouseholdError()
  // When an ingredient_id is provided, manually merge against any existing
  // row for (household, ingredient_id). We can't use Postgres's native
  // `ON CONFLICT … DO UPDATE` here because our uniqueness is a partial
  // index (`WHERE ingredient_id IS NOT NULL`) and `onConflictDoUpdate`
  // requires a full unique constraint. Two round-trips, bulletproof.
  if (input.ingredientId) {
    const [existing] = await db
      .select()
      .from(pantryItems)
      .where(
        and(
          eq(pantryItems.householdId, householdId),
          eq(pantryItems.ingredientId, input.ingredientId),
        ),
      )
      .limit(1)
    if (existing) {
      const [updated] = await db
        .update(pantryItems)
        .set({
          quantity: existing.quantity + (input.quantity ?? 1),
          unit: input.unit ?? existing.unit,
          expiresAt: input.expiresAt ?? existing.expiresAt,
          lastUpdatedAt: new Date(),
        })
        .where(eq(pantryItems.id, existing.id))
        .returning()
      return toRow(updated)
    }
    const [inserted] = await db
      .insert(pantryItems)
      .values({
        householdId,
        ingredientId: input.ingredientId,
        name: input.name.trim(),
        quantity: input.quantity ?? 1,
        unit: input.unit ?? 'u',
        expiresAt: input.expiresAt ?? null,
      })
      .returning()
    return toRow(inserted)
  }
  const [inserted] = await db
    .insert(pantryItems)
    .values({
      householdId,
      ingredientId: null,
      name: input.name.trim(),
      quantity: input.quantity ?? 1,
      unit: input.unit ?? 'u',
      expiresAt: input.expiresAt ?? null,
    })
    .returning()
  return toRow(inserted)
}

export interface PatchPantryInput {
  quantity?: number
  unit?: BuyableUnit
  expiresAt?: string | null
  name?: string
}

export async function patchPantryForUser(
  userId: string,
  pantryId: string,
  patch: PatchPantryInput,
  db: Db = defaultDb,
): Promise<PantryRow | null> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return null
  const update: Partial<typeof pantryItems.$inferInsert> = { lastUpdatedAt: new Date() }
  if (patch.quantity !== undefined) update.quantity = patch.quantity
  if (patch.unit !== undefined) update.unit = patch.unit
  if (patch.expiresAt !== undefined) update.expiresAt = patch.expiresAt
  if (patch.name !== undefined) update.name = patch.name.trim()
  const [updated] = await db
    .update(pantryItems)
    .set(update)
    .where(and(eq(pantryItems.id, pantryId), eq(pantryItems.householdId, householdId)))
    .returning()
  return updated ? toRow(updated) : null
}

export async function deletePantryForUser(
  userId: string,
  pantryId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return false
  const result = await db
    .delete(pantryItems)
    .where(and(eq(pantryItems.id, pantryId), eq(pantryItems.householdId, householdId)))
    .returning({ id: pantryItems.id })
  return result.length > 0
}

// ─── auto-decrement on cook log ──────────────────────────────────────────

export interface DecrementSummary {
  /** Pantry row ids that were updated. */
  updatedRowIds: string[]
  /** Recipe ingredient names that couldn't be deducted (no pantry row or unit mismatch). */
  skipped: Array<{ ingredientName: string; reason: string }>
}

/**
 * Walk every ingredient on `recipeId`, scaled by `scaleFactor` (servings the
 * household actually cooked / recipe.servings), and deduct from any
 * matching pantry row. Idempotent at the database layer (each call deducts
 * once), so the caller — `POST /cook-logs` — should invoke this exactly
 * once per insert.
 *
 * Match strategy: pantry row's `ingredient_id` must match the recipe
 * ingredient's `ingredient_id`. Free-text pantry rows are skipped. Unit
 * must match exactly (no conversion in v1).
 */
export async function decrementPantryForRecipe(
  householdId: string,
  recipeId: string,
  scaleFactor: number,
  db: Db = defaultDb,
): Promise<DecrementSummary> {
  if (scaleFactor <= 0) return { updatedRowIds: [], skipped: [] }

  // Load all ingredients on the recipe + every relevant pantry row in one
  // pair of round-trips. We index pantry by ingredientId for the match.
  const ings = await db
    .select({
      ingredientId: recipeIngredients.ingredientId,
      ingredientName: ingredients.name,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
    .where(eq(recipeIngredients.recipeId, recipeId))

  if (ings.length === 0) return { updatedRowIds: [], skipped: [] }

  const pantryRows = await db
    .select()
    .from(pantryItems)
    .where(
      and(eq(pantryItems.householdId, householdId), isNotNull(pantryItems.ingredientId)),
    )
  const byIngredient = new Map<string, typeof pantryRows[number]>()
  for (const r of pantryRows) {
    if (r.ingredientId) byIngredient.set(r.ingredientId, r)
  }

  const updatedRowIds: string[] = []
  const skipped: DecrementSummary['skipped'] = []

  for (const ing of ings) {
    const pantryRow = byIngredient.get(ing.ingredientId)
    if (!pantryRow) {
      skipped.push({ ingredientName: ing.ingredientName, reason: 'not in pantry' })
      continue
    }
    const deductQty = ing.quantity * scaleFactor
    const result = applyPantryDeduct(
      { quantity: pantryRow.quantity, unit: pantryRow.unit },
      { quantity: deductQty, unit: ing.unit },
    )
    if (!result.changed) {
      skipped.push({ ingredientName: ing.ingredientName, reason: result.reason ?? 'no-op' })
      continue
    }
    await db
      .update(pantryItems)
      .set({ quantity: result.newQuantity, lastUpdatedAt: new Date() })
      .where(eq(pantryItems.id, pantryRow.id))
    updatedRowIds.push(pantryRow.id)
  }

  return { updatedRowIds, skipped }
}

/**
 * Resolve the scale factor to apply to a recipe's authored quantities when
 * we decrement on cook. Uses the recipe's `servings` as the denominator;
 * the caller passes the actually-cooked servings (slot override or default
 * household diners). Falls back to 1 when recipe servings is missing.
 */
export async function resolveCookScale(
  recipeId: string,
  cookedServings: number | null | undefined,
  db: Db = defaultDb,
): Promise<number> {
  if (!cookedServings || cookedServings <= 0) return 1
  const [r] = await db
    .select({ servings: recipes.servings })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1)
  const base = r?.servings ?? 1
  if (base <= 0) return 1
  return cookedServings / base
}
