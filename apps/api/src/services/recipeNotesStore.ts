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

type Db = typeof defaultDb

const MAX_TEXT_LEN = 1000

/** What the route exchanges with the client. */
export interface NotesShape {
  notes: string | null
  rating: number | null
  substitutions: string | null
}

export interface NotesPatch {
  notes?: string | null
  rating?: number | null
  substitutions?: string | null
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
  const out: NotesShape = { ...current }
  if (Object.prototype.hasOwnProperty.call(patch, 'notes')) {
    out.notes = trimToNull(patch.notes ?? null)
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'rating')) {
    out.rating = patch.rating ?? null
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'substitutions')) {
    out.substitutions = trimToNull(patch.substitutions ?? null)
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
        }
      : { notes: null, rating: null, substitutions: null },
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
      lastEditedByUserId: userId,
    })
    .onConflictDoUpdate({
      target: [recipeNotes.householdId, recipeNotes.recipeId],
      set: {
        notes: merged.notes,
        rating: merged.rating,
        substitutions: merged.substitutions,
        lastEditedByUserId: userId,
        updatedAt: sql`NOW()`,
      },
    })

  const fresh = await getRecipeNotesForUser(userId, recipeId, db)
  if (!fresh) throw new Error('Failed to load notes after upsert')
  return fresh
}
