import crypto from 'crypto'
import { and, eq, desc, ilike, or, inArray, isNull } from 'drizzle-orm'
import {
  menus,
  recipes,
  recipeIngredients,
  recipeSteps,
  ingredients,
  userFavorites,
  users,
  userNutrientBalance,
  menuLogs,
  shoppingLists,
} from '../../db/schema.js'
import { nutrientsToPercentages, TARGET_MACROS, detectSeason, recipeDishesOf } from '@ona/shared'
import type { DayMenu, Meal, NutrientBalance } from '@ona/shared'
import { householdMultiplier } from '@ona/shared'
import { generateMenu } from '../menuGenerator.js'
import { findRecipeForSlot, type RecipeWithIngredients } from '../recipeMatcher.js'
import { calculateMenuCaloriesFromDB } from '../calorieCalculator.js'
import { calculateMenuNutrientsFromDB } from '../nutrientCalculator.js'
import { updateBalance } from '../nutrientBalance.js'
import { getSummary } from '../advisor.js'
import { getPrimaryHouseholdId, resolveScope, scopeWhere } from '../scopeResolver.js'
import { importRecipeFromUrl, createRecipeFromParts, type RecipeParts } from '../recipeImport.js'
import { mealLinesForDay } from '../menuText.js'
import { slotWithDishes } from '../menuDishes.js'
import { madridWeekStart } from '../madridTime.js'
import { DAY_PROP, dateLabel, isMenuDayError, menuDayOf, resolveMenuDay, type MenuDay } from './menuDay.js'
import { appSkills, bestMatch, dishNoteText, searchWords } from './appSkills.js'
import { createDishRecipe, NEW_RECIPE_PROP, NOTE_THEN_RECIPE_HINT, type NewRecipeParam } from './dishRecipe.js'
import { shopOrderSkills } from './shopOrderSkills.js'
import { fixedMealSkills } from './fixedMealSkills.js'
import { visibleAuthorIds, visibleRecipeWhere } from '../recipeVisibility.js'
import { loadMatchableRecipes } from '../matchableRecipes.js'
import { loadPreviousWeek } from '../menuWeek.js'
import { loadUserRestrictions, findRecipesWithWhatIHave } from '../withWhatIHave.js'
import { compileRestrictions, nameHasTerm, normalizeText, violatesRestrictions, type RestrictableRecipe } from '../dietaryRestrictions.js'
import { addPantryForUser, deletePantryForUser, listPantryForUser, NoHouseholdError } from '../pantryStore.js'
import { enqueuePrepAlertsForMenu } from '../notificationScheduler.js'
import { NotARecipeError, SocialCaptionUnavailableError } from '../recipeUrlExtractor.js'
import { NoExtractableContentError } from '../sources/youtube.js'
import { PageFetchError, UnsafeUrlError } from '../net/publicFetch.js'
import type { SkillDefinition, SkillContext, SkillResult } from './types.js'
import { HEALTH_CONSENT_SKILL_REPLY, WHATSAPP_HEALTH_DATA_REPLY } from '../healthConsent.js'
import { saveOnboarding } from '../onboarding.js'
import { evaluateAndSaveMenuFit, menuFitSummary } from '../menuFit.js'
import { isHealthMemoryKey } from '@ona/shared'

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
function getWeekStart(offsetWeeks = 0): string {
  return madridWeekStart(new Date(), offsetWeeks)
}

/**
 * The household's menu for the week starting `weekStart`, or null. Menu
 * tools never edit "the latest menu": the web creates next week's (empty)
 * row just by opening that week, and from then on "el sábado" landed on
 * next week's Saturday (PRO-63, hogares de prueba 2026-10-12).
 */
async function menuOfWeek(ctx: SkillContext, weekStart: string) {
  const [menu] = await ctx.db
    .select()
    .from(menus)
    .where(and(scopeWhere(menus.userId, menus.householdId, await resolveScope(ctx.userId, ctx.db)), eq(menus.weekStart, weekStart)))
    .orderBy(desc(menus.createdAt))
    .limit(1)
  return menu ?? null
}

const noMenuFor = (weekStart: string): SkillResult => ({
  data: null,
  summary: `No hay menu para la semana del ${dateLabel(weekStart)}; no he cambiado nada. Puedes generarlo con generate_weekly_menu.`,
  uiHint: 'text',
})

const MEAL_LABEL: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }
const MEAL_KEYS = Object.keys(MEAL_LABEL)

/** Which day a menu tool call means: `day` words/date, or legacy dayIndex (+ nextWeek). */
function menuDayParam(params: { day?: unknown; dayIndex?: unknown; nextWeek?: unknown }): MenuDay | { error: string } {
  return resolveMenuDay({ day: params?.day, dayIndex: params?.dayIndex, nextWeek: params?.nextWeek })
}

/** What a confirmed menu change hands back: the real week, date, meal and dish. */
function changeOf(t: MenuDay, meal: string, dish?: string) {
  return { weekStart: t.weekStart, date: t.isoDate, dayIndex: t.dayIndex, meal, ...(dish ? { dish } : {}) }
}

/** The name (recipe or note) now in a slot of a saved menu row, or null. */
function dishNow(row: { days?: unknown } | undefined, dayIndex: number, meal: string): string | null {
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
async function visibleWhere(ctx: SkillContext) {
  return visibleRecipeWhere(await visibleAuthorIds(ctx.userId, ctx.db))
}

/**
 * The user's allergies / diet (profile + memory, see mergeRestrictions) and
 * dislikes. Anything Mimoia proposes on its own goes through these; an explicit
 * request can override a dislike, never an allergy (systemPrompt.ts).
 */
async function restrictionsFor(ctx: SkillContext): Promise<{ restrictions: string[]; dislikes: string[] }> {
  return loadUserRestrictions(ctx.userId, ctx.db)
}

/** Which of the user's allergies / diets (not dislikes) a recipe breaks. */
async function restrictionConflicts(ctx: SkillContext, recipeId: string): Promise<string[]> {
  const { restrictions } = await restrictionsFor(ctx)
  if (restrictions.length === 0) return []
  const [row] = await ctx.db
    .select({ allergens: recipes.allergens })
    .from(recipes)
    .where(eq(recipes.id, recipeId))
    .limit(1)
  const ings = await ctx.db
    .select({ ingredientName: ingredients.name, allergenTags: ingredients.allergenTags })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(eq(recipeIngredients.recipeId, recipeId))
  const recipe = { allergens: row?.allergens ?? [], ingredients: (ings ?? []) as RestrictableRecipe['ingredients'] }
  return restrictions.filter((r) => violatesRestrictions(recipe, compileRestrictions([r])))
}

// ─── Skill definitions ─────────────────────────────────────

const getTodaysMenu: SkillDefinition = {
  name: 'get_todays_menu',
  description: 'Obtiene el menu del dia indicado (o de hoy si no se especifica). Pasa day con las palabras del usuario ("mañana", "el sábado", "el martes de la semana que viene") o la fecha.',
  parameters: {
    type: 'object',
    properties: {
      day: DAY_PROP,
      dayIndex: { type: 'number', description: 'Solo si no usas day: 0=lunes … 6=domingo de esta semana (con nextWeek, de la que viene).' },
      nextWeek: { type: 'boolean', description: 'Con dayIndex: true si es de la semana que viene.' },
    },
    required: [],
  },
  async handler(params: { day?: string; dayIndex?: number; nextWeek?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    // No day at all = today (Madrid). The menu read is always the one of the
    // resolved week — never "the latest menu", which after Sunday is often
    // next week's (PRO-63).
    const noDay = params?.day == null && (params?.dayIndex === undefined || params?.dayIndex === null)
    const t = menuDayParam(noDay ? { day: 'hoy' } : params)
    if (isMenuDayError(t)) return { data: null, summary: t.error, uiHint: 'text' }

    const menu = await menuOfWeek(ctx, t.weekStart)
    if (!menu) {
      return { data: null, summary: `No hay menu para la semana del ${dateLabel(t.weekStart)}.`, uiHint: 'text' }
    }

    const days = menu.days as DayMenu[]
    if (t.dayIndex >= days.length) {
      return { data: null, summary: 'Indice de dia fuera de rango.', uiHint: 'text' }
    }

    const day = days[t.dayIndex]
    // Slots hold `dishes[]` since the multi-dish migration — reading the old
    // `slot.recipeName` made every day look empty ("no hay comidas").
    const meals = mealLinesForDay(day)

    const summary = meals.length > 0
      ? `Menu del ${t.label}: ${meals.join(', ')}`
      : `No hay comidas planificadas para el ${t.label}.`

    return { data: { dayIndex: t.dayIndex, date: t.isoDate, weekStart: t.weekStart, menuId: menu.id, day }, summary, uiHint: 'menu' }
  },
}

/**
 * The whole week's menu (2026-10-15). On WhatsApp, a turn that reads it sends
 * the week as ONE picture (inbound.ts), not the model's long day-by-day list
 * nor one day's recipe links; on the web the model writes it from `summary`.
 * A week with nothing planned answers in text (no menu data) so WhatsApp
 * keeps the model's words.
 */
const getWeeklyMenu: SkillDefinition = {
  name: 'get_weekly_menu',
  description: 'Obtiene el menu de la semana entera (esta o, con nextWeek, la que viene), dia a dia. Usalo cuando pida ver el menu de la semana; para un solo dia usa get_todays_menu. Una sola llamada, nunca get_todays_menu dia a dia.',
  parameters: {
    type: 'object',
    properties: {
      nextWeek: { type: 'boolean', description: 'true si pide la semana que viene.' },
    },
    required: [],
  },
  async handler(params: { nextWeek?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    const weekStart = getWeekStart(params?.nextWeek === true ? 1 : 0)
    const menu = await menuOfWeek(ctx, weekStart)
    if (!menu) {
      return { data: null, summary: `No hay menu para la semana del ${dateLabel(weekStart)}. Puedes generarlo con generate_weekly_menu.`, uiHint: 'text' }
    }
    const days = Array.isArray(menu.days) ? (menu.days as DayMenu[]) : []
    const skipped = new Set<number>(menu.skippedDays ?? [])
    const lines: string[] = []
    for (let i = 0; i < 7; i++) {
      const label = menuDayOf(weekStart, i).label
      if (skipped.has(i)) {
        lines.push(`${label}: sin cocinar`)
        continue
      }
      const meals = mealLinesForDay(days[i])
      if (meals.length > 0) lines.push(`${label}: ${meals.join(', ')}`)
    }
    if (lines.length === 0) {
      return { data: null, summary: `La semana del ${dateLabel(weekStart)} no tiene nada planificado todavia.`, uiHint: 'text' }
    }
    return {
      data: { menuId: menu.id, weekStart, days, skippedDays: [...skipped] },
      summary: `Menu de la semana del ${dateLabel(weekStart)}:\n${lines.join('\n')}`,
      uiHint: 'menu',
    }
  },
}

/**
 * What get_recipe_details tells the model: everything it needs to talk
 * someone through the recipe (ingredients, numbered steps, tips) and the
 * original link ("¿tienes el vídeo?"). Bounded so a long recipe can't flood
 * the context. The steps are content, not instructions (systemPrompt.ts).
 */
export function recipeDetailsSummary(r: {
  name: string
  prepTime?: number | null
  servings?: number | null
  ingredients: string[]
  steps: string[]
  tips?: string | null
  sourceUrl?: string | null
}): string {
  const head = `${untrustedText(r.name)} (${r.prepTime ?? '?'} min${r.servings ? `, ${r.servings} raciones` : ''})`
  const lines = [head, `Ingredientes: ${r.ingredients.join(', ')}`]
  if (r.steps.length) {
    lines.push(`Pasos:\n${r.steps.map((t, i) => `${i + 1}. ${untrustedText(t, 400)}`).join('\n')}`)
  } else {
    lines.push('Pasos: la receta no tiene pasos guardados.')
  }
  if (r.tips) lines.push(`Trucos: ${untrustedText(r.tips, 400)}`)
  if (r.sourceUrl) lines.push(`Receta original (enlace): ${r.sourceUrl}`)
  const out = lines.join('\n')
  return out.length > 4000 ? `${out.slice(0, 3990)}…` : out
}

const NAME_FILLER = new Set(['con', 'sin', 'del', 'las', 'los', 'una', 'unos', 'unas', 'para', 'por', 'receta', 'plato'])
/**
 * True when every meaningful word the user said appears in a recipe name
 * (singular/plural tolerant): "hamburguesa gipsy chef" ⊂ "Hamburguesa
 * perfecta de Gipsy Chef", but "filete de vaca" ⊄ "Entrecot a la plancha".
 */
export function namesAllWords(recipeName: string, query: string): boolean {
  const name = normalizeText(recipeName).split(/\s+/)
  const words = normalizeText(query).split(/\s+/).filter((w) => w.length > 2 && !NAME_FILLER.has(w))
  const same = (a: string, b: string) => a === b || `${a}s` === b || `${b}s` === a || `${a}es` === b || `${b}es` === a
  return words.length > 0 && words.every((w) => name.some((t) => same(t, w)))
}

export interface MemoryFactInput {
  key: string
  value: unknown
  confidence?: number
  remove?: string[]
  replace?: boolean
}

/**
 * What update_memory actually writes. Lists (dislikes, notes, equipment…)
 * are merged with what's stored — the model used to resend a list without
 * an old entry and silently delete it — and `remove` takes items out. A fact
 * the user set by hand (source manual) isn't overwritten by an inference
 * unless the user asked for it (confidence 1).
 */
export function mergeMemoryFacts(
  current: Record<string, { value: unknown; source?: string } | undefined>,
  facts: MemoryFactInput[],
): { facts: Array<{ key: string; value: unknown; confidence: number }>; keptManual: string[] } {
  const out: Array<{ key: string; value: unknown; confidence: number }> = []
  const keptManual: string[] = []
  const norm = (x: unknown) => String(x).trim().toLowerCase()
  for (const f of facts) {
    const confidence = typeof f.confidence === 'number' ? f.confidence : 0.8
    const existing = current[f.key]
    if (existing?.source === 'manual' && confidence < 1) {
      keptManual.push(f.key)
      continue
    }
    let value = f.value
    if (Array.isArray(existing?.value) && (Array.isArray(value) || (f.remove?.length ?? 0) > 0)) {
      const base = f.replace ? [] : (existing!.value as unknown[])
      const incoming = Array.isArray(value) ? value : []
      const removed = new Set((f.remove ?? []).map(norm))
      const seen = new Set<string>()
      value = [...base, ...incoming].filter((item) => {
        const k = norm(item)
        if (removed.has(k) || seen.has(k)) return false
        seen.add(k)
        return true
      })
    } else if (Array.isArray(value) && f.remove?.length) {
      const removed = new Set(f.remove.map(norm))
      value = value.filter((item) => !removed.has(norm(item)))
    }
    out.push({ key: f.key, value, confidence })
  }
  return { facts: out, keptManual }
}

const getRecipeDetails: SkillDefinition = {
  name: 'get_recipe_details',
  description: 'Busca una receta (del catalogo o del usuario) por nombre y devuelve sus detalles: ingredientes con cantidades, pasos numerados, raciones, trucos y el enlace a la receta original (video o web) si lo tiene. Usala para explicar como se hace, guiar paso a paso o dar el enlace.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta a buscar' },
    },
    required: ['recipeName'],
  },
  async handler(params: { recipeName: string }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx

    // First try exact match
    let results = await db
      .select()
      .from(recipes)
      .where(and(await visibleWhere(ctx), ilike(recipes.name, `%${params.recipeName}%`)))
      .limit(1)

    // If no exact match, try word-by-word
    if (results.length === 0) {
      const words = params.recipeName.split(/\s+/).filter(w => w.length >= 3)
      if (words.length > 0) {
        results = await db
          .select()
          .from(recipes)
          .where(and(await visibleWhere(ctx), or(...words.map((w: string) => ilike(recipes.name, `%${w}%`)))))
          .limit(5)
      }
    }

    if (results.length === 0) {
      return { data: null, summary: `No he encontrado ninguna receta con el nombre "${params.recipeName}".`, uiHint: 'text' }
    }

    // Pick the best match: prefer name that contains the most query words
    const queryWords = params.recipeName.toLowerCase().split(/\s+/).filter(w => w.length >= 3)
    const recipe = results.reduce((best: any, r: any) => {
      const nameWords = r.name.toLowerCase()
      const score = queryWords.filter(w => nameWords.includes(w)).length
      const bestScore = queryWords.filter(w => best.name.toLowerCase().includes(w)).length
      return score > bestScore ? r : best
    }, results[0])

    // Get ingredients
    const riRows = await db
      .select({
        ingredientName: ingredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, recipe.id))

    // The steps live in recipe_steps. Until 2026-10-12 this read a
    // `recipe.steps` column that doesn't exist, so Mimo never saw a single
    // step and couldn't help anyone cook (diagnosis 2026-10-11).
    const stepRows = await db
      .select({ index: recipeSteps.index, text: recipeSteps.text, durationMin: recipeSteps.durationMin })
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, recipe.id))
      .orderBy(recipeSteps.index)
    const steps: string[] = (stepRows ?? []).map((s: any) => String(s.text ?? '').trim()).filter(Boolean)

    const ingredientList = riRows.map((r: any) => `${r.ingredientName}: ${r.quantity}${r.unit ?? 'g'}`)
    const summary = recipeDetailsSummary({
      name: recipe.name,
      prepTime: recipe.prepTime,
      servings: recipe.servings,
      ingredients: ingredientList,
      steps,
      tips: recipe.tips,
      sourceUrl: recipe.sourceUrl,
    })

    return {
      data: {
        id: recipe.id,
        name: recipe.name,
        prepTime: recipe.prepTime,
        meals: recipe.meals,
        seasons: recipe.seasons,
        steps,
        sourceUrl: recipe.sourceUrl ?? null,
        ingredients: riRows,
      },
      summary,
      uiHint: 'recipe',
    }
  },
}

