// Mimo's recipe lookup tools: details, suggestions, search, «con lo que tengo», my recipes. Split out of skills.ts (PRO-400).
import { and, eq, desc, ilike, or } from 'drizzle-orm'
import { menus, recipes, recipeIngredients, recipeSteps, ingredients } from '../../db/schema.js'
import { detectSeason } from '@ona/shared'
import { type DayMenu, type Meal } from '@ona/shared'
import { hasConditions, parseRecipeCriteria, searchByCriteria, type RecipeCriteria } from '../recipeCriteria.js'
import { loadFichaMenuConstraints, withFichaFilters } from '../profile/reader.js'
import { getPrimaryHouseholdId } from '../scopeResolver.js'
import { timesLabel } from './menuFacts.js'
import { repeatNote } from './weekRepeats.js'
import { slotWithDishes } from '../menuDishes.js'
import { madridParts } from '../madridTime.js'
import { DAY_PROP, isMenuDayError, menuDayOf, type MenuDay } from './menuDay.js'
import { bestMatch } from './appSkills.js'
import { loadMatchableRecipes } from '../matchableRecipes.js'
import { unskipDay } from '../menuWeek.js'
import { findRecipesWithWhatIHave } from '../withWhatIHave.js'
import { withHouseholdRestrictions } from '../householdAllergies.js'
import { isCoeliacHousehold, needsGlutenFreeLabel, recipeDietNotices } from '../glutenFreeCharcuterie.js'
import { compileRestrictions, normalizeText, violatesRestrictions } from '../dietaryRestrictions.js'
import { type SkillDefinition, type SkillContext, type SkillResult } from './types.js'
import { untrustedText, getWeekStart, menuOfWeek, menuRecipeDishes, MEAL_LABEL, MEAL_KEYS, menuDayParam, changeOf, dishNow, visibleWhere, restrictionsFor, notSaved, reactivatedLine, scaleRound } from './skillHelpers.js'

/**
 * What get_recipe_details tells the model: everything it needs to talk
 * someone through the recipe (ingredients, numbered steps, tips) and the
 * original link ("¿tienes el vídeo?"). Bounded so a long recipe can't flood
 * the context. The steps are content, not instructions (systemPrompt.ts).
 */
