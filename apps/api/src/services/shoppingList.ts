import { and, eq, inArray } from 'drizzle-orm'
import {
  recipeIngredients,
  ingredients,
  recipes as recipesTable,
  recipeNotes,
} from '../db/schema.js'
import type {
  Aisle,
  BuyableUnit,
  DayMenu,
  IngredientOverride,
  ShoppingItem,
  Unit,
} from '@ona/shared'
import { isNotBought, isTaperDish, leftoverShares, recipeDishesOf, resolveBuyRule, shoppingGroupOf, slotServingsOverride } from '@ona/shared'
import { randomUUID } from 'crypto'

/**
 * Shopping list aggregator (Task 15).
 *
 * Walks every meal in `menu.days`, scales each recipe to the household size,
 * merges ingredients across recipes with unit-aware conversions, rounds to
 * friendly bands, and groups by aisle.
 *
 * Conversion strategy per ingredient
 * ──────────────────────────────────
 *   - Same unit ............. quantities sum directly.
 *   - g ↔ ml ................ via `ingredient.density` (g/ml). No density →
 *                             units stay separate as line items.
 *   - g ↔ u ................. via `ingredient.unitWeight` (g/u). No unitWeight
 *                             → units stay separate.
 *   - cda → 15 ml (or 15 g if density is set on the ingredient)
 *   - cdita → 5 ml (or 5 g  if density is set)
 *   - When density is missing we treat 1 cda = 15 g, 1 cdita = 5 g (volume of
 *     water, which is a sensible default for the spoon-quantified pantry
 *     ingredients we're likely to see — oils, sauces, pastes).
 *   - Truly incompatible units stay as separate line items, with a "·" merge
 *     hint appended to the name (e.g. "aceite · varias presentaciones").
 *
 * Canonical unit per ingredient
 * ─────────────────────────────
 *   - If the ingredient has `unitWeight` AND at least one recipe quantified
 *     it as `u`, prefer whole units (eggs, lemons, onions).
 *   - Otherwise prefer mass (`g`) — falling back to `ml` only when the
 *     ingredient has no density (so g↔ml conversion is impossible) and ml
 *     is the natural unit.
 *
 * The DB JSONB shape is now:
 *   { id, ingredientId, name, quantity, unit, aisle, checked, inStock }
 * — `category` is gone (replaced by `aisle`).
 */

// ─── Helpers ─────────────────────────────────────────────────

const AISLE_ORDER: Aisle[] = [
  'produce',
  'proteinas',
  'lacteos',
  'panaderia',
  'despensa',
  'congelados',
  'otros',
]

const AISLE_INDEX: Record<Aisle, number> = AISLE_ORDER.reduce(
  (acc, a, i) => {
    acc[a] = i
    return acc
  },
  {} as Record<Aisle, number>,
)

/** Buyable units we keep in the list (cda/cdita are buyable but get folded
 * into g/ml when possible). pizca/al_gusto are dropped earlier. */
const BUYABLE: ReadonlySet<Unit> = new Set<Unit>(['g', 'ml', 'u', 'cda', 'cdita'])

/**
 * Rounds **up** to `step` (PRO-241): the list never asks for less than the
 * recipes add up to. A hair over a step from float noise (6.0000001 eggs)
 * doesn't jump to the next one.
 */
function ceilTo(value: number, step: number): number {
  return Math.ceil(value / step - 1e-6) * step
}

/**
 * g/ml friendly amounts, always rounded up (PRO-241; it used `Math.round`, so
 * 60 g of basmati read 50 g and 8 g read 0): 100 g steps from 1 kg (shown as
 * kg downstream), 50 g steps above 250 g, 25 g steps below.
 */
export function roundMassVolume(value: number): number {
  if (value <= 0) return 0
  if (value >= 1000) return ceilTo(value, 100)
  if (value > 250) return ceilTo(value, 50)
  return ceilTo(value, 25)
}

/** Whole units, rounded up: 1,2 huevos → 2 (PRO-241). */
export function roundUnitWhole(value: number): number {
  const r = ceilTo(value, 1)
  return r < 1 ? 1 : r
}

/** Half spoons, rounded up. */
function roundSpoon(value: number): number {
  return ceilTo(value, 0.5)
}

export function roundForUnit(quantity: number, unit: BuyableUnit): number {
  if (unit === 'g' || unit === 'ml') return roundMassVolume(quantity)
  if (unit === 'u') return roundUnitWhole(quantity)
  // cda / cdita
  return roundSpoon(quantity)
}

/** Convert one quantity from `from` unit into `to` unit using density (g/ml)
 * and unitWeight (g/u). Returns null when no conversion path exists. */