const getWeeklyNutrition: SkillDefinition = {
  name: 'get_weekly_nutrition',
  description: 'Obtiene el resumen nutricional de las ultimas semanas: calorias, macros y tendencia.',
  parameters: {
    type: 'object',
    properties: {
      weeks: { type: 'number', description: 'Numero de semanas a analizar (por defecto 4)' },
    },
    required: [],
  },
  async handler(params: { weeks?: number }, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx
    const weeks = params.weeks ?? 4

    const summaryResult = await getSummary(userId, weeks, db)

    // Also get current balance
    const [balance] = await db
      .select()
      .from(userNutrientBalance)
      .where(eq(userNutrientBalance.userId, userId))
      .limit(1)

    let balanceSummary = ''
    if (balance?.balance) {
      const pct = nutrientsToPercentages(balance.balance as NutrientBalance)
      balanceSummary = ` Balance actual: proteina ${pct.protein.toFixed(1)}%, carbohidratos ${pct.carbohydrates.toFixed(1)}%, grasa ${pct.fat.toFixed(1)}% (objetivo: ${TARGET_MACROS.protein}/${TARGET_MACROS.carbohydrates}/${TARGET_MACROS.fat}).`
    }

    const summary = summaryResult.weeks.length > 0
      ? `Ultimas ${summaryResult.weeks.length} semanas: media de ${Math.round(summaryResult.averageCalories)} kcal/semana, tendencia ${summaryResult.trend}.${balanceSummary}`
      : 'No hay datos nutricionales todavia. Genera un menu semanal para empezar a acumular datos.'

    return { data: { ...summaryResult, currentBalance: balance?.balance }, summary, uiHint: 'nutrition' }
  },
}

// get_shopping_list lives in appSkills.ts: it reads the same rolling list
// /shopping shows (manual items, checked / in-stock state included).

const suggestRecipes: SkillDefinition = {
  name: 'suggest_recipes',
  description: 'Sugiere recetas filtradas por temporada y/o tipo de comida. Devuelve hasta 5 recetas.',
  parameters: {
    type: 'object',
    properties: {
      criteria: { type: 'string', description: 'Criterio de busqueda libre (ej: "rapida", "legumbres")' },
      mealType: { type: 'string', description: 'Tipo de comida: breakfast, lunch, dinner' },
    },
    required: [],
  },
  async handler(params: { criteria?: string; mealType?: string }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx
    const season = detectSeason()

    // Never suggest something the user can't or won't eat.
    const { restrictions, dislikes } = await restrictionsFor(ctx)
    const rules = compileRestrictions(restrictions, dislikes)
    let allRecipes: any[] = (await loadMatchableRecipes(ctx.userId, db)).filter(
      (r) => !violatesRestrictions(r, rules),
    )

    // Filter by season
    allRecipes = allRecipes.filter((r: any) => {
      if (!r.seasons || r.seasons.length === 0) return true
      return r.seasons.includes(season)
    })

    // Filter by meal type
    if (params.mealType) {
      allRecipes = allRecipes.filter((r: any) => r.meals?.includes(params.mealType))
    }

    // Filter by criteria (search in name and tags)
    if (params.criteria) {
      const q = params.criteria.toLowerCase()
      allRecipes = allRecipes.filter((r: any) =>
        r.name.toLowerCase().includes(q) ||
        r.tags?.some((t: string) => t.toLowerCase().includes(q))
      )
    }

    const top5 = allRecipes.slice(0, 5)
    const summary = top5.length > 0
      ? `Sugerencias: ${top5.map((r: any) => `${r.name} (${r.prepTime ?? '?'}min)`).join(', ')}`
      : 'No he encontrado recetas con esos criterios.'

    return { data: top5, summary, uiHint: 'recipe' }
  },
}

// «Con lo que tengo» (PRO-31): same search as the /recipes filter.
const cookWithWhatIHave: SkillDefinition = {
  name: 'cook_with_what_i_have',
  description: 'Cuando el usuario dice que tiene ciertos ingredientes y pregunta que puede cocinar (ej. "tengo calabacin y huevos, que hago?", "que hago con un pollo y unos pimientos"), busca recetas suyas y del catalogo que usen esos ingredientes (hasta 3), ordenadas por cuantos usan, y dice que faltaria sin contar los basicos (sal, aceite, agua, pimienta, harina). Nunca devuelve recetas que choquen con sus alergias, dieta o lo que no le gusta.',
  parameters: {
    type: 'object',
    properties: {
      ingredients: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ingredientes que tiene, de 1 a 3, en singular y sin cantidades (ej: ["calabacin", "huevo"])',
      },
    },
    required: ['ingredients'],
  },
  async handler(params: { ingredients?: string[] | string }, ctx: SkillContext): Promise<SkillResult> {
    const raw = Array.isArray(params.ingredients) ? params.ingredients : String(params.ingredients ?? '').split(/,| y /)
    const names = raw.map((n) => String(n).trim()).filter(Boolean)
    if (names.length === 0) {
      return { data: [], summary: 'Dime que ingredientes tienes (hasta 3) y busco que puedes cocinar.', uiHint: 'text' }
    }
    const chosen = names.slice(0, 3).map((name) => ({ name }))
    const hits = await findRecipesWithWhatIHave(ctx.userId, chosen, ctx.db, 5)
    const ignored = names.length > 3 ? ` (solo miro los 3 primeros: ${names.slice(0, 3).join(', ')})` : ''
    if (hits.length === 0) {
      return { data: [], summary: `No he encontrado recetas con ${names.slice(0, 3).join(' y ')} que encajen contigo${ignored}.`, uiHint: 'text' }
    }
    const data = hits.map((h) => ({ id: h.recipe.id, name: h.recipe.name, uses: h.uses, missing: h.missing }))
    const lines = data.map((h) => {
      const falta = h.missing.length === 0 ? 'no te falta nada mas' : `te faltaria ${h.missing.join(', ')}`
      return `${h.name} (usa ${h.uses.join(' y ')}; ${falta})`
    })
    return { data, summary: `Con lo que tienes${ignored}: ${lines.join('; ')}.`, uiHint: 'recipe' }
  },
}

const searchRecipes: SkillDefinition = {
  name: 'search_recipes',
  description: 'Busca recetas por nombre.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Texto a buscar en el nombre de la receta' },
    },
    required: ['query'],
  },
  async handler(params: { query: string }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx

    const results = await db
      .select({
        id: recipes.id,
        name: recipes.name,
        meals: recipes.meals,
        seasons: recipes.seasons,
        prepTime: recipes.prepTime,
      })
      .from(recipes)
      .where(and(
        await visibleWhere(ctx),
        or(
          ilike(recipes.name, `%${params.query}%`),
          ...params.query.split(/\s+/).filter(w => w.length >= 3).map(word => ilike(recipes.name, `%${word}%`)),
        ),
      ))
      .limit(10)

    const summary = results.length > 0
      ? `Encontradas ${results.length} receta(s): ${results.map((r: any) => r.name).join(', ')}`
      : `No he encontrado recetas con "${params.query}".`

    return { data: results, summary, uiHint: 'recipe' }
  },
}

/** True when any slot of the week has a dish or a note. */
export function weekHasDishes(days: DayMenu[] | undefined): boolean {
  return (days ?? []).some((d) =>
    Object.values(d ?? {}).some((slot: any) => Array.isArray(slot?.dishes) && slot.dishes.length > 0),
  )
}

