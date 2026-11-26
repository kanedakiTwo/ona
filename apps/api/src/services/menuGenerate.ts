/**
 * Generate and save one week: the path of `POST /menu/generate` (PRO-381
 * moved it here so Mimo's Thursday week, `weeklyAutoplan.ts`, goes through
 * the very same steps). Same generator (diet, ficha, what was cooked or
 * changed), and it carries the week's locks, vetoes and «sin cocinar» days.
 *
 * What it does not do (the route does it around this): the wait for the
 * sign-up analysis, the fridge question, the «cuánto ha acertado» line
 * (PRO-155) and the response.
 */
import { pastMealsOn, type DayMenu, type DayTemplate, type WeekPlan } from '@ona/shared'
import { and, asc, desc, eq, lt, or } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { menuLogs, menus, recipeVerdicts, users } from '../db/schema.js'
import { calculateMenuCaloriesFromDB } from './calorieCalculator.js'
import { generateMenu } from './menuGenerator.js'
import { startShadowPlan } from './menuPlannerShadow.js'
import { compileRestrictions, mergeRestrictions, normalizeText, violatesRestrictions } from './dietaryRestrictions.js'
import { withHouseholdRestrictions } from './householdAllergies.js'
import { loadMatchableRecipes } from './matchableRecipes.js'
import { generationSkips, loadPreviousWeek, menuHasDishes, withoutPastMeals, type PreviousWeek } from './menuWeek.js'
import { placeSignupDishes, recipeForDish, type SignupDish } from './signupFirstMenu.js'
import { getMemoryForUser } from './userMemoryStore.js'
import { enqueuePrepAlertsForMenu } from './notificationScheduler.js'
import { calculateMenuNutrientsFromDB } from './nutrientCalculator.js'
import { updateBalance } from './nutrientBalance.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'

export interface GenerateWeekInput {
  userId: string
  weekStart: string
  customTemplate?: DayTemplate[]
  /** PRO-225: meals out and guests for this week only (after the fridge gate). */
  weekPlan?: WeekPlan
  /** PRO-244: the first menu starts on the sign-up day. */
  fromDate?: string
  /** PRO-377: «Rehacer la semana con mis favoritas». */
  onlyFavorites?: boolean
  /** Already loaded by the caller (the route needs it before). */
  previous?: PreviousWeek
}

export async function generateAndSaveMenu(input: GenerateWeekInput) {
  const { userId, weekStart } = input
  const householdId = await getPrimaryHouseholdId(userId)
  const previous = input.previous ?? (await loadPreviousWeek(userId, weekStart))
  const carryBanned = previous.bannedRecipeIds
  const carrySkipped = previous.skippedDays

  const generated = await generateMenu(
    userId,
    weekStart,
    input.customTemplate,
    db,
    previous.locked,
    previous.days,
    carryBanned,
    generationSkips(carrySkipped, weekStart, input.fromDate),
    input.weekPlan,
    { onlyFavorites: input.onlyFavorites === true },
  )
  const { warnings, favoritesShort } = generated
  // 19-nov: on the first menu's day, the meals already gone stay empty too.
  let days = withoutPastMeals(generated.days, weekStart, input.fromDate, pastMealsOn(input.fromDate))
  // PRO-1296: the web sign-up's first menu takes the dishes they make often, as on WhatsApp.
  if (input.fromDate) {
    const dishes = await signupDishesForWeek(userId, householdId, weekStart, input.fromDate).catch(() => [])
    if (dishes.length) days = placeSignupDishes(days, dishes, previous.locked).days
  }

  // Save to menus table — carry the lists forward so the matcher honours
  // them next regeneration too.
  const [menu] = await db
    .insert(menus)
    .values({
      userId,
      householdId,
      weekStart,
      days,
      locked: previous.locked,
      bannedRecipeIds: [...carryBanned],
      skippedDays: [...carrySkipped],
    })
    .returning()

  // Calculate calories and nutrients for the menu log
  const caloriesTotal = await calculateMenuCaloriesFromDB(days, db)
  const aggregatedNutrients = await calculateMenuNutrientsFromDB(days, db)
  await db.insert(menuLogs).values({ userId, menuId: menu.id, weekStart, aggregatedNutrients, caloriesTotal })
  await updateBalance(userId, aggregatedNutrients, db)

  // Enqueue prep-time alerts for this menu (PR-D). Best-effort: a
  // failure here must NOT take the menu down — we log and continue.
  // Opt-in: only fires when the user has matching `prep_habits`.
  enqueuePrepAlertsForMenu(menu.id).catch((err) => {
    console.warn('[menus.generate] enqueuePrepAlertsForMenu failed:', err)
  })

  // Menú inteligente a la sombra (PRO-255): Mimo piensa la misma semana
  // and stores its proposal in `menu_plans`; the household keeps seeing
  // this one. Not awaited: it never delays or breaks the menu.
  startShadowPlan({
    menuId: menu.id,
    userId,
    weekStart,
    days,
    locked: previous.locked,
    bannedRecipeIds: carryBanned,
    skippedDays: carrySkipped,
  })

  return { menu, days, warnings, favoritesShort }
}

