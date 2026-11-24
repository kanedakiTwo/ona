// Helpers shared by Mimo's tool modules (week, menu slot, restrictions). Split out of skills.ts (PRO-400).
import { and, eq, desc } from 'drizzle-orm'
import { menus, recipes, recipeIngredients, recipeSteps, ingredients } from '../../db/schema.js'
import { recipeDishesOf } from '@ona/shared'
import { type DayMenu, type Meal } from '@ona/shared'
import { resolveScope, scopeWhere } from '../scopeResolver.js'
import { fillRecipeNames } from '../menuNames.js'
import { madridWeekStart } from '../madridTime.js'
import { dateLabel, resolveMenuDay, type MenuDay } from './menuDay.js'
import { visibleAuthorIds, visibleRecipeWhere } from '../recipeVisibility.js'
import { unlistedDietMentions } from '../stepDietMentions.js'
import { loadUserRestrictions } from '../withWhatIHave.js'
import { withHouseholdRestrictions } from '../householdAllergies.js'
import { loadRecentUserTexts, saidRestrictionsForMenu, type SaidRestrictions } from '../saidRestrictions.js'
import { compileRestrictions, violatesRestrictions, type RestrictableRecipe } from '../dietaryRestrictions.js'
import { type SkillContext, type SkillResult } from './types.js'

/**
 * Text that came from a web page, a photo or another person (an imported
 * recipe's name, the extractor's reason) on its way back to the model: one
 * line, bounded. It is content, never instructions — systemPrompt.ts tells
 * the model the same — but a page shouldn't get a paragraph to try.
 */
export function untrustedText(value: unknown, max = 120): string {
  const s = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

// ─── Helper: get current week start (Monday) ───────────────
// Madrid wall clock, not the server's (UTC on Railway): between 00:00 and
// 02:00 Madrid the server still thinks it's yesterday.
export function getWeekStart(offsetWeeks = 0): string {
  return madridWeekStart(new Date(), offsetWeeks)
}

/**
 * The household's menu for the week starting `weekStart`, or null. Menu
 * tools never edit "the latest menu": the web creates next week's (empty)
 * row just by opening that week, and from then on "el sábado" landed on
 * next week's Saturday (PRO-63, hogares de prueba 2026-10-12).
 */
export async function menuOfWeek(ctx: SkillContext, weekStart: string) {
  const [menu] = await ctx.db
    .select()
    .from(menus)
    .where(and(scopeWhere(menus.userId, menus.householdId, await resolveScope(ctx.userId, ctx.db)), eq(menus.weekStart, weekStart)))
    .orderBy(desc(menus.createdAt))
    .limit(1)
  if (!menu) return null
  // PRO-296: tápers and added dishes saved without a name (before PRO-240)
  // read with their recipe's, like the card on the web.
  return { ...menu, days: await fillRecipeNames(menu.days, ctx.db) }
}

/**
 * The recipe dishes of a menu with their day and meal, in week order from
 * `firstDay` on (then the days before it): «las lentejas» or «la receta de
 * hoy» is the menu's recipe before any other with a similar name (PRO-349).
 */
export function menuRecipeDishes(
  menu: { days?: unknown } | null | undefined,
  firstDay = 0,
): Array<{ recipeId: string; recipeName: string; dayIndex: number; meal: string }> {
  const days = (Array.isArray(menu?.days) ? menu.days : []) as DayMenu[]
  const order = days.map((_, i) => i).sort((a, b) => ((a - firstDay + 7) % 7) - ((b - firstDay + 7) % 7))
  return order.flatMap((dayIndex) =>
    Object.keys(days[dayIndex] ?? {})
      .sort((a, b) => MEAL_KEYS.indexOf(a) - MEAL_KEYS.indexOf(b))
      .flatMap((meal) =>
        recipeDishesOf(days[dayIndex]?.[meal]?.dishes ?? []).map((d) => ({ recipeId: d.recipeId, recipeName: d.recipeName ?? '', dayIndex, meal })),
      ),
  )
}

export const noMenuFor = (weekStart: string): SkillResult => ({
  data: null,
  summary: `No hay menu para la semana del ${dateLabel(weekStart)}; no he cambiado nada. Puedes generarlo con generate_weekly_menu.`,
  uiHint: 'text',
})

export const MEAL_LABEL: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }
export const MEAL_KEYS = Object.keys(MEAL_LABEL)

/** Which day a menu tool call means: `day` words/date, or legacy dayIndex (+ nextWeek). */
export function menuDayParam(params: { day?: unknown; dayIndex?: unknown; nextWeek?: unknown }): MenuDay | { error: string } {
  return resolveMenuDay({ day: params?.day, dayIndex: params?.dayIndex, nextWeek: params?.nextWeek })
}

/** What a confirmed menu change hands back: the real week, date, meal and dish. */
export function changeOf(t: MenuDay, meal: string, dish?: string) {
  return { weekStart: t.weekStart, date: t.isoDate, dayIndex: t.dayIndex, meal, ...(dish ? { dish } : {}) }
}

