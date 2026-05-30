/**
 * recipe_notes business logic (PR 7).
 *
 * Per-household consumer notes / rating / substitutions on a recipe.
 * Distinct from `recipes.notes` (author's note) — this is "we thought it
 * was a bit salty, swap onion for leek next time".
 *
 * Reads + writes are scoped to the caller's primary household. Any
 * household member can read or upsert; concurrent edits last-write-win
 * (no merge UX yet).
 */

import { and, eq, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { recipeNotes, users } from '../db/schema.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'
import { ingredientOverrideSchema, type IngredientOverride } from '@ona/shared'

type Db = typeof defaultDb

const MAX_TEXT_LEN = 1000

/** Max custom tags per (household, recipe). */
const MAX_CUSTOM_TAGS = 10
const MAX_CUSTOM_TAG_LEN = 30

/** Max structured ingredient overrides per (household, recipe). */
const MAX_INGREDIENT_OVERRIDES = 50

/** What the route exchanges with the client. */
export interface NotesShape {
  notes: string | null
  rating: number | null
  substitutions: string | null
  /** PR 8B. Always an array (possibly empty). */
  customTags: string[]
  /**
   * Structured per-(household, recipe) ingredient edits. See
   * `IngredientOverride` in `@ona/shared`. Always an array (possibly empty).
   */
  ingredientOverrides: IngredientOverride[]
}

export interface NotesPatch {
  notes?: string | null
  rating?: number | null
  substitutions?: string | null
  customTags?: unknown
  ingredientOverrides?: unknown
}

export interface NotesRow extends NotesShape {
  recipeId: string
  householdId: string
  lastEditedByUserId: string | null
  /** Decorated client-side; null if user record was deleted. */
  lastEditedByUsername: string | null
  createdAt: string
  updatedAt: string
}

// ─── pure helpers (unit-tested) ──────────────────────────────────────────

export type RatingValidation =
  | { ok: true; value: number | null }
  | { ok: false; reason: string }

export function validateRating(raw: unknown): RatingValidation {
  if (raw === null || raw === undefined) return { ok: true, value: null }
  if (typeof raw !== 'number') return { ok: false, reason: 'rating must be a number' }
  if (!Number.isInteger(raw)) return { ok: false, reason: 'rating must be an integer' }
  if (raw < 1 || raw > 5) return { ok: false, reason: 'rating must be between 1 and 5' }
  return { ok: true, value: raw }
}

/**
 * Pure sanitizer for the `customTags` field — exported so the unit test
 * exercises the same code path the route uses. Rules:
 *   - non-array input → []
 *   - each entry: trim, lowercase, truncate at 30 chars
 *   - drop empty / whitespace / non-string entries
 *   - dedup case-insensitively, preserving first-occurrence order
 *   - cap the whole array at 10 entries
 */
/**
 * Pure sanitizer for `ingredientOverrides`. Validates each entry against
 * the shared zod schema; drops invalid entries silently (the UI shouldn't
 * be sending them, but a partial payload is better than a 400 that loses
 * the whole save). Dedupes 'remove' and 'modify' by `recipeIngredientId`
 * keeping the LAST entry, so the latest user edit wins; preserves all
 * 'add' entries (different additions are independent). Caps at 50.
 */
export function sanitizeIngredientOverrides(raw: unknown): IngredientOverride[] {
  if (!Array.isArray(raw)) return []
  const validated: IngredientOverride[] = []
  for (const entry of raw) {
    const parsed = ingredientOverrideSchema.safeParse(entry)
    if (parsed.success) validated.push(parsed.data)
  }
  // Last-write-wins per target for non-'add' kinds.
  const removeByTarget = new Map<string, IngredientOverride>()
  const modifyByTarget = new Map<string, IngredientOverride>()
  const adds: IngredientOverride[] = []
  for (const entry of validated) {
    if (entry.kind === 'remove') {
      removeByTarget.set(entry.recipeIngredientId, entry)
      modifyByTarget.delete(entry.recipeIngredientId)
    } else if (entry.kind === 'modify') {
      if (!removeByTarget.has(entry.recipeIngredientId)) {
        modifyByTarget.set(entry.recipeIngredientId, entry)
      }
    } else {
      adds.push(entry)
    }
  }
  const merged = [
    ...removeByTarget.values(),
    ...modifyByTarget.values(),
    ...adds,
  ]
  return merged.slice(0, MAX_INGREDIENT_OVERRIDES)
}

export function sanitizeCustomTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim().toLowerCase()
    if (trimmed === '') continue
    const capped = trimmed.slice(0, MAX_CUSTOM_TAG_LEN)
    if (seen.has(capped)) continue
    seen.add(capped)
    out.push(capped)
    if (out.length >= MAX_CUSTOM_TAGS) break
  }
  return out
}

function trimToNull(raw: string | null | undefined): string | null {
  if (raw === undefined) return null
  if (raw === null) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  return trimmed.slice(0, MAX_TEXT_LEN)
}

/**
 * Pure reducer — apply a partial `NotesPatch` onto an existing `NotesShape`.
 * Undefined fields preserve; explicit `null` clears; strings are trimmed
 * and capped at 1000 chars. Rating must pass `validateRating` separately
 * (the route does that before calling this, so this function trusts the
 * input shape).
 */