const generateWeeklyMenu: SkillDefinition = {
  name: 'generate_weekly_menu',
  description: 'Genera un menu semanal completo (todos los dias) y lo guarda. Solo cuando el usuario pida un menu nuevo para la semana entera; NUNCA para cambiar o poner uno o varios platos (eso es swap_meal / add_dish / set_meal_note). Con nextWeek=true lo genera para la semana que viene (por ejemplo si el usuario dice "la semana que viene" o acepta la propuesta del domingo). Si esa semana ya tiene platos no la toca y te lo dice: solo con replaceExisting=true, cuando el usuario ha confirmado que quiere rehacer la semana entera.',
  parameters: {
    type: 'object',
    properties: {
      nextWeek: { type: 'boolean', description: 'true para generar el menu de la semana que viene en lugar de la actual.' },
      replaceExisting: { type: 'boolean', description: 'true solo si el usuario ha confirmado que quiere rehacer entera una semana que ya tiene platos.' },
    },
    required: [],
  },
  async handler(params: { nextWeek?: boolean; replaceExisting?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx
    const weekStart = getWeekStart(params?.nextWeek === true ? 1 : 0)

    // Same promises as POST /menu/generate: locked slots, vetoes and
    // "sin cocinar" days of the current week survive the regeneration.
    const previous = await loadPreviousWeek(userId, weekStart, db)

    // A week that already has dishes is never remade without an explicit,
    // confirmed request: asking for one dish used to regenerate the whole
    // week and Laura lost her planned leftovers (PRO-63, 2026-10-11).
    if (params?.replaceExisting !== true && weekHasDishes(previous.days)) {
      return {
        data: { weekStart, replaced: false },
        summary: `No he cambiado nada: la semana del ${dateLabel(weekStart)} ya tiene menu. Para cambiar o poner platos concretos usa swap_meal, add_dish o set_meal_note. Solo si el usuario quiere rehacer la semana entera, confirmalo con el y vuelve a llamar con replaceExisting: true.`,
        uiHint: 'text',
      }
    }
    const { days } = await generateMenu(
      userId, weekStart, undefined, db,
      previous.locked, previous.days, previous.bannedRecipeIds, previous.skippedDays,
    )

    // Save to menus table — dual-write household_id so shared-scope reads
    // pick it up. Null is acceptable if the user somehow lacks a primary
    // household; the read path falls back to user-scope.
    const householdId = await getPrimaryHouseholdId(userId, db)
    const [menu] = await db
      .insert(menus)
      .values({
        userId, householdId, weekStart, days,
        locked: previous.locked,
        bannedRecipeIds: [...previous.bannedRecipeIds],
        skippedDays: [...previous.skippedDays],
      })
      .returning()

    // Calculate calories and nutrients for the log
    const caloriesTotal = await calculateMenuCaloriesFromDB(days, db)
    const aggregatedNutrients = await calculateMenuNutrientsFromDB(days, db)

    await db.insert(menuLogs).values({
      userId,
      menuId: menu.id,
      weekStart,
      aggregatedNutrients,
      caloriesTotal,
    })

    await updateBalance(userId, aggregatedNutrients, db)

    // Same prep-alert enqueue as POST /menu/generate (opt-in by prep_habits).
    enqueuePrepAlertsForMenu(menu.id).catch((err) => {
      console.warn('[assistant.generate_weekly_menu] enqueuePrepAlertsForMenu failed:', err)
    })

    // Build summary
    const dayNames = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
    const menuSummary = days.map((day: DayMenu, i: number) => {
      const meals = Object.entries(day)
        .filter(([, slot]: any) => slot?.dishes?.some((d: any) => d.recipeName))
        .map(([meal, slot]: any) => {
          const firstName = slot.dishes.find((d: any) => d.kind === 'recipe')?.recipeName ?? ''
          return `${meal}: ${firstName}`
        })
      return `${dayNames[i]}: ${meals.join(', ')}`
    }).join('; ')

    // «Cuánto ha acertado» (PRO-155): Mimo tells it following the prompt's guide.
    const fit = await evaluateAndSaveMenuFit({ userId, menuId: menu.id, days }, db)
    const fitLine = menuFitSummary(fit)

    return {
      data: { ...menu, fit },
      summary: `Menu generado para la semana del ${weekStart}. ${menuSummary}${fitLine ? `\n${fitLine}` : ''}`,
      uiHint: 'menu',
    }
  },
}

const COOKING_FREQS = ['daily', '3_4_times', 'rarely'] as const
const PRIORITIES = ['quick', 'varied', 'healthy', 'cheap'] as const

/**
 * WhatsApp-first sign-up (2026-10-10): Mimo asks the first-steps questions in
 * the chat and, with the answers, saves them (same as the web onboarding,
 * without health data) and builds the first week's menu in one go.
 */
const completeOnboarding: SkillDefinition = {
  name: 'complete_onboarding',
  description:
    'Solo durante los primeros pasos de un hogar nuevo por WhatsApp: guarda cuantos son en casa, cuanto cocinan, sus platos favoritos y su prioridad, marca los primeros pasos como hechos y genera su primer menu de esta semana (no hace falta llamar ademas a generate_weekly_menu). Llamalo una sola vez, cuando tengas adultos, niños, frecuencia y al menos un plato.',
  parameters: {
    type: 'object',
    properties: {
      adults: { type: 'integer', minimum: 1, maximum: 20, description: 'Adultos en casa (a partir de 11 años).' },
      kidsCount: { type: 'integer', minimum: 0, maximum: 20, description: 'Niños de 2 a 10 años; los menores de 2 no cuentan. 0 si no hay.' },
      cookingFreq: {
        type: 'string',
        enum: [...COOKING_FREQS],
        description: 'daily = cocinan casi a diario; 3_4_times = unos 3-4 dias por semana; rarely = poco.',
      },
      favoriteDishes: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 30,
        description: 'Platos que les gustan, tal como los dice el usuario: todos los que diga, no hay tope de cinco.',
      },
      priority: {
        type: 'string',
        enum: [...PRIORITIES],
        description: 'Lo que mas le importa (quick = rapido, varied = variado, healthy = sano, cheap = barato). Si no lo ha dicho, varied.',
      },
    },
    required: ['adults', 'kidsCount', 'cookingFreq', 'favoriteDishes'],
  },
  async handler(
    params: { adults?: number; kidsCount?: number; cookingFreq?: string; favoriteDishes?: string[]; priority?: string },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx
    const [current] = await db.select({ onboardingDone: users.onboardingDone }).from(users).where(eq(users.id, userId)).limit(1)
    if (current?.onboardingDone) {
      return { data: null, summary: 'Los primeros pasos ya estaban hechos; no he cambiado nada. Si quiere un menu nuevo, usa generate_weekly_menu.' }
    }
    const adults = Number.isInteger(params?.adults) ? Number(params.adults) : NaN
    const kidsCount = Number.isInteger(params?.kidsCount) ? Number(params.kidsCount) : 0
    const cookingFreq = (COOKING_FREQS as readonly string[]).includes(String(params?.cookingFreq)) ? (params.cookingFreq as (typeof COOKING_FREQS)[number]) : null
    const priority = (PRIORITIES as readonly string[]).includes(String(params?.priority)) ? (params.priority as (typeof PRIORITIES)[number]) : 'varied'
    const favoriteDishes = (Array.isArray(params?.favoriteDishes) ? params.favoriteDishes : [])
      .map((d) => String(d).trim())
      .filter(Boolean)
      .slice(0, 30)
    const missing = [
      !(adults >= 1 && adults <= 20) && 'cuantos adultos son',
      !(kidsCount >= 0 && kidsCount <= 20) && 'cuantos niños',
      !cookingFreq && 'cuanto cocinan',
      favoriteDishes.length === 0 && 'algun plato que les guste',
    ].filter(Boolean)
    if (missing.length > 0) {
      return { data: null, summary: `No he guardado nada: falta ${missing.join(', ')}. Preguntaselo.` }
    }
    // No restrictions or consent here: health data never goes through WhatsApp.
    await saveOnboarding(userId, { adults, kidsCount, cookingFreq: cookingFreq!, favoriteDishes, priority }, db)
    const menu = await generateWeeklyMenu.handler({}, ctx)
    return {
      ...menu,
      summary: `Primeros pasos guardados (${adults} adultos, ${kidsCount} niños). ${menu.summary}`,
    }
  },
}

/** The save didn't come back with the dish in place: never report it as done. */
const notSaved = (slotLabel: string): SkillResult => ({
  data: null,
  summary: `No he podido guardar el cambio en la ${slotLabel}; no esta hecho. Diselo al usuario.`,
  uiHint: 'text',
})

const swapMeal: SkillDefinition = {
  name: 'swap_meal',
  description:
    'Cambia un plato concreto del menu (nunca rehace la semana). Pasa day con las palabras del usuario ("el sábado", "la cena de hoy" → day "hoy", "el jueves de la semana que viene") o la fecha; la herramienta calcula la fecha en hora de Madrid y te devuelve el dia, la fecha y el plato que han quedado. meal: breakfast, lunch, snack o dinner. Si el usuario nombra una receta concreta, pásala en `recipeName` (o `recipeId` si lo conoces) y la receta se asigna directamente sin elegir aleatorio. Si ese plato no está en sus recetas ni en el catálogo y mandas newRecipe (una versión sencilla estimada), lo creo como receta del hogar y la pongo, para que sus ingredientes lleguen a la lista de la compra; sin newRecipe, se pone como nota con su nombre (y te digo lo más parecido que hay). Llámala igualmente, no hace falta crear la receta antes. Si no se nombra, el sistema escoge automáticamente un plato compatible con la temporada y restricciones.',
  parameters: {
    type: 'object',
    properties: {
      day: DAY_PROP,
      dayIndex: { type: 'number', description: 'Solo si no usas day: 0=lunes … 6=domingo de esta semana (con nextWeek, de la que viene)' },
      nextWeek: { type: 'boolean', description: 'Con dayIndex: true si es de la semana que viene' },
      meal: { type: 'string', description: 'Tipo de comida: breakfast, lunch, snack o dinner' },
      recipeId: {
        type: 'string',
        description: 'UUID de la receta concreta a colocar en ese hueco. Opcional.',
      },
      recipeName: {
        type: 'string',
        description: 'Nombre (o parte) de la receta concreta. Se buscará por substring case-insensitive. Opcional. Si hay varias coincidencias se prioriza la del usuario sobre las del catálogo de Mimoia.',
      },
      confirmRestriction: {
        type: 'boolean',
        description: 'Solo true si el usuario ya ha confirmado que quiere ese plato aunque choque con su alergia/dieta (la herramienta te lo habrá avisado).',
      },
      newRecipe: NEW_RECIPE_PROP,
    },
    required: ['meal'],
  },
  async handler(
    params: { day?: string; dayIndex?: number; nextWeek?: boolean; meal: string; recipeId?: string; recipeName?: string; confirmRestriction?: boolean; newRecipe?: NewRecipeParam },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx
    const { meal } = params
    const t = menuDayParam(params)
    if (isMenuDayError(t)) return { data: null, summary: t.error, uiHint: 'text' }
    if (!MEAL_KEYS.includes(meal)) {
      return { data: null, summary: 'meal debe ser breakfast, lunch, snack o dinner. No he cambiado nada.', uiHint: 'text' }
    }
    const dayIndex = t.dayIndex
    // "Comida del sábado 17 de octubre": what the user sees and Mimo repeats.
    const slotLabel = `${MEAL_LABEL[meal]} del ${t.label}`

    // The menu of the week the day falls in — never "the latest menu".
    const menu = await menuOfWeek(ctx, t.weekStart)
    if (!menu) return noMenuFor(t.weekStart)

    const days = menu.days as DayMenu[]

    if (dayIndex >= days.length) {
      return { data: null, summary: 'Indice de dia fuera de rango.', uiHint: 'text' }
    }

    // Manual override path: if the user (or the model) named a specific
    // recipe, look it up and place it directly. Prefer recipes the user
    // owns when matching by name so "mi tortilla" wins over a system one
    // with the same word.
    if (params.recipeId || params.recipeName) {
      let chosen: { id: string; name: string } | null = null
      let approximate = false
      if (params.recipeId) {
        const [row] = await db
          .select({ id: recipes.id, name: recipes.name })
          .from(recipes)
          .where(and(await visibleWhere(ctx), eq(recipes.id, params.recipeId)))
          .limit(1)
        chosen = row ?? null
      } else if (params.recipeName) {
        // Only the Mimoia catalogue + the user's own recipes — never another
        // user's private ones.
        const visible = await visibleWhere(ctx)
        const candidates = await db
          .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
          .from(recipes)
          .where(and(visible, ilike(recipes.name, `%${params.recipeName}%`)))
          .limit(20)
        const owned = candidates.find((c: { authorId: string | null }) => c.authorId === userId)
        chosen = owned ?? candidates[0] ?? null
        if (!chosen) {
          // "filete de vaca" → closest real recipe ("Entrecot a la plancha"),
          // which is only offered: the slot gets the user's dish as a note.
          const words = searchWords(params.recipeName)
          if (words.length > 0) {
            const loose = await db
              .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
              .from(recipes)
              .where(and(visible, or(...words.map((w) => ilike(recipes.name, `%${w}%`)))))
              .limit(50)
            // "hamburguesa Gipsy Chef" names "Hamburguesa perfecta de Gipsy
            // Chef": every word the user said is in it, so that IS the recipe
            // (2026-10-08 it went in as a note and Mimo asked "¿te la cambio?").
            const named = loose.filter((c: { name: string }) => namesAllWords(c.name, params.recipeName!))
            const exactish = named.find((c: { authorId: string | null }) => c.authorId === userId) ?? named[0] ?? null
            const best = exactish ?? bestMatch(loose, params.recipeName, (c: { name: string }) => c.name) ?? loose[0] ?? null
            if (best) {
              chosen = best
              approximate = !exactish
            }
          }
        }
      }
      // A dish that isn't in the user's recipes nor the catalogue goes in as a
      // note with their own words — the menu never blocks on a missing recipe
      // (2026-10-08: "ponme X el jueves" got "no existe, ¿la creo?"). The
      // closest real recipe, if any, is only offered, never swapped in.
      if (params.recipeName && (!chosen || approximate)) {
        // PRO-74: with a `newRecipe`, the dish becomes a household recipe so
        // its ingredients reach the shopping list; the note is the fallback.
        const created = await createDishRecipe(userId, params.recipeName, params.newRecipe)
        if (created) {
          days[dayIndex][meal] = slotWithDishes(days[dayIndex][meal], [{ kind: 'recipe', recipeId: created.id, recipeName: created.name }])
          const [updatedNew] = await db.update(menus).set({ days }).where(eq(menus.id, menu.id)).returning()
          if (dishNow(updatedNew, dayIndex, meal) !== created.name) return notSaved(slotLabel)
          return {
            data: { ...updatedNew, change: changeOf(t, meal, created.name), recipeId: created.id },
            summary: `Hecho. "${untrustedText(created.name, 80)}" no estaba en sus recetas ni en el catalogo: la he creado como receta del hogar (raciones e ingredientes estimados; se puede revisar en la app) y la he puesto en la ${slotLabel}. Sus ingredientes ya salen en la lista de la compra.`,
            uiHint: 'menu',
          }
        }
        const note = dishNoteText(params.recipeName)
        days[dayIndex][meal] = slotWithDishes(days[dayIndex][meal], [{ kind: 'note', text: note }])
        const [updatedNote] = await db
          .update(menus)
          .set({ days })
          .where(eq(menus.id, menu.id))
          .returning()
        const closest = chosen ? ` Lo mas parecido que si hay es "${chosen.name}".` : ''
        if (dishNow(updatedNote, dayIndex, meal) !== note) return notSaved(slotLabel)
        return {
          data: { ...updatedNote, change: changeOf(t, meal, note) },
          summary: `Hecho. "${untrustedText(note, 80)}" no esta en sus recetas ni en el catalogo, asi que lo he puesto como nota en la ${slotLabel}.${closest} ${NOTE_THEN_RECIPE_HINT}${chosen ? ` Si prefiere "${chosen.name}", ofrecele cambiar la nota por esa receta.` : ''}`,
          uiHint: 'menu',
        }
      }
      if (!chosen) {
        return {
          data: null,
          summary: `No he encontrado la receta "${params.recipeId}"; no he cambiado nada.`,
          uiHint: 'text',
        }
      }
      // Allergies / diet are never skipped silently: an explicit request can
      // beat a dislike, not an allergy without the user's confirmation.
      const conflicts = await restrictionConflicts(ctx, chosen.id)
      if (conflicts.length > 0 && !params.confirmRestriction) {
        return {
          data: { recipeId: chosen.id, recipeName: chosen.name, conflicts },
          summary: `No he cambiado nada: "${chosen.name}" no es compatible con sus restricciones (${conflicts.join(', ')}). Avisale y pregunta si aun asi lo quiere; si lo confirma, vuelve a llamar a swap_meal con confirmRestriction: true.`,
          uiHint: 'text',
        }
      }
      days[dayIndex][meal] = slotWithDishes(days[dayIndex][meal], [{ kind: 'recipe', recipeId: chosen.id, recipeName: chosen.name }])
      const [updatedManual] = await db
        .update(menus)
        .set({ days })
        .where(eq(menus.id, menu.id))
        .returning()
      if (dishNow(updatedManual, dayIndex, meal) !== chosen.name) return notSaved(slotLabel)
      return {
        data: { ...updatedManual, change: changeOf(t, meal, chosen.name) },
        summary: `Hecho. He puesto "${chosen.name}" en la ${slotLabel}.`,
        uiHint: 'menu',
      }
    }

    // Collect used recipe IDs (excluding the one being replaced)
    const usedRecipeIds = new Set<string>()
    for (let d = 0; d < days.length; d++) {
      for (const m of Object.keys(days[d])) {
        if (d === dayIndex && m === meal) continue
        const slot = days[d][m]
        if (!slot) continue
        for (const dish of recipeDishesOf(slot.dishes)) {
          usedRecipeIds.add(dish.recipeId)
        }
      }
    }

    // Allergies / diet (profile + memory) and dislikes — same filter as the generator.
    const { restrictions, dislikes } = await restrictionsFor(ctx)

    // Fetch favorites
    const favRows = await db
      .select({ recipeId: userFavorites.recipeId })
      .from(userFavorites)
      .where(scopeWhere(userFavorites.userId, userFavorites.householdId, await resolveScope(userId, db)))

    const favoriteRecipeIds = new Set<string>(favRows.map((f: any) => f.recipeId))

    // Load recipes with ingredients for matching
    const allRecipes = await loadMatchableRecipes(userId, db)
    const season = detectSeason()

    const newRecipe = findRecipeForSlot(allRecipes, {
      meal: meal as Meal,
      season,
      usedRecipeIds,
      restrictions,
      dislikes,
      favoriteRecipeIds,
    })

    if (!newRecipe) {
      return { data: null, summary: 'No he encontrado una receta alternativa para ese hueco.', uiHint: 'text' }
    }

    // Update the menu (the slot keeps its «Solo hoy», PRO-102)
    days[dayIndex][meal] = slotWithDishes(days[dayIndex][meal], [{ kind: 'recipe', recipeId: newRecipe.id, recipeName: newRecipe.name }])

    const [updated] = await db
      .update(menus)
      .set({ days })
      .where(eq(menus.id, menu.id))
      .returning()

    if (dishNow(updated, dayIndex, meal) !== newRecipe.name) return notSaved(slotLabel)
    return {
      data: { ...updated, change: changeOf(t, meal, newRecipe.name) },
      summary: `Cambiado: la ${slotLabel} ahora es "${newRecipe.name}".`,
      uiHint: 'menu',
    }
  },
}