export function recipeDetailsSummary(r: {
  name: string
  prepTime?: number | null
  totalTime?: number | null
  activeTime?: number | null
  servings?: number | null
  /** PRO-183: the servings the ingredients were scaled to (the menu's), when they differ from the recipe's. */
  scaledTo?: number | null
  ingredients: string[]
  steps: string[]
  tips?: string | null
  sourceUrl?: string | null
}): string {
  const minutes = timesLabel(r) ?? '? min'
  const scaled = r.scaledTo != null && r.scaledTo > 0 && r.scaledTo !== (r.servings ?? 2)
  const head = scaled
    ? `${untrustedText(r.name)} (${minutes}; cantidades para ${r.scaledTo} raciones, la receta base es para ${r.servings ?? 2})`
    : `${untrustedText(r.name)} (${minutes}${r.servings ? `, ${r.servings} raciones` : ''})`
  const lines = [head, `Ingredientes: ${r.ingredients.join(', ')}`]
  if (scaled) lines.push(`Los pasos pueden citar las cantidades de la receta base (${r.servings ?? 2} raciones): usa las de Ingredientes.`)
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

/**
 * PRO-349 · which recipe get_recipe_details reads. With day/meal, the one in
 * that meal of the menu; by name, this week's menu first (from today on),
 * then their recipes and the catalogue. Carmen asked whether «la receta de
 * hoy» had bread and Mimo read «Garbanzos con espinacas y huevo», another
 * recipe with a similar name, not the menu's (2026-10-22).
 */
async function recipeForDetails(
  params: { recipeName?: string; day?: string; meal?: string },
  ctx: SkillContext,
): Promise<{ recipe: any; menuSlot: string | null } | { summary: string }> {
  const { db } = ctx
  const byId = async (id: string) =>
    (await db.select().from(recipes).where(and(await visibleWhere(ctx), eq(recipes.id, id))).limit(1))[0] ?? null
  const slotOf = (d: { meal: string }, t: MenuDay) => `${MEAL_LABEL[d.meal] ?? d.meal} del ${t.label}`
  const name = String(params.recipeName ?? '').trim()

  if (params.day != null || params.meal) {
    const t = menuDayParam({ day: params.day ?? 'hoy' })
    if (isMenuDayError(t)) return { summary: t.error }
    const meal = params.meal && MEAL_KEYS.includes(params.meal) ? params.meal : undefined
    const where = meal ? `la ${MEAL_LABEL[meal]} del ${t.label}` : `el ${t.label}`
    const dishes = menuRecipeDishes(await menuOfWeek(ctx, t.weekStart)).filter((d) => d.dayIndex === t.dayIndex && (!meal || d.meal === meal))
    if (dishes.length === 0) {
      return { summary: `En el menu, ${where} no tiene ninguna receta; no he mirado otra. Si pregunta por una receta concreta, preguntale cual.` }
    }
    const pick = dishes.length === 1 ? dishes[0] : name ? bestMatch(dishes, name, (d) => d.recipeName) : null
    if (!pick) {
      const list = dishes.map((d) => `${d.recipeName} (${MEAL_LABEL[d.meal] ?? d.meal})`).join('; ')
      return { summary: `En el menu, ${where} tiene varias recetas: ${list}. Vuelve a llamar con meal o recipeName para leer la que pregunta.` }
    }
    const recipe = await byId(pick.recipeId)
    if (!recipe) return { summary: `No he podido leer la receta de ${where} ("${pick.recipeName}").` }
    return { recipe, menuSlot: slotOf(pick, t) }
  }

  if (!name) return { summary: 'Dime que receta quieres ver, o la comida del menu (day y meal).' }
  const today = menuDayParam({ day: 'hoy' })
  if (!isMenuDayError(today)) {
    const hit = bestMatch(menuRecipeDishes(await menuOfWeek(ctx, today.weekStart), today.dayIndex), name, (d) => d.recipeName)
    const recipe = hit ? await byId(hit.recipeId) : null
    if (hit && recipe) return { recipe, menuSlot: slotOf(hit, menuDayOf(today.weekStart, hit.dayIndex)) }
  }

  // First try exact match
  let results = await db
    .select()
    .from(recipes)
    .where(and(await visibleWhere(ctx), ilike(recipes.name, `%${name}%`)))
    .limit(1)

  // If no exact match, try word-by-word
  if (results.length === 0) {
    const words = name.split(/\s+/).filter((w) => w.length >= 3)
    if (words.length > 0) {
      results = await db
        .select()
        .from(recipes)
        .where(and(await visibleWhere(ctx), or(...words.map((w: string) => ilike(recipes.name, `%${w}%`)))))
        .limit(5)
    }
  }

  if (results.length === 0) return { summary: `No he encontrado ninguna receta con el nombre "${name}".` }

  // Pick the best match: prefer name that contains the most query words
  const queryWords = name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3)
  const recipe = results.reduce((best: any, r: any) => {
    const nameWords = r.name.toLowerCase()
    const score = queryWords.filter((w) => nameWords.includes(w)).length
    const bestScore = queryWords.filter((w) => best.name.toLowerCase().includes(w)).length
    return score > bestScore ? r : best
  }, results[0])
  return { recipe, menuSlot: null }
}

