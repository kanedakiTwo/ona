// Mimo's menu tools: today's and the week's menu, nutrition, generating a week, history. Split out of skills.ts (PRO-400).
import { eq, desc, inArray } from 'drizzle-orm'
import { menus, recipes, users, userNutrientBalance, menuLogs } from '../../db/schema.js'
import { nutrientsToPercentages, TARGET_MACROS, pastDayIndexes } from '@ona/shared'
import { type DayMenu, type Meal, type NutrientBalance, type WeekPlan } from '@ona/shared'
import { fridgeTextOf, parseWeekPlanAnswer, weekPlanIsEmpty, weekPlanSchema } from '@ona/shared'
import { describeWeekPlan } from '../weekPlan.js'
import { generateMenu } from '../menuGenerator.js'
import { calculateMenuCaloriesFromDB } from '../calorieCalculator.js'
import { calculateMenuNutrientsFromDB } from '../nutrientCalculator.js'
import { updateBalance } from '../nutrientBalance.js'
import { getSummary } from '../advisor.js'
import { getPrimaryHouseholdId, resolveScope, scopeWhere } from '../scopeResolver.js'
import { mealLinesForDay } from '../menuText.js'
import { cookedRecipeIds, householdDiners, mealLinesWithFacts, type RecipeTimes } from './menuFacts.js'
import { addDays, madridParts } from '../madridTime.js'
import { DAY_PROP, dateLabel, isMenuDayError, menuDayOf } from './menuDay.js'
import { generationSkips, loadPreviousWeek, withoutPastMeals } from '../menuWeek.js'
import { placeSignupDishes, type PlacedDish, type SignupDish } from '../signupFirstMenu.js'
import { withMenuOnlyRestrictions } from '../menuOnlyRestrictions.js'
import { saidRestrictionsLine } from '../saidRestrictions.js'
import { enqueuePrepAlertsForMenu } from '../notificationScheduler.js'
import { type SkillDefinition, type SkillContext, type SkillResult } from './types.js'
import { HEALTH_CONSENT_SKILL_REPLY, WHATSAPP_HEALTH_DATA_REPLY } from '../healthConsent.js'
import { evaluateAndSaveMenuFit, menuFitSummary } from '../menuFit.js'
import { weekHolidaySummary } from '../menuHolidays.js'
import { untrustedText, getWeekStart, menuOfWeek, menuDayParam, saidForMenu, RESTRICTIONS_SAID_PROP } from './skillHelpers.js'

/**
 * PRO-183: what the menu tools need to say the same as the app — the
 * household's diners (servings per meal) and each cooked recipe's minutes.
 * Two reads; if they fail the tools still answer with the bare menu.
 */
async function menuFactsFor(ctx: SkillContext, days: readonly (DayMenu | null | undefined)[]): Promise<{ times: Map<string, RecipeTimes>; diners: number } | null> {
  try {
    const [u] = await ctx.db
      .select({ adults: users.adults, kidsCount: users.kidsCount })
      .from(users)
      .where(eq(users.id, ctx.userId))
      .limit(1)
    const ids = cookedRecipeIds(days)
    const rows: Array<{ id: string } & RecipeTimes> = ids.length
      ? await ctx.db
          .select({ id: recipes.id, totalTime: recipes.totalTime, activeTime: recipes.activeTime, prepTime: recipes.prepTime })
          .from(recipes)
          .where(inArray(recipes.id, ids))
      : []
    return { times: new Map((rows ?? []).map((r) => [r.id, r])), diners: householdDiners(u) }
  } catch (err: any) {
    console.warn('[assistant] menu facts unavailable:', err?.message ?? err)
    return null
  }
}

