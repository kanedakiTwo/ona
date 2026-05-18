/**
 * Cookbooks business logic (PR 8A) — named, household-shared recipe
 * collections. Owners can create, rename, delete; any member can add /
 * remove recipes. Recipes can live in many cookbooks at once.
 */

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { cookbooks, cookbookRecipes, recipes } from '../db/schema.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'

type Db = typeof defaultDb

// ─── pure validators (unit-tested) ───────────────────────────────────────

export type Validation<T> = { ok: true; value: T } | { ok: false; reason: string }

export function validateCookbookName(raw: unknown): Validation<string> {
  if (typeof raw !== 'string') return { ok: false, reason: 'name must be a string' }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: false, reason: 'name is required' }
  if (trimmed.length > 60) return { ok: false, reason: 'name must be ≤ 60 chars' }
  return { ok: true, value: trimmed }
}

export function validateCookbookEmoji(raw: unknown): Validation<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, reason: 'emoji must be a string' }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  // Accommodates ZWJ sequences (👨‍👩‍👧 → 8 chars when counting code points).
  if (trimmed.length > 8) return { ok: false, reason: 'emoji must be ≤ 8 chars' }
  return { ok: true, value: trimmed }
}

export function validateCookbookDescription(raw: unknown): Validation<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'string') return { ok: false, reason: 'description must be a string' }
  const trimmed = raw.trim()
  if (trimmed.length === 0) return { ok: true, value: null }
  if (trimmed.length > 280) return { ok: false, reason: 'description must be ≤ 280 chars' }
  return { ok: true, value: trimmed }
}

// ─── DB-backed operations ────────────────────────────────────────────────

export interface CookbookRow {
  id: string
  householdId: string
  name: string
  description: string | null
  emoji: string | null
  recipeCount: number
  createdAt: string
  updatedAt: string
}

export class NoHouseholdError extends Error {
  constructor() {
    super('Tu cuenta aún no tiene un hogar asignado.')
    this.name = 'NoHouseholdError'
  }
}

export class CookbookNotFoundError extends Error {
  constructor() {
    super('Cookbook no encontrado')
    this.name = 'CookbookNotFoundError'
  }
}

/** List all cookbooks for the caller's household with recipe counts. */
export async function listCookbooksForUser(
  userId: string,
  db: Db = defaultDb,
): Promise<CookbookRow[]> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return []
  const rows = await db
    .select({
      id: cookbooks.id,
      householdId: cookbooks.householdId,
      name: cookbooks.name,
      description: cookbooks.description,
      emoji: cookbooks.emoji,
      createdAt: cookbooks.createdAt,
      updatedAt: cookbooks.updatedAt,
      recipeCount: sql<number>`COALESCE(COUNT(${cookbookRecipes.id}), 0)`,
    })
    .from(cookbooks)
    .leftJoin(cookbookRecipes, eq(cookbookRecipes.cookbookId, cookbooks.id))
    .where(eq(cookbooks.householdId, householdId))
    .groupBy(cookbooks.id)
    .orderBy(asc(cookbooks.createdAt))
  return rows.map((r) => ({
    id: r.id,
    householdId: r.householdId,
    name: r.name,
    description: r.description ?? null,
    emoji: r.emoji ?? null,
    recipeCount: Number(r.recipeCount),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }))
}

/** Load one cookbook (with its recipes) — null when not in caller's scope. */
export async function getCookbookForUser(
  userId: string,
  cookbookId: string,
  db: Db = defaultDb,
): Promise<(CookbookRow & { recipes: Array<{ id: string; name: string; imageUrl: string | null; addedAt: string }> }) | null> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return null
  const [book] = await db
    .select()
    .from(cookbooks)
    .where(and(eq(cookbooks.id, cookbookId), eq(cookbooks.householdId, householdId)))
    .limit(1)
  if (!book) return null
  const recipeRows = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      imageUrl: recipes.imageUrl,
      addedAt: cookbookRecipes.addedAt,
    })
    .from(cookbookRecipes)
    .innerJoin(recipes, eq(recipes.id, cookbookRecipes.recipeId))
    .where(eq(cookbookRecipes.cookbookId, cookbookId))
    .orderBy(desc(cookbookRecipes.addedAt))
  return {
    id: book.id,
    householdId: book.householdId,
    name: book.name,
    description: book.description ?? null,
    emoji: book.emoji ?? null,
    recipeCount: recipeRows.length,
    createdAt: book.createdAt.toISOString(),
    updatedAt: book.updatedAt.toISOString(),
    recipes: recipeRows.map((r) => ({
      id: r.id,
      name: r.name,
      imageUrl: r.imageUrl ?? null,
      addedAt: r.addedAt.toISOString(),
    })),
  }
}