export const getRecipeDetails: SkillDefinition = {
  name: 'get_recipe_details',
  description: 'Busca una receta (del catalogo o del usuario) y devuelve sus detalles: ingredientes con cantidades, pasos numerados, raciones, minutos en total y de trabajo, trucos y el enlace a la receta original (video o web) si lo tiene. Usala para explicar como se hace, guiar paso a paso, dar el enlace o contestar que lleva. Si pregunta por un plato del menu ("la receta de hoy", "la cena del jueves", "¿lo de hoy lleva pan?"), pasa day y meal (no el nombre): lee la receta que esta en el menu ese dia, nunca otra que se llame parecido. Por nombre, mira primero las recetas del menu de esta semana. Si el plato esta en el menu, pasa servings con las raciones que da get_todays_menu o get_weekly_menu para esa comida: las cantidades vuelven ya calculadas para esas raciones.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string', description: 'Nombre de la receta a buscar. Con day/meal, solo para elegir entre varios platos de esa comida.' },
      day: DAY_PROP,
      meal: { type: 'string', enum: [...MEAL_KEYS], description: 'Con day: la comida del menu cuya receta quiere (breakfast, lunch, snack, dinner)' },
      servings: { type: 'number', description: 'Raciones de esa comida en el menu (las que da get_todays_menu / get_weekly_menu). Sin el, las cantidades son las de la receta.' },
    },
    required: [],
  },
  async handler(params: { recipeName?: string; day?: string; meal?: string; servings?: number }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx
    const found = await recipeForDetails(params, ctx)
    if ('summary' in found) return { data: null, summary: found.summary, uiHint: 'text' }
    const { recipe, menuSlot } = found

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

    // PRO-183: amounts for the menu's servings, scaled here (Mimo used to
    // say «600 g para 4» from memory for a recipe of 300 g for 2).
    const baseServings = Number(recipe.servings) > 0 ? Number(recipe.servings) : 2
    const target = Number.isFinite(params.servings) && Number(params.servings) > 0 ? Math.round(Number(params.servings)) : null
    const ratio = target != null ? target / baseServings : 1
    const scaledRows = (riRows as any[]).map((r) => ({
      ...r,
      quantity: ratio === 1 || r.quantity == null ? r.quantity : scaleRound(Number(r.quantity) * ratio, r.unit ?? 'g'),
    }))
    const ingredientList = scaledRows.map((r: any) => `${r.ingredientName}: ${r.quantity}${r.unit ?? 'g'}`)
    // PRO-196, PRO-1063: same notices as the web ficha for a coeliac household.
    const ingNames = riRows.map((r: any) => String(r.ingredientName))
    const dietNotices = ingNames.some(needsGlutenFreeLabel)
      ? recipeDietNotices(ingNames, isCoeliacHousehold((await restrictionsFor(ctx)).restrictions))
      : []
    const details = recipeDetailsSummary({
      name: recipe.name,
      prepTime: recipe.prepTime,
      totalTime: recipe.totalTime,
      activeTime: recipe.activeTime,
      servings: recipe.servings,
      scaledTo: target,
      ingredients: ingredientList,
      steps,
      tips: recipe.tips,
      sourceUrl: recipe.sourceUrl,
    })
    const withNotices = dietNotices.length > 0 ? `${details}\nAviso para este hogar: ${dietNotices.join('. ')}.` : details
    // PRO-349: which recipe this is, so «la receta de hoy» is never answered from another one.
    const summary = menuSlot ? `Es la receta del menu (${menuSlot}).\n${withNotices}` : withNotices

    return {
      data: {
        id: recipe.id,
        name: recipe.name,
        prepTime: recipe.prepTime,
        totalTime: recipe.totalTime ?? null,
        activeTime: recipe.activeTime ?? null,
        servings: target ?? recipe.servings ?? null,
        baseServings: recipe.servings ?? null,
        meals: recipe.meals,
        seasons: recipe.seasons,
        steps,
        sourceUrl: recipe.sourceUrl ?? null,
        ingredients: scaledRows,
        dietNotices,
      },
      summary,
      uiHint: 'recipe',
    }
  },
}

/**
 * 2026-11-19: the recipes that meet every condition of a search («calabacín
 * rápida menos de 30 minutos», «cena ligera sin arroz sin garbanzos»), never
 * one the household can't or won't eat (allergies and diet of everyone,
 * dislikes with whole categories, the ficha), in season. Before, the whole
 * sentence had to be inside a name or a tag: 10 of 17 searches found nothing.
 */
