/**
 * «Cocinar ahora» (specs/cook-now.md): what the search reads from the
 * database — the meal of now and what was planned for it, the candidates
 * (the menu's loader and matcher, minus the time budget), the house
 * (pantry, staples, recent cooks) — and the write of «Cocinar esta».
 */
import {
  cookNowMeal,
  displaceTargets,
  plannedRecipeDishes,
  type CookNowChooseRequest,
  type CookNowProposalRequest,
  type DayMenu,
  type Meal,
  type RecipeDish,
} from '@ona/shared'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/connection.js'
import { ingredients, menus, pantryItems, recipes } from '../../db/schema.js'
import { getRecipeCookStats, listRecentCookLogs } from '../cookLogStore.js'
import { loadHouseholdRatingSets } from '../householdRatings.js'
import { madridParts, madridWeekStart } from '../madridTime.js'
import { loadMatchableRecipes, type RecipeWithCourse } from '../matchableRecipes.js'
import { recordMenuEdits, slotDiff } from '../menuEdits.js'
import { loadSlotPickContext } from '../menuSlotPick.js'
import { matchRecipes } from '../recipeMatcher.js'
import { visibleAuthorIds, visibleRecipeWhere } from '../recipeVisibility.js'
import { getPrimaryHouseholdId, resolveScope, scopeWhere } from '../scopeResolver.js'
import { listActiveStaplesForHousehold } from '../staplesStore.js'
import type { PhraseFactsInput } from './phrase.js'
import { placeCookNowRecipe } from './place.js'
import { evaluateRecipe, rankCookNow, type CookNowContext, type CookNowFit, type PantryLine } from './search.js'

export const COOK_NOW_ITEMS = 3
export const RECENT_COOK_DAYS = 7

/** Main and versatile dishes only: «Cocinar ahora» proposes a meal, not a starter or a dessert. */
export function isCookNowCourse(course: string | null): boolean {
  return course == null || course === 'main'
}

export interface CookNowPlannedDish {
  recipeId: string
  recipeName: string
  imageUrl: string | null
  totalTime: number | null
}

/** The household's menu of this week (same scope as Mimo's menuOfWeek), the most recent row. */
async function menuOfWeek(userId: string, weekStart: string) {
  const [menu] = await db
    .select()
    .from(menus)
    .where(and(scopeWhere(menus.userId, menus.householdId, await resolveScope(userId)), eq(menus.weekStart, weekStart)))
    .orderBy(desc(menus.createdAt))
    .limit(1)
  return menu ?? null
}

/** The meal of now, what was planned for it and the days its dishes can move to. */
export async function loadCookNowToday(userId: string, now: Date = new Date()) {
  const { weekday: day, hour } = madridParts(now)
  const weekStart = madridWeekStart(now)
  const menu = await menuOfWeek(userId, weekStart)
  const days = ((menu?.days as DayMenu[] | undefined) ?? []).slice()
  const meal = cookNowMeal(days[day] ?? {}, hour)
  const slot = meal ? days[day]?.[meal] : undefined
  const dishes = plannedRecipeDishes(slot)
  const info = dishes.length
    ? await db
        .select({ id: recipes.id, name: recipes.name, imageUrl: recipes.imageUrl, totalTime: recipes.totalTime })
        .from(recipes)
        .where(inArray(recipes.id, dishes.map((d) => d.recipeId)))
    : []
  const byId = new Map(info.map((r) => [r.id, r]))
  const planned: CookNowPlannedDish[] = dishes.map((d) => ({
    recipeId: d.recipeId,
    recipeName: byId.get(d.recipeId)?.name ?? d.recipeName ?? '',
    imageUrl: byId.get(d.recipeId)?.imageUrl ?? null,
    totalTime: byId.get(d.recipeId)?.totalTime ?? null,
  }))
  return {
    weekStart,
    day,
    meal,
    menu,
    days,
    planned,
    slotServings: slot?.servings ?? null,
    targets: meal ? displaceTargets(days, day, meal, (menu?.skippedDays as number[] | undefined) ?? []) : [],
  }
}