/** The name (recipe or note) now in a slot of a saved menu row, or null. */
export function dishNow(row: { days?: unknown } | undefined, dayIndex: number, meal: string): string | null {
  const slot = (row?.days as DayMenu[] | undefined)?.[dayIndex]?.[meal as Meal] as
    | { dishes?: Array<{ recipeName?: string; text?: string }>; recipeName?: string }
    | undefined
  const d = slot?.dishes?.[0]
  return d?.recipeName ?? d?.text ?? slot?.recipeName ?? null
}

/**
 * Catalogue + the caller's and their household's recipes — every recipe
 * lookup by name goes through this so the assistant never surfaces another
 * user's private recipe (specs/recipes.md).
 */
export async function visibleWhere(ctx: SkillContext) {
  return visibleRecipeWhere(await visibleAuthorIds(ctx.userId, ctx.db))
}

/**
 * The user's allergies / diet (profile + memory, see mergeRestrictions) and
 * dislikes. Anything Mimoia proposes on its own goes through these; an explicit
 * request can override a dislike, never an allergy (systemPrompt.ts).
 */
export async function restrictionsFor(ctx: SkillContext): Promise<{ restrictions: string[]; dislikes: string[] }> {
  return loadUserRestrictions(ctx.userId, ctx.db)
}

/**
 * PRO-1041 (Seguridad): the allergies said to Mimo (`restrictions_said`, and
 * the person's own messages) that aren't saved for anyone in the household.
 * The menu tools apply them to that menu only and hand Mimo the link to save
 * them on the web with the consent.
 */
export async function saidForMenu(ctx: SkillContext, fromModel: unknown): Promise<SaidRestrictions | null> {
  const saved = () => restrictionsFor(ctx).then((own) => withHouseholdRestrictions(own.restrictions, ctx.userId, ctx.db))
  return saidRestrictionsForMenu(ctx.userId, ctx.db, fromModel, saved, loadRecentUserTexts)
}

export const RESTRICTIONS_SAID_PROP = {
  type: 'array',
  items: { type: 'string' },
  description:
    'Alergias, intolerancias o restricciones de salud que el usuario (o alguien de su casa) ha dicho en esta conversacion y que no estan guardadas, con sus palabras cortas: ["sin gluten"], ["frutos secos"], ["marisco"]. Se aplican solo a este menu y no se guardan. Si no ha dicho ninguna, omitelo.',
} as const

/** Which of the user's allergies / diets (not dislikes) a recipe breaks. */
export async function restrictionConflicts(ctx: SkillContext, recipeId: string): Promise<string[]> {
  const { restrictions } = await restrictionsFor(ctx)
  if (restrictions.length === 0) return []
  const [row] = await ctx.db
    .select({ allergens: recipes.allergens })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1)
  const ings = await ctx.db
    .select({ ingredientName: ingredients.name, allergenTags: ingredients.allergenTags, containsTags: ingredients.containsTags })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(eq(recipeIngredients.recipeId, recipeId))
  // PRO-346: what the steps name and the ingredients don't counts too.
  const steps = await ctx.db
    .select({ index: recipeSteps.index, text: recipeSteps.text })
    .from(recipeSteps)
    .where(eq(recipeSteps.recipeId, recipeId))
  const stepTexts = [...(steps ?? [])].sort((a: any, b: any) => a.index - b.index).map((s: any) => s.text ?? '')
  const ingredientRows = (ings ?? []) as RestrictableRecipe['ingredients']
  const recipe: RestrictableRecipe = {
    allergens: row?.allergens ?? [],
    ingredients: ingredientRows,
    stepMentions: unlistedDietMentions(stepTexts, ingredientRows.map((i) => i.ingredientName)),
  }
  return restrictions.filter((r) => violatesRestrictions(recipe, compileRestrictions([r])))
}


/** The save didn't come back with the dish in place: never report it as done. */
export const notSaved = (slotLabel: string): SkillResult => ({
  data: null,
  summary: `No he podido guardar el cambio en la ${slotLabel}; no esta hecho. Diselo al usuario.`,
  uiHint: 'text',
})

/** PRO-349: a dish on a «sin cocinar» day reactivates it (`unskipDay` in the save); the summary says so. */
export function reactivatedLine(menu: { skippedDays?: number[] | null } | null | undefined, t: { dayIndex: number; label: string }): string {
  return menu?.skippedDays?.includes(t.dayIndex) ? ` El ${t.label} estaba marcado sin cocinar: ya vuelve a estar activo.` : ''
}

// Helper: rounding bands consistent with services/recipeScaler.ts (kept inline so the
// skill stays a pure read; if scaler adds units we should mirror them here).
export function scaleRound(raw: number, unit: string): number {
  if (raw === 0) return 0
  const u = (unit ?? 'g').toLowerCase()
  if (u === 'pizca' || u === 'al_gusto') return raw
  if (u === 'u') return Math.max(1, Math.round(raw))
  if (u === 'cda' || u === 'cdita') return Math.round(raw * 2) / 2
  // g / ml: same bands as recipeScaler.ts
  const bands: ReadonlyArray<readonly [number, number]> = [
    [5, 0.5], [25, 1], [100, 5], [250, 25], [500, 50], [1000, 100], [5000, 250], [Infinity, 500],
  ]
  let step = 500
  for (const [upper, s] of bands) { if (raw < upper) { step = s; break } }
  return Math.round(raw / step) * step
}