const toggleFavorite: SkillDefinition = {
  name: 'toggle_favorite',
  description: 'Anade o quita una receta de favoritos del usuario.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta' },
    },
    required: ['recipeName'],
  },
  async handler(params: { recipeName: string }, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx

    // Find recipe by name
    const [recipe] = await db
      .select({ id: recipes.id, name: recipes.name })
      .from(recipes)
      .where(and(await visibleWhere(ctx), or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map((w: string) => ilike(recipes.name, `%${w}%`)),
      )))
      .limit(1)

    if (!recipe) {
      return { data: null, summary: `No he encontrado la receta "${params.recipeName}".`, uiHint: 'text' }
    }

    // Check if already favorited
    const existing = await db
      .select()
      .from(userFavorites)
      .where(
        scopeWhere(userFavorites.userId, userFavorites.householdId, await resolveScope(userId, db)),
      )

    const alreadyFav = existing.find((f: any) => f.recipeId === recipe.id)

    if (alreadyFav) {
      await db
        .delete(userFavorites)
        .where(eq(userFavorites.id, alreadyFav.id))

      return { data: { recipeId: recipe.id, favorited: false }, summary: `${recipe.name} eliminada de favoritos.`, uiHint: 'confirmation' }
    } else {
      const householdId = await getPrimaryHouseholdId(userId, db)
      await db
        .insert(userFavorites)
        .values({ userId, householdId, recipeId: recipe.id })

      return { data: { recipeId: recipe.id, favorited: true }, summary: `${recipe.name} anadida a favoritos.`, uiHint: 'confirmation' }
    }
  },
}

const markMealEaten: SkillDefinition = {
  name: 'mark_meal_eaten',
  description: 'Marca una comida como comida o no comida en el menu actual.',
  parameters: {
    type: 'object',
    properties: {
      day: DAY_PROP,
      dayIndex: { type: 'number', description: 'Solo si no usas day: 0=lunes … 6=domingo de esta semana' },
      meal: { type: 'string', description: 'Tipo de comida: breakfast, lunch, snack o dinner' },
      eaten: { type: 'boolean', description: 'true si se ha comido, false si no' },
    },
    required: ['meal', 'eaten'],
  },
  async handler(params: { day?: string; dayIndex?: number; meal: string; eaten: boolean }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx
    const { meal, eaten } = params
    const t = menuDayParam({ day: params.day, dayIndex: params.dayIndex })
    if (isMenuDayError(t)) return { data: null, summary: t.error, uiHint: 'text' }
    const dayIndex = t.dayIndex

    const menu = await menuOfWeek(ctx, t.weekStart)
    if (!menu) return noMenuFor(t.weekStart)

    const days = menu.days as any[]

    if (dayIndex >= days.length) {
      return { data: null, summary: 'Indice de dia fuera de rango.', uiHint: 'text' }
    }

    if (!days[dayIndex][meal]) {
      return { data: null, summary: 'No hay comida planificada en ese hueco.', uiHint: 'text' }
    }

    days[dayIndex][meal].eaten = eaten
    if (eaten) {
      days[dayIndex][meal].eatenAt = new Date().toISOString()
    } else {
      delete days[dayIndex][meal].eatenAt
    }

    const [updated] = await db
      .update(menus)
      .set({ days })
      .where(eq(menus.id, menu.id))
      .returning()

    const label = eaten ? 'comida' : 'no comida'
    const recipeName = dishNow(updated ?? menu, dayIndex, meal) ?? MEAL_LABEL[meal] ?? meal
    return {
      data: { ...updated, change: changeOf(t, meal, recipeName) },
      summary: `Hecho: "${recipeName}" (${MEAL_LABEL[meal] ?? meal} del ${t.label}) marcada como ${label}.`,
      uiHint: 'confirmation',
    }
  },
}

const createRecipe: SkillDefinition = {
  name: 'create_recipe',
  description:
    'Crea y guarda una receta nueva del usuario. Si el usuario pide una receta basica sin dar detalles ("crea tu un filete a la parrilla"), inventa tu una version sencilla y razonable (ingredientes con cantidades y pasos) y creala sin hacer mas preguntas.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nombre de la receta' },
      servings: { type: 'number', description: 'Raciones (por defecto 2)' },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Nombre del ingrediente' },
            quantity: { type: 'number', description: 'Cantidad' },
            unit: { type: 'string', description: 'Unidad: g, ml, u, cda, cdita' },
          },
          required: ['name'],
        },
        description: 'Lista de ingredientes con cantidades',
      },
      steps: { type: 'array', items: { type: 'string' }, description: 'Pasos de preparacion' },
      prepTime: { type: 'number', description: 'Tiempo de preparacion en minutos' },
      cookTime: { type: 'number', description: 'Tiempo de coccion en minutos' },
      meals: { type: 'array', items: { type: 'string' }, description: 'breakfast, lunch, dinner, snack' },
      seasons: { type: 'array', items: { type: 'string' }, description: 'spring, summer, autumn, winter' },
    },
    required: ['name', 'ingredients', 'steps'],
  },
  async handler(params: RecipeParts, ctx: SkillContext): Promise<SkillResult> {
    const saved = await createRecipeFromParts(params, ctx.userId)
    const review = saved.warnings.some((w) => /no encontrado/.test(w))
      ? ' Algun ingrediente no se reconocio del todo; se puede revisar en la app.'
      : ''
    return {
      data: { recipeId: saved.recipeId, name: saved.name },
      summary: `Receta "${saved.name}" creada en las recetas del usuario (id ${saved.recipeId}).${review}`,
      uiHint: 'recipe',
    }
  },
}

const recipeVariation: SkillDefinition = {
  name: 'recipe_variation',
  description: 'Obtiene los datos de una receta para sugerir una variacion o sustitucion de ingrediente. Tu (Claude) sugerieras la sustitucion usando tu conocimiento.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta' },
      ingredientToReplace: { type: 'string', description: 'Ingrediente que se quiere sustituir' },
    },
    required: ['recipeName', 'ingredientToReplace'],
  },
  async handler(params: { recipeName: string; ingredientToReplace: string }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx

    const [recipe] = await db
      .select()
      .from(recipes)
      .where(and(await visibleWhere(ctx), or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map((w: string) => ilike(recipes.name, `%${w}%`)),
      )))
      .limit(1)

    if (!recipe) {
      return { data: null, summary: `No he encontrado la receta "${params.recipeName}".`, uiHint: 'text' }
    }

    const riRows = await db
      .select({
        ingredientName: ingredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, recipe.id))

    const ingredientList = riRows.map((r: any) => `${r.ingredientName} (${r.quantity}${r.unit ?? 'g'})`)

    return {
      data: {
        recipeName: recipe.name,
        ingredients: riRows,
        ingredientToReplace: params.ingredientToReplace,
      },
      summary: `Receta ${recipe.name}. Ingredientes: ${ingredientList.join(', ')}. El usuario quiere sustituir: ${params.ingredientToReplace}.`,
      uiHint: 'recipe',
    }
  },
}

const nutritionAdvice: SkillDefinition = {
  name: 'nutrition_advice',
  description: 'Proporciona contexto del usuario para responder preguntas de nutricion. Tu (Claude) responderas usando la base de conocimiento del sistema.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Pregunta de nutricion del usuario' },
    },
    required: ['question'],
  },
  async handler(params: { question: string }, ctx: SkillContext): Promise<SkillResult> {
    const { userId, db } = ctx

    // Get current balance
    const [balance] = await db
      .select()
      .from(userNutrientBalance)
      .where(eq(userNutrientBalance.userId, userId))
      .limit(1)

    let balanceInfo = 'Sin datos de balance nutricional.'
    if (balance?.balance) {
      const b = balance.balance as NutrientBalance
      const pct = nutrientsToPercentages(b)
      balanceInfo = `Balance actual: proteina ${pct.protein.toFixed(1)}%, carbohidratos ${pct.carbohydrates.toFixed(1)}%, grasa ${pct.fat.toFixed(1)}% (objetivo: ${TARGET_MACROS.protein}/${TARGET_MACROS.carbohydrates}/${TARGET_MACROS.fat}).`
    }

    // Recent logs
    const recentLogs = await db
      .select()
      .from(menuLogs)
      .where(eq(menuLogs.userId, userId))
      .orderBy(desc(menuLogs.weekStart))
      .limit(4)

    let logInfo = ''
    if (recentLogs.length > 0) {
      const avgCal = recentLogs.reduce((s: number, l: any) => s + l.caloriesTotal, 0) / recentLogs.length
      logInfo = ` Calorias promedio semanal (ultimas ${recentLogs.length} semanas): ${Math.round(avgCal)} kcal.`
    }

    return {
      data: { balance: balance?.balance, question: params.question },
      summary: `Pregunta del usuario: ${params.question}. ${balanceInfo}${logInfo} Responde usando la base de conocimiento de Mimoia.`,
      uiHint: 'nutrition',
    }
  },
}

// ─── New skills (expansion 1–13) ────────────────────────────

// Helper: fuzzy-find an item in a shopping_lists.items array by ingredient name
function findShoppingItem(items: any[], query: string): any | null {
  const q = query.toLowerCase().trim()
  if (!q) return null
  const exact = items.find(i => String(i?.name ?? '').toLowerCase() === q)
  if (exact) return exact
  const includes = items.find(i => String(i?.name ?? '').toLowerCase().includes(q))
  if (includes) return includes
  const words = q.split(/\s+/).filter(w => w.length >= 3)
  for (const w of words) {
    const found = items.find(i => String(i?.name ?? '').toLowerCase().includes(w))
    if (found) return found
  }
  return null
}

