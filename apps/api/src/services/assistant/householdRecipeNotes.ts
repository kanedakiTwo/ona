/**
 * PRO-1071 · the household's notes on a recipe, for Mimo's recipe tools.
 *
 * Carmen y Antonio wrote «Una pizca de comino al final.» on their «Lentejas
 * guisadas» and «vale la pescadilla» on their «Pescado a la plancha». The app
 * shows it (`GET /recipes/:id/notes`), but no tool that reads a recipe for
 * Mimo did: Mimo said «no hay ninguna nota», invented one from the recipe's
 * own «Trucos», or «el texto de la nota no me aparece» (2026-10-28 to
 * 2026-11-18). get_recipe_details, search_recipes and recipe_variation now
 * read the household's row in `recipe_notes` (the same as the web ficha) and
 * say it word for word, apart from the recipe's tips.
 */

import { and, eq, inArray } from 'drizzle-orm'
import { recipeNotes } from '../../db/schema.js'
import { getPrimaryHouseholdId } from '../scopeResolver.js'

export interface HouseholdRecipeNote {
  notes: string | null
  substitutions: string | null
}

/** The household's notes and substitutions per recipe id (only recipes that have some). */
export async function loadHouseholdRecipeNotes(
  userId: string,
  recipeIds: readonly string[],
  db: any,
): Promise<Map<string, HouseholdRecipeNote>> {
  const out = new Map<string, HouseholdRecipeNote>()
  const ids = [...new Set(recipeIds.filter(Boolean))]
  if (ids.length === 0) return out
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return out
  const rows: Array<{ recipeId: string; notes: string | null; substitutions: string | null }> = await db
    .select({ recipeId: recipeNotes.recipeId, notes: recipeNotes.notes, substitutions: recipeNotes.substitutions })
    .from(recipeNotes)
    .where(and(eq(recipeNotes.householdId, householdId), inArray(recipeNotes.recipeId, ids)))
  for (const r of rows ?? []) {
    const notes = cleanNote(r.notes)
    const substitutions = cleanNote(r.substitutions)
    if (notes || substitutions) out.set(r.recipeId, { notes, substitutions })
  }
  return out
}

/**
 * The note as written, one line per line, without a line repeated (Carmen's
 * comino is saved twice: Mimo reads it once). Control characters go, the
 * words stay. Null when there's nothing.
 */
export function cleanNote(raw: string | null | undefined, max = 600): string | null {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const line of String(raw ?? '').split(/\r?\n/)) {
    const l = line.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
    const key = l.toLowerCase()
    if (!l || seen.has(key)) continue
    seen.add(key)
    lines.push(l)
  }
  const text = lines.join(' / ')
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** The lines Mimo reads: the note word for word, or that there's none. */
export function householdNoteLines(note: HouseholdRecipeNote | null | undefined): string[] {
  const lines: string[] = []
  if (note?.notes) lines.push(`Nota del hogar en esta receta (citala tal cual, entre comillas): «${note.notes}»`)
  if (note?.substitutions) lines.push(`Sustituciones apuntadas por el hogar en esta receta: «${note.substitutions}»`)
  if (lines.length === 0) lines.push('Nota del hogar en esta receta: ninguna.')
  return lines
}

/** Short form for a list of recipes (search_recipes): only the ones with a note. */
export function householdNoteInline(note: HouseholdRecipeNote | null | undefined): string {
  if (!note) return ''
  const parts = [
    note.notes ? `nota del hogar: «${note.notes}»` : null,
    note.substitutions ? `sustituciones del hogar: «${note.substitutions}»` : null,
  ].filter(Boolean)
  return parts.join('; ')
}