export function convert(
  quantity: number,
  from: BuyableUnit,
  to: BuyableUnit,
  density: number | null | undefined,
  unitWeight: number | null | undefined,
): number | null {
  if (from === to) return quantity

  // Spoons folded first into g (or ml if density missing): 1 cda = 15, 1 cdita = 5.
  if (from === 'cda') return convert(quantity * 15, density != null ? 'g' : 'ml', to, density, unitWeight)
  if (from === 'cdita') return convert(quantity * 5, density != null ? 'g' : 'ml', to, density, unitWeight)
  if (to === 'cda') {
    const inG = convert(quantity, from, density != null ? 'g' : 'ml', density, unitWeight)
    return inG == null ? null : inG / 15
  }
  if (to === 'cdita') {
    const inG = convert(quantity, from, density != null ? 'g' : 'ml', density, unitWeight)
    return inG == null ? null : inG / 5
  }

  // g ↔ ml
  if (from === 'g' && to === 'ml') return density && density > 0 ? quantity / density : null
  if (from === 'ml' && to === 'g') return density && density > 0 ? quantity * density : null

  // g ↔ u
  if (from === 'g' && to === 'u') return unitWeight && unitWeight > 0 ? quantity / unitWeight : null
  if (from === 'u' && to === 'g') return unitWeight && unitWeight > 0 ? quantity * unitWeight : null

  // ml ↔ u (chain through g if both density and unitWeight are present)
  if (from === 'ml' && to === 'u') {
    const inG = density && density > 0 ? quantity * density : null
    return inG != null && unitWeight && unitWeight > 0 ? inG / unitWeight : null
  }
  if (from === 'u' && to === 'ml') {
    const inG = unitWeight && unitWeight > 0 ? quantity * unitWeight : null
    return inG != null && density && density > 0 ? inG / density : null
  }

  return null
}

// ─── Aggregator state ────────────────────────────────────────

export interface CatalogRow {
  id: string
  name: string
  aisle: Aisle | null
  density: number | null
  unitWeight: number | null
}

interface IngredientLineUnit {
  /** Total accumulated quantity in this unit (pre-rounding). */
  quantity: number
  /** True when at least one recipe explicitly quantified this ingredient in this unit. */
  explicit: boolean
}

interface IngredientBucket {
  /** Representative ingredient: its id and name go on the line. */
  ingredientId: string
  catalog: CatalogRow
  /** Every catalogue ingredient joined into this product (PRO-177). */
  members: Map<string, CatalogRow>
  /** What the shop calls the product when several names were joined. */
  label: string | null
  /** Aisle the buy rule gives the product (beats the catalogue's). */
  ruleAisle: Aisle | null
  /** Per-unit accumulators before canonicalisation. */
  byUnit: Map<BuyableUnit, IngredientLineUnit>
  /** Raw contributions, each converted with its own ingredient's density / unit weight. */
  parts: Array<{ unit: BuyableUnit; quantity: number; catalog: CatalogRow }>
  /** Distinct recipe notes for this ingredient (shop orders use them). */
  notes: Set<string>
}

export interface ScaledRow {
  ingredientId: string
  quantity: number
  unit: Unit
  note?: string | null
}

/**
 * PRO-75 / PRO-298 — a planned leftover ("táper") is part of its source's
 * batch, not another cooking. The batch is `leftoverShares` (`@ona/shared`),
 * the same rule as the menu page's «N raciones» and Mimo: the source's own
 * diners plus what each leftover adds. When the source's «Solo hoy: N» is
 * only who eats that meal (N ≤ the household, e.g. the template's diners the
 * generator puts on every slot), each leftover adds its own diners: Dani y
 * Sara's bowl, Monday for 2 + leftovers Tuesday to Thursday → 8, not 2.
 * When N is above the household it already pays for tápers (Laura alone,
 * lasaña «Solo hoy: 2» + sobras → 2), and a leftover adds only what N doesn't
 * cover. A leftover that adds nothing is dropped from the copy this returns;
 * one that adds part carries it as `listDiners`, which `sumDinersByRecipe`
 * counts instead of the slot's diners. A táper for tomorrow (PRO-223, slot
 * with `taper`) always adds its own rations. A leftover whose source turned
 * into a táper of the same recipe (PRO-240) adds nothing.
 *
 * Takes ONE menu's 7 days (indices = `leftoverOf.day`), so call it before
 * slicing/re-indexing days for a date range. Pure; never mutates its input.
 * A leftover whose source slot no longer holds that recipe is left alone.
 */