// Helper: rounding bands consistent with services/recipeScaler.ts (kept inline so the
// skill stays a pure read; if scaler adds units we should mirror them here).
function scaleRound(raw: number, unit: string): number {
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

// 1. ── get_pantry_stock ────────────────────────────────────
// One answer to "¿qué tengo en casa?": the real pantry (pantry_items, with
// quantities and expiry dates, what /pantry shows) plus anything marked "ya lo
// tengo" on this week's shopping list. Before 2026-10-07 it only read the list
// flags, so the pantry the user kept in the app was invisible to the assistant.
async function latestShoppingList(ctx: SkillContext) {
  const [list] = await ctx.db
    .select()
    .from(shoppingLists)
    .where(scopeWhere(shoppingLists.userId, shoppingLists.householdId, await resolveScope(ctx.userId, ctx.db)))
    .orderBy(desc(shoppingLists.createdAt))
    .limit(1)
  return list ?? null
}

const getPantryStock: SkillDefinition = {
  name: 'get_pantry_stock',
  description: 'Lo que el usuario tiene en casa: su despensa (cantidades y caducidades) y lo marcado como "ya lo tengo" en la lista de la compra. Usala para "que tengo en la nevera/despensa", "que me caduca pronto".',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_params, ctx) {
    const pantry = await listPantryForUser(ctx.userId, ctx.db).catch(() => [])
    const list = await latestShoppingList(ctx)
    const inPantry = new Set(pantry.map((p) => normalizeText(p.name)))
    const fromList = ((list?.items as any[]) ?? []).filter((i) => i?.inStock && !inPantry.has(normalizeText(String(i.name ?? ''))))
    if (pantry.length === 0 && fromList.length === 0) {
      return {
        data: [],
        summary: list
          ? 'No tienes nada en la despensa ni marcado como "ya lo tengo" en la lista.'
          : 'Tu despensa esta vacia y aun no tienes lista de la compra.',
        uiHint: 'text',
      }
    }
    const fmt = (r: { name: string; quantity: number; unit: string; expiresAt: string | null }) =>
      `${r.name}${r.quantity ? ` ${r.quantity} ${r.unit}` : ''}${r.expiresAt ? ` (caduca ${String(r.expiresAt).slice(0, 10)})` : ''}`
    const all = [...pantry.map(fmt), ...fromList.map((i) => String(i.name))]
    return {
      data: { pantry, fromList },
      summary: `Tienes en casa: ${all.slice(0, 40).join(', ')}${all.length > 40 ? '…' : ''}.`,
      uiHint: 'text',
    }
  },
}

// 2. ── mark_in_stock ────────────────────────────────────────
function findPantryRow<T extends { name: string }>(rows: T[], query: string): T | null {
  const q = normalizeText(query)
  if (!q) return null
  return (
    rows.find((r) => normalizeText(r.name) === q) ??
    rows.find((r) => nameHasTerm(normalizeText(r.name), q) || nameHasTerm(q, normalizeText(r.name))) ??
    null
  )
}

const markInStock: SkillDefinition = {
  name: 'mark_in_stock',
  description: 'El usuario dice que tiene o que se le ha acabado un ingrediente. "tengo X" → inStock:true (lo apunta en la despensa y lo marca "ya lo tengo" en la lista); "se acabo X" / "ya no tengo X" → false (lo quita de ambas). Sin inStock alterna.',
  parameters: {
    type: 'object',
    properties: {
      ingredient: { type: 'string', description: 'Nombre del ingrediente (acepta coincidencia parcial)' },
      inStock: { type: 'boolean', description: 'true si tiene, false si no. Si se omite, alterna el estado.' },
    },
    required: ['ingredient'],
  },
  async handler(params: { ingredient: string; inStock?: boolean }, ctx) {
    const { userId, db } = ctx
    const pantry = await listPantryForUser(userId, db).catch(() => [])
    const list = await latestShoppingList(ctx)
    const items = ((list?.items as any[]) ?? []).slice()
    const item = list ? findShoppingItem(items, params.ingredient) : null
    const pantryHit = findPantryRow(pantry, params.ingredient)
    const current = item ? Boolean(item.inStock) : Boolean(pantryHit)
    const next = params.inStock != null ? !!params.inStock : !current

    let touched = false
    if (item) {
      item.inStock = next
      await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, list.id))
      touched = true
    }
    if (next && !pantryHit) {
      try {
        await addPantryForUser(userId, { name: String(item?.name ?? params.ingredient).trim().slice(0, 80) }, db)
        touched = true
      } catch (err) {
        if (!(err instanceof NoHouseholdError)) throw err
      }
    }
    if (!next && pantryHit) {
      await deletePantryForUser(userId, pantryHit.id, db)
      touched = true
    }
    if (!touched) {
      return {
        data: null,
        summary: list
          ? `No he encontrado "${params.ingredient}" en tu lista ni en la despensa.`
          : 'Necesitas tener una lista de la compra activa para gestionar la despensa.',
        uiHint: 'text',
      }
    }
    const name = item?.name ?? pantryHit?.name ?? params.ingredient
    return {
      data: { name, inStock: next },
      summary: next ? `${name} marcado como en casa.` : `${name} eliminado de la despensa.`,
      uiHint: 'confirmation',
    }
  },
}

// 3. ── check_shopping_item ─────────────────────────────────
const checkShoppingItem: SkillDefinition = {
  name: 'check_shopping_item',
  description: 'Marca un articulo de la lista de la compra como comprado (o lo desmarca). Util cuando el usuario va por el supermercado en manos libres.',
  parameters: {
    type: 'object',
    properties: {
      ingredient: { type: 'string', description: 'Nombre del ingrediente (acepta coincidencia parcial)' },
      checked: { type: 'boolean', description: 'true para marcar como comprado, false para devolver a pendiente. Si se omite, alterna.' },
    },
    required: ['ingredient'],
  },
  async handler(params: { ingredient: string; checked?: boolean }, ctx) {
    const { userId, db } = ctx
    const [list] = await db
      .select()
      .from(shoppingLists)
      .where(scopeWhere(shoppingLists.userId, shoppingLists.householdId, await resolveScope(userId, db)))
      .orderBy(desc(shoppingLists.createdAt))
      .limit(1)
    if (!list) {
      return { data: null, summary: 'No tienes lista de la compra activa.', uiHint: 'text' }
    }
    const items = ((list.items as any[]) ?? []).slice()
    const item = findShoppingItem(items, params.ingredient)
    if (!item) {
      return { data: null, summary: `No he encontrado "${params.ingredient}" en tu lista.`, uiHint: 'text' }
    }
    const next = params.checked != null ? !!params.checked : !item.checked
    item.checked = next
    await db.update(shoppingLists).set({ items }).where(eq(shoppingLists.id, list.id))
    return {
      data: { name: item.name, checked: next },
      summary: next ? `${item.name} marcado como comprado.` : `${item.name} vuelve a la lista.`,
      uiHint: 'confirmation',
    }
  },
}

// 4. ── get_my_recipes ──────────────────────────────────────
const getMyRecipes: SkillDefinition = {
  name: 'get_my_recipes',
  description: 'Lista las recetas creadas por el usuario (no las del catalogo del sistema). Util cuando dice "mis recetas".',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p, ctx) {
    const { userId, db } = ctx
    const rows = await db
      .select({ id: recipes.id, name: recipes.name, meals: recipes.meals, prepTime: recipes.prepTime, servings: recipes.servings })
      .from(recipes)
      .where(eq(recipes.authorId, userId))
      .orderBy(desc(recipes.createdAt))
      .limit(50)
    if (rows.length === 0) {
      return { data: [], summary: 'Aun no has guardado recetas propias. Cuando crees una se quedara aqui.', uiHint: 'text' }
    }
    const names = rows.map((r: any) => r.name).join(', ')
    return { data: rows, summary: `Tienes ${rows.length} receta(s) propia(s): ${names}.`, uiHint: 'recipe' }
  },
}

// 5. ── get_menu_history ────────────────────────────────────
const getMenuHistory: SkillDefinition = {
  name: 'get_menu_history',
  description: 'Devuelve los menus pasados del usuario para responder cuando dice "cuando comi X la ultima vez" o "que cocine la semana pasada".',
  parameters: {
    type: 'object',
    properties: {
      weeks: { type: 'number', description: 'Semanas pasadas a recuperar (1-12, por defecto 4)' },
    },
    required: [],
  },
  async handler(params: { weeks?: number }, ctx) {
    const { userId, db } = ctx
    const limit = Math.max(1, Math.min(12, params.weeks ?? 4))
    const rows = await db
      .select({ id: menus.id, weekStart: menus.weekStart, days: menus.days })
      .from(menus)
      .where(scopeWhere(menus.userId, menus.householdId, await resolveScope(userId, db)))
      .orderBy(desc(menus.weekStart))
      .limit(limit)
    if (rows.length === 0) {
      return { data: [], summary: 'No tienes historial de menus.', uiHint: 'text' }
    }
    const summary = rows.map((m: any) => {
      const meals = new Set<string>()
      for (const d of (m.days as any[]) ?? []) {
        for (const slot of Object.values(d) as any[]) {
          if (slot?.recipeName) meals.add(slot.recipeName)
        }
      }
      const list = [...meals].slice(0, 8).join(', ')
      return `${m.weekStart}: ${list}${meals.size > 8 ? '…' : ''}`
    }).join(' | ')
    return { data: rows, summary: `Historial: ${summary}`, uiHint: 'menu' }
  },
}

// 6. ── scale_recipe ────────────────────────────────────────
const scaleRecipeSkill: SkillDefinition = {
  name: 'scale_recipe',
  description: 'Reescala los ingredientes de una receta a un numero distinto de comensales. No modifica la receta guardada — solo devuelve las cantidades para el plato de hoy.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta' },
      servings: { type: 'number', description: 'Numero de comensales objetivo (entero positivo)' },
    },
    required: ['recipeName', 'servings'],
  },
  async handler(params: { recipeName: string; servings: number }, ctx) {
    const { db } = ctx
    if (!Number.isFinite(params.servings) || params.servings <= 0) {
      return { data: null, summary: 'El numero de comensales debe ser positivo.', uiHint: 'text' }
    }
    const [recipe] = await db
      .select()
      .from(recipes)
      .where(and(await visibleWhere(ctx), or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map(w => ilike(recipes.name, `%${w}%`)),
      )))
      .limit(1)
    if (!recipe) {
      return { data: null, summary: `No he encontrado la receta "${params.recipeName}".`, uiHint: 'text' }
    }
    const baseServings = (recipe as any).servings || 2
    const ratio = params.servings / baseServings
    const riRows = await db
      .select({
        ingredientName: ingredients.name,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        optional: recipeIngredients.optional,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(eq(recipeIngredients.recipeId, (recipe as any).id))
    const scaled = (riRows as any[]).map(r => ({
      name: r.ingredientName,
      quantity: scaleRound((r.quantity as number) * ratio, r.unit ?? 'g'),
      unit: r.unit ?? 'g',
      optional: !!r.optional,
    }))
    const summary = `${(recipe as any).name} para ${params.servings} comensales (receta original para ${baseServings}): ${scaled.map(s => `${s.name} ${s.quantity}${s.unit}${s.optional ? ' (opcional)' : ''}`).join(', ')}.`
    return {
      data: { recipeId: (recipe as any).id, recipeName: (recipe as any).name, servings: params.servings, baseServings, ingredients: scaled },
      summary,
      uiHint: 'recipe',
    }
  },
}

// 7. ── evaluate_food_health ────────────────────────────────
const evaluateFoodHealth: SkillDefinition = {
  name: 'evaluate_food_health',
  description: 'Cuando el usuario pregunta si un alimento es sano o que opinas de el (ej. "el zumo es sano", "que tal la avena"), llama a esta skill. Devuelve contexto para que tu (Claude) respondas con criterio segun los principios de cocina de Mimoia (Como cocina Mimoia) — no neutral.',
  parameters: {
    type: 'object',
    properties: {
      food: { type: 'string', description: 'Alimento o producto que el usuario pregunta' },
    },
    required: ['food'],
  },
  async handler(params: { food: string }) {
    return {
      data: { food: params.food },
      summary: `Opina de "${params.food}" con los principios de cocina de Mimoia. Considera: 1) cuanta verdura, legumbre o fibra aporta, 2) si es comida de verdad o un ultraprocesado, y cuanto azucar añadido lleva, 3) cada cuanto encaja en la semana, 4) si hay una alternativa de cocina mejor segun los principios (fruta entera mejor que zumo, pan de verdad mejor que de molde, de temporada mejor que de fuera de temporada). Habla de cocina y de costumbres, nunca de efectos en el cuerpo; si pregunta por su salud, sigue la regla de Salud. Da una respuesta corta (2-3 frases) con criterio propio, sin moralizar.`,
      uiHint: 'nutrition',
    }
  },
}

// 8. ── suggest_substitution ────────────────────────────────
const suggestSubstitution: SkillDefinition = {
  name: 'suggest_substitution',
  description: 'Cuando al usuario le falta un ingrediente o quiere cambiarlo (ej. "no tengo nata, que uso", "como sustituyo el azucar"), llama a esta skill. Tu (Claude) propondras alternativas alineadas con los principios de Mimoia.',
  parameters: {
    type: 'object',
    properties: {
      ingredient: { type: 'string', description: 'Ingrediente a sustituir' },
      recipeName: { type: 'string', description: 'Nombre de la receta (opcional, da contexto)' },
      restriction: { type: 'string', description: 'Restriccion del usuario (ej: sin lactosa, sin gluten)' },
    },
    required: ['ingredient'],
  },
  async handler(params: { ingredient: string; recipeName?: string; restriction?: string }, ctx) {
    const { db } = ctx
    let recipeContext = ''
    if (params.recipeName) {
      const [recipe] = await db
        .select({ name: recipes.name, allergens: recipes.allergens })
        .from(recipes)
        .where(and(await visibleWhere(ctx), or(
          ilike(recipes.name, `%${params.recipeName}%`),
          ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map(w => ilike(recipes.name, `%${w}%`)),
        )))
        .limit(1)
      if (recipe) {
        const allergens = ((recipe as any).allergens as string[]) ?? []
        recipeContext = ` Receta: ${(recipe as any).name}${allergens.length > 0 ? ` (alergenos detectados: ${allergens.join(', ')})` : ''}.`
      }
    }
    return {
      data: params,
      summary: `El usuario quiere sustituir "${params.ingredient}"${params.restriction ? ` (restriccion: ${params.restriction})` : ''}.${recipeContext} Sugiere 1-2 alternativas concretas alineadas con los principios de Mimoia. Importante: NUNCA propongas margarina, aceites vegetales refinados (girasol, soja, maiz, colza), edulcorantes artificiales ni sirope de maiz. Si propon AOVE, ghee, mantequilla, fermentados, frutos secos, semillas, harinas integrales, hueso/caldo casero, fruta entera en lugar de zumo.`,
      uiHint: 'recipe',
    }
  },
}