export const getTodaysMenu: SkillDefinition = {
  name: 'get_todays_menu',
  description: 'Obtiene el menu del dia indicado (o de hoy si no se especifica): por comida, las raciones que muestra la app y, por plato, los minutos en total y de trabajo. Pasa day con las palabras del usuario ("mañana", "el sábado", "el martes de la semana que viene") o la fecha.',
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
    const facts = mealLinesForDay(day).length > 0 ? await menuFactsFor(ctx, days) : null
    const meals = facts ? mealLinesWithFacts(days, t.dayIndex, facts.times, facts.diners) : mealLinesForDay(day)

    const summary = meals.length > 0
      ? `Menu del ${t.label}: ${meals.join(facts ? '; ' : ', ')}`
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
export const getWeeklyMenu: SkillDefinition = {
  name: 'get_weekly_menu',
  description: 'Obtiene el menu de la semana entera (esta o, con nextWeek, la que viene), dia a dia, con las raciones de cada comida y los minutos de cada plato. Usalo cuando pida ver el menu de la semana; para un solo dia usa get_todays_menu. Una sola llamada, nunca get_todays_menu dia a dia.',
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
    const planned = days.some((d, i) => !skipped.has(i) && mealLinesForDay(d).length > 0)
    const facts = planned ? await menuFactsFor(ctx, days) : null
    for (let i = 0; i < 7; i++) {
      const label = menuDayOf(weekStart, i).label
      if (skipped.has(i)) {
        lines.push(`${label}: sin cocinar`)
        continue
      }
      const meals = facts ? mealLinesWithFacts(days, i, facts.times, facts.diners) : mealLinesForDay(days[i])
      if (meals.length > 0) lines.push(`${label}: ${meals.join(facts ? '; ' : ', ')}`)
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

export const getWeeklyNutrition: SkillDefinition = {
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

/** True when any slot of the week has a dish or a note. */
export function weekHasDishes(days: DayMenu[] | undefined): boolean {
  return (days ?? []).some((d) =>
    Object.values(d ?? {}).some((slot: any) => Array.isArray(slot?.dishes) && slot.dishes.length > 0),
  )
}

/**
 * PRO-225: the week-only answers to «¿Alguna comida fuera?» / «¿Viene
 * alguien?». Structured fields from the model win; the user's raw text is
 * read as a fallback. Out-of-range entries are dropped. Undefined when empty.
 */
export function weekPlanFromParams(
  params: { diners?: unknown; mealsOut?: unknown; guests?: unknown; fridge?: unknown; fridge_text?: unknown; fridge_health?: unknown; fridge_restrictions?: unknown; answer?: unknown } | undefined,
): WeekPlan | undefined {
  const fridgeHealth = params?.fridge_health === 'save' || params?.fridge_health === 'skip' ? params.fridge_health : undefined
  // PRO-275: «esta semana somos dos» → the whole week; out of range is dropped.
  const diners = typeof params?.diners === 'number' && Number.isInteger(params.diners) && params.diners >= 1 && params.diners <= 24 ? params.diners : undefined
  const structured = weekPlanSchema.safeParse({
    diners,
    mealsOut: Array.isArray(params?.mealsOut) ? params!.mealsOut : undefined,
    guests: Array.isArray(params?.guests) ? params!.guests : undefined,
    fridge: Array.isArray(params?.fridge) ? (params!.fridge as unknown[]).filter((f) => typeof f === 'string' && f.trim()).slice(0, 20) : undefined,
    // PRO-295: the fridge answer as the person said it, read by Claude.
    fridgeText: typeof params?.fridge_text === 'string' && params.fridge_text.trim() ? params.fridge_text.slice(0, 600) : undefined,
    fridgeAnswer: fridgeHealth
      ? {
          decision: fridgeHealth,
          ...(Array.isArray(params?.fridge_restrictions)
            ? { restrictions: (params!.fridge_restrictions as unknown[]).filter((r): r is string => typeof r === 'string' && r.trim().length > 0 && r.length <= 40).slice(0, 8) }
            : {}),
        }
      : undefined,
  })
  let plan: WeekPlan | undefined = structured.success ? structured.data : undefined
  if ((plan?.mealsOut?.length ?? 0) === 0 && (plan?.guests?.length ?? 0) === 0 && typeof params?.answer === 'string' && params.answer.trim()) {
    const { mealsOut: _m, guests: _g, ...fridgePart } = plan ?? {}
    plan = { ...(diners ? { diners } : {}), ...parseWeekPlanAnswer(params.answer), ...fridgePart }
  }
  if (plan && !plan.fridge?.length) delete plan.fridge
  if (plan && !plan.fridgeText) delete plan.fridgeText
  if (plan && !plan.fridgeAnswer) delete plan.fridgeAnswer
  if (plan && !plan.mealsOut?.length) delete plan.mealsOut
  if (plan && !plan.guests?.length) delete plan.guests
  return weekPlanIsEmpty(plan) ? undefined : plan
}

/**
 * PRO-295: the fridge gate in Mimo's words. Null = generate (with
 * `weekPlan.fridgeItems` filled); otherwise what Mimo must ask or say first.
 */
export async function fridgeGateForSkill(ctx: SkillContext, weekPlan: WeekPlan | undefined): Promise<{ plan: WeekPlan | undefined; stop: string | null; saved?: string }> {
  const text = fridgeTextOf(weekPlan)
  if (!text) return { plan: weekPlan, stop: null }
  const channel = ctx.channel === 'whatsapp' ? 'whatsapp' : 'chat'
  const { prepareFridgeForMenu } = await import('../fridgeReader.js')
  const gate = await prepareFridgeForMenu(ctx.userId, text, weekPlan?.fridgeAnswer, channel)
  if (gate.status === 'ready') {
    const saved = gate.savedRestrictions.length ? ` Guardada como restriccion de su dieta: ${gate.savedRestrictions.join(', ')}.` : ''
    return { plan: { ...weekPlan, fridgeItems: gate.items }, stop: null, ...(saved ? { saved } : {}) }
  }
  const what = gate.restrictions.length ? gate.restrictions.join(', ') : 'una alergia o intolerancia (no se cual exactamente)'
  const quote = gate.quote ? ` (dijo: «${untrustedText(gate.quote, 160)}»)` : ''
  const again = 'Vuelve a llamar a generate_weekly_menu con el mismo fridge_text y fridge_health: "save" (guardarla) o "skip" (no guardarla)'
  if (gate.status === 'ask') {
    return {
      plan: weekPlan,
      stop: `Menu NO generado todavia. En lo de la nevera habla de ${what}${quote}. Preguntale, en una frase corta, si quieres que lo guardes como restriccion de su dieta para todos los menus.${gate.restrictions.length ? '' : ' Si dice que si, pregunta cual es y pasala en fridge_restrictions.'} ${again}.${ctx.channel === 'whatsapp' ? ' Por WhatsApp no guardas datos de salud: si quiere guardarla, tendra que añadirla en su perfil de la web.' : ''}`,
    }
  }
  if (gate.status === 'whatsapp_no_health') {
    return { plan: weekPlan, stop: `Menu NO generado. ${WHATSAPP_HEALTH_DATA_REPLY} Dile esto y preguntale si genera ya el menu sin guardarlo (fridge_health: "skip") o prefiere añadirlo antes en su perfil.` }
  }
  return { plan: weekPlan, stop: `Menu NO generado. ${HEALTH_CONSENT_SKILL_REPLY} Dile esto y preguntale si genera ya el menu sin guardarlo (fridge_health: "skip") o prefiere dar antes su consentimiento en el perfil.` }
}

export const generateWeeklyMenu: SkillDefinition = {
  name: 'generate_weekly_menu',
  description: 'Genera un menu semanal completo (todos los dias) y lo guarda. Solo cuando el usuario pida un menu nuevo para la semana entera; NUNCA para cambiar o poner uno o varios platos (eso es swap_meal / add_dish / set_meal_note). Con nextWeek=true lo genera para la semana que viene (por ejemplo si el usuario dice "la semana que viene" o acepta la propuesta del domingo). Si esa semana ya tiene platos no la toca y te lo dice: solo con replaceExisting=true, cuando el usuario ha confirmado que quiere rehacer la semana entera.',
  parameters: {
    type: 'object',
    properties: {
      nextWeek: { type: 'boolean', description: 'true para generar el menu de la semana que viene en lugar de la actual.' },
      replaceExisting: { type: 'boolean', description: 'true solo si el usuario ha confirmado que quiere rehacer entera una semana que ya tiene platos.' },
      diners: { type: 'integer', minimum: 1, maximum: 24, description: 'Cuantos comen en casa toda esa semana, cuando el usuario dice que solo esta semana son otro numero («esta semana somos dos»). Pone esos comensales en todas las comidas de esa semana; la plantilla no cambia. Si es para siempre, usa antes update_weekly_template. Los dias con guests mandan sobre esto.' },
      mealsOut: {
        type: 'array',
        description: 'Comidas que esa semana se hacen fuera de casa (respuesta a «¿Alguna comida fuera de casa esta semana?»). Se quitan solo de esa semana; la plantilla no cambia. Sin meal = el dia entero.',
        items: {
          type: 'object',
          properties: {
            day: { type: 'integer', minimum: 0, maximum: 6, description: '0 = lunes … 6 = domingo' },
            meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
          },
          required: ['day'],
        },
      },
      guests: {
        type: 'array',
        description: 'Dias con invitados (respuesta a «¿Viene alguien?»): cuantos comen en total ese dia o esa comida, p. ej. «el sabado somos 6» → { day: 5, diners: 6 }. Solo esa semana.',
        items: {
          type: 'object',
          properties: {
            day: { type: 'integer', minimum: 0, maximum: 6, description: '0 = lunes … 6 = domingo' },
            meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
            diners: { type: 'integer', minimum: 1, maximum: 24 },
          },
          required: ['day', 'diners'],
        },
      },
      fridge_text: {
        type: 'string',
        description: 'Lo que le queda en la nevera (respuesta a «¿Qué te queda en la nevera?»), el texto entero tal como lo dice, o lo que ves en su foto en una frase. El sistema lo lee: apunta en la despensa solo la comida, con cantidad, y si habla de una alergia o intolerancia no genera hasta que contestes con fridge_health.',
      },
      fridge_health: {
        type: 'string',
        enum: ['save', 'skip'],
        description: 'Solo cuando la herramienta te ha pedido preguntar por una alergia o intolerancia de la nevera: "save" si quiere guardarla como restriccion de su dieta, "skip" si no.',
      },
      fridge_restrictions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Con fridge_health "save", si la persona aclara que guardar: ["sin lactosa"].',
      },
      fridge: {
        type: 'array',
        items: { type: 'string' },
        description: 'Obsoleto: usa fridge_text.',
      },
      answer: { type: 'string', description: 'El texto tal cual del usuario cuando contesta a las preguntas de antes de planificar (p. ej. «el jueves cenamos fuera y el sabado somos 6»). Se usa solo si no pasas mealsOut ni guests.' },
      only_favorites: { type: 'boolean', description: 'true cuando pide la semana con sus favoritas («hazme la semana con mis favoritas»): los platos salen de las recetas que el hogar tiene en favoritos; lo que no llenen sale del catalogo y te digo cuantos.' },
      restrictions_said: RESTRICTIONS_SAID_PROP,
    },
    required: [],
  },
  async handler(
    params: { nextWeek?: boolean; replaceExisting?: boolean; diners?: number; mealsOut?: WeekPlan['mealsOut']; guests?: WeekPlan['guests']; fridge?: string[]; fridge_text?: string; fridge_health?: 'save' | 'skip'; fridge_restrictions?: string[]; answer?: string; only_favorites?: boolean; restrictions_said?: string[] },
    ctx: SkillContext,
  ): Promise<SkillResult> {
    const { userId, db } = ctx
    const weekStart = getWeekStart(params?.nextWeek === true ? 1 : 0)
    const weekPlan = weekPlanFromParams(params)

    // Same promises as POST /menu/generate: locked slots, vetoes and
    // "sin cocinar" days of the current week survive the regeneration.
    const previous = await loadPreviousWeek(userId, weekStart, db)

    // A week that already has dishes is never remade without an explicit,
    // confirmed request: asking for one dish used to regenerate the whole
    // week and Laura lost her planned leftovers (PRO-63, 2026-10-11).
    if (params?.replaceExisting !== true && weekHasDishes(previous.days)) {
      return {
        // 21-nov: the menu it kept, so WhatsApp shows it («Tu menú…», never «Listo»).
        data: { weekStart, replaced: false, ...(previous.menuId ? { menuId: previous.menuId } : {}) },
        summary: `No he cambiado nada: la semana del ${dateLabel(weekStart)} ya tiene menu. Para cambiar o poner platos concretos usa swap_meal, add_dish o set_meal_note. Solo si el usuario quiere rehacer la semana entera, confirmalo con el y vuelve a llamar con replaceExisting: true.`,
        uiHint: 'text',
      }
    }
    // PRO-295: the fridge text, read by Claude; an allergy in it stops here
    // until the person says whether to save it.
    const fridge = await fridgeGateForSkill(ctx, weekPlan)
    if (fridge.stop) return { data: { weekStart, replaced: false }, summary: fridge.stop, uiHint: 'text' }
    // PRO-1041: an allergy said and not saved goes into this menu anyway.
    const said = await saidForMenu(ctx, params?.restrictions_said)
    const result = await withMenuOnlyRestrictions(said?.apply ?? [], () =>
      generateAndSaveWeek(ctx, weekStart, previous, undefined, fridge.plan, params?.only_favorites === true),
    )
    const lines = [result.summary, fridge.saved?.trim(), said && saidRestrictionsLine(said, ctx.channel)].filter(Boolean)
    return { ...result, summary: lines.join('\n') }
  },
}

/**
 * Generate and save one week (generate_weekly_menu, and complete_onboarding
 * for each first-menu week). `fromDate` (PRO-244, the sign-up day): days
 * before it are not generated.
 */
export async function generateAndSaveWeek(
  ctx: SkillContext,
  weekStart: string,
  previous: Awaited<ReturnType<typeof loadPreviousWeek>>,
  fromDate?: string,
  /** PRO-225: meals out and guests for this week only. */
  weekPlan?: WeekPlan,
  /** PRO-377: «hazme la semana con mis favoritas». */
  onlyFavorites = false,
  /**
   * 19-nov, the WhatsApp sign-up's first menu: today's meals already gone
   * stay empty, and the dishes they make often go in (`signupFirstMenu.ts`).
   */
  signup?: { pastMeals: Meal[]; dishes: SignupDish[] },
): Promise<SkillResult & { left?: SignupDish[] }> {
    const { userId, db } = ctx
    const generated = await generateMenu(
      userId, weekStart, undefined, db,
      previous.locked, previous.days, previous.bannedRecipeIds, generationSkips(previous.skippedDays, weekStart, fromDate),
      weekPlan,
      { onlyFavorites },
    )
    const { favoritesShort } = generated
    let days = generated.days
    let placedDishes: PlacedDish[] = []
    let left: SignupDish[] | undefined
    if (signup) {
      days = withoutPastMeals(days, weekStart, fromDate, signup.pastMeals)
      const placing = placeSignupDishes(days, signup.dishes, previous.locked)
      days = placing.days
      placedDishes = placing.placed
      left = placing.left
    }

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

    // Menú inteligente a la sombra (PRO-255), as in POST /menu/generate.
    const { startShadowPlan } = await import('../menuPlannerShadow.js')
    startShadowPlan({
      menuId: menu.id,
      userId,
      weekStart,
      days,
      locked: previous.locked,
      bannedRecipeIds: previous.bannedRecipeIds,
      skippedDays: previous.skippedDays,
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
      return meals.length > 0 ? `${dayNames[i]}: ${meals.join(', ')}` : null
    }).filter(Boolean).join('; ')
    const past = fromDate ? pastDayIndexes(weekStart, fromDate) : []
    const firstDay = fromDate && past.length < 7 ? dayNames[past.length] : null
    // The sign-up's start, only on the week the first day falls in.
    const startsHere = !!fromDate && firstDay !== null && addDays(weekStart, past.length) === fromDate.slice(0, 10)
    const signupFrom = signup && startsHere ? signupStartLine(fromDate!, firstDay!, signup.pastMeals) : null
    const pastLine = signupFrom
      ? ` ${signupFrom}`
      : past.length > 0 && firstDay
        ? ` Empieza hoy (${firstDay}): los dias que ya han pasado no se han generado.`
        : ''

    // «Cuánto ha acertado» (PRO-155): Mimo tells it following the prompt's
    // guide — never on the sign-up's first menu (19-nov: it opened with «no
    // he conseguido acercarme»): there, the dishes they make often.
    const fit = await evaluateAndSaveMenuFit({ userId, menuId: menu.id, days }, db)
    const fitLine = signup ? signupDishesLine(placedDishes, weekStart) : menuFitSummary(fit)
    // Festivos (PRO-226): Mimo mentions them.
    const holidayLine = await weekHolidaySummary(userId, weekStart)

    const planLine = weekPlan ? `\nSolo esta semana (la plantilla no cambia): ${describeWeekPlan(weekPlan)}.` : ''
    const favLine = !onlyFavorites
      ? ''
      : favoritesShort
        ? `\nCon sus favoritas. Tenia pocas: ${favoritesShort} ${favoritesShort === 1 ? 'plato es nuevo (del catalogo)' : 'platos son nuevos (del catalogo)'}; diselo.`
        : '\nTodos los platos salen de sus favoritas.'
    return {
      data: { ...menu, fit, ...(onlyFavorites ? { favoritesShort: favoritesShort ?? 0 } : {}) },
      summary: `Menu generado para la semana del ${weekStart}.${pastLine} ${menuSummary}${planLine}${favLine}${fitLine ? `\n${fitLine}` : ''}${holidayLine ? `\n${holidayLine}` : ''}`,
      uiHint: 'menu',
      ...(left ? { left } : {}),
    }
}

const MEAL_NAME_ES: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }

/** 19-nov: where the sign-up's first menu starts, for Mimo (it never talks about a meal already gone). */
function signupStartLine(fromDate: string, firstDay: string, pastMeals: readonly Meal[]): string {
  const today = madridParts(new Date()).isoDate
  if (fromDate !== today) return `Empieza mañana (${firstDay}): hoy ya no queda ninguna comida por hacer. No hables de comidas de hoy.`
  const next = (['lunch', 'dinner'] as const).find((m) => !pastMeals.includes(m))
  if (pastMeals.length === 0 || !next) return `Empieza hoy (${firstDay}).`
  return `Empieza con la ${MEAL_NAME_ES[next]} de hoy (${firstDay}): las comidas que ya han pasado no se han generado. No hables de ellas.`
}

/** 19-nov: the sign-up's dishes in the first menu, and the ones Mimo has to turn into the household's recipe. */
function signupDishesLine(placed: readonly PlacedDish[], weekStart: string): string {
  if (placed.length === 0) return 'No ha dicho platos que haga a menudo.'
  const dayNames = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
  const at = (p: PlacedDish) => `${MEAL_NAME_ES[p.meal]} del ${dayNames[p.dayIndex]}`
  const withRecipe = placed.filter((p) => p.recipeName)
  const notes = placed.filter((p) => !p.recipeName)
  const lines: string[] = []
  if (withRecipe.length) lines.push(`Sus platos de siempre, en este menu: ${withRecipe.map((p) => `${p.dish} (${p.recipeName}, ${at(p)})`).join('; ')}.`)
  for (const p of notes) {
    lines.push(`«${p.dish}» no esta en el catalogo: lo he puesto como nota en la ${at(p)}. Ahora, en este mismo turno, crea la receta de la casa con swap_meal (day "${addDays(weekStart, p.dayIndex)}", meal "${p.meal}", recipeName "${p.dish}" y newRecipe con tu version sencilla) para que sus ingredientes salgan en la lista; no se lo preguntes.`)
  }
  return lines.join('\n')
}

// 5. ── get_menu_history ────────────────────────────────────
export const getMenuHistory: SkillDefinition = {
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
