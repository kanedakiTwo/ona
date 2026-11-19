/**
 * What «Cambiar» (`PUT /menu/:menuId/day/:day/meal/:meal`) knows before it
 * re-picks a slot: everyone's allergies and diet (PRO-305), the ficha's
 * dislikes and equipment (PRO-253), cuisines and cooking level (PRO-1201), favourites and «¿Qué tal?» ratings
 * (PRO-111), the week's vetoes and the matchable catalogue. Shared with the
 * review of saved menus when someone's restrictions change (PRO-364), so both
 * pick a replacement the same way. While the household is starting, or once
 * the week has its 2 dishes from outside, it keeps to the `diario` recipes
 * when one fits (PRO-1200, `everydayMenu.ts`).
 *
 * «Cambiar» without a dish (the app's and Mimo's `swap_meal`, 2026-11-19:
 * a khachapuri of 151 min for a Tuesday dinner, a sweet mutabbaq as a
 * Sunday dinner, higadillos twice the same week, hummus for a household that
 * said no legumes) also keeps what the household said about its menu
 * (`menuRules.ts`: weekly limits, light meals), a reasonable time on a
 * working day and, while one fits, a dish whose main food isn't elsewhere in
 * the week and, as a single dish, has protein (`pickForSlot`).
 */
import type { Course, DayMenu, Meal } from '@ona/shared'
import { detectSeason, weekHolidays } from '@ona/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { userFavorites, users } from '../db/schema.js'
import { mergeRestrictions } from './dietaryRestrictions.js'
import { everydayPolicy, loadIsStarting, slotEveryday } from './everydayMenu.js'
import { withHouseholdRestrictions } from './householdAllergies.js'
import { loadHouseholdRatingSets, withHouseholdRatings } from './householdRatings.js'
import { loadMatchableRecipes } from './matchableRecipes.js'
import { regionFromMemory, slotTimeBudget } from './menuHolidays.js'
import { findForCourse } from './courseAwareMatcher.js'
import { proteinKind } from './tasteDeck.js'
import { isLightDish, limitCounts, mainFoodKey, withinLimits } from './menuRules.js'
import type { RecipeWithCourse } from './matchableRecipes.js'
import { loadFichaMenuConstraints, withFichaFilters } from './profile/reader.js'
import { normaliseEquipment } from './recipeMatcher.js'
import { memoryTastes } from './menuTastes.js'
import { schoolDinnerPool } from './schoolMenu.js'
import { resolveScope, scopeWhere } from './scopeResolver.js'
import { getMemoryForUser } from './userMemoryStore.js'

export interface SlotPickMenu {
  userId: string
  householdId: string | null
  weekStart: string
  bannedRecipeIds: string[] | null
}

export type SlotPickContext = Awaited<ReturnType<typeof loadSlotPickContext>>

/** The owner's memory and the allergies and diet of the whole household (PRO-305), like the weekly menu. */
export async function loadMenuRestrictions(menu: Pick<SlotPickMenu, 'userId'>) {
  const [user] = await db
    .select({ restrictions: users.restrictions })
    .from(users)
    .where(eq(users.id, menu.userId))
    .limit(1)
  const memory = await getMemoryForUser(menu.userId).catch(() => null)
  const restrictions = await withHouseholdRestrictions(mergeRestrictions(user?.restrictions, memory), menu.userId)
  return { memory, restrictions }
}