export function applyNotesPatch(current: NotesShape, patch: NotesPatch): NotesShape {
  const out: NotesShape = {
    ...current,
    customTags: [...current.customTags],
    ingredientOverrides: [...current.ingredientOverrides],
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'notes')) {
    out.notes = trimToNull(patch.notes ?? null)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'rating')) {
    out.rating = patch.rating ?? null
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'substitutions')) {
    out.substitutions = trimToNull(patch.substitutions ?? null)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'customTags')) {
    out.customTags = sanitizeCustomTags(patch.customTags)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'ingredientOverrides')) {
    out.ingredientOverrides = sanitizeIngredientOverrides(patch.ingredientOverrides)
  }
  return out
}

// ─── DB-backed operations ────────────────────────────────────────────────

export async function getRecipeNotesForUser(
  userId: string,
  recipeId: string,
  db: Db = defaultDb,
): Promise<NotesRow | null> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return null
  const [row] = await db
    .select({
      householdId: recipeNotes.householdId,
      recipeId: recipeNotes.recipeId,
      notes: recipeNotes.notes,
      rating: recipeNotes.rating,
      substitutions: recipeNotes.substitutions,
      customTags: recipeNotes.customTags,
      ingredientOverrides: recipeNotes.ingredientOverrides,
      lastEditedByUserId: recipeNotes.lastEditedByUserId,
      lastEditedByUsername: users.username,
      createdAt: recipeNotes.createdAt,
      updatedAt: recipeNotes.updatedAt,
    })
    .from(recipeNotes)
    .leftJoin(users, eq(users.id, recipeNotes.lastEditedByUserId))
    .where(and(eq(recipeNotes.householdId, householdId), eq(recipeNotes.recipeId, recipeId)))
    .limit(1)
  if (!row) return null
  return {
    householdId: row.householdId,
    recipeId: row.recipeId,
    notes: row.notes ?? null,
    rating: row.rating ?? null,
    substitutions: row.substitutions ?? null,
    customTags: row.customTags ?? [],
    // Defensive: sanitize on read in case malformed entries leaked in via a
    // direct DB write or a future bug. Keeps the route guaranteed-clean.
    ingredientOverrides: sanitizeIngredientOverrides(row.ingredientOverrides),
    lastEditedByUserId: row.lastEditedByUserId ?? null,
    lastEditedByUsername: row.lastEditedByUsername ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export class NoHouseholdError extends Error {
  constructor() {
    super('Tu cuenta aún no tiene un hogar asignado.')
    this.name = 'NoHouseholdError'
  }
}

/**
 * Upsert the household's notes for a recipe. Any household member can
 * call. `last_edited_by_user_id` records the latest editor for the audit.
 */
export async function upsertRecipeNotes(
  userId: string,
  recipeId: string,
  patch: NotesPatch,
  db: Db = defaultDb,
): Promise<NotesRow> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) throw new NoHouseholdError()

  // Load current state so the patch can preserve fields it doesn't touch.
  const [current] = await db
    .select({
      notes: recipeNotes.notes,
      rating: recipeNotes.rating,
      substitutions: recipeNotes.substitutions,
      customTags: recipeNotes.customTags,
      ingredientOverrides: recipeNotes.ingredientOverrides,
    })
    .from(recipeNotes)
    .where(and(eq(recipeNotes.householdId, householdId), eq(recipeNotes.recipeId, recipeId)))
    .limit(1)

  const merged = applyNotesPatch(
    current
      ? {
          notes: current.notes ?? null,
          rating: current.rating ?? null,
          substitutions: current.substitutions ?? null,
          customTags: current.customTags ?? [],
          ingredientOverrides: sanitizeIngredientOverrides(current.ingredientOverrides),
        }
      : {
          notes: null,
          rating: null,
          substitutions: null,
          customTags: [],
          ingredientOverrides: [],
        },
    patch,
  )

  await db
    .insert(recipeNotes)
    .values({
      householdId,
      recipeId,
      notes: merged.notes,
      rating: merged.rating,
      substitutions: merged.substitutions,
      customTags: merged.customTags,
      ingredientOverrides: merged.ingredientOverrides,
      lastEditedByUserId: userId,
    })
    .onConflictDoUpdate({
      target: [recipeNotes.householdId, recipeNotes.recipeId],
      set: {
        notes: merged.notes,
        rating: merged.rating,
        substitutions: merged.substitutions,
        customTags: merged.customTags,
        ingredientOverrides: merged.ingredientOverrides,
        lastEditedByUserId: userId,
        updatedAt: sql`NOW()`,
      },
    })

  const fresh = await getRecipeNotesForUser(userId, recipeId, db)
  if (!fresh) throw new Error('Failed to load notes after upsert')
  return fresh
}

/**
 * Distinct custom tags used across the household, with row counts.
 * Used for the catalog filter UI + tag chip suggestions on the editor.
 */
export async function listCustomTagsForHousehold(
  userId: string,
  db: Db = defaultDb,
): Promise<Array<{ tag: string; count: number }>> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return []
  const rows = await db
    .select({
      tag: sql<string>`unnest(${recipeNotes.customTags})`,
      count: sql<number>`COUNT(*)`,
    })
    .from(recipeNotes)
    .where(eq(recipeNotes.householdId, householdId))
    .groupBy(sql`unnest(${recipeNotes.customTags})`)
    .orderBy(sql`COUNT(*) DESC`)
  return rows.map((r) => ({ tag: r.tag, count: Number(r.count) }))
}