// 9. ── get_variety_score ───────────────────────────────────
const VEG_RE = /(verdura|hoja|espinaca|kale|acelga|brocoli|coliflor|tomate|cebolla|ajo|pimiento|calabac|berenjena|zanahoria|remolacha|esparrago|aguacate|champin|seta|alcachofa|pepino|rucula|canon|lechuga|repollo|col|puerro|apio|nabo|rabano|calabaza|judia_verde|guisante)/i
const PROT_RE = /(pollo|pavo|ternera|cerdo|cordero|huevo|salmon|atun|sardina|merluza|bacalao|gamba|mejillon|pulpo|tofu|tempeh|legumbre|lenteja|garbanzo|alubia|conejo|pato|trucha|caballa)/i

const getVarietyScore: SkillDefinition = {
  name: 'get_variety_score',
  description: 'Calcula la diversidad de ingredientes (con foco en vegetales y proteinas) en el menu actual del usuario. Pilar del principio 2 de Mimoia: verdura todos los dias, y variada.',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p, ctx) {
    const { userId, db } = ctx
    const menu = await menuOfWeek(ctx, getWeekStart())
    if (!menu) {
      return { data: null, summary: 'No tienes menu activo.', uiHint: 'text' }
    }
    const recipeIds = new Set<string>()
    for (const d of (menu.days as any[]) ?? []) {
      for (const slot of Object.values(d) as any[]) {
        for (const dish of recipeDishesOf(slot?.dishes ?? [])) {
          recipeIds.add(dish.recipeId)
        }
      }
    }
    if (recipeIds.size === 0) {
      return { data: null, summary: 'El menu no tiene recetas asignadas.', uiHint: 'text' }
    }
    const ids = [...recipeIds]
    const riRows = await db
      .select({ ingredientName: ingredients.name })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(inArray(recipeIngredients.recipeId, ids))
    const distinct = new Set<string>()
    const veggies = new Set<string>()
    const proteins = new Set<string>()
    for (const r of riRows as any[]) {
      const n = String(r.ingredientName ?? '').toLowerCase().trim()
      if (!n) continue
      distinct.add(n)
      if (VEG_RE.test(n)) veggies.add(n)
      if (PROT_RE.test(n)) proteins.add(n)
    }
    const score = Math.round(Math.min(distinct.size / 35, 1) * 100)
    const advice = score < 50
      ? 'Anade verdes oscuros (espinaca, kale) y crucíferas (brocoli, coliflor) para subir.'
      : score < 80
        ? 'Buen camino — sigue rotando proteinas distintas (legumbres, pescado azul, huevo).'
        : 'Excelente variedad: una semana con mucha verdura distinta.'
    return {
      data: { distinctCount: distinct.size, vegetableCount: veggies.size, proteinCount: proteins.size, score, vegetables: [...veggies], proteins: [...proteins] },
      summary: `Esta semana llevas ${distinct.size} ingredientes distintos (${veggies.size} vegetales, ${proteins.size} proteinas). Score de variedad: ${score}/100. ${advice}`,
      uiHint: 'nutrition',
    }
  },
}

// 10. ── get_eating_window ──────────────────────────────────
const getEatingWindow: SkillDefinition = {
  name: 'get_eating_window',
  description: 'Calcula la ventana de alimentacion del usuario (primera y ultima comida del dia, longitud media en horas) usando las comidas marcadas como comidas. Sirve para el principio 7 de Mimoia: comidas a su hora, sin picoteo.',
  parameters: {
    type: 'object',
    properties: {
      weeks: { type: 'number', description: 'Semanas a analizar (1-8, por defecto 2)' },
    },
    required: [],
  },
  async handler(params: { weeks?: number }, ctx) {
    const { userId, db } = ctx
    const limit = Math.max(1, Math.min(8, params.weeks ?? 2))
    const rows = await db
      .select({ days: menus.days, weekStart: menus.weekStart })
      .from(menus)
      .where(scopeWhere(menus.userId, menus.householdId, await resolveScope(userId, db)))
      .orderBy(desc(menus.weekStart))
      .limit(limit)
    if (rows.length === 0) {
      return { data: null, summary: 'No tengo datos de menus.', uiHint: 'text' }
    }
    const dayHours: number[][] = []
    for (const r of rows as any[]) {
      const days = (r.days as any[]) ?? []
      for (const d of days) {
        const hours: number[] = []
        for (const slot of Object.values(d) as any[]) {
          if (slot?.eaten && slot?.eatenAt) {
            const t = new Date(slot.eatenAt)
            if (!Number.isNaN(t.valueOf())) hours.push(t.getHours() + t.getMinutes() / 60)
          }
        }
        if (hours.length > 0) dayHours.push(hours)
      }
    }
    if (dayHours.length === 0) {
      return { data: null, summary: 'Aun no has marcado ninguna comida como comida con hora. Cuando lo hagas podre calcular tu ventana.', uiHint: 'text' }
    }
    const widths = dayHours.map(hs => Math.max(...hs) - Math.min(...hs))
    const avgW = widths.reduce((a, b) => a + b, 0) / widths.length
    const avgFirst = dayHours.map(hs => Math.min(...hs)).reduce((a, b) => a + b, 0) / dayHours.length
    const avgLast = dayHours.map(hs => Math.max(...hs)).reduce((a, b) => a + b, 0) / dayHours.length
    const fmt = (h: number) => `${Math.floor(h).toString().padStart(2, '0')}:${Math.round((h - Math.floor(h)) * 60).toString().padStart(2, '0')}`
    const advice = avgW > 12
      ? 'Ventana ancha: muchas horas entre la primera y la ultima comida. Si os encaja, cenar un poco antes deja las comidas a su hora y menos picoteo.'
      : avgW < 8
        ? 'Ventana corta: las comidas se concentran en pocas horas.'
        : 'Ventana razonable: comidas a horas regulares.'
    return {
      data: { avgWindowHours: Number(avgW.toFixed(2)), avgFirstHour: avgFirst, avgLastHour: avgLast, daysSampled: dayHours.length },
      summary: `Sobre ${dayHours.length} dia(s) con datos: ventana media ${avgW.toFixed(1)}h (~${fmt(avgFirst)} a ~${fmt(avgLast)}). ${advice}`,
      uiHint: 'nutrition',
    }
  },
}

// 11. ── get_week_balance ─────────────────────────────────
// Kitchen balance of the week (or one recipe), told in cooking words:
// vegetables and fibre, legumes, salt, processed food and fried dishes.
// No score and no health vocabulary on purpose (PRO-09, constitution §6):
// a "your index of X" calculator reads as a medical device.
const PROCESSED_RE = /(azucar|harina blanca|harina_blanca|aceite girasol|aceite_girasol|aceite soja|aceite_soja|aceite maiz|aceite_maiz|embutido|salchich|bacon|beicon|nata industrial|salsa industrial|margarina|edulcorante|sirope|jarabe_maiz|jarabe maiz|fritos|precocinad)/i
const SALTY_RE = /(embutido|chorizo|salchich|bacon|beicon|salami|fuet|sobrasada|tocino|pastilla de caldo|cubito|salsa de soja)/i
const LEGUME_RE = /(legumbre|lenteja|garbanzo|alubia|frijol|judion|habas?\b|soja texturizada|edamame)/i
const FIBER_RE = /(legumbre|lenteja|garbanzo|alubia|frijol|integral|avena|quinoa|chia|lino|psyllium|semilla)/i
const FRY_RE = /(\bfrit|fritura|freir|deep[ _]fry|empanad|rebozad)/i

const BALANCE_DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** Lowercase and drop accents so «calabacín» matches /calabac/ and «brócoli» /brocoli/. */
function plain(s: unknown): string {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** «a», «a y b», «a, b y c». */
function joinEs(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

export interface RecipeBalance {
  recipeId: string
  name: string
  verdura: boolean
  legumbre: boolean
  fibra: boolean
  salada: boolean
  frito: boolean
  procesados: string[]
}

/**
 * Kitchen signals of one recipe from its ingredient names, step texts and
 * per-serving nutrition. Pure, so the weekly and single-recipe paths share it.
 */
export function recipeBalance(
  recipe: { id: string; name: string; nutritionPerServing?: any },
  ingredientNames: string[],
  stepTexts: string[],
): RecipeBalance {
  const names = ingredientNames.map(plain).filter(Boolean)
  const steps = stepTexts.map(plain).join(' ')
  const nps = recipe.nutritionPerServing as any
  const fiberG = typeof nps?.fiberG === 'number' ? nps.fiberG : null
  const saltG = typeof nps?.saltG === 'number' ? nps.saltG : null
  const legumbre = names.some((n) => LEGUME_RE.test(n))
  return {
    recipeId: recipe.id,
    name: recipe.name,
    verdura: names.some((n) => VEG_RE.test(n)),
    legumbre,
    fibra: legumbre || (fiberG !== null && fiberG >= 8) || names.some((n) => FIBER_RE.test(n)),
    salada: (saltG !== null && saltG > 3) || names.some((n) => SALTY_RE.test(n)),
    frito: FRY_RE.test(steps),
    procesados: [...new Set(names.filter((n) => PROCESSED_RE.test(n)))],
  }
}

/** Fetch ingredient names + step texts for several recipes in two queries. */
async function loadBalances(recipeRows: any[], db: any): Promise<Map<string, RecipeBalance>> {
  const ids = recipeRows.map((r) => r.id)
  const ingRows = ids.length === 0 ? [] : await db
    .select({ recipeId: recipeIngredients.recipeId, name: ingredients.name })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(inArray(recipeIngredients.recipeId, ids))
  const stepRows = ids.length === 0 ? [] : await db
    .select({ recipeId: recipeSteps.recipeId, text: recipeSteps.text, technique: recipeSteps.technique })
    .from(recipeSteps)
    .where(inArray(recipeSteps.recipeId, ids))
  const out = new Map<string, RecipeBalance>()
  for (const r of recipeRows) {
    const ings = (ingRows as any[]).filter((x) => x.recipeId === r.id).map((x) => x.name)
    const steps = (stepRows as any[]).filter((x) => x.recipeId === r.id).map((x) => `${x.text ?? ''} ${x.technique ?? ''}`)
    out.set(r.id, recipeBalance(r, ings, steps))
  }
  return out
}

/**
 * The week's balance in plain kitchen sentences. `slots` are the menu's
 * meals that hold at least one recipe, with their day index (0 = lunes).
 */
export function describeWeekBalance(slots: Array<{ day: number; recipes: RecipeBalance[] }>) {
  const comidas = slots.length
  const conVerdura = slots.filter((s) => s.recipes.some((r) => r.verdura)).length
  const daysWhere = (pred: (r: RecipeBalance) => boolean) =>
    [...new Set(slots.filter((s) => s.recipes.some(pred)).map((s) => s.day))].sort((a, b) => a - b)
  const diasLegumbre = daysWhere((r) => r.legumbre)
  const diasFritos = daysWhere((r) => r.frito)
  const all = slots.flatMap((s) => s.recipes)
  const unique = <T,>(xs: T[]) => [...new Set(xs)]
  const saladas = unique(all.filter((r) => r.salada).map((r) => r.name))
  const procesados = unique(all.filter((r) => r.procesados.length > 0).map((r) => r.name))
  const dayList = (ds: number[]) => joinEs(ds.map((d) => `el ${BALANCE_DAY_NAMES[d] ?? `día ${d + 1}`}`))

  const parts: string[] = []
  const ratio = comidas > 0 ? conVerdura / comidas : 0
  if (ratio < 0.5) parts.push(`Esta semana vas corto de verdura: solo la llevan ${conVerdura} de ${comidas} comidas.`)
  else if (ratio < 0.75) parts.push(`Hay verdura en ${conVerdura} de ${comidas} comidas; cabe alguna más.`)
  else parts.push(`Bien de verdura: la llevan ${conVerdura} de ${comidas} comidas.`)

  if (diasLegumbre.length === 0) parts.push('No hay legumbre en toda la semana.')
  else if (diasLegumbre.length === 1) parts.push(`Legumbre solo un día (${dayList(diasLegumbre)}).`)
  else parts.push(`Legumbre ${diasLegumbre.length} días.`)

  if (diasFritos.length >= 2) {
    const cap = dayList(diasFritos)
    parts.push(`${cap.charAt(0).toUpperCase()}${cap.slice(1)} repiten fritos.`)
  } else if (diasFritos.length === 1) parts.push(`Hay fritos ${dayList(diasFritos)}.`)
  else parts.push('Ningún frito.')

  if (saladas.length > 0) parts.push(`Van cargadas de sal: ${joinEs(saladas)}.`)
  if (procesados.length > 0) parts.push(`Llevan procesados: ${joinEs(procesados)}.`)

  return {
    summary: parts.join(' '),
    data: { comidas, conVerdura, diasLegumbre: diasLegumbre.length, diasFritos: diasFritos.map((d) => BALANCE_DAY_NAMES[d]), saladas, procesados },
  }
}

/** One recipe's balance in a sentence. */
export function describeRecipeBalance(b: RecipeBalance): string {
  const good: string[] = []
  const watch: string[] = []
  if (b.verdura) good.push('verdura')
  if (b.legumbre) good.push('legumbre')
  else if (b.fibra) good.push('fibra')
  if (b.frito) watch.push('es frito o rebozado')
  if (b.salada) watch.push('va cargado de sal')
  if (b.procesados.length > 0) watch.push(`lleva procesados (${joinEs(b.procesados)})`)
  const lead = good.length > 0 ? `lleva ${joinEs(good)}` : 'no lleva verdura ni legumbre'
  const tail = watch.length > 0 ? `; ojo: ${joinEs(watch)}` : '; nada frito ni procesado'
  return `${b.name}: ${lead}${tail}.`
}

const getWeekBalance: SkillDefinition = {
  name: 'get_week_balance',
  description: 'Repasa el equilibrio de cocina del menu de la semana (o de una receta concreta): cuanta verdura y legumbre lleva, y donde hay fritos, mucha sal o procesados. Devuelve frases de cocina, sin puntuaciones.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de una receta. Omitir para repasar el menu de la semana.' },
    },
    required: [],
  },
  async handler(params: { recipeName?: string }, ctx) {
    const { userId, db } = ctx
    if (params.recipeName) {
      const [recipe] = await db
        .select()
        .from(recipes)
        .where(and(await visibleWhere(ctx), or(
          ilike(recipes.name, `%${params.recipeName}%`),
          ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map(w => ilike(recipes.name, `%${w}%`)),
        )))
        .limit(1)
      if (!recipe) {
        return { data: null, summary: `No he encontrado "${params.recipeName}".`, uiHint: 'text' }
      }
      const balances = await loadBalances([recipe], db)
      const b = balances.get((recipe as any).id)!
      return { data: b, summary: describeRecipeBalance(b), uiHint: 'nutrition' }
    }

    const menu = await menuOfWeek(ctx, getWeekStart())
    if (!menu) {
      return { data: null, summary: 'No tienes menu activo.', uiHint: 'text' }
    }
    const slotIds: Array<{ day: number; ids: string[] }> = []
    ;((menu.days as any[]) ?? []).forEach((d, day) => {
      for (const slot of Object.values(d ?? {}) as any[]) {
        const ids = recipeDishesOf(slot?.dishes ?? []).map((x) => x.recipeId)
        if (ids.length > 0) slotIds.push({ day, ids })
      }
    })
    if (slotIds.length === 0) {
      return { data: null, summary: 'El menu no tiene recetas.', uiHint: 'text' }
    }
    const ids = [...new Set(slotIds.flatMap((s) => s.ids))]
    const recipeRows = await db.select().from(recipes).where(inArray(recipes.id, ids))
    const balances = await loadBalances(recipeRows as any[], db)
    const slots = slotIds.map((s) => ({
      day: s.day,
      recipes: s.ids.map((id) => balances.get(id)).filter((b): b is RecipeBalance => !!b),
    })).filter((s) => s.recipes.length > 0)
    const { summary, data } = describeWeekBalance(slots)
    return { data: { ...data, porReceta: [...balances.values()] }, summary, uiHint: 'nutrition' }
  },
}

