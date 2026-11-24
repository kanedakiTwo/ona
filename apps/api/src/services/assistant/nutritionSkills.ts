// Mimo's nutrition tools: advice, food health, substitutions, variety, eating window, balance. Split out of skills.ts (PRO-400).
import { and, eq, desc, ilike, or, inArray } from 'drizzle-orm'
import { menus, recipes, recipeIngredients, recipeSteps, ingredients, userNutrientBalance, menuLogs } from '../../db/schema.js'
import { nutrientsToPercentages, TARGET_MACROS, recipeDishesOf } from '@ona/shared'
import { type NutrientBalance } from '@ona/shared'
import { resolveScope, scopeWhere } from '../scopeResolver.js'
import { withHouseholdRestrictions } from '../householdAllergies.js'
import { hasMilkAllergy } from '../dietaryRestrictions.js'
import { type SkillDefinition, type SkillContext, type SkillResult } from './types.js'
import { getWeekStart, menuOfWeek, visibleWhere, restrictionsFor } from './skillHelpers.js'

export const nutritionAdvice: SkillDefinition = {
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


// 7. ── evaluate_food_health ────────────────────────────────
export const evaluateFoodHealth: SkillDefinition = {
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
/** PRO-312: what suggest_substitution tells the model when the household has a milk allergy. */
export const MILK_ALLERGY_SUBSTITUTION =
  'ALERGIA A LA LECHE en este hogar: nunca propongas ningun lacteo, tampoco sin lactosa (leche, nata, queso, yogur, kefir o mantequilla sin lactosa), ni ghee ni mantequilla. Propon AOVE, bebida de avena, soja o arroz, crema de verduras o de patata, frutos secos o semillas (si no hay alergia a ellos), harinas integrales, caldo casero.'
export const suggestSubstitution: SkillDefinition = {
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
    // PRO-312 (Seguridad): with a milk allergy anywhere in the household (or
    // named in this call), lactose-free dairy, butter and ghee are not swaps.
    const household = await restrictionsFor(ctx)
      .then((own) => withHouseholdRestrictions(own.restrictions, ctx.userId, db))
      .catch(() => [] as string[])
    const milkAllergy = hasMilkAllergy([...household, ...(params.restriction ? [params.restriction] : [])])
    return {
      data: params,
      summary: `El usuario quiere sustituir "${params.ingredient}"${params.restriction ? ` (restriccion: ${params.restriction})` : ''}.${recipeContext} Sugiere 1-2 alternativas concretas alineadas con los principios de Mimoia. Importante: NUNCA propongas margarina, aceites vegetales refinados (girasol, soja, maiz, colza), edulcorantes artificiales ni sirope de maiz. ${milkAllergy ? MILK_ALLERGY_SUBSTITUTION : 'Si propon AOVE, ghee, mantequilla, fermentados, frutos secos, semillas, harinas integrales, hueso/caldo casero, fruta entera en lugar de zumo.'}`,
      uiHint: 'recipe',
    }
  },
}

// 9. ── get_variety_score ───────────────────────────────────
const VEG_RE = /(verdura|hoja|espinaca|kale|acelga|brocoli|coliflor|tomate|cebolla|ajo|pimiento|calabac|berenjena|zanahoria|remolacha|esparrago|aguacate|champin|seta|alcachofa|pepino|rucula|canon|lechuga|repollo|col|puerro|apio|nabo|rabano|calabaza|judia_verde|guisante)/i
const PROT_RE = /(pollo|pavo|ternera|cerdo|cordero|huevo|salmon|atun|sardina|merluza|bacalao|gamba|mejillon|pulpo|tofu|tempeh|legumbre|lenteja|garbanzo|alubia|conejo|pato|trucha|caballa)/i

export const getVarietyScore: SkillDefinition = {
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
export const getEatingWindow: SkillDefinition = {
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

export const getWeekBalance: SkillDefinition = {
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