async function searchRecipesByCriteria(ctx: SkillContext, c: RecipeCriteria): Promise<SkillResult> {
  const own = await restrictionsFor(ctx)
  const restrictions = await withHouseholdRestrictions(own.restrictions, ctx.userId, ctx.db).catch(() => own.restrictions)
  const ficha = await loadFichaMenuConstraints(ctx.userId, { db: ctx.db }).catch(() => null)
  const dislikes = ficha ? withFichaFilters({ dislikes: own.dislikes, availableEquipment: undefined }, ficha).dislikes : own.dislikes
  const rules = compileRestrictions(restrictions, dislikes)
  const season = detectSeason()
  const pool = (await loadMatchableRecipes(ctx.userId, ctx.db)).filter(
    (r: any) => !violatesRestrictions(r, rules) && (!r.seasons?.length || r.seasons.includes(season)),
  )
  const { exact, partial } = searchByCriteria(pool as any[], c)
  const said = [
    c.words.length ? c.words.join(' ') : '',
    c.meal ? MEAL_LABEL[c.meal] : '',
    c.light ? 'ligera' : '',
    c.maxMinutes != null ? `≤ ${c.maxMinutes} min` : '',
    ...c.exclude.map((x) => `sin ${x}`),
  ].filter(Boolean).join(', ')
  const line = (r: any) => `${r.name} (${r.totalTime ?? r.prepTime ?? '?'} min)`
  if (exact.length) {
    const top = exact.slice(0, 5)
    return { data: top, summary: `Recetas que cumplen todo (${said}): ${top.map(line).join(', ')}`, uiHint: 'recipe' }
  }
  if (partial.length) {
    const top = partial.slice(0, 5)
    return { data: top, summary: `Ninguna cumple todo (${said}). Lo más cercano, con parte de lo que pide: ${top.map(line).join(', ')}. Díselo así.`, uiHint: 'recipe' }
  }
  return { data: [], summary: `No hay ninguna receta con todo eso (${said}). Díselo y pregúntale qué condición puede soltar.`, uiHint: 'recipe' }
}