/** The menu's candidates for this meal (allergies, diet, dislikes, vetoes, «Mejor no», equipment, season), without the time budget. */
export async function loadCookNowCandidates(userId: string, meal: string, weekday: number, menu: { householdId: string | null; weekStart: string; bannedRecipeIds: string[] | null } | null) {
  const ctx = await loadSlotPickContext(
    { userId, householdId: menu?.householdId ?? null, weekStart: menu?.weekStart ?? madridWeekStart(), bannedRecipeIds: menu?.bannedRecipeIds ?? [] },
    userId,
  )
  const matched = matchRecipes(ctx.recipes, {
    meal: meal as Meal,
    season: ctx.season,
    usedRecipeIds: new Set(),
    restrictions: ctx.restrictions,
    ...ctx.rated,
    dislikes: ctx.dislikes,
    availableEquipment: ctx.availableEquipment,
    unavailableEquipment: ctx.unavailableEquipment,
    dayIndex: weekday,
  }) as RecipeWithCourse[]
  // The matcher repeats favourites to weigh them: one of each here.
  const seen = new Set<string>()
  const candidates = matched.filter((r) => isCookNowCourse(r.course) && !seen.has(r.id) && seen.add(r.id))
  // «Repetir a menudo» (5 stars, «Me encanta»): a tie-break in the order.
  const { boost } = await loadHouseholdRatingSets(userId)
  return { candidates, boost }
}

/** The house: pantry, active staples, recipes cooked in the last 7 days, today (Madrid). */
export async function loadCookNowHouse(userId: string, now: Date = new Date()): Promise<Omit<CookNowContext, 'substituteNames' | 'boost'>> {
  const householdId = await getPrimaryHouseholdId(userId)
  const pantryRows = householdId
    ? await db
        .select({ ingredientId: pantryItems.ingredientId, name: pantryItems.name, quantity: pantryItems.quantity, unit: pantryItems.unit, expiresAt: pantryItems.expiresAt })
        .from(pantryItems)
        .where(eq(pantryItems.householdId, householdId))
    : []
  const staples = householdId ? await listActiveStaplesForHousehold(householdId) : []
  const since = now.getTime() - RECENT_COOK_DAYS * 86_400_000
  const logs = await listRecentCookLogs(userId, 200)
  return {
    pantry: pantryRows.map((p): PantryLine => ({ ingredientId: p.ingredientId, name: p.name, quantity: p.quantity, unit: p.unit, expiresAt: p.expiresAt ?? null })),
    staples: staples.map((s) => s.name),
    cookedRecently: new Set(logs.filter((l) => l.cookedAt && new Date(l.cookedAt).getTime() >= since).map((l) => l.recipeId)),
    today: madridParts(now).isoDate,
  }
}

/** Names of every substitute the candidates mention, in one query. */
async function loadSubstituteNames(candidates: readonly RecipeWithCourse[]): Promise<Map<string, string>> {
  const ids = new Set<string>()
  for (const r of candidates) for (const i of r.ingredients) for (const id of i.substituteIngredientIds ?? []) ids.add(id)
  if (ids.size === 0) return new Map()
  const rows = await db.select({ id: ingredients.id, name: ingredients.name }).from(ingredients).where(inArray(ingredients.id, [...ids]))
  return new Map(rows.map((r) => [r.id, r.name]))
}

export interface CookNowProposalItem {
  recipe: { id: string; name: string; imageUrl: string | null; totalTime: number | null }
  fit: CookNowFit
  missingEssential: string[]
  short: string[]
  missingSecondary: string[]
  substitutions: Array<{ missing: string; use: string }>
  uses: string[]
  expiring: string[]
}

/** POST /cook-now/proposal: 0–3 recipes for the four answers. Without a meal of now, it searches dinner and says `meal: null`. */
export async function findCookNowProposal(userId: string, answers: CookNowProposalRequest, now: Date = new Date()) {
  const today = await loadCookNowToday(userId, now)
  const { candidates, boost } = await loadCookNowCandidates(userId, today.meal ?? 'dinner', today.day, today.menu)
  const house = await loadCookNowHouse(userId, now)
  const substituteNames = await loadSubstituteNames(candidates)
  const { hits, fallback } = rankCookNow(candidates, answers, { ...house, substituteNames, boost })
  const top = (answers.requirePantryUse ? hits.filter((h) => h.uses.length > 0) : hits).slice(0, COOK_NOW_ITEMS)
  const images = top.length
    ? await db.select({ id: recipes.id, imageUrl: recipes.imageUrl }).from(recipes).where(inArray(recipes.id, top.map((h) => h.recipe.id)))
    : []
  const imageOf = new Map(images.map((r) => [r.id, r.imageUrl]))
  const items: CookNowProposalItem[] = top.map((h) => ({
    recipe: { id: h.recipe.id, name: h.recipe.name, imageUrl: imageOf.get(h.recipe.id) ?? null, totalTime: h.recipe.totalTime ?? null },
    fit: h.fit,
    missingEssential: h.missingEssential,
    short: h.short,
    missingSecondary: h.missingSecondary,
    substitutions: h.substitutions,
    uses: h.uses,
    expiring: h.expiring,
  }))
  return { meal: today.meal, fallback, items }
}