/** Everything that doesn't depend on the slot. `requesterId`: who asked (their visible recipes and ratings). */
export async function loadSlotPickContext(menu: SlotPickMenu, requesterId: string) {
  // Restrictions + dislikes from long-term memory.
  const { memory, restrictions } = await loadMenuRestrictions(menu)
  const dislikesValue = memory?.dislikes?.value
  const equipmentValue = memory?.equipment?.value
  // The household's ficha on top (PRO-253): dislikes of every member, equipment missing right now;
  // cuisines and cooking level as weights (PRO-1201).
  const { dislikes, availableEquipment, unavailableEquipment, tastes, weeklyLimits, lightMeals, efforts } = withFichaFilters(
    {
      dislikes: Array.isArray(dislikesValue) ? (dislikesValue as string[]) : [],
      availableEquipment: Array.isArray(equipmentValue) ? new Set<string>((equipmentValue as string[]).map(normaliseEquipment)) : undefined,
      tastes: memoryTastes(memory),
      notes: [memory?.notes?.value, memory?.nutrition_principles?.value].flatMap((v) => (Array.isArray(v) ? v : [])),
    },
    await loadFichaMenuConstraints(menu.userId),
  )

  // Fetch favorites — household-scoped when the flag is on so the
  // matcher boosts recipes any household member has starred.
  const favScope = await resolveScope(menu.userId)
  const favRows = await db
    .select({ recipeId: userFavorites.recipeId })
    .from(userFavorites)
    .where(scopeWhere(userFavorites.userId, userFavorites.householdId, favScope))

  // «¿Qué tal?» ratings (PRO-111): 5 stars boost, 1 star never auto-picked.
  const rated = withHouseholdRatings(
    new Set<string>(favRows.map((f: any) => f.recipeId)),
    new Set(menu.bannedRecipeIds ?? []),
    await loadHouseholdRatingSets(requesterId),
  )

  // Same loader as the weekly generator: visibility, fit maps, frequency, allergens.
  const recipes = await loadMatchableRecipes(requesterId)

  // PRO-1200: «de diario» while starting, at most 2 from outside a week after.
  const everyday = everydayPolicy(recipes, await loadIsStarting(menu.userId, menu.weekStart), [...rated.favoriteRecipeIds, ...rated.likedRecipeIds])

  return { memory, restrictions, dislikes, availableEquipment, unavailableEquipment, tastes, rated, recipes, everyday, season: detectSeason(), weeklyLimits, lightMeals, efforts }
}

/** A working day's lunch or dinner, when the household said no time: at most this, in total. */
export const WORKDAY_MAX_MINUTES = 60

/** Minutes a recipe takes in total, when known (total, else prep + cook). */
function totalMinutesOf(r: { totalTime?: number | null; prepTime?: number | null; cookTime?: number | null }): number | null {
  if (r.totalTime && r.totalTime > 0) return r.totalTime
  const sum = (r.prepTime ?? 0) + (r.cookTime ?? 0)
  return sum > 0 ? sum : null
}

/**
 * Pure: the week's recipes outside one slot (`days`, the menu as it is),
 * looked up in `byId`.
 */
function weekRecipesBut<T>(days: readonly DayMenu[], byId: ReadonlyMap<string, T>, dayIndex: number, meal: string): T[] {
  const out: T[] = []
  days.forEach((day, d) => {
    for (const [m, slot] of Object.entries(day ?? {})) {
      if (d === dayIndex && m === meal) continue
      for (const dish of slot?.dishes ?? []) {
        const r = dish.kind === 'recipe' ? byId.get(dish.recipeId) : undefined
        if (r) out.push(r)
      }
    }
  })
  return out
}

export interface SlotRulesInput {
  meal: string
  dayIndex: number
  /** The week as it is (the slot being changed is left out). */
  days?: readonly DayMenu[]
  weeklyLimits: SlotPickContext['weeklyLimits']
  lightMeals: readonly string[]
  /** Lunch or dinner of a working day (not a holiday) with no time said for it. */
  workdayCap: number | null
  /** Every recipe the week may hold, by id (to read the other slots). */
  byId: ReadonlyMap<string, RecipeWithCourse>
}

/**
 * Pure: the slot's pool with the household's menu rules (a weekly limit
 * already reached, light meals, the working-day time cap; all hard), and the
 * preferred part of it: no main food already elsewhere in the week.
 */