export const suggestRecipes: SkillDefinition = {
  name: 'suggest_recipes',
  description: 'Busca recetas del catálogo y del hogar con varias condiciones a la vez, todas juntas: ingredientes o tipo de plato («calabacín», «pollo al horno»), tiempo («rápida», «menos de 30 minutos»), «sin X» (también familias: «sin legumbres», «sin arroz»), «ligera», comida o cena, postre. Nunca devuelve lo que la casa no puede o no quiere comer. Hasta 5 recetas.',
  parameters: {
    type: 'object',
    properties: {
      criteria: { type: 'string', description: 'Lo que pide, con sus palabras: "calabacín rápida menos de 30 minutos", "cena ligera sin arroz sin garbanzos".' },
      mealType: { type: 'string', description: 'Tipo de comida: breakfast, lunch, dinner' },
      maxMinutes: { type: 'number', description: 'Opcional: minutos como mucho, en total.' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Opcional: lo que no debe llevar ("arroz", "legumbres").' },
      light: { type: 'boolean', description: 'Opcional: true si la quiere ligera.' },
    },
    required: [],
  },
  async handler(params: { criteria?: string; mealType?: string; maxMinutes?: number; exclude?: string[]; light?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    const c = parseRecipeCriteria(params.criteria)
    if (typeof params.maxMinutes === 'number' && params.maxMinutes > 0) c.maxMinutes = Math.min(c.maxMinutes ?? Infinity, params.maxMinutes)
    for (const x of Array.isArray(params.exclude) ? params.exclude : []) if (typeof x === 'string' && x.trim() && !c.exclude.includes(x.trim())) c.exclude.push(x.trim())
    if (params.light) c.light = true
    if (params.mealType && MEAL_KEYS.includes(params.mealType)) c.meal = params.mealType as Meal
    return searchRecipesByCriteria(ctx, c)
  },
}

// «Con lo que tengo» (PRO-31): same search as the /recipes filter.
// «¿Qué hago hoy con lo que tengo?» (PRO-222, D-069): 3 recipes with their
// time and what is missing, never one that breaks allergies, diet, dislikes
// or the week's menu vetoes; from a fridge photo it first says what it saw;
// `pickRecipeId` puts the chosen one in the day, with or without a menu.
const WHAT_I_HAVE_MAX = 8
const WHAT_I_HAVE_RESULTS = 3

/** The meal still ahead today in Madrid: lunch until 16:00, then dinner. */
function nextMealNow(now: Date = new Date()): 'lunch' | 'dinner' {
  return madridParts(now).hour < 16 ? 'lunch' : 'dinner'
}

/** «pollo, calabacín y arroz». */
function listEs(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

export const cookWithWhatIHave: SkillDefinition = {
  name: 'cook_with_what_i_have',
  description:
    'Cuando el usuario dice lo que tiene y pregunta que puede cocinar ("que hago hoy con lo que tengo", "tengo pollo, calabacin y arroz", "que hago con un pollo y unos pimientos") o manda una foto de su nevera o despensa: propone 3 recetas suyas o del catalogo que usen esos ingredientes, ordenadas por cuantos usan, con su tiempo y lo que faltaria (sin contar sal, aceite, agua, pimienta, harina). Nunca devuelve recetas que choquen con sus alergias, dieta, lo que no le gusta o lo vetado en el menu de la semana. Funciona sin menu de la semana. Si los ingredientes los has visto en una foto, pasa fromPhoto: true y la respuesta empieza diciendo lo que has visto, para que lo pueda corregir. Cuando elija una, llama otra vez solo con pickRecipeId (el id que te devolvi) y, si lo dice, day y meal; por defecto la pongo en la proxima comida de hoy (comida hasta las 16:00, si no cena).',
  parameters: {
    type: 'object',
    properties: {
      ingredients: {
        type: 'array',
        items: { type: 'string' },
        description: `Ingredientes que tiene, hasta ${WHAT_I_HAVE_MAX}, en singular y sin cantidades (ej: ["pollo", "calabacin", "arroz"])`,
      },
      fromPhoto: { type: 'boolean', description: 'true si los ingredientes los has sacado de una foto que te ha mandado (nevera, despensa).' },
      pickRecipeId: { type: 'string', description: 'Id de la receta que ha elegido de las que propuse: la pongo en el dia.' },
      day: DAY_PROP,
      meal: { type: 'string', description: 'Con pickRecipeId: breakfast, lunch, snack o dinner. Por defecto, la proxima comida de hoy.' },
    },
    required: [],
  },
  async handler(
    params: { ingredients?: string[] | string; fromPhoto?: boolean; pickRecipeId?: string; day?: string; meal?: string },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    if (params.pickRecipeId) return pickWhatIHaveRecipe(params, ctx)
    const raw = Array.isArray(params.ingredients) ? params.ingredients : String(params.ingredients ?? '').split(/,| y /)
    const names = [...new Set(raw.map((n) => String(n).trim()).filter(Boolean))]
    if (names.length === 0) {
      return { data: [], summary: 'Dime que ingredientes tienes (o mandame una foto de la nevera) y busco que puedes cocinar hoy.', uiHint: 'text' }
    }
    const used = names.slice(0, WHAT_I_HAVE_MAX)
    // From a photo, say first what was seen so the user can correct it.
    const seen = params.fromPhoto === true ? `En la foto he visto: ${listEs(used)}. Si me he equivocado en algo, dimelo y lo cambio. ` : ''
    const ignored = names.length > WHAT_I_HAVE_MAX ? ` (solo miro los ${WHAT_I_HAVE_MAX} primeros)` : ''
    // The week's vetoes count too (PRO-197's lesson: every proposal goes through the same filters as the menu).
    const menu = await menuOfWeek(ctx, getWeekStart())
    const banned = new Set<string>(((menu?.bannedRecipeIds as string[] | null) ?? []).filter(Boolean))
    const hits = await findRecipesWithWhatIHave(ctx.userId, used.map((name) => ({ name })), ctx.db, WHAT_I_HAVE_RESULTS, {
      excludeIds: banned,
      maxChosen: WHAT_I_HAVE_MAX,
    })
    if (hits.length === 0) {
      return {
        data: { seen: params.fromPhoto ? used : undefined, recipes: [] },
        summary: `${seen}No he encontrado recetas con ${listEs(used)} que encajen contigo${ignored}.`,
        uiHint: 'text',
      }
    }
    const recipesOut = hits.map((h) => ({
      id: h.recipe.id,
      name: h.recipe.name,
      totalTime: (h.recipe.row as { totalTime?: number | null }).totalTime ?? null,
      uses: h.uses,
      missing: h.missing,
    }))
    const lines = recipesOut.map((h) => {
      const time = h.totalTime ? `${h.totalTime} min; ` : ''
      const falta = h.missing.length === 0 ? 'no te falta nada mas' : `te faltaria ${h.missing.join(', ')}`
      return `${h.name} (${time}usa ${listEs(h.uses)}; ${falta})`
    })
    return {
      data: { seen: params.fromPhoto ? used : undefined, recipes: recipesOut },
      summary: `${seen}Con lo que tienes${ignored}: ${lines.join('; ')}. Si eliges una, la pongo en el dia.`,
      uiHint: 'recipe',
    }
  },
}

/** `pickRecipeId`: the chosen recipe goes into the day's meal; a week without a menu gets one with just that dish. */
async function pickWhatIHaveRecipe(
  params: { pickRecipeId?: string; day?: string; meal?: string },
  ctx: SkillContext,
): Promise<SkillResult> {
  const { db, userId } = ctx
  const meal = params.meal && MEAL_KEYS.includes(params.meal) ? params.meal : nextMealNow()
  const t = menuDayParam({ day: params.day ?? 'hoy' })
  if (isMenuDayError(t)) return { data: null, summary: t.error, uiHint: 'text' }
  const [recipe] = await db
    .select({ id: recipes.id, name: recipes.name })
    .from(recipes)
    .where(and(await visibleWhere(ctx), eq(recipes.id, params.pickRecipeId!)))
    .limit(1)
  if (!recipe) return { data: null, summary: 'No encuentro esa receta; no he cambiado nada.', uiHint: 'text' }
  const slotLabel = `${MEAL_LABEL[meal]} del ${t.label}`
  const menu = await menuOfWeek(ctx, t.weekStart)
  if ((menu?.bannedRecipeIds as string[] | undefined)?.includes(recipe.id)) {
    return { data: null, summary: `"${recipe.name}" esta vetada esta semana; no la he puesto.`, uiHint: 'text' }
  }
  // A locked meal changes too when asked (PRO-1175): the lock only keeps it when the week is redone.
  const dish = { kind: 'recipe' as const, recipeId: recipe.id, recipeName: recipe.name }
  let saved: { days?: unknown } | undefined
  if (menu) {
    const days = menu.days as DayMenu[]
    days[t.dayIndex] = { ...(days[t.dayIndex] ?? {}), [meal]: slotWithDishes(days[t.dayIndex]?.[meal], [dish]) }
    ;[saved] = await db.update(menus).set({ days, skippedDays: unskipDay(menu.skippedDays, t.dayIndex) }).where(eq(menus.id, menu.id)).returning()
  } else {
    // No menu this week: one with only this dish (the rest stays empty).
    const days: DayMenu[] = Array.from({ length: 7 }, () => ({}))
    days[t.dayIndex] = { [meal]: { dishes: [dish] } }
    const householdId = await getPrimaryHouseholdId(userId, db)
    ;[saved] = await db
      .insert(menus)
      .values({ userId, householdId, weekStart: t.weekStart, days, locked: {}, bannedRecipeIds: [], skippedDays: [] })
      .returning()
  }
  if (dishNow(saved, t.dayIndex, meal) !== recipe.name) return notSaved(slotLabel)
  return {
    data: { ...(saved as object), change: changeOf(t, meal, recipe.name), recipeId: recipe.id },
    summary: `Hecho: "${recipe.name}" en la ${slotLabel}. Sus ingredientes ya salen en la lista de la compra.${reactivatedLine(menu, t)}${repeatNote(saved?.days as DayMenu[] ?? [], t.weekStart, t.dayIndex, meal, { recipeId: recipe.id, name: recipe.name })}`,
    uiHint: 'menu',
  }
}

export const searchRecipes: SkillDefinition = {
  name: 'search_recipes',
  description: 'Busca recetas por nombre. Si la búsqueda trae condiciones (tiempo, «sin X», ligera, comida o cena), busca con todas a la vez como suggest_recipes.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Texto a buscar en el nombre de la receta' },
    },
    required: ['query'],
  },
  async handler(params: { query: string }, ctx: SkillContext): Promise<SkillResult> {
    const { db } = ctx
    // «calabacín rápida menos de 30 minutos»: conditions, not a name (2026-11-19).
    const criteria = parseRecipeCriteria(params.query)
    if (hasConditions(criteria)) return searchRecipesByCriteria(ctx, criteria)

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

// 4. ── get_my_recipes ──────────────────────────────────────
export const getMyRecipes: SkillDefinition = {
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