// 12. ── start_cooking_mode ────────────────────────────────
const startCookingMode: SkillDefinition = {
  name: 'start_cooking_mode',
  description: 'Abre el modo cocina paso a paso para una receta. El cliente navega a /recipes/:id/cook al recibir esta respuesta.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta' },
      servings: { type: 'number', description: 'Comensales para el cooking mode (opcional)' },
    },
    required: ['recipeName'],
  },
  async handler(params: { recipeName: string; servings?: number }, ctx) {
    const { db } = ctx
    const [recipe] = await db
      .select({ id: recipes.id, name: recipes.name })
      .from(recipes)
      .where(and(await visibleWhere(ctx), or(
        ilike(recipes.name, `%${params.recipeName}%`),
        ...params.recipeName.split(/\s+/).filter(w => w.length >= 3).map(w => ilike(recipes.name, `%${w}%`)),
      )))
      .limit(1)
    if (!recipe) {
      return { data: null, summary: `No he encontrado "${params.recipeName}".`, uiHint: 'text' }
    }
    return {
      data: { recipeId: (recipe as any).id, recipeName: (recipe as any).name, servings: params.servings ?? null },
      summary: `Empezando a cocinar ${(recipe as any).name}.`,
      uiHint: 'cooking_navigate',
    }
  },
}

// 13. ── set_timer ─────────────────────────────────────────
const setTimer: SkillDefinition = {
  name: 'set_timer',
  description: 'Pone un temporizador de cocina. Solo tiene efecto visible si el usuario esta en el modo cocina; en otros contextos confirma verbalmente.',
  parameters: {
    type: 'object',
    properties: {
      minutes: { type: 'number', description: 'Minutos del temporizador (0.5 - 180)' },
      label: { type: 'string', description: 'Etiqueta opcional (ej: "arroz")' },
    },
    required: ['minutes'],
  },
  async handler(params: { minutes: number; label?: string }) {
    const m = Math.max(0.5, Math.min(180, Number(params.minutes) || 0))
    return {
      data: { minutes: m, label: params.label ?? null },
      summary: `Temporizador de ${m} min${params.label ? ` para ${params.label}` : ''} en marcha.`,
      uiHint: 'cooking_timer',
    }
  },
}

// 14. ── cooking_step ──────────────────────────────────────
const cookingStep: SkillDefinition = {
  name: 'cooking_step',
  description: 'Avanza, retrocede o repite el paso actual del modo cocina. Solo tiene efecto visible si el usuario esta en el modo cocina.',
  parameters: {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['next', 'previous', 'repeat'], description: 'Direccion del paso' },
    },
    required: ['direction'],
  },
  async handler(params: { direction: 'next' | 'previous' | 'repeat' }) {
    const d = params.direction === 'previous' ? 'previous' : params.direction === 'repeat' ? 'repeat' : 'next'
    const verb = d === 'next' ? 'Siguiente paso' : d === 'previous' ? 'Paso anterior' : 'Repitiendo el paso actual'
    return {
      data: { direction: d },
      summary: `${verb}.`,
      uiHint: 'cooking_step',
    }
  },
}

/**
 * edit_recipe — author-only metadata edits via voice ("cambia el nombre de mi
 * tortilla a 'Tortilla de patatas Lacoma'", "mi receta de paella tarda 50
 * minutos en total"). For full edits (ingredients/steps), the skill responds
 * with a navigate hint to /recipes/<id>/edit so the realtime overlay can route
 * the user to the form. Voice does not attempt to rewrite the ingredient list
 * inline — too error-prone in audio-only context.
 */
const editRecipe: SkillDefinition = {
  name: 'edit_recipe',
  description:
    'Edita una receta del usuario. Sólo el autor puede editar (las recetas del catálogo de Mimoia, con authorId null, no son editables). Útil para cambios de nombre, tiempos, dificultad, notas y trucos por voz. Para editar ingredientes o pasos completos sugiere abrir el editor.',
  parameters: {
    type: 'object',
    properties: {
      recipeId: {
        type: 'string',
        description: 'UUID de la receta. Si lo conoces, úsalo. Si no, usa recipeName.',
      },
      recipeName: {
        type: 'string',
        description: 'Nombre (o parte) de la receta a editar. Se buscará en las recetas del usuario primero.',
      },
      name: { type: 'string', description: 'Nuevo nombre' },
      prepTime: { type: 'number', description: 'Tiempo de preparación en minutos' },
      cookTime: { type: 'number', description: 'Tiempo de cocción en minutos' },
      difficulty: { type: 'string', description: 'easy | medium | hard' },
      notes: { type: 'string', description: 'Notas (texto libre)' },
      tips: { type: 'string', description: 'Trucos (texto libre)' },
      openEditor: {
        type: 'boolean',
        description: 'Si true, no aplica cambios y devuelve un hint para navegar al editor de ingredientes/pasos.',
      },
    },
    required: [],
  },
  async handler(
    params: {
      recipeId?: string
      recipeName?: string
      name?: string
      prepTime?: number
      cookTime?: number
      difficulty?: string
      notes?: string
      tips?: string
      openEditor?: boolean
    },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx

    // Resolve target recipe — prefer user-owned matches when looking up by name.
    let target: { id: string; name: string; authorId: string | null } | null = null
    if (params.recipeId) {
      const [row] = await db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
        .from(recipes)
        .where(eq(recipes.id, params.recipeId))
        .limit(1)
      target = row ?? null
    } else if (params.recipeName) {
      // Look in user's own recipes first.
      const candidates = await db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
        .from(recipes)
        .where(ilike(recipes.name, `%${params.recipeName}%`))
        .limit(10)
      target = candidates.find((c: { authorId: string | null }) => c.authorId === userId) ?? null
    }

    if (!target) {
      return {
        data: null,
        summary: params.recipeName
          ? `No he encontrado una receta tuya que se llame "${params.recipeName}". Sólo puedes editar las recetas que tú has creado.`
          : 'Necesito el nombre o el id de la receta que quieres editar.',
        uiHint: 'text',
      }
    }

    if (target.authorId !== userId) {
      return {
        data: null,
        summary: `"${target.name}" es una receta del catálogo de Mimoia, no tuya. Para hacer cambios, primero añádela a tus recetas y edita la copia.`,
        uiHint: 'text',
      }
    }

    if (params.openEditor) {
      return {
        data: { recipeId: target.id, navigateTo: `/recipes/${target.id}/edit` },
        summary: `Te abro el editor completo de "${target.name}".`,
        uiHint: 'recipe',
      }
    }

    // Apply field-level updates (only the recipe row — no ingredients/steps via voice).
    const updates: Record<string, unknown> = { updatedAt: new Date() }
    const changedFields: string[] = []

    if (typeof params.name === 'string' && params.name.trim().length > 0) {
      updates.name = params.name.trim()
      changedFields.push('nombre')
    }
    if (typeof params.prepTime === 'number' && params.prepTime >= 0) {
      updates.prepTime = params.prepTime
      changedFields.push('tiempo de preparación')
    }
    if (typeof params.cookTime === 'number' && params.cookTime >= 0) {
      updates.cookTime = params.cookTime
      changedFields.push('tiempo de cocción')
    }
    if (typeof params.difficulty === 'string') {
      const d = params.difficulty.toLowerCase()
      if (d === 'easy' || d === 'medium' || d === 'hard') {
        updates.difficulty = d
        changedFields.push('dificultad')
      }
    }
    if (typeof params.notes === 'string') {
      updates.notes = params.notes.trim() || null
      changedFields.push('notas')
    }
    if (typeof params.tips === 'string') {
      updates.tips = params.tips.trim() || null
      changedFields.push('trucos')
    }

    if (changedFields.length === 0) {
      return {
        data: { recipeId: target.id },
        summary: `Para editar "${target.name}" dime qué quieres cambiar (nombre, tiempo, dificultad, notas, trucos) o pídeme abrir el editor completo.`,
        uiHint: 'text',
      }
    }

    await db.update(recipes).set(updates).where(eq(recipes.id, target.id))

    return {
      data: { recipeId: target.id, changed: changedFields },
      summary: `Hecho. He actualizado ${changedFields.join(', ')} en "${target.name}".`,
      uiHint: 'recipe',
    }
  },
}

/**
 * update_household — set the user's adults + kidsCount (children 2–10 years)
 * via voice ("ahora somos 2 adultos y un niño", "quítame el niño"). Drives
 * shopping-list portion sizing immediately.
 */
const updateHousehold: SkillDefinition = {
  name: 'update_household',
  description:
    'Actualiza la composición del hogar del usuario: adultos (incluye mayores de 10 años) y número de niños de 2 a 10 años. Los menores de 2 no se cuentan. Se usa para escalar la lista de la compra y las raciones por defecto en las recetas.',
  parameters: {
    type: 'object',
    properties: {
      adults: {
        type: 'number',
        description: 'Número de adultos en el hogar (>=1). Incluye mayores de 10 años.',
      },
      kidsCount: {
        type: 'number',
        description: 'Niños entre 2 y 10 años (>=0). Cada niño cuenta como 0.5 raciones.',
      },
    },
    required: ['adults', 'kidsCount'],
  },
  async handler(
    params: { adults: number; kidsCount: number },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx
    const adults = Math.max(1, Math.floor(params.adults))
    const kidsCount = Math.max(0, Math.floor(params.kidsCount))

    await db
      .update(users)
      .set({ adults, kidsCount, householdSize: null })
      .where(eq(users.id, userId))

    const multiplier = householdMultiplier(adults, kidsCount)
    const adultsLabel = adults === 1 ? '1 adulto' : `${adults} adultos`
    const kidsLabel =
      kidsCount === 0
        ? 'sin niños'
        : kidsCount === 1
          ? '1 niño (2-10 años)'
          : `${kidsCount} niños (2-10 años)`

    return {
      data: { adults, kidsCount, multiplier },
      summary: `Hogar actualizado: ${adultsLabel} ${kidsCount > 0 ? `+ ${kidsLabel}` : `(${kidsLabel})`}. Las próximas listas de la compra escalarán a ${multiplier} raciones.`,
      uiHint: 'confirmation',
    }
  },
}

/**
 * add_recipe_to_mine — copy a system (or another user's) recipe into the
 * caller's catalog so they can edit it. Drives the "añade la fabada de Mimoia
 * a mis recetas" voice utterance and unlocks the Editar flow on copies.
 */
