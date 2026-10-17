/**
 * Registro de cambios del menú (PRO-149, specs/menus.md «Registro de cambios»).
 *
 * Every route in routes/menus.ts that changes which recipes a menu holds
 * writes here, once, after its own update: one row per recipe that went out
 * or came in, with the day and meal, who did it (`user` in the app or `mimo`)
 * and where (`web` or `whatsapp`). Generating a menu is not an edit.
 *
 * Mimo's tools that change the menu call those same routes over loopback
 * (assistant/appApi.ts) with the header `x-mimoia-internal` and the
 * conversation's channel in `x-mimoia-channel`, so they land here as `mimo`
 * without any code of their own.
 *
 * The pure helpers build the rows from the slot before and after; the write
 * never throws and never blocks the user's change (best-effort like the
 * usage events), because losing one signal is better than failing a swap.
 */
import { inArray } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { menuEdits, recipes } from '../db/schema.js'
import type { Dish, MealSlot } from '@ona/shared'
import { INTERNAL_CALL_HEADER } from './usageEvents.js'

export const MENU_EDIT_ACTIONS = ['swap', 'add', 'remove', 'ban', 'skip_day', 'move', 'leftover', 'freezer'] as const
export type MenuEditAction = (typeof MENU_EDIT_ACTIONS)[number]
export type MenuEditActor = 'user' | 'mimo'
export type MenuEditChannel = 'web' | 'whatsapp'

/** Header with the conversation's channel on Mimo's loopback calls (appApi.ts). */
export const CHANNEL_HEADER = 'x-mimoia-channel'

export interface RecipeRef {
  id: string
  name: string | null
}

/** One change, before it gets the menu / household / who. */
export interface MenuEditChange {
  action: MenuEditAction
  day?: number | null
  meal?: string | null
  fromDay?: number | null
  fromMeal?: string | null
  before?: RecipeRef | null
  after?: RecipeRef | null
}

export interface MenuEditWho {
  actor: MenuEditActor
  channel: MenuEditChannel
}

/** Pure: who made the request. Loopback calls from Mimo carry the internal header. */
export function menuEditWho(req: { get?: (h: string) => string | undefined }): MenuEditWho {
  const internal = Boolean(req.get?.(INTERNAL_CALL_HEADER))
  if (!internal) return { actor: 'user', channel: 'web' }
  return { actor: 'mimo', channel: req.get?.(CHANNEL_HEADER) === 'whatsapp' ? 'whatsapp' : 'web' }
}

/** Pure: the recipe dishes of a slot, in order (notes skipped). */
export function slotRecipes(slot: MealSlot | { dishes?: Dish[] } | null | undefined): RecipeRef[] {
  const out: RecipeRef[] = []
  for (const d of slot?.dishes ?? []) {
    if (d.kind === 'recipe') out.push({ id: d.recipeId, name: d.recipeName ?? null })
  }
  return out
}

/** Pure: a dish as a recipe reference, or null for a note. */
export function dishRecipe(dish: Dish | null | undefined): RecipeRef | null {
  if (!dish || dish.kind !== 'recipe') return null
  return { id: dish.recipeId, name: dish.recipeName ?? null }
}

/**
 * Pure: the changes between a slot's dishes before and after a re-pick
 * (PUT on the slot, dish regenerate). Position by position: a different
 * recipe is a `swap`; a recipe where there was none is an `add`; one that
 * disappeared is a `remove`. Unchanged positions leave no row.
 */
export function slotDiff(day: number, meal: string, before: Dish[] | undefined, after: Dish[] | undefined): MenuEditChange[] {
  const b = before ?? []
  const a = after ?? []
  const changes: MenuEditChange[] = []
  const len = Math.max(b.length, a.length)
  for (let i = 0; i < len; i++) {
    const from = dishRecipe(b[i])
    const to = dishRecipe(a[i])
    if (from && to) {
      if (from.id !== to.id) changes.push({ action: 'swap', day, meal, before: from, after: to })
    } else if (to) {
      changes.push({ action: 'add', day, meal, after: to })
    } else if (from) {
      changes.push({ action: 'remove', day, meal, before: from })
    }
  }
  return changes
}

/** Pure: one row per recipe of a slot that was removed (`remove` or `skip_day`). */
export function slotRemoved(action: 'remove' | 'skip_day', day: number, meal: string, slot: MealSlot | undefined): MenuEditChange[] {
  return slotRecipes(slot).map((r) => ({ action, day, meal, before: r }))
}

/**
 * Pure: the rows for a move between two slots. Each recipe that changed place
 * is one `move` row, from its old slot to its new one (a swap of two full
 * slots gives rows in both directions).
 */
export function moveChanges(
  from: { day: number; meal: string; slot: MealSlot | undefined },
  to: { day: number; meal: string; slot: MealSlot | undefined },
): MenuEditChange[] {
  const out: MenuEditChange[] = []
  for (const r of slotRecipes(from.slot)) {
    out.push({ action: 'move', day: to.day, meal: to.meal, fromDay: from.day, fromMeal: from.meal, after: r })
  }
  for (const r of slotRecipes(to.slot)) {
    out.push({ action: 'move', day: from.day, meal: from.meal, fromDay: to.day, fromMeal: to.meal, after: r })
  }
  return out
}

export interface MenuRef {
  id: string
  householdId: string | null
}

/** Pure: the rows to insert. */
export function menuEditRows(menu: MenuRef, userId: string | null, who: MenuEditWho, changes: MenuEditChange[]) {
  return changes.map((c) => ({
    householdId: menu.householdId,
    menuId: menu.id,
    userId,
    day: c.day ?? null,
    meal: c.meal ?? null,
    fromDay: c.fromDay ?? null,
    fromMeal: c.fromMeal ?? null,
    action: c.action,
    beforeRecipeId: c.before?.id ?? null,
    beforeRecipeName: c.before?.name ?? null,
    afterRecipeId: c.after?.id ?? null,
    afterRecipeName: c.after?.name ?? null,
    actor: who.actor,
    channel: who.channel,
  }))
}

/**
 * Record the changes a request made to a menu. The single write point for
 * routes/menus.ts. Never throws; nothing to record → no query.
 */
export async function recordMenuEdits(
  req: { userId?: string; get?: (h: string) => string | undefined },
  menu: MenuRef,
  changes: MenuEditChange[],
): Promise<void> {
  if (changes.length === 0) return
  try {
    // Some paths only know the recipe id (a dish added by id, a veto): fill
    // the names with one query so every row reads on its own.
    const missing = new Set<string>()
    for (const c of changes) {
      for (const r of [c.before, c.after]) if (r && !r.name) missing.add(r.id)
    }
    if (missing.size > 0) {
      const rows = await db.select({ id: recipes.id, name: recipes.name }).from(recipes).where(inArray(recipes.id, [...missing]))
      const names = new Map(rows.map((r) => [r.id, r.name]))
      for (const c of changes) {
        if (c.before && !c.before.name) c.before = { ...c.before, name: names.get(c.before.id) ?? null }
        if (c.after && !c.after.name) c.after = { ...c.after, name: names.get(c.after.id) ?? null }
      }
    }
    await db.insert(menuEdits).values(menuEditRows(menu, req.userId ?? null, menuEditWho(req), changes))
  } catch (err: any) {
    console.warn('[menu-edits] record failed (ignored):', err?.message ?? err)
  }
}