export function applySlotRules<T extends RecipeWithCourse>(pool: T[], i: SlotRulesInput): { pool: T[]; preferred: T[] } {
  const week = i.days ? weekRecipesBut(i.days, i.byId, i.dayIndex, i.meal) : []
  let out = pool
  if (i.weeklyLimits.length) out = withinLimits(out, i.weeklyLimits, limitCounts(i.weeklyLimits, week))
  if (i.lightMeals.includes(i.meal)) out = out.filter((r) => isLightDish(r))
  if (i.workdayCap) out = out.filter((r) => { const t = totalMinutesOf(r); return t == null || t <= i.workdayCap! })
  const keys = new Set(week.map((r) => mainFoodKey(r)).filter((k): k is string => !!k))
  const preferred = keys.size ? out.filter((r) => { const k = mainFoodKey(r); return !k || !keys.has(k) }) : out
  return { pool: out, preferred }
}

/**
 * Pure: a recipe for one dish of the slot. In order: the preferred pool with
 * a protein (a single dish or a main), the preferred pool, then the whole
 * pool. `narrow` keeps each to a dish type (the week type's, a chip's).
 */
export function pickForSlot<T extends RecipeWithCourse>(
  pick: { pool: T[]; preferred?: T[]; options: Parameters<typeof findForCourse>[2] },
  course: Course | null,
  narrow: (p: T[]) => T[] = (p) => p,
): T | undefined {
  const preferred = pick.preferred ?? pick.pool
  const savoury = (course === null || course === 'main') && (pick.options.meal === 'lunch' || pick.options.meal === 'dinner')
  const tries = [...(savoury ? [preferred.filter((r) => proteinKind({ name: r.name, ingredients: r.ingredients ?? [] }) !== 'verdura')] : []), preferred, pick.pool]
  for (const p of tries) {
    const found = findForCourse(narrow(p), course, pick.options) as T | undefined
    if (found) return found
  }
  return undefined
}

/**
 * The pool and the matcher options for one slot. With `days` (the week as it
 * is), also the household's menu rules and the preferred pool (`applySlotRules`).
 */
export async function slotPickOptions(ctx: SlotPickContext, menu: SlotPickMenu, dayIndex: number, meal: string, usedRecipeIds: Set<string>, days?: readonly DayMenu[]) {
  const school = await schoolDinnerPool(ctx.recipes, menu, dayIndex, meal)
  // The day's limit: what the household said (memory, else an `effort` of the ficha), else a working-day cap.
  const said = slotTimeBudget(ctx.memory, menu.weekStart, dayIndex)
  const effort = ctx.efforts?.find((e) => e.meal === meal && e.days.includes(dayIndex))
  const start = typeof menu.weekStart === 'string' ? menu.weekStart : String(menu.weekStart)
  const holiday = weekHolidays(start.slice(0, 10), regionFromMemory(ctx.memory?.region?.value)).some((h) => h.dayIndex === dayIndex)
  const workdayCap = !said && (meal === 'lunch' || meal === 'dinner') && dayIndex < 5 && !holiday ? effort?.totalMinutes ?? WORKDAY_MAX_MINUTES : null
  const { pool, preferred } = applySlotRules(school as RecipeWithCourse[], {
    meal,
    dayIndex,
    days,
    weeklyLimits: ctx.weeklyLimits ?? [],
    lightMeals: ctx.lightMeals ?? [],
    workdayCap,
    byId: new Map(ctx.recipes.map((r) => [r.id, r as RecipeWithCourse])),
  })
  const options = {
    meal: meal as Meal,
    season: ctx.season,
    usedRecipeIds,
    restrictions: ctx.restrictions,
    ...ctx.rated,
    dislikes: ctx.dislikes,
    availableEquipment: ctx.availableEquipment,
    unavailableEquipment: ctx.unavailableEquipment,
    tastes: ctx.tastes,
    // PRO-138: the day's limit on total or hands-on time.
    timeBudget: said,
    // PRO-1200: the rest of the week's dishes say how many from outside are left.
    everyday: slotEveryday(ctx.everyday, usedRecipeIds),
  }
  return { pool, options, preferred }
}
