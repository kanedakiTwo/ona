import { Router } from 'express'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
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
import { canAccessRow, getPrimaryHouseholdId, resolveScope } from '../services/scopeResolver.js'
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

// ─── Helpers: dates + meal-time cutoffs ──────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** YYYY-MM-DD in Europe/Madrid (the user-facing "today" — server can be in UTC). */
function todayInMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Hour of the day (0-23) in Europe/Madrid. Used by the "skip already-passed
 *  meals today" filter on the range aggregator. */
function hourInMadrid(): number {
  const s = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    hour12: false,
  }).format(new Date())
  return parseInt(s, 10)
}

/** Shift an ISO date by N days; returns ISO date. */
function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  // Use UTC to avoid DST corner cases — we're only doing date arithmetic.
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** Inclusive day-difference between two YYYY-MM-DD dates (b - a). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const da = Date.UTC(ay, am - 1, ad)
  const db = Date.UTC(by, bm - 1, bd)
  return Math.round((db - da) / (1000 * 60 * 60 * 24))
}

/** Map a date to its Monday week-start (ISO Mon-Sun grid). */
function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  // getUTCDay: 0=Sun..6=Sat. Map to Mon-based 0=Mon..6=Sun.
  const dow = (dt.getUTCDay() + 6) % 7
  dt.setUTCDate(dt.getUTCDate() - dow)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** Drop today's already-passed meal slots from a `DayMenu`. Cutoffs are
 *  generous so a user who scrolls the list around lunch still sees lunch
 *  ("comida" tagged as past once it's 16:00 Madrid). */
function filterPastTodayMeals(day: DayMenu | undefined, hour: number): DayMenu {
  if (!day) return {}
  const past = new Set<string>()
  if (hour >= 10) past.add('breakfast')
  if (hour >= 16) past.add('lunch')
  if (hour >= 19) past.add('snack')
  if (hour >= 23) past.add('dinner')
  const out: DayMenu = {}
  for (const k of Object.keys(day)) {
    if (!past.has(k)) out[k] = day[k]
  }
  return out
}

// GET /shopping-list/:menuId - generate shopping list from menu
/**
 * GET /shopping-list — rolling window list (auth-scoped).
 *
 *   Query params: `from`, `to` (both `YYYY-MM-DD`, both optional).
 *   Defaults: from = today (Madrid), to = end of next week (today's Monday
 *   + 13 days). The route looks up every menu in `[from, to]` that the
 *   caller's user (or household) owns, builds a synthetic day array, drops
 *   today's already-passed meals (cutoffs: breakfast 10:00, lunch 16:00,
 *   snack 19:00, dinner 23:00 Madrid time), and aggregates ingredients with
 *   the existing `generateShoppingList` pipeline.
 *
 *   The persisted `shopping_lists` row is overwritten on every read so the
 *   list always reflects the current menu state — manual items + `checked`/
 *   `inStock`/`pricePerUnit` survive via an overlay merge by ingredientId.
 *
 *   One row per user (or household when shared) — we delete prior rows for
 *   the user before inserting the fresh aggregate so historical staleness
 *   doesn't accumulate.
 */
router.get('/shopping-list', async (req: AuthRequest, res) => {
  try {
    const userId = req.userId!
    const todayMadrid = todayInMadrid()
    const hourMadrid = hourInMadrid()

    // Parse + validate range.
    const rawFrom = typeof req.query.from === 'string' ? req.query.from : null
    const rawTo = typeof req.query.to === 'string' ? req.query.to : null
    const from = rawFrom && ISO_DATE_RE.test(rawFrom) ? rawFrom : todayMadrid
    // Default to: end of next week. "Today's Monday + 13" = next Sunday.
    const defaultTo = shiftDate(mondayOf(todayMadrid), 13)
    const to = rawTo && ISO_DATE_RE.test(rawTo) ? rawTo : defaultTo
    if (daysBetween(from, to) < 0) {
      res.status(400).json({ error: 'Rango inválido: from > to' })
      return
    }

    // Pull household sizing.
    const [user] = await db
      .select({
        adults: users.adults,
        kidsCount: users.kidsCount,
        householdSize: users.householdSize,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    const multiplier = multiplierForUser(user ?? {})
    const householdId = await getPrimaryHouseholdId(userId)

    // Fetch every menu of this user/household whose 7-day window overlaps
    // with [from, to]. A menu covers `[weekStart, weekStart + 6]`, so the
    // earliest week we need is the one whose Monday <= `to` and whose
    // Sunday >= `from` → `weekStart in [from-6, to]`.
    const earliestWeek = shiftDate(from, -6)
    const menuRows = await db
      .select({
        id: menus.id,
        weekStart: menus.weekStart,
        days: menus.days,
        userId: menus.userId,
        householdId: menus.householdId,
      })
      .from(menus)
      .where(
        and(
          // Household-scoped if available; otherwise user-scoped.
          householdId
            ? eq(menus.householdId, householdId)
            : eq(menus.userId, userId),
          sql`${menus.weekStart} >= ${earliestWeek}`,
          sql`${menus.weekStart} <= ${to}`,
        ),
      )
      .orderBy(desc(menus.createdAt))

    // Pick the most recent menu per weekStart (the user may have
    // regenerated the same week multiple times — only the latest counts).
    const menuByWeek = new Map<string, (typeof menuRows)[number]>()
    for (const m of menuRows) {
      if (!menuByWeek.has(m.weekStart)) menuByWeek.set(m.weekStart, m)
    }

    // Walk every date in [from, to] and pull the right slot from the
    // covering menu. Today's already-passed meals are dropped.
    const span = daysBetween(from, to) + 1
    const aggregatedDays: DayMenu[] = []
    for (let i = 0; i < span; i++) {
      const date = shiftDate(from, i)
      const wk = mondayOf(date)
      const menu = menuByWeek.get(wk)
      if (!menu) {
        aggregatedDays.push({})
        continue
      }
      const dowIndex = daysBetween(wk, date) // 0..6
      const day = (menu.days as DayMenu[])[dowIndex] ?? {}
      aggregatedDays.push(date === todayMadrid ? filterPastTodayMeals(day, hourMadrid) : day)
    }

    // Aggregate with the existing pipeline (handles overrides + scaling).
    const menuItems = await generateShoppingList(
      aggregatedDays,
      multiplier,
      db,
      householdId,
    )

    // Load the user's previous list (if any) so we can merge state +
    // manual items into the freshly-aggregated set.
    const [previous] = await db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.userId, userId))
      .orderBy(desc(shoppingLists.createdAt))
      .limit(1)
    const prevItems = (previous?.items ?? []) as ShoppingItem[]

    // Overlay merge: keep checked / inStock / pricePerUnit on every menu
    // item that survives the new aggregate. Key is `(ingredientId, unit)`
    // — a single ingredient can produce multiple rows when the aggregator
    // splits incompatible units (e.g. "jengibre · 50 g" + "jengibre · 1 u"
    // when one recipe uses grams and another uses unidades without a
    // unitWeight). Keying by ingredientId alone meant the last-iterated
    // row's state silently overwrote the others, so checking one row
    // sometimes appeared to "un-check" itself on the next read.
    const overlayByKey = new Map<string, ShoppingItem>()
    const manualSurviving: ShoppingItem[] = []
    for (const it of prevItems) {
      if (it.kind === 'manual') {
        manualSurviving.push(it)
      } else if (it.ingredientId) {
        overlayByKey.set(`${it.ingredientId}|${it.unit}`, it)
      }
    }
    const mergedMenuItems: ShoppingItem[] = menuItems.map((it) => {
      const prev = it.ingredientId
        ? overlayByKey.get(`${it.ingredientId}|${it.unit}`)
        : undefined
      if (!prev) return it
      return {
        ...it,
        checked: prev.checked,
        inStock: prev.inStock,
        pricePerUnit: prev.pricePerUnit ?? null,
      }
    })

    // Re-merge staples (PR 10B) on top of the menu-derived items so they
    // keep their `inStock` / pricing.
    const staples = householdId ? await listActiveStaplesForHousehold(householdId) : []
    const stapleMerged = mergeStaplesIntoItems(mergedMenuItems, staples)
    // Manual items always at the end, preserving order.
    const finalItems = [...stapleMerged, ...manualSurviving]

    // Overwrite the persisted row — one shopping list per user. Delete
    // any prior rows so historical churn doesn't pile up.
    await db.delete(shoppingLists).where(eq(shoppingLists.userId, userId))
    const firstMenuInRange = aggregatedDays
      .map((_, i) => menuByWeek.get(mondayOf(shiftDate(from, i))))
      .find((m) => Boolean(m))
    const [list] = await db
      .insert(shoppingLists)
      .values({
        userId,
        householdId,
        menuId: firstMenuInRange?.id ?? null,
        rangeStartDate: from,
        rangeEndDate: to,
        items: finalItems,
      })
      .returning()

    res.json(list)
  } catch (err) {
    console.error('Get rolling shopping list error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// Legacy single-menu listing — kept for the assistant skill + any
// backwards-compat callers. The new web client uses the rolling window
// endpoint above.
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

    // PR 10B: pre-pend household staples (dedup'd by case-insensitive name).
    const householdId = menu.householdId ?? (await getPrimaryHouseholdId(menu.userId))

    // Generate the shopping list — pass the household id so the aggregator
    // applies `recipe_notes.ingredient_overrides` (remove / modify / add)
    // before scaling.
    const menuItems = await generateShoppingList(days, multiplier, db, householdId)
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

    // PR 10B: regenerate rebuilds menu items from scratch but preserves
    // user-authored extras — manual rows and the price the user typed on
    // them — and re-applies staples. Order: menu → manual (kept) → staples.
    const previousItems = (list.items ?? []) as ShoppingItem[]
    const manualKept = previousItems.filter((i) => i.kind === 'manual')
    const householdId = list.householdId ?? menu.householdId ?? null

    const menuItems = await generateShoppingList(
      menu.days as DayMenu[],
      multiplier,
      db,
      householdId,
    )
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
  if (!canAccessRow(list, userId, scope)) {
    return { list: null as null, forbidden: true }
  }
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