/** The Monday (ISO) of the week `isoDate` falls in. */
function mondayOfDate(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** The sign-up's first menu takes three of their dishes, as the WhatsApp sign-up asks three. */
const SIGNUP_DISHES = 3

/**
 * PRO-1296 · The web sign-up (`fromDate`: the first menu starts on the sign-up
 * day) puts the dishes they said in the first menu, as the WhatsApp sign-up
 * does (`signupFirstMenu.ts`, 19-nov). The web doesn't ask for dishes since
 * PRO-146: what they said are the «Me encanta» of «Afina tu menú» (oldest
 * first, up to three) and, from the API or an old client, `favoriteDishes`
 * (the catalogue's recipe, or their own, else a note with the dish's name).
 * Never a recipe with what someone in the house can't eat. Only while these
 * are the household's first weeks (no menu with dishes before the sign-up's
 * week), and a dish already in an earlier first week (Friday to Sunday the
 * sign-up makes two) doesn't go again. Before, they only weighed like
 * favourites and the first menu often didn't bring them.
 */
export async function signupDishesForWeek(userId: string, householdId: string | null, weekStart: string, fromDate: string): Promise<SignupDish[]> {
  const [user] = await db.select({ favoriteDishes: users.favoriteDishes, restrictions: users.restrictions }).from(users).where(eq(users.id, userId)).limit(1)
  const said = (user?.favoriteDishes ?? []).map((d) => d.trim()).filter(Boolean)
  const loved = await db
    .select({ recipeId: recipeVerdicts.recipeId })
    .from(recipeVerdicts)
    .where(and(eq(recipeVerdicts.userId, userId), eq(recipeVerdicts.verdict, 'love')))
    .orderBy(asc(recipeVerdicts.createdAt))
  if (said.length === 0 && loved.length === 0) return []
  const firstWeek = mondayOfDate(fromDate)
  const rows = await db
    .select({ weekStart: menus.weekStart, days: menus.days })
    .from(menus)
    .where(and(householdId ? or(eq(menus.householdId, householdId), eq(menus.userId, userId)) : eq(menus.userId, userId), lt(menus.weekStart, weekStart)))
    .orderBy(desc(menus.createdAt))
  if (rows.some((r) => String(r.weekStart) < firstWeek && menuHasDishes(r.days as DayMenu[]))) return []
  // The dishes already in the first weeks before this one (each week as it is now: its newest row).
  const seen = new Set<string>()
  const placedIds = new Set<string>()
  const placedNotes = new Set<string>()
  for (const r of rows) {
    const week = String(r.weekStart)
    if (seen.has(week)) continue
    seen.add(week)
    for (const day of (r.days as DayMenu[]) ?? []) {
      for (const slot of Object.values(day ?? {})) {
        for (const d of slot?.dishes ?? []) {
          if (d.kind === 'recipe') placedIds.add(d.recipeId)
          else placedNotes.add(normalizeText(d.text))
        }
      }
    }
  }
  const pool = await loadMatchableRecipes(userId)
  const memory = await getMemoryForUser(userId).catch(() => null)
  const rules = compileRestrictions(await withHouseholdRestrictions(mergeRestrictions(user?.restrictions, memory), userId))
  const allowed = pool.filter((r) => !violatesRestrictions(r, rules))
  const dishes: SignupDish[] = []
  const chosen = new Set<string>()
  const add = (dish: SignupDish) => {
    if (dish.recipe) {
      if (chosen.has(dish.recipe.id)) return
      chosen.add(dish.recipe.id)
    }
    dishes.push(dish)
  }
  for (const dish of said) {
    const recipe = recipeForDish(dish, allowed, userId)
    // Its recipe has what someone can't eat: left out, never as a note either.
    if (!recipe && recipeForDish(dish, pool, userId)) continue
    add({ dish, recipe })
  }
  const allowedById = new Map(allowed.map((r) => [r.id, r]))
  for (const { recipeId } of loved) {
    if (dishes.length >= SIGNUP_DISHES) break
    const recipe = allowedById.get(recipeId)
    // A lunch or dinner dish (not a breakfast, nor a dessert).
    const main = recipe && recipe.course !== 'dessert' && (!recipe.meals?.length || recipe.meals.some((m) => m === 'lunch' || m === 'dinner'))
    if (main) add({ dish: recipe.name, recipe })
  }
  return dishes.filter((d) => (d.recipe ? !placedIds.has(d.recipe.id) : !placedNotes.has(normalizeText(d.dish))))
}
