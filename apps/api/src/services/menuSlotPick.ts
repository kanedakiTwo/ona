/**
 * What «Cambiar» (`PUT /menu/:menuId/day/:day/meal/:meal`) knows before it
 * re-picks a slot: everyone's allergies and diet (PRO-305), the ficha's
 * dislikes and equipment (PRO-253), favourites and «¿Qué tal?» ratings
 * (PRO-111), the week's vetoes and the matchable catalogue. Shared with the
 * review of saved menus when someone's restrictions change (PRO-364), so both
 * pick a replacement the same way.
 */
import type { Meal } from '@ona/shared'
import { detectSeason } from '@ona/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { userFavorites, users } from '../db/schema.js'
import { mergeRestrictions } from './dietaryRestrictions.js'
import { withHouseholdRestrictions } from './householdAllergies.js'
import { loadHouseholdRatingSets, withHouseholdRatings } from './householdRatings.js'
import { loadMatchableRecipes } from './matchableRecipes.js'
import { slotTimeBudget } from './menuHolidays.js'
import { loadFichaMenuConstraints, withFichaFilters } from './profile/reader.js'
import { normaliseEquipment } from './recipeMatcher.js'
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
  // The household's ficha on top (PRO-253): dislikes of every member, equipment missing right now.
  const { dislikes, availableEquipment, unavailableEquipment } = withFichaFilters(
    {
      dislikes: Array.isArray(dislikesValue) ? (dislikesValue as string[]) : [],
      availableEquipment: Array.isArray(equipmentValue) ? new Set<string>((equipmentValue as string[]).map(normaliseEquipment)) : undefined,
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

  return { memory, restrictions, dislikes, availableEquipment, unavailableEquipment, rated, recipes, season: detectSeason() }
}

/** The pool and the matcher options for one slot. */
export async function slotPickOptions(ctx: SlotPickContext, menu: SlotPickMenu, dayIndex: number, meal: string, usedRecipeIds: Set<string>) {
  const pool = await schoolDinnerPool(ctx.recipes, menu, dayIndex, meal)
  const options = {
    meal: meal as Meal,
    season: ctx.season,
    usedRecipeIds,
    restrictions: ctx.restrictions,
    ...ctx.rated,
    dislikes: ctx.dislikes,
    availableEquipment: ctx.availableEquipment,
    unavailableEquipment: ctx.unavailableEquipment,
    // PRO-138: the day's limit on total or hands-on time.
    timeBudget: slotTimeBudget(ctx.memory, menu.weekStart, dayIndex),
  }
  return { pool, options }
}
