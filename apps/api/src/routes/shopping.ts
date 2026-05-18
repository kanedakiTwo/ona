import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { db } from '../db/connection.js'
import { menus, shoppingLists, users } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  computeListTotal,
  generateShoppingList,
  mergeStaplesIntoItems,
} from '../services/shoppingList.js'
import { getPrimaryHouseholdId, resolveScope } from '../services/scopeResolver.js'
import { listActiveStaplesForHousehold } from '../services/staplesStore.js'
import {
  AISLES,
  UNITS,
  householdMultiplier,
  householdSizeToCounts,
  type Aisle,
  type DayMenu,
  type HouseholdSize,
  type ShoppingItem,
} from '@ona/shared'

const BUYABLE_UNITS = new Set<string>(['g', 'ml', 'u', 'cda', 'cdita'])
const AISLE_SET = new Set<string>(AISLES)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Pull the user's authoritative household sizing, falling back to the legacy
 * `householdSize` enum if `adults`/`kidsCount` haven't been set yet (e.g. a
 * user who registered before the migration and hasn't visited /profile to
 * set the new fields). */
function multiplierForUser(user: {
  adults?: number | null
  kidsCount?: number | null
  householdSize?: string | null
}): number {
  if (typeof user.adults === 'number' && user.adults > 0) {
    return householdMultiplier(user.adults, user.kidsCount ?? 0)
  }
  const counts = householdSizeToCounts(user.householdSize as HouseholdSize | null | undefined)
  return householdMultiplier(counts.adults, counts.kidsCount)
}

const router = Router()

// All routes require auth
router.use(authMiddleware)

