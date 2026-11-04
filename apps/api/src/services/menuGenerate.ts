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
import type { DayTemplate, WeekPlan } from '@ona/shared'
import { db } from '../db/connection.js'
import { menuLogs, menus } from '../db/schema.js'
import { calculateMenuCaloriesFromDB } from './calorieCalculator.js'
import { generateMenu } from './menuGenerator.js'
import { startShadowPlan } from './menuPlannerShadow.js'
import { generationSkips, loadPreviousWeek, type PreviousWeek } from './menuWeek.js'
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

  const { days, warnings, favoritesShort } = await generateMenu(
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