export function withLeftoverBatches(weekDays: DayMenu[], householdDiners: number): DayMenu[] {
  type Ref = { day: number; meal: keyof DayMenu; pos: number; diners: number | null }
  // Planned (non-táper) leftovers of each source batch, in week order.
  const groups = new Map<string, Ref[]>()
  const drop = new Set<string>()
  const key = (day: number, meal: string | number, pos: number) => `${day}|${meal}|${pos}`
  weekDays.forEach((day, dayIndex) => {
    if (!day) return
    for (const meal of Object.keys(day) as (keyof DayMenu)[]) {
      const slot = day[meal]
      if (!slot?.dishes?.length) continue
      slot.dishes.forEach((dish, pos) => {
        if (dish.kind !== 'recipe' || dish.variant !== 'leftover' || !dish.leftoverOf) return
        const source = weekDays[dish.leftoverOf.day]?.[dish.leftoverOf.meal as keyof DayMenu]
        // PRO-240: the source became a táper (already cooked, in the fridge
        // or freezer): its leftovers came out of that same batch — nothing
        // to buy for them either.
        if ((source?.dishes ?? []).some((d) => isTaperDish(d) && d.kind === 'recipe' && d.recipeId === dish.recipeId)) {
          drop.add(key(dayIndex, meal, pos))
          return
        }
        // PRO-223: a táper is one ration more on top of «Solo hoy», never covered by it.
        if (slot.taper) return
        const sourceCooksIt = (source?.dishes ?? []).some(
          (d) => d.kind === 'recipe' && d.variant !== 'leftover' && d.recipeId === dish.recipeId,
        )
        if (!sourceCooksIt) return
        const g = `${dish.leftoverOf.day}|${dish.leftoverOf.meal}|${dish.recipeId}`
        const list = groups.get(g) ?? []
        list.push({ day: dayIndex, meal, pos, diners: slotServingsOverride(slot) })
        groups.set(g, list)
      })
    }
  })
  const listDiners = new Map<string, number>()
  for (const [g, refs] of groups) {
    const [srcDay, srcMeal] = g.split('|')
    const source = weekDays[Number(srcDay)]?.[srcMeal as keyof DayMenu]
    const shares = leftoverShares(slotServingsOverride(source), householdDiners, refs.map((r) => r.diners))
    refs.forEach((r, i) => {
      const own = r.diners ?? householdDiners
      if (shares[i] <= 0) drop.add(key(r.day, r.meal, r.pos))
      else if (shares[i] !== own) listDiners.set(key(r.day, r.meal, r.pos), shares[i])
    })
  }
  if (drop.size === 0 && listDiners.size === 0) return weekDays
  return weekDays.map((day, dayIndex) => {
    if (!day) return day
    let changed = false
    const next: DayMenu = { ...day }
    for (const meal of Object.keys(day) as (keyof DayMenu)[]) {
      const slot = day[meal]
      if (!slot?.dishes?.length) continue
      const touched = slot.dishes.some((_, pos) => drop.has(key(dayIndex, meal, pos)) || listDiners.has(key(dayIndex, meal, pos)))
      if (!touched) continue
      changed = true
      const dishes = slot.dishes.flatMap((dish, pos) => {
        const k = key(dayIndex, meal, pos)
        if (drop.has(k)) return []
        const n = listDiners.get(k)
        return n != null ? [{ ...dish, listDiners: n } as unknown as typeof dish] : [dish]
      })
      next[meal] = { ...slot, dishes }
    }
    return changed ? next : day
  })
}

/**
 * Sum the diner counts for every slot in the week, grouped by recipe id.
 * Per-slot `servings` overrides win over the household-level fallback; a
 * recipe scheduled in two slots accumulates both diner counts (a leftover
 * slot is the same batch cooked bigger, so it adds its diners too — unless
 * `withLeftoverBatches` dropped it or cut it because its source's «Solo hoy» covers it,
 * PRO-75). Pure
 * (no DB) so it's the unit-test entry point for shopping-list scaling.
 *
 * `minServingsByRecipe` ("esta receta siempre la cocino para al menos N",
 * recipe_notes.min_servings): every time the recipe is actually cooked
 * (each non-leftover occurrence) counts for at least N servings, so the
 * total is max(diners, N × times cooked). The surplus is what the household
 * keeps or freezes.
 */
export function sumDinersByRecipe(
  menuDays: DayMenu[],
  householdMultiplier: number,
  minServingsByRecipe: ReadonlyMap<string, number> = new Map(),
): Map<string, number> {
  const out = new Map<string, number>()
  const timesCooked = new Map<string, number>()
  for (const day of menuDays) {
    for (const meal of Object.keys(day)) {
      const slot = day[meal as keyof DayMenu]
      if (!slot) continue
      const diners =
        typeof slot.servings === 'number' && slot.servings > 0
          ? slot.servings
          : householdMultiplier
      for (const dish of recipeDishesOf(slot.dishes)) {
        // A táper from the freezer (PRO-82) or the fridge (PRO-240) was
        // bought and cooked some other time: no ingredients, not a cooking.
        if (isTaperDish(dish)) continue
        // PRO-298: a leftover only partly covered by its source's «Solo hoy»
        // adds what `withLeftoverBatches` worked out, not its whole slot.
        const listDiners = (dish as { listDiners?: number }).listDiners
        out.set(dish.recipeId, (out.get(dish.recipeId) ?? 0) + (typeof listDiners === 'number' ? listDiners : diners))
        if (dish.variant !== 'leftover') timesCooked.set(dish.recipeId, (timesCooked.get(dish.recipeId) ?? 0) + 1)
      }
    }
  }
  for (const [recipeId, min] of minServingsByRecipe) {
    const total = out.get(recipeId)
    if (total === undefined || !(min > 0)) continue
    out.set(recipeId, Math.max(total, min * Math.max(1, timesCooked.get(recipeId) ?? 0)))
  }
  return out
}

/**
 * Apply a household's `ingredient_overrides` to the raw `recipe_ingredients`
 * rows of one recipe before the shopping aggregator scales them.
 *
 * Pure helper — no DB. `addRowResolver` is called for every `add` override
 * to obtain a synthetic ingredient row (the route layer resolves catalog
 * IDs from free-form names by case-insensitive match); returning `null`
 * drops the add silently (the recipe detail still shows it, the shopping
 * list just can't find a catalog entry to scale).
 *
 * Semantics:
 *   - `remove` drops the matching row.
 *   - `modify` replaces `quantity` and/or `unit` on the matching row.
 *     A modify that changes a buyable unit to `pizca`/`al_gusto` will be
 *     dropped downstream by the aggregator's `BUYABLE` filter — that's the
 *     "I don't want a number of grams of this, just a pinch" path.
 *   - `add` appends every successful `addRowResolver` result.
 *
 * Per-recipe quantities scale together with the rest of the row set; the
 * caller passes the raw values straight from `recipe_ingredients` and the
 * downstream `factor = totalDiners / recipe.servings` does the work.
 */