const addRecipeToMine: SkillDefinition = {
  name: 'add_recipe_to_mine',
  description:
    'Copia una receta (del catálogo de Mimoia o de otro usuario) a las recetas del usuario actual. La copia es totalmente editable. Devuelve el id y el nombre de la nueva receta. Si el usuario nombra una receta que ya es suya, no se duplica.',
  parameters: {
    type: 'object',
    properties: {
      recipeId: { type: 'string', description: 'UUID de la receta original.' },
      recipeName: {
        type: 'string',
        description: 'Nombre (o parte) de la receta a copiar. Se prefiere el match exacto en el catálogo de Mimoia.',
      },
    },
    required: [],
  },
  async handler(
    params: { recipeId?: string; recipeName?: string },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx

    let source: { id: string; name: string; authorId: string | null } | null = null
    if (params.recipeId) {
      const [row] = await db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
        .from(recipes)
        .where(and(await visibleWhere(ctx), eq(recipes.id, params.recipeId)))
        .limit(1)
      source = row ?? null
    } else if (params.recipeName) {
      const candidates = await db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId })
        .from(recipes)
        .where(and(await visibleWhere(ctx), ilike(recipes.name, `%${params.recipeName}%`)))
        .limit(20)
      // Prefer Mimoia system recipes for "add to mine" (don't accidentally copy
      // your own recipe). If only your own match, refuse with a friendly
      // message.
      source = candidates.find((c: { authorId: string | null }) => c.authorId === null)
        ?? candidates.find((c: { authorId: string | null }) => c.authorId !== userId)
        ?? null
      const ownsOnly = candidates.length > 0 && candidates.every((c: { authorId: string | null }) => c.authorId === userId)
      if (!source && ownsOnly) {
        return {
          data: null,
          summary: `"${params.recipeName}" ya está en tus recetas.`,
          uiHint: 'text',
        }
      }
    }

    if (!source) {
      return {
        data: null,
        summary: params.recipeName
          ? `No he encontrado la receta "${params.recipeName}" en el catálogo.`
          : 'Necesito el nombre o el id de la receta que quieres añadir.',
        uiHint: 'text',
      }
    }

    if (source.authorId === userId) {
      return {
        data: { recipeId: source.id, name: source.name },
        summary: `"${source.name}" ya es tuya.`,
        uiHint: 'text',
      }
    }

    // Load child rows + clone in a transaction (mirrors POST /recipes/:id/copy
    // semantics; we keep the logic local to the skill so the voice path doesn't
    // depend on the HTTP route).
    const sourceIngredients = await db
      .select()
      .from(recipeIngredients)
      .where(eq(recipeIngredients.recipeId, source.id))

    const sourceSteps = await db
      .select()
      .from(recipeSteps)
      .where(eq(recipeSteps.recipeId, source.id))

    const ingRowIdMap = new Map<string, string>()
    for (const ing of sourceIngredients) {
      ingRowIdMap.set(ing.id, crypto.randomUUID())
    }

    const [full] = await db.select().from(recipes).where(eq(recipes.id, source.id)).limit(1)
    const baseInternalTags = (full.internalTags ?? []).filter(
      (t: string) => t !== 'compartida' && t !== 'auto-extracted' && t !== 'from-url',
    )
    baseInternalTags.push('copied-from-catalog')

    const newId = await db.transaction(async (tx: any) => {
      const [inserted] = await tx
        .insert(recipes)
        .values({
          name: full.name,
          authorId: userId,
          imageUrl: full.imageUrl,
          servings: full.servings,
          yieldText: full.yieldText,
          prepTime: full.prepTime,
          cookTime: full.cookTime,
          activeTime: full.activeTime,
          totalTime: full.totalTime,
          difficulty: full.difficulty ?? 'medium',
          meals: full.meals ?? [],
          seasons: full.seasons ?? [],
          equipment: full.equipment ?? [],
          allergens: full.allergens ?? [],
          notes: full.notes,
          tips: full.tips,
          substitutions: full.substitutions,
          storage: full.storage,
          nutritionPerServing: full.nutritionPerServing,
          tags: full.tags ?? [],
          internalTags: baseInternalTags,
          sourceUrl: full.sourceUrl,
          sourceType: 'manual',
          copiedFromRecipeId: full.id,
        })
        .returning({ id: recipes.id })

      if (sourceIngredients.length > 0) {
        await tx.insert(recipeIngredients).values(
          sourceIngredients.map((ing: any, i: number) => ({
            id: ingRowIdMap.get(ing.id)!,
            recipeId: inserted.id,
            ingredientId: ing.ingredientId,
            section: ing.section,
            quantity: ing.quantity,
            unit: ing.unit,
            optional: ing.optional,
            note: ing.note,
            displayOrder: ing.displayOrder ?? i,
          })),
        )
      }

      if (sourceSteps.length > 0) {
        await tx.insert(recipeSteps).values(
          sourceSteps.map((s: any) => ({
            recipeId: inserted.id,
            index: s.index,
            text: s.text,
            durationMin: s.durationMin,
            temperature: s.temperature,
            technique: s.technique,
            ingredientRefs: (s.ingredientRefs ?? []).map(
              (oldId: string) => ingRowIdMap.get(oldId) ?? oldId,
            ),
          })),
        )
      }
      return inserted.id
    })

    return {
      data: { recipeId: newId, name: source.name },
      summary: `He añadido "${source.name}" a tus recetas. Ya puedes editarla.`,
      uiHint: 'recipe',
    }
  },
}

/**
 * Persist a freshly-learned preference into the user's long-term memory.
 *
 * The advisor calls this when the user says "recuerda que…", "apunta que…",
 * "ya no me gusta…", etc. Source is 'inferred' (confidence 0.8) unless the
 * user is emphatic ("APUNTA", "GUÁRDATE", "QUE NO SE TE OLVIDE") — then
 * confidence 1.0. The skill is fire-and-forget from the LLM's perspective;
 * it returns a one-line Spanish confirmation.
 */
const updateMemory: SkillDefinition = {
  name: 'update_memory',
  description:
    'Guarda en la memoria del usuario un dato persistente que mencione en la conversación (disgustos, equipo de cocina, presupuesto, preferencias de cocina, días con poco tiempo, hábitos de preparación, etc.). Llámalo SIEMPRE que el usuario diga "recuerda que…", "ya no me gusta…", "no me apetece nunca…", "tengo / no tengo (electrodoméstico)", "los lunes no cocino", "el presupuesto semanal es…", "preferimos cocina mediterránea", "siempre congelo el pescado", "pongo las legumbres en remojo la noche antes". Acepta un array de hechos para cubrir varios cambios en un único turno. Usa claves canónicas: dislikes (array), equipment (array), restrictions (array), weekly_budget_eur (number), cuisine_bias (object cuisine->0..100), time_available (object weekday->minutes), cooking_skill ("easy"|"medium"|"advanced"), meal_times (object meal->"HH:MM"), notes (array), nutrition_principles (array), prep_habits (array), physical.age, physical.weight_kg, physical.height_cm, physical.activity_level, household.adults, household.kids_2_to_10.',
  parameters: {
    type: 'object',
    properties: {
      facts: {
        type: 'array',
        description: 'Hechos a guardar. Cada uno con key + value.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Clave canónica.' },
            value: {
              description: 'Valor en el formato correcto para la clave (array, número, string, etc).',
            },
            confidence: {
              type: 'number',
              description: 'Opcional. 0..1. Default 0.8 (inferido). Usa 1 si el usuario lo pidió explícitamente ("recuerda que…", "ya no…") o corrige un dato guardado.',
            },
            remove: {
              type: 'array',
              items: { type: 'string' },
              description: 'Solo para listas: elementos a QUITAR ("ya no me disgusta el vacuno" → key dislikes, value [], remove ["vacuno"]).',
            },
            replace: {
              type: 'boolean',
              description: 'Solo para listas: true si el usuario quiere rehacer la lista entera. Por defecto lo que pasas en value se AÑADE a lo que ya hay.',
            },
          },
          required: ['key', 'value'],
        },
      },
    },
    required: ['facts'],
  },
  async handler(
    params: { facts: MemoryFactInput[] },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId } = ctx
    // Over WhatsApp health data is never stored (PRO-24): drop those facts
    // and point to the web profile.
    if (ctx.channel === 'whatsapp' && params.facts.some((f) => isHealthMemoryKey(f.key))) {
      params = { facts: params.facts.filter((f) => !isHealthMemoryKey(f.key)) }
      if (params.facts.length === 0) return { data: null, summary: WHATSAPP_HEALTH_DATA_REPLY, uiHint: 'text' }
    }
    const { setMemoryBatch, getMemoryForUser, UnknownMemoryKeyError, MemoryValueValidationError, HealthConsentRequiredError } = await import('../userMemoryStore.js')
    const current = await getMemoryForUser(userId).catch(() => ({}))
    const { facts: merged, keptManual } = mergeMemoryFacts(current as Record<string, { value: unknown; source?: string }>, params.facts)
    if (merged.length === 0) {
      return {
        data: null,
        summary: `No he cambiado nada: ${keptManual.join(', ')} lo puso el usuario a mano; si quiere cambiarlo, que te lo diga expresamente.`,
        uiHint: 'text',
      }
    }
    // Forward as a single transaction so a partial failure rolls back.
    try {
      // The skill writes source='inferred'; mergeMemoryFacts keeps what the
      // user set by hand unless they asked for the change (confidence 1).
      await setMemoryBatch(userId, merged, 'inferred')
    } catch (err) {
      if (err instanceof HealthConsentRequiredError) {
        return {
          data: null,
          summary: HEALTH_CONSENT_SKILL_REPLY,
          uiHint: 'text',
        }
      }
      if (err instanceof UnknownMemoryKeyError) {
        return {
          data: null,
          summary: `No conozco la clave "${err.message.split(':').pop()?.trim()}", no la he guardado.`,
          uiHint: 'text',
        }
      }
      if (err instanceof MemoryValueValidationError) {
        return {
          data: null,
          summary: `No he podido guardar ${err.key}: ${err.reason}.`,
          uiHint: 'text',
        }
      }
      throw err
    }
    const keys = merged.map((f) => f.key).join(', ')
    const kept = keptManual.length ? ` No he tocado ${keptManual.join(', ')}: lo puso el usuario a mano.` : ''
    return {
      data: { updated: merged.length },
      summary: `Apuntado. (${keys})${kept}`,
      uiHint: 'confirmation',
    }
  },
}

// ─── Exports ────────────────────────────────────────────────

// ─── import_recipe_from_url ─────────────────────────────────────
// "Guárdame esta receta: <enlace>" — same extractor + persist path as the
// /recipes "Importar desde enlace" flow (services/recipeImport.ts). Shines
// on WhatsApp, where sharing a YouTube/blog link is the natural gesture.
export const importRecipeFromUrlSkill: SkillDefinition = {
  name: 'import_recipe_from_url',
  description:
    'Importa una receta desde un enlace (video de YouTube, articulo/blog de cocina o post de Instagram/TikTok) y la guarda en las recetas del usuario. Usala cuando el usuario comparta o pegue un enlace de una receta o pida "guardame esta receta". Tarda unos segundos. Devuelve el id y el nombre de la receta guardada.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL completa (http/https) de la receta' },
    },
    required: ['url'],
  },
  handler: async (params: { url?: string }, ctx: SkillContext): Promise<SkillResult> => {
    const url = typeof params.url === 'string' ? params.url.trim() : ''
    if (!/^https?:\/\/\S+$/i.test(url)) {
      return { data: null, summary: 'La URL no es valida. Pide al usuario el enlace completo.', uiHint: 'text' }
    }
    try {
      const saved = await importRecipeFromUrl(url, ctx.userId)
      const review = saved.warnings.length > 0
        ? ` Algunos ingredientes no se reconocieron del todo: sugiere revisarla en la app.`
        : ''
      return {
        data: { recipeId: saved.recipeId, name: saved.name },
        summary: `Receta «${untrustedText(saved.name, 80)}» guardada en las recetas del usuario (id ${saved.recipeId}).${review}`,
        uiHint: 'recipe',
      }
    } catch (err: any) {
      if (err instanceof SocialCaptionUnavailableError) {
        // Plan B for Instagram/TikTok: a screenshot, which the photo import
        // reads (a WhatsApp photo is imported directly).
        return {
          data: null,
          summary: `No se ha guardado nada. Responde al usuario exactamente: «${err.message}».`,
          uiHint: 'text',
        }
      }
      if (err instanceof NotARecipeError) {
        return { data: null, summary: `El enlace no parece contener una receta cocinable: «${untrustedText(err.reason, 160)}»`, uiHint: 'text' }
      }
      if (err instanceof NoExtractableContentError || err instanceof PageFetchError) {
        return { data: null, summary: `No se pudo leer el contenido del enlace: ${err.message}`, uiHint: 'text' }
      }
      if (err instanceof UnsafeUrlError) {
        return { data: null, summary: `No se puede importar ese enlace: ${err.message} Pide un enlace público a la receta.`, uiHint: 'text' }
      }
      throw err
    }
  },
}

export const skills: SkillDefinition[] = [
  getTodaysMenu,
  getWeeklyMenu,
  getRecipeDetails,
  getWeeklyNutrition,
  suggestRecipes,
  searchRecipes,
  generateWeeklyMenu,
  completeOnboarding,
  swapMeal,
  toggleFavorite,
  markMealEaten,
  createRecipe,
  recipeVariation,
  nutritionAdvice,
  // Expansion 1–13:
  getPantryStock,
  markInStock,
  checkShoppingItem,
  getMyRecipes,
  getMenuHistory,
  scaleRecipeSkill,
  evaluateFoodHealth,
  suggestSubstitution,
  getVarietyScore,
  getEatingWindow,
  getWeekBalance,
  cookWithWhatIHave,
  startCookingMode,
  setTimer,
  cookingStep,
  // Improvements 2026-05:
  editRecipe,
  updateHousehold,
  addRecipeToMine,
  updateMemory,
  // WhatsApp channel 2026-10:
  importRecipeFromUrlSkill,
  // UI parity (everything the app can do, from chat) — appSkills.ts:
  ...appSkills,
  // Compra en mis tiendas (specs/shop-orders.md) — shopOrderSkills.ts:
  ...shopOrderSkills,
  // Comidas fijas (PRO-218, specs/menus.md):
  ...fixedMealSkills,
]

/**
 * Convert skills to Anthropic tool definitions format.
 */
/**
 * Tools the model can use on a channel. Hiding what doesn't apply makes the
 * choice easier (64 tools on 2026-10-11): the in-app cooking controls don't
 * exist on WhatsApp, and complete_onboarding only matters during the
 * WhatsApp-first sign-up.
 */
const HIDDEN_ON_WHATSAPP = new Set(['set_timer', 'cooking_step'])

export function toolsFor(opts: { mode?: string; onboarding?: boolean } = {}): SkillDefinition[] {
  return skills.filter((skill) => {
    if (skill.name === 'complete_onboarding') return opts.onboarding === true
    if (opts.mode === 'whatsapp' && HIDDEN_ON_WHATSAPP.has(skill.name)) return false
    return true
  })
}

export function getToolDefinitions(opts: { mode?: string; onboarding?: boolean } = {}): Array<{
  name: string
  description: string
  input_schema: Record<string, any>
}> {
  return toolsFor(opts).map(skill => ({
    name: skill.name,
    description: skill.description,
    input_schema: skill.parameters,
  }))
}
