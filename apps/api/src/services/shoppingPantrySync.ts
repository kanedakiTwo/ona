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
