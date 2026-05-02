import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { menus, shoppingLists, users } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { generateShoppingList } from '../services/shoppingList.js'
import type { DayMenu, HouseholdSize, ShoppingItem } from '@ona/shared'

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

    // Fetch user for household size
    const [user] = await db
      .select({ householdSize: users.householdSize })
      .from(users)
      .where(eq(users.id, menu.userId))
      .limit(1)

    const householdSize = (user?.householdSize as HouseholdSize) ?? 'couple'
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
    const items = await generateShoppingList(days, householdSize, db)

    // Save to shopping_lists table
    const [list] = await db
      .insert(shoppingLists)
      .values({
        userId: menu.userId,
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

    if (list.userId !== userId) {
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
      .select({ householdSize: users.householdSize })
      .from(users)
      .where(eq(users.id, menu.userId))
      .limit(1)

    const householdSize = (user?.householdSize as HouseholdSize) ?? 'couple'
    const items = await generateShoppingList(menu.days as DayMenu[], householdSize, db)

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

export default router
