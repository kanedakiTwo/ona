import type { BuyableUnit, ShoppingItem } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { addPantryForUser, deletePantryForUser, listPantryForUser, NoHouseholdError, patchPantryForUser, type AddPantryInput } from './pantryStore.js'
import { pantryRowsFor, withPantryAtHome } from './shoppingPantry.js'
import type { ConvertQty } from './shoppingItemState.js'

type Db = typeof defaultDb

/**
 * «En casa» on a line writes the pantry (PRO-1265), so the next rebuild,
 * which only keeps «en casa» what the pantry has, keeps it: as much as the
 * line asks (a row with less is raised to it; one with more, or in a unit
 * that doesn't compare, is left alone). Taken out of «en casa», the rows
 * that backed it go. The web's «En casa» / «Quitar» and Mimo's «tengo X».
 */
export async function syncPantryForLine(
  userId: string,
  item: ShoppingItem,
  inStock: boolean,
  opts: { convert?: ConvertQty; location?: AddPantryInput['location']; db?: Db } = {},
): Promise<void> {
  const { convert, location, db = defaultDb } = opts
  const rows = pantryRowsFor(item, await listPantryForUser(userId, db))
  if (!inStock) {
    for (const r of rows) await deletePantryForUser(userId, r.id, db)
    return
  }
  if (withPantryAtHome([{ ...item, inStock: true }], rows, convert)[0].inStock) return
  const unit = item.unit as BuyableUnit
  try {
    if (rows[0]) await patchPantryForUser(userId, rows[0].id, { quantity: item.quantity, unit, ...(location ? { location } : {}) }, db)
    else {
      const menuLine = item.kind !== 'manual' && item.kind !== 'staple' && item.ingredientId
      await addPantryForUser(
        userId,
        { name: item.name.trim().slice(0, 80), quantity: item.quantity, unit, location, ...(menuLine ? { ingredientId: item.ingredientId } : {}) },
        db,
      )
    }
  } catch (err) {
    if (!(err instanceof NoHouseholdError)) throw err
  }
}

/**
 * «¿Cuánto os queda en casa?» on a line (PRO-182) is what the pantry holds
 * of it (PRO-1265): the row that backs it gets that amount, in the line's
 * unit (it's what's left, not added), or a new row; 0 takes it out.
 */
export async function setPantryAmountForLine(userId: string, item: ShoppingItem, have: number, db: Db = defaultDb): Promise<void> {
  const rows = pantryRowsFor(item, await listPantryForUser(userId, db))
  if (!(have > 0)) {
    for (const r of rows) await deletePantryForUser(userId, r.id, db)
    return
  }
  const unit = item.unit as BuyableUnit
  try {
    if (rows[0]) {
      await patchPantryForUser(userId, rows[0].id, { quantity: have, unit }, db)
      // One row says how much there is: the rest that matched would add up on top.
      for (const r of rows.slice(1)) await deletePantryForUser(userId, r.id, db)
    } else {
      await addPantryForUser(userId, { name: item.name.trim().slice(0, 80), quantity: have, unit, ...(item.ingredientId ? { ingredientId: item.ingredientId } : {}) }, db)
    }
  } catch (err) {
    if (!(err instanceof NoHouseholdError)) throw err
  }
}
