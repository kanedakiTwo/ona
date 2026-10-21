/**
 * «Habitual» from the shopping list (PRO-293): a line of /shopping becomes
 * one of the household's staples (`household_staples`, «Mis básicos»), so it
 * comes back by itself on every new list; switching it off pauses the staple
 * (`active = false`), it never deletes it.
 *
 * A staple joins a menu line of the same name (the dedup rule of
 * `mergeStaplesIntoItems`: trimmed, case-insensitive), so a menu line marked
 * habitual stays a menu line this week and shows as habitual; a week whose
 * menu doesn't have it gets the staple line instead. A manual line marked
 * habitual turns into the staple line (it would be on the list twice).
 */
import type { ShoppingItem } from '@ona/shared'
import { addStapleForUser, listStaplesForUser, patchStapleForUser, type StapleRow } from './staplesStore.js'

export const stapleNameKey = (name: string) => name.trim().toLowerCase()

/** Same id `mergeStaplesIntoItems` gives a staple line. */
export const stapleItemId = (name: string) => `staple:${stapleNameKey(name).replace(/\s+/g, '-')}`

/** Menu and manual lines whose name is an active staple read «Habitual» (`habitual: true`); staple lines are by kind. */
export function withHabitual(items: ShoppingItem[], activeStapleNames: readonly string[]): ShoppingItem[] {
  const names = new Set(activeStapleNames.map(stapleNameKey))
  return items.map((it) => {
    if (it.kind === 'staple') return it
    if (names.has(stapleNameKey(it.name))) return { ...it, habitual: true }
    if (it.habitual) {
      const { habitual: _gone, ...rest } = it
      return rest
    }
    return it
  })
}

/** What a staple made from a line keeps: its name, amount, unit, aisle and price. */
export function stapleFromLine(item: ShoppingItem) {
  return {
    name: item.name.trim().slice(0, 80),
    quantity: item.quantity > 0 ? item.quantity : 1,
    unit: item.unit,
    aisle: item.aisle,
    pricePerUnit: item.pricePerUnit ?? null,
  }
}

/**
 * The rows of the list after marking `item` habitual (on) or not (off):
 * a manual line becomes the staple line; a staple line switched off leaves
 * the list; a menu line just carries the flag. Pure: returns new rows.
 */
export function applyHabitualToRows(items: ShoppingItem[], item: ShoppingItem, on: boolean): ShoppingItem[] {
  if (on) {
    if (item.kind === 'manual') {
      const staple: ShoppingItem = {
        ...stapleFromLine(item),
        id: stapleItemId(item.name),
        ingredientId: null,
        checked: item.checked,
        inStock: item.inStock,
        kind: 'staple',
      }
      return items.flatMap((it) => (it.id === item.id ? [staple] : it.kind === 'staple' && it.id === staple.id ? [] : [it]))
    }
    return items.map((it) => (it.id === item.id && it.kind !== 'staple' ? { ...it, habitual: true } : it))
  }
  if (item.kind === 'staple') return items.filter((it) => it.id !== item.id)
  return items.map((it) => {
    if (it.id !== item.id) return it
    const { habitual: _gone, ...rest } = it
    return rest
  })
}

/**
 * Create or switch on (on) / pause (off) the staple for a line. With `on`,
 * an existing staple of that name (paused or not) is switched on with the
 * line's amount; otherwise one is created. Returns the staple touched, or
 * null when there was nothing to pause.
 */
export async function setStapleForLine(userId: string, item: ShoppingItem, on: boolean): Promise<StapleRow | null> {
  const rows = await listStaplesForUser(userId)
  const same = rows.filter((r) => stapleNameKey(r.name) === stapleNameKey(item.name))
  if (!on) {
    let last: StapleRow | null = null
    for (const r of same.filter((s) => s.active)) last = await patchStapleForUser(userId, r.id, { active: false })
    return last
  }
  const data = stapleFromLine(item)
  // A staple line keeps its own amount: it already is the staple.
  if (same[0]) return patchStapleForUser(userId, same[0].id, item.kind === 'staple' ? { active: true } : { ...data, active: true })
  return addStapleForUser(userId, data)
}