// GET /shopping-list/:menuId - generate shopping list from menu
router.get('/shopping-list/:menuId', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)

    // Fetch the menu
    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, menuId))
      .limit(1)

    if (!menu) {
      res.status(404).json({ error: 'Menu not found' })
      return
    }

    // Fetch user for household sizing (prefers adults+kidsCount, falls back
    // to legacy householdSize until everyone has updated their profile).
    const [user] = await db
      .select({
        adults: users.adults,
        kidsCount: users.kidsCount,
        householdSize: users.householdSize,
      })
      .from(users)
      .where(eq(users.id, menu.userId))
      .limit(1)

    const multiplier = multiplierForUser(user ?? {})
    const days = menu.days as DayMenu[]

    // Check if a shopping list already exists for this menu
    const [existing] = await db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.menuId, menuId))
      .limit(1)

    if (existing) {
      res.json(existing)
      return
    }

    // Generate the shopping list
    const menuItems = await generateShoppingList(days, multiplier, db)

    // PR 10B: pre-pend household staples (dedup'd by case-insensitive name).
    const householdId = menu.householdId ?? (await getPrimaryHouseholdId(menu.userId))
    const staples = householdId ? await listActiveStaplesForHousehold(householdId) : []
    const items = mergeStaplesIntoItems(menuItems, staples)

    // Save to shopping_lists table — dual-write the menu's household id
    // (resolves on user when missing) so household members share the list.
    const [list] = await db
      .insert(shoppingLists)
      .values({
        userId: menu.userId,
        householdId,
        menuId,
        items,
      })
      .returning()

    res.json(list)
  } catch (err) {
    console.error('Get shopping list error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /shopping-list/:listId/item/:itemId/check - toggle checked status
router.put('/shopping-list/:listId/item/:itemId/check', async (req: AuthRequest, res) => {
  try {
    const listId = String(req.params.listId)
    const itemId = String(req.params.itemId)

    const [list] = await db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.id, listId))
      .limit(1)

    if (!list) {
      res.status(404).json({ error: 'Shopping list not found' })
      return
    }

    const items = list.items as ShoppingItem[]
    const item = items.find((i) => i.id === itemId)

    if (!item) {
      res.status(404).json({ error: 'Item not found' })
      return
    }

    item.checked = !item.checked

    const [updated] = await db
      .update(shoppingLists)
      .set({ items })
      .where(eq(shoppingLists.id, listId))
      .returning()

    res.json(updated)
  } catch (err) {
    console.error('Toggle check error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /shopping-list/:listId/item/:itemId/stock - toggle inStock status
router.put('/shopping-list/:listId/item/:itemId/stock', async (req: AuthRequest, res) => {
  try {
    const listId = String(req.params.listId)
    const itemId = String(req.params.itemId)

    const [list] = await db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.id, listId))
      .limit(1)

    if (!list) {
      res.status(404).json({ error: 'Shopping list not found' })
      return
    }

    const items = list.items as ShoppingItem[]
    const item = items.find((i) => i.id === itemId)

    if (!item) {
      res.status(404).json({ error: 'Item not found' })
      return
    }

    item.inStock = !item.inStock

    const [updated] = await db
      .update(shoppingLists)
      .set({ items })
      .where(eq(shoppingLists.id, listId))
      .returning()

    res.json(updated)
  } catch (err) {
    console.error('Toggle stock error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /shopping-list/:listId/regenerate - rebuild items from the source menu
router.post('/shopping-list/:listId/regenerate', async (req: AuthRequest, res) => {
  try {
    const listId = String(req.params.listId)
    const userId = req.userId

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }

    const [list] = await db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.id, listId))
      .limit(1)

    if (!list) {
      res.status(404).json({ error: 'Shopping list not found' })
      return
    }

    // Access check: legacy = list.userId == userId. Household-scoped = any
    // member of the list's household can regenerate. `resolveScope` reads
    // the requester's primary household; if that matches the list's
    // household_id (or list belongs to the requester directly), allow.
    const requesterScope = await resolveScope(userId)
    const userOwns = list.userId === userId
    const sameHousehold =
      requesterScope.kind === 'household' &&
      list.householdId != null &&
      list.householdId === requesterScope.value
    if (!userOwns && !sameHousehold) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    if (!list.menuId) {
      res.status(400).json({ error: 'Shopping list has no source menu' })
      return
    }

    const [menu] = await db
      .select()
      .from(menus)
      .where(eq(menus.id, list.menuId))
      .limit(1)

    if (!menu) {
      res.status(404).json({ error: 'Source menu not found' })
      return
    }

    const [user] = await db
      .select({
        adults: users.adults,
        kidsCount: users.kidsCount,
        householdSize: users.householdSize,
      })
      .from(users)
      .where(eq(users.id, menu.userId))
      .limit(1)

    const multiplier = multiplierForUser(user ?? {})
    const menuItems = await generateShoppingList(menu.days as DayMenu[], multiplier, db)

    // PR 10B: regenerate rebuilds menu items from scratch but preserves
    // user-authored extras — manual rows and the price the user typed on
    // them — and re-applies staples. Order: menu → manual (kept) → staples.
    const previousItems = (list.items ?? []) as ShoppingItem[]
    const manualKept = previousItems.filter((i) => i.kind === 'manual')
    const householdId = list.householdId ?? menu.householdId ?? null
    const staples = householdId ? await listActiveStaplesForHousehold(householdId) : []
    const itemsBeforeStaples = [...menuItems, ...manualKept]
    const items = mergeStaplesIntoItems(itemsBeforeStaples, staples)

    const [updated] = await db
      .update(shoppingLists)
      .set({ items })
      .where(eq(shoppingLists.id, listId))
      .returning()

    res.json(updated)
  } catch (err) {
    console.error('Regenerate shopping list error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ─── PR 10: manual items + prices + totals ───────────────────────────────

const addItemSchema = z.object({
  name: z.string().min(1).max(80),
  quantity: z.number().positive().max(10_000).optional(),
  unit: z.string().refine((u) => BUYABLE_UNITS.has(u)).optional(),
  aisle: z.string().refine((a) => AISLE_SET.has(a)).optional(),
  pricePerUnit: z.number().nonnegative().max(10_000).nullable().optional(),
})

const patchItemSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  quantity: z.number().positive().max(10_000).optional(),
  unit: z.string().refine((u) => BUYABLE_UNITS.has(u)).optional(),
  aisle: z.string().refine((a) => AISLE_SET.has(a)).optional(),
  pricePerUnit: z.number().nonnegative().max(10_000).nullable().optional(),
})

/** Access check shared by all item-mutation routes. PR 1B: any household
 *  member can touch the household's list. Pre-PR-1B: list.userId == userId. */
async function loadListForCaller(listId: string, userId: string) {
  const [list] = await db
    .select()
    .from(shoppingLists)
    .where(eq(shoppingLists.id, listId))
    .limit(1)
  if (!list) return { list: null as null, forbidden: false }
  const scope = await resolveScope(userId)
  const userOwns = list.userId === userId
  const sameHousehold =
    scope.kind === 'household' &&
    list.householdId != null &&
    list.householdId === scope.value
  if (!userOwns && !sameHousehold) return { list: null as null, forbidden: true }
  return { list, forbidden: false }
}

// POST /shopping-list/:listId/items — append a manual free-text item.
router.post('/shopping-list/:listId/items', async (req: AuthRequest, res) => {
  try {
    const listId = String(req.params.listId)
    if (!UUID_RE.test(listId)) {
      res.status(400).json({ error: 'listId must be a UUID' })
      return
    }
    const parsed = addItemSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos invalidos', issues: parsed.error.issues })
      return
    }
    const { list, forbidden } = await loadListForCaller(listId, req.userId!)
    if (!list) {
      res.status(forbidden ? 403 : 404).json({ error: forbidden ? 'Forbidden' : 'Shopping list not found' })
      return
    }
    const items = (list.items as ShoppingItem[]).slice()
    const newItem: ShoppingItem = {
      id: randomUUID(),
      ingredientId: null,
      name: parsed.data.name.trim(),
      quantity: parsed.data.quantity ?? 1,
      unit: (parsed.data.unit as ShoppingItem['unit']) ?? 'u',
      aisle: (parsed.data.aisle as Aisle) ?? 'otros',
      checked: false,
      inStock: false,
      kind: 'manual',
      pricePerUnit: parsed.data.pricePerUnit ?? null,
    }
    items.push(newItem)
    const [updated] = await db
      .update(shoppingLists)
      .set({ items })
      .where(eq(shoppingLists.id, listId))
      .returning()
    res.status(201).json(updated)
  } catch (err) {
    console.error('Add manual item error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// PATCH /shopping-list/:listId/item/:itemId — partial update.
//   Allowed on manual items: name, quantity, unit, aisle, pricePerUnit.
//   Allowed on menu items: pricePerUnit only (pricing your generated list).
router.patch('/shopping-list/:listId/item/:itemId', async (req: AuthRequest, res) => {
  try {
    const listId = String(req.params.listId)
    const itemId = String(req.params.itemId)
    if (!UUID_RE.test(listId) || !UUID_RE.test(itemId)) {
      res.status(400).json({ error: 'IDs must be UUIDs' })
      return
    }
    const parsed = patchItemSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Datos invalidos', issues: parsed.error.issues })
      return
    }
    const { list, forbidden } = await loadListForCaller(listId, req.userId!)
    if (!list) {
      res.status(forbidden ? 403 : 404).json({ error: forbidden ? 'Forbidden' : 'Shopping list not found' })
      return
    }
    const items = (list.items as ShoppingItem[]).slice()
    const idx = items.findIndex((i) => i.id === itemId)
    if (idx < 0) {
      res.status(404).json({ error: 'Item not found' })
      return
    }
    const current = items[idx]
    const isManual = current.kind === 'manual'
    const patch = parsed.data
    const next: ShoppingItem = { ...current }
    if (patch.pricePerUnit !== undefined) next.pricePerUnit = patch.pricePerUnit
    if (isManual) {
      if (patch.name !== undefined) next.name = patch.name.trim()
      if (patch.quantity !== undefined) next.quantity = patch.quantity
      if (patch.unit !== undefined) next.unit = patch.unit as ShoppingItem['unit']
      if (patch.aisle !== undefined) next.aisle = patch.aisle as Aisle
    } else if (
      patch.name !== undefined ||
      patch.quantity !== undefined ||
      patch.unit !== undefined ||
      patch.aisle !== undefined
    ) {
      res.status(400).json({
        error:
          'Solo se puede editar el precio en items generados desde el menu. Crea uno manual para nombre / cantidad / pasillo.',
      })
      return
    }
    items[idx] = next
    const [updated] = await db
      .update(shoppingLists)
      .set({ items })
      .where(eq(shoppingLists.id, listId))
      .returning()
    res.json(updated)
  } catch (err) {
    console.error('PATCH item error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// DELETE /shopping-list/:listId/item/:itemId — manual items only.
router.delete('/shopping-list/:listId/item/:itemId', async (req: AuthRequest, res) => {
  try {
    const listId = String(req.params.listId)
    const itemId = String(req.params.itemId)
    if (!UUID_RE.test(listId) || !UUID_RE.test(itemId)) {
      res.status(400).json({ error: 'IDs must be UUIDs' })
      return
    }
    const { list, forbidden } = await loadListForCaller(listId, req.userId!)
    if (!list) {
      res.status(forbidden ? 403 : 404).json({ error: forbidden ? 'Forbidden' : 'Shopping list not found' })
      return
    }
    const items = (list.items as ShoppingItem[]).slice()
    const idx = items.findIndex((i) => i.id === itemId)
    if (idx < 0) {
      res.status(404).json({ error: 'Item not found' })
      return
    }
    if (items[idx].kind !== 'manual') {
      res.status(400).json({
        error:
          'Solo se pueden borrar items manuales. Los items generados desde el menu desaparecen al regenerar la lista.',
      })
      return
    }
    items.splice(idx, 1)
    const [updated] = await db
      .update(shoppingLists)
      .set({ items })
      .where(eq(shoppingLists.id, listId))
      .returning()
    res.json(updated)
  } catch (err) {
    console.error('DELETE item error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// GET /shopping-list/:listId/totals — { totalEur, pricedCount, unpricedCount }.
router.get('/shopping-list/:listId/totals', async (req: AuthRequest, res) => {
  try {
    const listId = String(req.params.listId)
    if (!UUID_RE.test(listId)) {
      res.status(400).json({ error: 'listId must be a UUID' })
      return
    }
    const { list, forbidden } = await loadListForCaller(listId, req.userId!)
    if (!list) {
      res.status(forbidden ? 403 : 404).json({ error: forbidden ? 'Forbidden' : 'Shopping list not found' })
      return
    }
    res.json(computeListTotal(list.items as ShoppingItem[]))
  } catch (err) {
    console.error('GET totals error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