export function applyOverridesToRecipeRows<
  Row extends { recipeIngredientId?: string | null; quantity: number; unit: Unit },
>(
  rows: Row[],
  overrides: IngredientOverride[],
  addRowResolver: (
    add: Extract<IngredientOverride, { kind: 'add' }>,
  ) => Row | null,
): Row[] {
  const removed = new Set<string>()
  const modifies = new Map<string, Extract<IngredientOverride, { kind: 'modify' }>>()
  const adds: Extract<IngredientOverride, { kind: 'add' }>[] = []
  for (const ov of overrides) {
    if (ov.kind === 'remove') {
      removed.add(ov.recipeIngredientId)
      modifies.delete(ov.recipeIngredientId)
    } else if (ov.kind === 'modify') {
      if (!removed.has(ov.recipeIngredientId)) {
        modifies.set(ov.recipeIngredientId, ov)
      }
    } else {
      adds.push(ov)
    }
  }
  const out: Row[] = []
  for (const row of rows) {
    const id = row.recipeIngredientId
    if (id && removed.has(id)) continue
    const mod = id ? modifies.get(id) : undefined
    if (!mod) {
      out.push(row)
      continue
    }
    out.push({
      ...row,
      ...(mod.quantity != null ? { quantity: mod.quantity } : {}),
      ...(mod.unit != null ? { unit: mod.unit } : {}),
    })
  }
  for (const add of adds) {
    const resolved = addRowResolver(add)
    if (resolved) out.push(resolved)
  }
  return out
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Generate a shopping list from a menu.
 *
 *   1. Scale each meal's ingredients by `householdMultiplier / recipe.servings`.
 *   2. Drop optional ingredients and `pizca` / `al_gusto`.
 *   3. Merge by ingredientId, converting between units when possible.
 *   4. Round each line to a friendly band.
 *   5. Tag each item with the catalog's `aisle` (fallback `otros`) and sort.
 *
 * `householdMultiplier` is `adults + 0.5 × kidsCount` for the user's
 * household. Callers compute it via `householdMultiplier()` from `@ona/shared`.
 */
export async function generateShoppingList(
  menuDays: DayMenu[],
  householdMultiplier: number,
  db: any,
  /**
   * When provided, the aggregator loads the household's
   * `recipe_notes.ingredient_overrides` for every recipe in the menu and
   * applies them (remove / modify quantity-unit / add) before scaling.
   * Free-form `add` entries are name-resolved against the catalog (case
   * insensitive). Unknown adds drop silently — the recipe detail still
   * shows them, the list just can't include something we don't catalog.
   */
  householdId?: string | null,
): Promise<ShoppingItem[]> {
  // 1. Collect (recipeId → total diners across all occurrences this week).
  // Per-slot `servings` overrides win over the household-level multiplier;
  // see `sumDinersByRecipe` for the math (extracted for unit testing).
  let dinersByRecipe = sumDinersByRecipe(menuDays, householdMultiplier)
  // Comidas fijas (PRO-218): their items, per person × the slot's diners.
  const fixedLines = sumFixedItems(menuDays, householdMultiplier)
  if (dinersByRecipe.size === 0 && fixedLines.length === 0) return []
  const recipeIds = [...dinersByRecipe.keys()]

  // householdMultiplier is provided by the caller (adults + 0.5 × kidsCount).
  // The fallback for legacy/unknown households happens at the route layer.

  // 2. Fetch recipe servings + ingredient rows + catalog density/unitWeight/aisle.
  const recipeRows: { id: string; servings: number }[] = recipeIds.length === 0 ? [] : await db
    .select({ id: recipesTable.id, servings: recipesTable.servings })
    .from(recipesTable)
    .where(inArray(recipesTable.id, recipeIds))

  const servingsById = new Map<string, number>()
  for (const r of recipeRows) servingsById.set(r.id, r.servings)

  const ingredientRows: Array<{
    recipeId: string
    /** The `recipe_ingredients.id` of the source row — needed so the
     *  override layer can target individual rows for remove / modify. */
    recipeIngredientId: string | null
    ingredientId: string
    quantity: number
    unit: Unit
    optional: boolean
    ingredientName: string
    aisle: Aisle | null
    density: number | null
    unitWeight: number | null
    /** Recipe note ("picada", "morada en juliana") — the shop order reads it. */
    note?: string | null
  }> = recipeIds.length === 0 ? [] : await db
    .select({
      recipeId: recipeIngredients.recipeId,
      recipeIngredientId: recipeIngredients.id,
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      optional: recipeIngredients.optional,
      ingredientName: ingredients.name,
      aisle: ingredients.aisle,
      density: ingredients.density,
      unitWeight: ingredients.unitWeight,
      note: recipeIngredients.note,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(inArray(recipeIngredients.recipeId, recipeIds))

  // 2b. Per-household ingredient overrides — quitar, modificar, añadir.
  // Loaded only when a household scope is supplied so anonymous menus
  // (assistant tool calls without a session) behave as before.
  type RecipeRow = (typeof ingredientRows)[number]
  let rowsByRecipe = new Map<string, RecipeRow[]>()
  for (const r of ingredientRows) {
    const list = rowsByRecipe.get(r.recipeId) ?? []
    list.push(r)
    rowsByRecipe.set(r.recipeId, list)
  }
  if (householdId && recipeIds.length > 0) {
    const overrideRows: Array<{ recipeId: string; ingredientOverrides: unknown; minServings: number | null }> =
      await db
        .select({
          recipeId: recipeNotes.recipeId,
          ingredientOverrides: recipeNotes.ingredientOverrides,
          minServings: recipeNotes.minServings,
        })
        .from(recipeNotes)
        .where(
          and(
            eq(recipeNotes.householdId, householdId),
            inArray(recipeNotes.recipeId, recipeIds),
          ),
        )

    // "Siempre la cocino para al menos N": recompute the diners with the
    // household's minimums (sumDinersByRecipe).
    const minServings = new Map<string, number>()
    for (const r of overrideRows) if (typeof r.minServings === 'number' && r.minServings > 0) minServings.set(r.recipeId, r.minServings)
    if (minServings.size > 0) dinersByRecipe = sumDinersByRecipe(menuDays, householdMultiplier, minServings)

    // Catalog name→row map for resolving free-form `add` entries. Index by
    // lowercased catalog name; ties go to the first match (rare — the
    // catalog uses canonical singular Spanish lowercase names).
    const catalogByName = new Map<string, Omit<RecipeRow, 'recipeId' | 'recipeIngredientId' | 'quantity' | 'unit' | 'optional'>>()
    if (overrideRows.some((r) => Array.isArray(r.ingredientOverrides) && (r.ingredientOverrides as IngredientOverride[]).some((ov) => ov.kind === 'add'))) {
      const catalogRows: Array<{
        id: string
        name: string
        aisle: Aisle | null
        density: number | null
        unitWeight: number | null
      }> = await db
        .select({
          id: ingredients.id,
          name: ingredients.name,
          aisle: ingredients.aisle,
          density: ingredients.density,
          unitWeight: ingredients.unitWeight,
        })
        .from(ingredients)
      for (const c of catalogRows) {
        catalogByName.set(c.name.toLowerCase(), {
          ingredientId: c.id,
          ingredientName: c.name,
          aisle: c.aisle,
          density: c.density,
          unitWeight: c.unitWeight,
        })
      }
    }

    for (const ovRow of overrideRows) {
      const overrides = Array.isArray(ovRow.ingredientOverrides)
        ? (ovRow.ingredientOverrides as IngredientOverride[])
        : []
      if (overrides.length === 0) continue
      const original = rowsByRecipe.get(ovRow.recipeId) ?? []
      const transformed = applyOverridesToRecipeRows<RecipeRow>(
        original,
        overrides,
        (add) => {
          // 'add' may carry an explicit ingredientId; otherwise we name-match.
          let catalog = add.ingredientId
            ? [...catalogByName.values()].find((c) => c.ingredientId === add.ingredientId)
            : catalogByName.get(add.label.trim().toLowerCase())
          if (!catalog) return null
          // The aggregator needs a buyable unit + a positive quantity. When
          // the user added without a quantity ("una pizca de algo") we can't
          // include it in the shopping list — drop and let the recipe detail
          // keep showing it.
          const unit = add.unit ?? null
          const quantity = add.quantity ?? 0
          if (!unit || !BUYABLE.has(unit) || quantity <= 0) return null
          return {
            recipeId: ovRow.recipeId,
            recipeIngredientId: null,
            ingredientId: catalog.ingredientId,
            quantity,
            unit,
            optional: false,
            ingredientName: catalog.ingredientName,
            aisle: catalog.aisle,
            density: catalog.density,
            unitWeight: catalog.unitWeight,
          }
        },
      )
      rowsByRecipe.set(ovRow.recipeId, transformed)
    }
  }
  // Re-flatten back into the iteration order downstream code expects.
  const effectiveRows: RecipeRow[] = []
  for (const list of rowsByRecipe.values()) effectiveRows.push(...list)

  // 3. Scale + filter into a flat list of (ingredientId, quantity, unit).
  const scaled: ScaledRow[] = []
  /** ingredientId → catalog metadata (name, aisle, density, unitWeight). */
  const catalogById = new Map<string, CatalogRow>()
  for (const row of effectiveRows) {
    if (row.optional) continue
    if (!BUYABLE.has(row.unit)) continue // pizca / al_gusto

    const recipeServings = servingsById.get(row.recipeId)
    if (!recipeServings || recipeServings <= 0) continue
    // `totalDiners` already sums every slot's effective diner count for
    // this recipe (per-slot override or household fallback), so we don't
    // need a separate `× occurrences` multiplier here.
    const totalDiners = dinersByRecipe.get(row.recipeId) ?? 0
    if (totalDiners <= 0) continue
    const factor = totalDiners / recipeServings

    catalogById.set(row.ingredientId, {
      id: row.ingredientId,
      name: row.ingredientName,
      aisle: row.aisle,
      density: row.density,
      unitWeight: row.unitWeight,
    })
    scaled.push({
      ingredientId: row.ingredientId,
      quantity: row.quantity * factor,
      unit: row.unit,
      note: row.note ?? null,
    })
  }

  // Comidas fijas (PRO-218): an item named like a catalogue ingredient joins
  // that line (the eggs of the breakfast + the eggs of a recipe); any other
  // goes in its own line.
  let fixedExtra: ShoppingItem[] = []
  if (fixedLines.length > 0) {
    const catalogRows: CatalogRow[] = await db
      .select({ id: ingredients.id, name: ingredients.name, aisle: ingredients.aisle, density: ingredients.density, unitWeight: ingredients.unitWeight })
      .from(ingredients)
    const byKey = new Map<string, CatalogRow>()
    for (const c of catalogRows) if (!byKey.has(foldName(c.name))) byKey.set(foldName(c.name), c)
    const { matched, unmatched } = splitFixedLines(fixedLines, byKey)
    for (const m of matched) {
      catalogById.set(m.catalog.id, m.catalog)
      scaled.push({ ingredientId: m.catalog.id, quantity: m.quantity, unit: m.unit, note: null })
    }
    fixedExtra = fixedLinesToItems(unmatched)
  }

  const items = aggregateScaledRows(scaled, catalogById)
  return fixedExtra.length > 0 ? [...items, ...fixedExtra] : items
}

// ─── Comidas fijas (PRO-218) ─────────────────────────────────────────

export interface FixedLine {
  name: string
  quantity: number
  unit: BuyableUnit
}

const foldName = (name: string) => name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')

/** Folded name for matching and ids: lowercase, no accents, no plural «s». */
export function fixedItemKey(name: string): string {
  return foldName(name)
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ')
}

/** The keys a fixed item may match: «yogures» → «yogure», «yogur». */
function fixedItemCandidates(name: string): string[] {
  let combos = ['']
  for (const w of foldName(name).split(' ')) {
    const forms = new Set([w])
    if (w.length > 3 && w.endsWith('s')) forms.add(w.slice(0, -1))
    if (w.length > 4 && w.endsWith('es')) forms.add(w.slice(0, -2))
    combos = combos.flatMap((c) => [...forms].map((f) => (c ? `${c} ${f}` : f))).slice(0, 32)
  }
  return combos
}

/**
 * Pure: every «Fijo: …» slot's items (per person) × the slot's diners
 * (`servings`, else the household multiplier), summed per item and unit.
 * A 7-day breakfast for 1 with 1 yogur, 40 g de cereales and 2 galletas →
 * 7 yogures, 280 g de cereales, 14 galletas.
 */
export function sumFixedItems(menuDays: DayMenu[], householdMultiplier: number): FixedLine[] {
  const out = new Map<string, FixedLine>()
  for (const day of menuDays) {
    for (const meal of Object.keys(day ?? {})) {
      const slot = day[meal as keyof DayMenu]
      if (!slot) continue
      const diners = typeof slot.servings === 'number' && slot.servings > 0 ? slot.servings : householdMultiplier
      for (const dish of slot.dishes ?? []) {
        if (dish.kind !== 'note' || !dish.fixed) continue
        for (const item of dish.fixed.items ?? []) {
          if (!item?.name || !(item.quantity > 0) || !BUYABLE.has(item.unit)) continue
          const key = `${fixedItemKey(item.name)}|${item.unit}`
          const cur = out.get(key)
          if (cur) cur.quantity += item.quantity * diners
          else out.set(key, { name: item.name.trim(), quantity: item.quantity * diners, unit: item.unit as BuyableUnit })
        }
      }
    }
  }
  return [...out.values()]
}

/** Pure: which fixed lines are a catalogue ingredient (by folded name) and which aren't. */
export function splitFixedLines(
  lines: FixedLine[],
  catalogByKey: ReadonlyMap<string, CatalogRow>,
): { matched: Array<FixedLine & { catalog: CatalogRow }>; unmatched: FixedLine[] } {
  const matched: Array<FixedLine & { catalog: CatalogRow }> = []
  const unmatched: FixedLine[] = []
  for (const l of lines) {
    const catalog = fixedItemCandidates(l.name).map((k) => catalogByKey.get(k)).find(Boolean)
    if (catalog) matched.push({ ...l, catalog })
    else unmatched.push(l)
  }
  return { matched, unmatched }
}

/** Pure: fixed lines without a catalogue ingredient → their own list lines («Otros»), with their exact amounts. */
export function fixedLinesToItems(lines: FixedLine[]): ShoppingItem[] {
  return lines
    .map((l) => ({
      id: `fixed:${fixedItemKey(l.name).replace(/\s+/g, '-')}:${l.unit}`,
      ingredientId: null,
      name: l.name.toLowerCase(),
      // The household's own amounts: whole grams / units, not the list's
      // rounding to 50 g (280 g of cereales stays 280 g).
      quantity: l.unit === 'cda' || l.unit === 'cdita' ? roundForUnit(l.quantity, l.unit) : Math.round(l.quantity),
      unit: l.unit,
      aisle: 'otros' as Aisle,
      checked: false,
      inStock: false,
      kind: 'menu' as const,
    }))
    .filter((i) => i.quantity > 0)
}

/**
 * Steps 4–6 of the aggregator, pure (PRO-177 tests drive it directly).
 *
 *   - Tap water and salt never become lines (`isNotBought`).
 *   - Lines that are the same product join into one: same catalogue
 *     ingredient, same buy rule («huevo» + «huevos» + «yema», the two olive
 *     oils, «jamón cocido» + «jamón de york») or the same name spelled two
 *     ways («Limón» / «Limon», a duplicated «Pimentón dulce»). Quantities are
 *     summed in one unit, each part converted with its own density / unit
 *     weight (falling back to the group's).
 *   - The line keeps a representative ingredient (shortest name) for its id;
 *     the others go in `mergedIngredientIds` so what was marked on any of the
 *     old lines stays marked (`carryItemState`).
 *   - The aisle comes from the buy rule when it has one (eggs, tofu →
 *     «Lácteos y huevos»), else from the catalogue.
 */
export function aggregateScaledRows(scaled: ScaledRow[], catalogById: Map<string, CatalogRow>): ShoppingItem[] {
  const buckets = new Map<string, IngredientBucket>()
  for (const s of scaled) {
    const cat = catalogById.get(s.ingredientId)
    if (!cat) continue
    if (!BUYABLE.has(s.unit)) continue
    if (isNotBought(cat.name)) continue
    const group = shoppingGroupOf(cat.name)
    let bucket = buckets.get(group.key)
    if (!bucket) {
      bucket = {
        ingredientId: s.ingredientId,
        catalog: cat,
        members: new Map(),
        label: group.rule && !group.rule.noun[0].includes('{') && group.rule.noun[0] ? group.rule.noun[0] : null,
        ruleAisle: group.aisle,
        byUnit: new Map(),
        parts: [],
        notes: new Set(),
      }
      buckets.set(group.key, bucket)
    }
    bucket.members.set(cat.id, cat)
    const unit = s.unit as BuyableUnit
    const cur = bucket.byUnit.get(unit) ?? { quantity: 0, explicit: false }
    cur.quantity += s.quantity
    cur.explicit = true
    bucket.byUnit.set(unit, cur)
    bucket.parts.push({ unit, quantity: s.quantity, catalog: cat })
    const note = s.note?.trim()
    if (note && !/añadido automáticamente/i.test(note)) bucket.notes.add(note)
  }

  // 5. Pick canonical unit per product, fold compatible units into it.
  //    Anything that can't be folded keeps its own line item.
  const items: ShoppingItem[] = []
  for (const bucket of buckets.values()) {
    const members = [...bucket.members.values()].sort(
      (a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    )
    const rep = members[0]!
    bucket.ingredientId = rep.id
    bucket.catalog = {
      ...rep,
      aisle: rep.aisle ?? members.find((m) => m.aisle)?.aisle ?? null,
      density: rep.density ?? members.find((m) => m.density != null)?.density ?? null,
      unitWeight: rep.unitWeight ?? members.find((m) => m.unitWeight != null)?.unitWeight ?? null,
    }
    const distinctNames = new Set(members.map((m) => m.name.trim().toLowerCase()))
    const baseName = (distinctNames.size > 1 && bucket.label ? bucket.label : rep.name).toLowerCase()
    const others = members.slice(1).map((m) => m.id)
    const lines = pickCanonicalLines(bucket)
    for (const line of lines) {
      if (line.quantity <= 0) continue
      let rounded = roundForUnit(line.quantity, line.unit)
      // Two cloves of garlic or a little parsley round to 0 g — keep them when
      // a shop sells the product (1 cabeza, 1 manojo); pantry staples can go.
      if (rounded <= 0) {
        const rule = resolveBuyRule(bucket.catalog.name)?.rule
        if (!rule || rule.tier === 'despensa' || rule.shop === 'despensa') continue
        rounded = Math.ceil(line.quantity)
      }
      items.push({
        // Deterministic id: `menu:<ingredientId>:<unit>`. Stable across
        // regenerates so React keys (and the route layer's lookup-by-id)
        // don't see a fresh row every fetch. The aggregator already
        // guarantees one row per (ingredientId, unit) within a list, so
        // this id is unique per item; the `menu:` prefix keeps it from
        // colliding with manual / staple uuids.
        id: `menu:${bucket.ingredientId}:${line.unit}`,
        ingredientId: bucket.ingredientId,
        name: line.suffix ? `${baseName} · ${line.suffix}` : baseName,
        quantity: rounded,
        unit: line.unit,
        aisle: bucket.ruleAisle ?? bucket.catalog.aisle ?? 'otros',
        checked: false,
        inStock: false,
        ...(others.length ? { mergedIngredientIds: others } : {}),
        ...(bucket.notes.size ? { notes: [...bucket.notes] } : {}),
      })
    }
  }

  // 6. Sort: aisle order, then alphabetical by name.
  items.sort((a, b) => {
    const ai = AISLE_INDEX[a.aisle] - AISLE_INDEX[b.aisle]
    if (ai !== 0) return ai
    return a.name.localeCompare(b.name)
  })

  return items
}

interface CanonicalLine {
  quantity: number
  unit: BuyableUnit
  /** Optional name suffix (e.g. "varias presentaciones") for hint when we
   * cannot merge two units into a single line. */
  suffix?: string
}

function pickCanonicalLines(bucket: IngredientBucket): CanonicalLine[] {
  const { catalog, byUnit } = bucket
  if (byUnit.size === 0) return []
  if (byUnit.size === 1) {
    const [[unit, info]] = [...byUnit.entries()]
    return [{ quantity: info.quantity, unit }]
  }

  // Decide canonical unit:
  //   Prefer `u` when unitWeight is set AND at least one recipe used `u`.
  //   Otherwise prefer `g` if any unit can convert to g (density OR unitWeight).
  //   Otherwise prefer `ml`.
  const usedU = byUnit.get('u')?.explicit === true
  const usedG = byUnit.get('g')?.explicit === true
  const usedMl = byUnit.get('ml')?.explicit === true

  let canonical: BuyableUnit
  if (usedU && catalog.unitWeight && catalog.unitWeight > 0) {
    canonical = 'u'
  } else if (usedG || catalog.density != null || catalog.unitWeight != null) {
    canonical = 'g'
  } else if (usedMl) {
    canonical = 'ml'
  } else {
    // Fallback: any unit with the largest accumulator.
    canonical = [...byUnit.entries()].sort((a, b) => b[1].quantity - a[1].quantity)[0]![0]
  }

  // Try to convert every part into the canonical unit, each with its own
  // ingredient's density / unit weight and the group's as a fallback
  // (PRO-177: «aceite de oliva virgen» in ml + «virgen extra» in g).
  let canonicalQty = 0
  const orphans: Array<{ unit: BuyableUnit; quantity: number }> = []
  for (const part of bucket.parts) {
    const converted = convert(
      part.quantity,
      part.unit,
      canonical,
      part.catalog.density ?? catalog.density,
      part.catalog.unitWeight ?? catalog.unitWeight,
    )
    if (converted == null || !Number.isFinite(converted)) {
      orphans.push({ unit: part.unit, quantity: part.quantity })
    } else {
      canonicalQty += converted
    }
  }

  const lines: CanonicalLine[] = []
  if (canonicalQty > 0) {
    lines.push({ quantity: canonicalQty, unit: canonical })
  }
  if (orphans.length > 0) {
    // Merge orphans by unit (already grouped, but be defensive).
    const byOrphanUnit = new Map<BuyableUnit, number>()
    for (const o of orphans) {
      byOrphanUnit.set(o.unit, (byOrphanUnit.get(o.unit) ?? 0) + o.quantity)
    }
    for (const [unit, qty] of byOrphanUnit) {
      lines.push({
        quantity: qty,
        unit,
        // Hint that this is a separate line because the unit could not be
        // folded into the canonical one (no density / no unitWeight).
        suffix: lines.length > 0 ? 'varias presentaciones' : undefined,
      })
    }
  }

  return lines
}

// ─── PR 10B: staples merge ──────────────────────────────────────────────

/**
 * Subset of a `household_staples` row that the merge needs. The router
 * passes this in so we don't import the schema into the pure function.
 */
export interface StapleSnapshot {
  name: string
  quantity: number
  unit: BuyableUnit
  aisle: Aisle
  pricePerUnit: number | null
}

/**
 * Prepend each active staple to the items array as a new
 * `kind: 'staple'` row, **unless** a menu-derived row with the same name
 * already exists (case-insensitive). When the menu already covers the
 * staple, we keep the menu row authoritative — it has the right
 * `ingredientId` for downstream nutrition / unit conversion.
 *
 * Pure function — exercised by `staplesMerge.test.ts` directly.
 */
export function mergeStaplesIntoItems(
  items: ShoppingItem[],
  staples: StapleSnapshot[],
): ShoppingItem[] {
  if (staples.length === 0) return items
  const existingNames = new Set(items.map((i) => i.name.trim().toLowerCase()))
  const out: ShoppingItem[] = [...items]
  for (const s of staples) {
    const norm = s.name.trim().toLowerCase()
    if (existingNames.has(norm)) continue
    existingNames.add(norm)
    out.push({
      // Deterministic staple id so check/inStock state survives the
      // rolling regenerate. The name is normalized to slug form so a
      // trailing space / case difference can't bump the id.
      id: `staple:${norm.replace(/\s+/g, '-')}`,
      ingredientId: null,
      name: s.name,
      quantity: s.quantity,
      unit: s.unit,
      aisle: s.aisle,
      checked: false,
      inStock: false,
      kind: 'staple',
      pricePerUnit: s.pricePerUnit,
    })
  }
  return out
}

// ─── PR 10: price total ─────────────────────────────────────────────────

export interface ListTotal {
  /** Sum of `quantity * pricePerUnit` across non-inStock priced items. */
  totalEur: number
  /** How many items carry a usable price. */
  pricedCount: number
  /** How many items lack a price (helps the UI show "X items sin precio"). */
  unpricedCount: number
}

/**
 * Reduce a list of `ShoppingItem`s to a price snapshot. Pure function — kept
 * separate from the aggregator so a regression in arithmetic trips a unit
 * test before the UI shows a wrong subtotal.
 *
 * Skip rules:
 *   - `pricePerUnit` null / undefined / non-finite → counted as `unpriced`.
 *   - `inStock === true` → user already has it, exclude from spend (but
 *     still counted as priced).
 *   - `quantity <= 0` → defensive, exclude from spend.
 *   - `skipped` («No lo compro esta semana», PRO-175) → not counted at all.
 */
export function computeListTotal(items: ShoppingItem[]): ListTotal {
  let totalEur = 0
  let pricedCount = 0
  let unpricedCount = 0
  for (const it of items) {
    if (it.skipped) continue // «No lo compro esta semana» (PRO-175)
    const price = it.pricePerUnit
    const hasPrice = typeof price === 'number' && Number.isFinite(price)
    if (!hasPrice) {
      unpricedCount += 1
      continue
    }
    pricedCount += 1
    if (it.inStock) continue
    if (!(it.quantity > 0)) continue
    totalEur += it.quantity * (price as number)
  }
  return { totalEur, pricedCount, unpricedCount }
}