export interface CreateCookbookInput {
  name: string
  description?: string | null
  emoji?: string | null
}

export async function createCookbookForUser(
  userId: string,
  input: CreateCookbookInput,
  db: Db = defaultDb,
): Promise<CookbookRow> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) throw new NoHouseholdError()
  const [inserted] = await db
    .insert(cookbooks)
    .values({
      householdId,
      name: input.name,
      description: input.description ?? null,
      emoji: input.emoji ?? null,
    })
    .returning()
  return {
    id: inserted.id,
    householdId: inserted.householdId,
    name: inserted.name,
    description: inserted.description ?? null,
    emoji: inserted.emoji ?? null,
    recipeCount: 0,
    createdAt: inserted.createdAt.toISOString(),
    updatedAt: inserted.updatedAt.toISOString(),
  }
}

export interface PatchCookbookInput {
  name?: string
  description?: string | null
  emoji?: string | null
}

export async function patchCookbookForUser(
  userId: string,
  cookbookId: string,
  patch: PatchCookbookInput,
  db: Db = defaultDb,
): Promise<CookbookRow | null> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return null
  const update: Partial<typeof cookbooks.$inferInsert> = { updatedAt: new Date() }
  if (patch.name !== undefined) update.name = patch.name
  if (patch.description !== undefined) update.description = patch.description
  if (patch.emoji !== undefined) update.emoji = patch.emoji
  const [updated] = await db
    .update(cookbooks)
    .set(update)
    .where(and(eq(cookbooks.id, cookbookId), eq(cookbooks.householdId, householdId)))
    .returning()
  if (!updated) return null
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(cookbookRecipes)
    .where(eq(cookbookRecipes.cookbookId, cookbookId))
  return {
    id: updated.id,
    householdId: updated.householdId,
    name: updated.name,
    description: updated.description ?? null,
    emoji: updated.emoji ?? null,
    recipeCount: Number(count),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  }
}

export async function deleteCookbookForUser(
  userId: string,
  cookbookId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return false
  const result = await db
    .delete(cookbooks)
    .where(and(eq(cookbooks.id, cookbookId), eq(cookbooks.householdId, householdId)))
    .returning({ id: cookbooks.id })
  return result.length > 0
}

/** Idempotent add (does nothing if already in the cookbook). */
export async function addRecipeToCookbook(
  userId: string,
  cookbookId: string,
  recipeId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return false
  // Verify the cookbook is in our household (also doubles as the
  // authorization check).
  const [book] = await db
    .select({ id: cookbooks.id })
    .from(cookbooks)
    .where(and(eq(cookbooks.id, cookbookId), eq(cookbooks.householdId, householdId)))
    .limit(1)
  if (!book) return false
  await db
    .insert(cookbookRecipes)
    .values({ cookbookId, recipeId })
    .onConflictDoNothing()
  return true
}

export async function removeRecipeFromCookbook(
  userId: string,
  cookbookId: string,
  recipeId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return false
  const [book] = await db
    .select({ id: cookbooks.id })
    .from(cookbooks)
    .where(and(eq(cookbooks.id, cookbookId), eq(cookbooks.householdId, householdId)))
    .limit(1)
  if (!book) return false
  await db
    .delete(cookbookRecipes)
    .where(and(eq(cookbookRecipes.cookbookId, cookbookId), eq(cookbookRecipes.recipeId, recipeId)))
  return true
}

/**
 * Which cookbooks contain this recipe? Scoped to the caller's household.
 * Used on the recipe detail page to render the "Añadir a cookbook" sheet.
 */
export async function listCookbooksForRecipe(
  userId: string,
  recipeId: string,
  db: Db = defaultDb,
): Promise<Array<{ cookbookId: string; name: string; emoji: string | null }>> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return []
  const rows = await db
    .select({
      cookbookId: cookbooks.id,
      name: cookbooks.name,
      emoji: cookbooks.emoji,
    })
    .from(cookbookRecipes)
    .innerJoin(cookbooks, eq(cookbooks.id, cookbookRecipes.cookbookId))
    .where(and(eq(cookbookRecipes.recipeId, recipeId), eq(cookbooks.householdId, householdId)))
  return rows.map((r) => ({
    cookbookId: r.cookbookId,
    name: r.name,
    emoji: r.emoji ?? null,
  }))
}