/** The facts of Mimo's line on one recipe; null when the user can't see it. */
export async function loadPhraseFacts(userId: string, recipeId: string, now: Date = new Date()): Promise<PhraseFactsInput | null> {
  const recipe = (await loadMatchableRecipes(userId)).find((r) => r.id === recipeId)
  if (!recipe) return null
  const house = await loadCookNowHouse(userId, now)
  const substituteNames = await loadSubstituteNames([recipe])
  const { boost } = await loadHouseholdRatingSets(userId)
  const hit = evaluateRecipe(recipe, { minutes: null, servings: recipe.servings ?? 4, canBuy: true }, { ...house, substituteNames, boost })
  const stats = await getRecipeCookStats(userId, recipeId)
  const last = stats.lastCookedAt ? new Date(stats.lastCookedAt) : null
  return {
    recipeName: recipe.name,
    uses: hit.uses,
    expiring: hit.expiring,
    lastCookedDaysAgo: last ? Math.max(0, Math.floor((now.getTime() - last.getTime()) / 86_400_000)) : null,
    repeat: boost.has(recipeId),
    missingSecondary: hit.missingSecondary,
  }
}

export type CookNowChooseResult =
  | { placed: true; menuId: string; weekStart: string; day: number; meal: string }
  | { placed: false; reason: 'no_meal' | 'not_found' | 'banned' | 'bad_target' }

/** POST /cook-now/choose: the recipe goes into the meal of now; the planned dishes move to `displacedTo` or go. */
export async function chooseCookNowRecipe(
  req: { userId?: string; get?: (h: string) => string | undefined },
  body: CookNowChooseRequest,
  now: Date = new Date(),
): Promise<CookNowChooseResult> {
  const userId = req.userId!
  const today = await loadCookNowToday(userId, now)
  const { meal, day, menu } = today
  if (!meal) return { placed: false, reason: 'no_meal' }
  // A locked meal is replaced too (PRO-1175): the lock only keeps it when the week is redone.
  const [recipe] = await db
    .select({ id: recipes.id, name: recipes.name })
    .from(recipes)
    .where(and(visibleRecipeWhere(await visibleAuthorIds(userId)), eq(recipes.id, body.recipeId)))
    .limit(1)
  if (!recipe) return { placed: false, reason: 'not_found' }
  if ((menu?.bannedRecipeIds as string[] | undefined)?.includes(recipe.id)) return { placed: false, reason: 'banned' }
  if (body.displacedTo != null && !today.targets.some((t) => t.day === body.displacedTo && !t.disabled)) {
    return { placed: false, reason: 'bad_target' }
  }
  const dish: RecipeDish = { kind: 'recipe', recipeId: recipe.id, recipeName: recipe.name }
  if (menu) {
    const before = today.days
    const after = placeCookNowRecipe(before, { day, meal }, dish, body.servings, body.displacedTo)
    await db.update(menus).set({ days: after }).where(eq(menus.id, menu.id))
    const moved = body.displacedTo != null && today.planned.length > 0
    await recordMenuEdits(req, menu, [
      ...slotDiff(day, meal, before[day]?.[meal]?.dishes, after[day]?.[meal]?.dishes),
      ...(moved ? slotDiff(body.displacedTo!, meal, before[body.displacedTo!]?.[meal]?.dishes, after[body.displacedTo!]?.[meal]?.dishes) : []),
    ])
    return { placed: true, menuId: menu.id, weekStart: today.weekStart, day, meal }
  }
  // No menu this week: one with only this dish (the rest stays empty), like Mimo.
  const days: DayMenu[] = Array.from({ length: 7 }, () => ({}))
  days[day] = { [meal]: { ...(body.servings != null ? { servings: body.servings } : {}), dishes: [dish] } }
  const householdId = await getPrimaryHouseholdId(userId)
  const [saved] = await db
    .insert(menus)
    .values({ userId, householdId, weekStart: today.weekStart, days, locked: {}, bannedRecipeIds: [], skippedDays: [] })
    .returning({ id: menus.id })
  return { placed: true, menuId: saved.id, weekStart: today.weekStart, day, meal }
}
