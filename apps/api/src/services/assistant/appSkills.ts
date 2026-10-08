import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import { madridWeekStart } from '../madridTime.js'
import { env } from '../../config/env.js'
import { HEALTH_CONSENT_SKILL_REPLY } from '../healthConsent.js'
import { PROACTIVE_KINDS, PROACTIVE_LABELS, type ProactiveKind } from '../whatsapp/proactive.js'

/**
 * UI-parity skills: everything the web app can do, reachable from chat
 * (WhatsApp first). Each one calls the same REST endpoint the UI calls, as
 * the user (appApi.ts), so behaviour, validation and permissions are identical.
 *
 * Conventions: dayIndex 0 = lunes … 6 = domingo; meal ∈ breakfast | lunch |
 * snack | dinner; `nextWeek: true` targets next week's menu. Summaries are
 * plain facts the model relays; lookups that find nothing return a summary
 * saying nothing changed (never a silent no-op).
 */

const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MEALS = ['breakfast', 'lunch', 'snack', 'dinner'] as const
const MEAL_ES: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }

const api = (ctx: SkillContext): AppApi => ctx.api ?? appApiFor(ctx.userId)
const text = (summary: string, data: unknown = null): SkillResult => ({ data, summary, uiHint: 'text' })
const menuDone = (summary: string, data: unknown = null): SkillResult => ({ data, summary, uiHint: 'menu' })

export function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Articles/prepositions that shouldn't count when matching ("las lentejas"). */
const STOPWORDS = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'con', 'sin', 'mi', 'mis', 'tu', 'tus', 'y', 'o', 'en', 'para', 'por'])

/**
 * Everyday words → how recipes in the catalogue are actually named
 * ("filete de vaca" → ternera / entrecot / solomillo).
 */
const FOOD_SYNONYMS: Record<string, string[]> = {
  vaca: ['ternera', 'buey', 'entrecot', 'solomillo'],
  buey: ['ternera', 'entrecot', 'solomillo'],
  filete: ['entrecot', 'solomillo', 'ternera', 'pechuga', 'lomo'],
  bistec: ['ternera', 'entrecot'],
  chuleton: ['ternera', 'entrecot'],
  carne: ['ternera', 'cerdo', 'pollo', 'cordero', 'carne'],
  cerdo: ['lomo', 'secreto', 'costilla', 'cerdo'],
  pescado: ['merluza', 'salmon', 'bacalao', 'dorada', 'lubina', 'atun'],
  marisco: ['gambas', 'langostinos', 'mejillones', 'calamar'],
  pasta: ['espaguetis', 'macarrones', 'lasana', 'pasta'],
}

/** Significant search words for a free-text dish name, expanded with synonyms. */
export function searchWords(name: string): string[] {
  const words = normalize(name).split(' ').filter((w) => w.length > 3 && !STOPWORDS.has(w))
  const out = new Set<string>()
  for (const w of words) {
    out.add(w)
    for (const syn of FOOD_SYNONYMS[w] ?? []) out.add(syn)
  }
  return [...out]
}

/** Best fuzzy name match (exact > prefix > contains > token overlap), or null. */
export function bestMatch<T>(items: readonly T[], query: string, nameOf: (t: T) => string): T | null {
  const q = normalize(query)
    .split(' ')
    .filter((w, i, all) => !(STOPWORDS.has(w) && all.length > 1))
    .join(' ')
  if (!q) return null
  const qTokens = new Set(q.split(' ').filter((t) => t.length > 2))
  let best: T | null = null
  let bestScore = 0
  for (const item of items) {
    const n = normalize(nameOf(item) ?? '')
    if (!n) continue
    let score = 0
    if (n === q) score = 100
    else if (n.startsWith(q)) score = 85
    else if (n.includes(q)) score = 70
    else if (q.includes(n)) score = 55
    else if (qTokens.size > 0) {
      const nTokens = n.split(' ')
      const hits = [...qTokens].filter((t) => nTokens.some((w) => w.startsWith(t) || t.startsWith(w))).length
      score = Math.round((hits / qTokens.size) * 50)
    }
    if (score > bestScore) {
      best = item
      bestScore = score
    }
  }
  return bestScore >= 30 ? best : null
}

const dayMealError = (dayIndex: unknown, meal: unknown): string | null => {
  if (typeof dayIndex !== 'number' || dayIndex < 0 || dayIndex > 6) return 'dayIndex debe ser 0 (lunes) a 6 (domingo).'
  if (meal !== undefined && !MEALS.includes(meal as any)) return 'meal debe ser breakfast, lunch, snack o dinner.'
  return null
}
const where = (dayIndex: number, meal?: string) =>
  meal ? `la ${MEAL_ES[meal]} del ${DAY_NAMES[dayIndex]}` : `el ${DAY_NAMES[dayIndex]}`

interface MenuDoc {
  id: string
  days: Array<Record<string, { dishes?: Array<{ kind: string; recipeId?: string; recipeName?: string; text?: string }>; servings?: number | null } | undefined>>
}

async function loadMenu(ctx: SkillContext, nextWeek?: boolean): Promise<MenuDoc | null> {
  try {
    return await api(ctx)<MenuDoc>('GET', `/menu/${ctx.userId}/${madridWeekStart(new Date(), nextWeek ? 1 : 0)}`)
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return null
    throw err
  }
}
const NO_MENU = (nextWeek?: boolean) =>
  text(`No hay menú ${nextWeek ? 'para la semana que viene' : 'esta semana'}; no he cambiado nada. Puedes generarlo con generate_weekly_menu.`)
const slotPath = (menuId: string, day: number, meal: string) => `/menu/${menuId}/day/${day}/meal/${meal}`

/**
 * A dish the user named that isn't in their recipes nor the catalogue goes on
 * the menu as a note with their own words ("pizza casera" → "Pizza casera"):
 * the menu never blocks on a missing recipe.
 */
export function dishNoteText(name: unknown): string {
  const t = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return t.charAt(0).toLocaleUpperCase('es') + t.slice(1)
}

/**
 * Resolve a recipe the user named. With `menuFirst`, "las lentejas" means the
 * lentils in THIS week's menu before any catalogue recipe with that word.
 * `approximate` = nothing matched the name itself, only one of its words
 * ("filete de vaca" → "Entrecot a la plancha").
 */
async function findRecipe(
  ctx: SkillContext,
  name: string,
  opts: { menuFirst?: boolean } = {},
): Promise<{ id: string; name: string; approximate?: boolean } | null> {
  if (opts.menuFirst) {
    const menu = await loadMenu(ctx).catch(() => null)
    const dishes = (menu?.days ?? [])
      .flatMap((d) => Object.values(d ?? {}))
      .flatMap((sl) => sl?.dishes ?? [])
      .filter((d) => d.kind === 'recipe' && d.recipeId)
    const hit = bestMatch(dishes, name, (d) => d.recipeName ?? '')
    if (hit) return { id: hit.recipeId!, name: hit.recipeName ?? name }
  }
  const cards = await api(ctx)<Array<{ id: string; name: string }>>(
    'GET',
    `/recipes?search=${encodeURIComponent(name)}&perPage=30`,
  )
  let hit = bestMatch(cards ?? [], name, (c) => c.name)
  let approximate = false
  if (!hit) {
    // "filete de vaca" → try significant words and their culinary synonyms.
    for (const w of searchWords(name).slice(0, 6)) {
      const more = await api(ctx)<Array<{ id: string; name: string }>>('GET', `/recipes?search=${encodeURIComponent(w)}&perPage=30`)
      hit = bestMatch(more ?? [], name, (c) => c.name) ?? (more?.[0] ?? null)
      if (hit) {
        approximate = true
        break
      }
    }
  }
  return hit ? { id: hit.id, name: hit.name, approximate } : null
}

const dayMealProps = {
  dayIndex: { type: 'number', description: '0=lunes … 6=domingo' },
  meal: { type: 'string', enum: [...MEALS], description: 'breakfast (desayuno), lunch (comida), snack (merienda), dinner (cena)' },
  nextWeek: { type: 'boolean', description: 'true si se refiere a la semana que viene' },
}

// ─── Menu ────────────────────────────────────────────────────────

const setMealNote: SkillDefinition = {
  name: 'set_meal_note',
  description:
    'Pone una nota libre en una comida del menu en lugar de (o junto a) los platos: "el sabado cenamos fuera", "comemos en casa de Paqui", "pizza casera". Por defecto sustituye los platos de esa comida por la nota.',
  parameters: {
    type: 'object',
    properties: {
      ...dayMealProps,
      text: { type: 'string', description: 'Texto corto de la nota (max 120)' },
      keepDishes: { type: 'boolean', description: 'true para añadir la nota sin quitar los platos existentes' },
    },
    required: ['dayIndex', 'meal', 'text'],
  },
  async handler(p, ctx) {
    const bad = dayMealError(p.dayIndex, p.meal)
    if (bad) return text(bad)
    const menu = await loadMenu(ctx, p.nextWeek)
    if (!menu) return NO_MENU(p.nextWeek)
    const path = slotPath(menu.id, p.dayIndex, p.meal)
    const had = (menu.days[p.dayIndex]?.[p.meal]?.dishes ?? []).length > 0
    if (!p.keepDishes && had) await api(ctx)('DELETE', path)
    await api(ctx)('POST', `${path}/dish`, { kind: 'note', text: String(p.text).slice(0, 120) })
    return menuDone(
      `Hecho: ${where(p.dayIndex, p.meal)} queda como "${p.text}"${!p.keepDishes && had ? ' (he quitado los platos que había)' : ''}.`,
      { menuId: menu.id },
    )
  },
}

const clearMeal: SkillDefinition = {
  name: 'clear_meal',
  description: 'Vacia una comida del menu (quita todos sus platos y notas).',
  parameters: { type: 'object', properties: dayMealProps, required: ['dayIndex', 'meal'] },
  async handler(p, ctx) {
    const bad = dayMealError(p.dayIndex, p.meal)
    if (bad) return text(bad)
    const menu = await loadMenu(ctx, p.nextWeek)
    if (!menu) return NO_MENU(p.nextWeek)
    await api(ctx)('DELETE', slotPath(menu.id, p.dayIndex, p.meal))
    return menuDone(`Hecho: he vaciado ${where(p.dayIndex, p.meal)}.`)
  },
}

const setDaySkipped: SkillDefinition = {
  name: 'set_day_skipped',
  description:
    'Marca un dia entero como "sin cocinar" (vacia sus comidas no bloqueadas y la regeneracion semanal lo respeta) o lo vuelve a activar. Ej: "el domingo no cocino", "el sabado comemos fuera todo el dia".',
  parameters: {
    type: 'object',
    properties: {
      dayIndex: dayMealProps.dayIndex,
      skipped: { type: 'boolean', description: 'true = sin cocinar; false = volver a planificar ese dia' },
      nextWeek: dayMealProps.nextWeek,
    },
    required: ['dayIndex'],
  },
  async handler(p, ctx) {
    const bad = dayMealError(p.dayIndex, undefined)
    if (bad) return text(bad)
    const menu = await loadMenu(ctx, p.nextWeek)
    if (!menu) return NO_MENU(p.nextWeek)
    const skip = p.skipped !== false
    await api(ctx)(skip ? 'POST' : 'DELETE', `/menu/${menu.id}/day/${p.dayIndex}/skip`)
    return menuDone(skip ? `Hecho: el ${DAY_NAMES[p.dayIndex]} queda sin cocinar.` : `Hecho: el ${DAY_NAMES[p.dayIndex]} vuelve a estar planificable (vacio hasta que añadas o regeneres).`)
  },
}

const addDish: SkillDefinition = {
  name: 'add_dish',
  description:
    'Añade un plato mas a una comida sin quitar los que ya hay (ej. "añade una ensalada a la comida del lunes"). Con recipeName busca esa receta en sus recetas y el catalogo; si no existe, lo añade como nota con su nombre y te dice lo mas parecido que hay. Sin nombre añade uno aleatorio compatible.',
  parameters: {
    type: 'object',
    properties: { ...dayMealProps, recipeName: { type: 'string' }, recipeId: { type: 'string' } },
    required: ['dayIndex', 'meal'],
  },
  async handler(p, ctx) {
    const bad = dayMealError(p.dayIndex, p.meal)
    if (bad) return text(bad)
    const menu = await loadMenu(ctx, p.nextWeek)
    if (!menu) return NO_MENU(p.nextWeek)
    const path = slotPath(menu.id, p.dayIndex, p.meal)
    if (!p.recipeId && !p.recipeName) {
      await api(ctx)('POST', `${path}/dish/random`)
      return menuDone(`Hecho: he añadido un plato aleatorio a ${where(p.dayIndex, p.meal)}.`)
    }
    const recipe = p.recipeId ? { id: p.recipeId, name: p.recipeName ?? 'la receta' } : await findRecipe(ctx, p.recipeName)
    if (!p.recipeId && (!recipe || ('approximate' in recipe && recipe.approximate))) {
      const note = dishNoteText(p.recipeName)
      await api(ctx)('POST', `${path}/dish`, { kind: 'note', text: note })
      const closest = recipe ? ` Lo mas parecido que si hay es "${recipe.name}".` : ''
      return menuDone(
        `Hecho: he añadido "${note}" a ${where(p.dayIndex, p.meal)} como nota, porque no esta en sus recetas ni en el catalogo.${closest} Diselo y ofrecele crear la receta${recipe ? ` o cambiar la nota por "${recipe.name}"` : ''}; no hace falta para que quede en el menu.`,
      )
    }
    if (!recipe) return text(`No encontre la receta "${p.recipeId}"; no he añadido nada.`)
    await api(ctx)('POST', `${path}/dish`, { kind: 'recipe', recipeId: recipe.id })
    return menuDone(`Hecho: he añadido "${recipe.name}" a ${where(p.dayIndex, p.meal)}.`, { recipeId: recipe.id })
  },
}

const removeDish: SkillDefinition = {
  name: 'remove_dish',
  description: 'Quita un plato concreto (o una nota) de una comida que tiene varios, por su nombre.',
  parameters: {
    type: 'object',
    properties: { ...dayMealProps, dishName: { type: 'string', description: 'Nombre del plato o texto de la nota' } },
    required: ['dayIndex', 'meal', 'dishName'],
  },
  async handler(p, ctx) {
    const bad = dayMealError(p.dayIndex, p.meal)
    if (bad) return text(bad)
    const menu = await loadMenu(ctx, p.nextWeek)
    if (!menu) return NO_MENU(p.nextWeek)
    const dishes = (menu.days[p.dayIndex]?.[p.meal]?.dishes ?? []).map((d, i) => ({ ...d, i }))
    const hit = bestMatch(dishes, p.dishName, (d) => d.recipeName ?? d.text ?? '')
    if (!hit) return text(`No hay ningun plato parecido a "${p.dishName}" en ${where(p.dayIndex, p.meal)}; no he quitado nada.`)
    await api(ctx)('DELETE', `${slotPath(menu.id, p.dayIndex, p.meal)}/dish/${hit.i}`)
    return menuDone(`Hecho: he quitado "${hit.recipeName ?? hit.text}" de ${where(p.dayIndex, p.meal)}.`)
  },
}

const setMealServings: SkillDefinition = {
  name: 'set_meal_servings',
  description:
    'Cambia cuantos comensales hay en una comida concreta (ej. "el viernes somos 6 a cenar"). Ajusta las cantidades de la lista de la compra. servings null vuelve al valor por defecto del hogar.',
  parameters: {
    type: 'object',
    properties: { ...dayMealProps, servings: { type: ['number', 'null'], description: 'Numero de comensales, o null' } },
    required: ['dayIndex', 'meal', 'servings'],
  },
  async handler(p, ctx) {
    const bad = dayMealError(p.dayIndex, p.meal)
    if (bad) return text(bad)
    const menu = await loadMenu(ctx, p.nextWeek)
    if (!menu) return NO_MENU(p.nextWeek)
    await api(ctx)('PATCH', slotPath(menu.id, p.dayIndex, p.meal), { servings: p.servings ?? null })
    return menuDone(
      p.servings == null
        ? `Hecho: ${where(p.dayIndex, p.meal)} vuelve a los comensales por defecto.`
        : `Hecho: ${where(p.dayIndex, p.meal)} queda para ${p.servings} personas.`,
    )
  },
}

const lockMeal: SkillDefinition = {
  name: 'lock_meal',
  description: 'Bloquea (o desbloquea) una comida para que no cambie al regenerar el menu ("deja fijo el cocido del domingo").',
  parameters: { type: 'object', properties: { ...dayMealProps, locked: { type: 'boolean' } }, required: ['dayIndex', 'meal'] },
  async handler(p, ctx) {
    const bad = dayMealError(p.dayIndex, p.meal)
    if (bad) return text(bad)
    const menu = await loadMenu(ctx, p.nextWeek)
    if (!menu) return NO_MENU(p.nextWeek)
    const locked = p.locked !== false
    await api(ctx)('PUT', `${slotPath(menu.id, p.dayIndex, p.meal)}/lock`, { locked })
    return menuDone(`Hecho: ${where(p.dayIndex, p.meal)} ${locked ? 'queda bloqueada' : 'queda desbloqueada'}.`)
  },
}

const moveMeal: SkillDefinition = {
  name: 'move_meal',
  description:
    'Mueve o intercambia comidas del menu ("cambia la cena del lunes por la del martes", "pasa la comida del jueves al viernes"). Si el destino tiene platos, se intercambian.',
  parameters: {
    type: 'object',
    properties: {
      fromDay: dayMealProps.dayIndex,
      fromMeal: dayMealProps.meal,
      toDay: dayMealProps.dayIndex,
      toMeal: dayMealProps.meal,
      nextWeek: dayMealProps.nextWeek,
    },
    required: ['fromDay', 'fromMeal', 'toDay', 'toMeal'],
  },
  async handler(p, ctx) {
    const bad = dayMealError(p.fromDay, p.fromMeal) ?? dayMealError(p.toDay, p.toMeal)
    if (bad) return text(bad)
    const menu = await loadMenu(ctx, p.nextWeek)
    if (!menu) return NO_MENU(p.nextWeek)
    await api(ctx)('POST', `/menu/${menu.id}/move-slot`, { fromDay: p.fromDay, fromMeal: p.fromMeal, toDay: p.toDay, toMeal: p.toMeal })
    return menuDone(`Hecho: he movido ${where(p.fromDay, p.fromMeal)} a ${where(p.toDay, p.toMeal)} (si habia algo, se han intercambiado).`)
  },
}

const banRecipe: SkillDefinition = {
  name: 'ban_recipe_this_week',
  description:
    'Veta (o desveta) una receta para el resto de la semana: no volvera a salir al regenerar o cambiar platos ("no quiero mas lentejas esta semana"). No quita la receta de donde ya esta; para eso usa swap_meal.',
  parameters: {
    type: 'object',
    properties: { recipeName: { type: 'string' }, banned: { type: 'boolean' }, nextWeek: dayMealProps.nextWeek },
    required: ['recipeName'],
  },
  async handler(p, ctx) {
    const menu = await loadMenu(ctx, p.nextWeek)
    if (!menu) return NO_MENU(p.nextWeek)
    const inMenu = menu.days
      .flatMap((d) => Object.values(d ?? {}))
      .flatMap((s) => s?.dishes ?? [])
      .filter((d) => d.kind === 'recipe' && d.recipeId)
    const hit = bestMatch(inMenu, p.recipeName, (d) => d.recipeName ?? '')
    const recipe = hit ? { id: hit.recipeId!, name: hit.recipeName ?? p.recipeName } : await findRecipe(ctx, p.recipeName)
    if (!recipe) return text(`No encontre "${p.recipeName}"; no he vetado nada.`)
    if (p.banned === false) {
      await api(ctx)('DELETE', `/menu/${menu.id}/ban/${recipe.id}`)
      return text(`Hecho: "${recipe.name}" vuelve a poder salir esta semana.`)
    }
    await api(ctx)('POST', `/menu/${menu.id}/ban`, { recipeId: recipe.id })
    return text(`Hecho: "${recipe.name}" no volvera a salir esta semana.`)
  },
}

const setLeftovers: SkillDefinition = {
  name: 'set_leftovers',
  description:
    'Planifica sobras: una comida reutiliza la receta de otra ("el martes comemos las sobras del cocido del lunes"). Sustituye lo que hubiera en la comida destino.',
  parameters: {
    type: 'object',
    properties: {
      sourceDay: dayMealProps.dayIndex,
      sourceMeal: dayMealProps.meal,
      targetDay: dayMealProps.dayIndex,
      targetMeal: dayMealProps.meal,
      nextWeek: dayMealProps.nextWeek,
    },
    required: ['sourceDay', 'sourceMeal', 'targetDay', 'targetMeal'],
  },
  async handler(p, ctx) {
    const bad = dayMealError(p.sourceDay, p.sourceMeal) ?? dayMealError(p.targetDay, p.targetMeal)
    if (bad) return text(bad)
    const menu = await loadMenu(ctx, p.nextWeek)
    if (!menu) return NO_MENU(p.nextWeek)
    if ((menu.days[p.targetDay]?.[p.targetMeal]?.dishes ?? []).length > 0) {
      await api(ctx)('DELETE', slotPath(menu.id, p.targetDay, p.targetMeal))
    }
    await api(ctx)('POST', `/menu/${menu.id}/day/${p.targetDay}/leftover`, {
      sourceDay: p.sourceDay,
      sourceMeal: p.sourceMeal,
      targetMeal: p.targetMeal,
    })
    return menuDone(`Hecho: ${where(p.targetDay, p.targetMeal)} son sobras de ${where(p.sourceDay, p.sourceMeal)}.`)
  },
}

// ─── Shopping list ───────────────────────────────────────────────

interface ListDoc { id: string; items: Array<{ id: string; name: string; checked?: boolean }> }
const currentList = (ctx: SkillContext) => api(ctx)<ListDoc>('GET', '/shopping-list')

/** Free-form quantity → what the list accepts (g, ml, u, cda, cdita). */
export function toBuyable(quantity?: number, unit?: string): { quantity?: number; unit?: string; suffix?: string } {
  if (quantity == null || !(quantity > 0)) return {}
  const u = normalize(unit ?? '')
  if (!u || ['u', 'ud', 'uds', 'unidad', 'unidades', 'pieza', 'piezas'].includes(u)) return { quantity, unit: 'u' }
  if (['g', 'gr', 'gramo', 'gramos'].includes(u)) return { quantity, unit: 'g' }
  if (['kg', 'kilo', 'kilos', 'kilogramo', 'kilogramos'].includes(u)) return { quantity: quantity * 1000, unit: 'g' }
  if (['ml', 'mililitro', 'mililitros'].includes(u)) return { quantity, unit: 'ml' }
  if (['l', 'litro', 'litros'].includes(u)) return { quantity: quantity * 1000, unit: 'ml' }
  if (['cda', 'cucharada', 'cucharadas'].includes(u)) return { quantity, unit: 'cda' }
  if (['cdita', 'cucharadita', 'cucharaditas'].includes(u)) return { quantity, unit: 'cdita' }
  return { suffix: `${quantity} ${unit}` } // "2 paquetes" → kept in the name
}

const addShoppingItems: SkillDefinition = {
  name: 'add_shopping_items',
  description: 'Añade uno o varios productos a la lista de la compra ("apunta leche y dos barras de pan").',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { name: { type: 'string' }, quantity: { type: 'number' }, unit: { type: 'string' } },
          required: ['name'],
        },
      },
    },
    required: ['items'],
  },
  async handler(p, ctx) {
    const list = await currentList(ctx)
    const added: string[] = []
    for (const it of (p.items ?? []).slice(0, 30)) {
      const b = toBuyable(it.quantity, it.unit)
      const name = String(b.suffix ? `${it.name} (${b.suffix})` : it.name).slice(0, 80)
      await api(ctx)('POST', `/shopping-list/${list.id}/items`, {
        name,
        ...(b.quantity ? { quantity: b.quantity } : {}),
        ...(b.unit ? { unit: b.unit } : {}),
      })
      added.push(name)
    }
    return { data: { listId: list.id }, summary: `Hecho: añadido a la lista: ${added.join(', ')}.`, uiHint: 'shopping_list' }
  },
}

const removeShoppingItems: SkillDefinition = {
  name: 'remove_shopping_items',
  description: 'Quita productos de la lista de la compra (no es lo mismo que marcarlos como comprados: para eso usa check_shopping_item).',
  parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] },
  async handler(p, ctx) {
    const list = await currentList(ctx)
    const removed: string[] = []
    const missing: string[] = []
    let items = [...(list.items ?? [])]
    for (const name of p.names ?? []) {
      const hit = bestMatch(items, name, (i) => i.name)
      if (!hit) {
        missing.push(name)
        continue
      }
      await api(ctx)('DELETE', `/shopping-list/${list.id}/item/${hit.id}`)
      removed.push(hit.name)
      items = items.filter((i) => i.id !== hit.id)
    }
    const parts = []
    if (removed.length) parts.push(`Quitado de la lista: ${removed.join(', ')}.`)
    if (missing.length) parts.push(`No estaban en la lista: ${missing.join(', ')}.`)
    return { data: null, summary: parts.join(' '), uiHint: 'shopping_list' }
  },
}

const regenerateShoppingList: SkillDefinition = {
  name: 'regenerate_shopping_list',
  description:
    'Rehace la lista de la compra a partir del menu actual (util despues de cambiar platos). Conserva lo añadido a mano y los basicos.',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p, ctx) {
    const list = await currentList(ctx)
    const next = await api(ctx)<ListDoc>('POST', `/shopping-list/${list.id}/regenerate`)
    return { data: { listId: list.id }, summary: `Hecho: lista de la compra rehecha (${next?.items?.length ?? 0} productos).`, uiHint: 'shopping_list' }
  },
}

const manageStaples: SkillDefinition = {
  name: 'manage_staples',
  description:
    'Gestiona los basicos del hogar (productos que se añaden solos a cada lista nueva: pan, leche, cafe…). action: add, remove, pause (no comprar temporalmente), resume, list.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'remove', 'pause', 'resume', 'list'] },
      name: { type: 'string' },
      quantity: { type: 'number' },
      unit: { type: 'string' },
    },
    required: ['action'],
  },
  async handler(p, ctx) {
    const rows = await api(ctx)<Array<{ id: string; name: string; active: boolean }>>('GET', '/staples')
    if (p.action === 'list') {
      return text(rows.length ? `Basicos: ${rows.map((r) => `${r.name}${r.active ? '' : ' (pausado)'}`).join(', ')}.` : 'No hay basicos todavia.')
    }
    if (!p.name) return text('Falta el nombre del basico.')
    if (p.action === 'add') {
      const b = toBuyable(p.quantity, p.unit)
      await api(ctx)('POST', '/staples', { name: String(p.name).slice(0, 80), ...(b.quantity ? { quantity: b.quantity, unit: b.unit } : {}) })
      return text(`Hecho: "${p.name}" añadido a los basicos; saldra en cada lista nueva.`)
    }
    const hit = bestMatch(rows, p.name, (r) => r.name)
    if (!hit) return text(`"${p.name}" no esta en los basicos; no he cambiado nada.`)
    if (p.action === 'remove') {
      await api(ctx)('DELETE', `/staples/${hit.id}`)
      return text(`Hecho: "${hit.name}" ya no es un basico.`)
    }
    await api(ctx)('PATCH', `/staples/${hit.id}`, { active: p.action === 'resume' })
    return text(`Hecho: "${hit.name}" ${p.action === 'resume' ? 'vuelve a añadirse' : 'queda en pausa'}.`)
  },
}

// ─── Pantry ──────────────────────────────────────────────────────

interface PantryRow { id: string; name: string; quantity: number; unit: string; expiresAt?: string | null }

// Reading the pantry is get_pantry_stock (skills.ts): pantry + list flags in one answer.

const updatePantry: SkillDefinition = {
  name: 'update_pantry',
  description:
    'Actualiza la despensa real: action add ("he comprado 1 kg de arroz"), set (fija la cantidad), remove ("se acabo el aceite"). expiresAt opcional YYYY-MM-DD.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['add', 'set', 'remove'] },
      name: { type: 'string' },
      quantity: { type: 'number' },
      unit: { type: 'string' },
      expiresAt: { type: 'string', description: 'YYYY-MM-DD' },
    },
    required: ['action', 'name'],
  },
  async handler(p, ctx) {
    const rows = await api(ctx)<PantryRow[]>('GET', '/pantry')
    const hit = bestMatch(rows, p.name, (r) => r.name)
    const b = toBuyable(p.quantity, p.unit)
    const exp = typeof p.expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.expiresAt) ? p.expiresAt : undefined
    if (p.action === 'remove') {
      if (!hit) return text(`"${p.name}" no estaba en la despensa.`)
      await api(ctx)('DELETE', `/pantry/${hit.id}`)
      return text(`Hecho: "${hit.name}" fuera de la despensa.`)
    }
    if (hit && (p.action === 'set' || p.action === 'add')) {
      const quantity = b.quantity == null ? undefined : p.action === 'add' && hit.unit === b.unit ? hit.quantity + b.quantity : b.quantity
      await api(ctx)('PATCH', `/pantry/${hit.id}`, {
        ...(quantity != null ? { quantity } : {}),
        ...(b.unit ? { unit: b.unit } : {}),
        ...(exp ? { expiresAt: exp } : {}),
      })
      return text(`Hecho: "${hit.name}" actualizado en la despensa${quantity != null ? ` (${quantity} ${b.unit ?? hit.unit})` : ''}.`)
    }
    await api(ctx)('POST', '/pantry', {
      name: String(b.suffix ? `${p.name} (${b.suffix})` : p.name).slice(0, 80),
      ...(b.quantity != null ? { quantity: b.quantity, unit: b.unit } : {}),
      ...(exp ? { expiresAt: exp } : {}),
    })
    return text(`Hecho: "${p.name}" añadido a la despensa.`)
  },
}

// ─── Recipes ─────────────────────────────────────────────────────

const logCooked: SkillDefinition = {
  name: 'log_cooked',
  description:
    'Apunta que el usuario ha cocinado una receta ("hoy he hecho la lasaña", "la cena de ayer la hice"). Descuenta ingredientes de la despensa. Pasa dayIndex+meal si se refiere a una comida del menu, o recipeName.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string' },
      dayIndex: dayMealProps.dayIndex,
      meal: dayMealProps.meal,
      servings: { type: 'number', description: 'Raciones cocinadas, si lo dice' },
      notes: { type: 'string' },
    },
    required: [],
  },
  async handler(p, ctx) {
    let recipe: { id: string; name: string } | null = null
    let menuId: string | undefined
    if (typeof p.dayIndex === 'number' && p.meal) {
      const menu = await loadMenu(ctx)
      const dish = menu?.days[p.dayIndex]?.[p.meal]?.dishes?.find((d) => d.kind === 'recipe' && d.recipeId)
      if (dish) {
        recipe = { id: dish.recipeId!, name: dish.recipeName ?? 'la receta' }
        menuId = menu!.id
      }
    }
    if (!recipe && p.recipeName) recipe = await findRecipe(ctx, p.recipeName, { menuFirst: true })
    if (!recipe) return text('No se que receta has cocinado; no he apuntado nada.')
    const res = await api(ctx)<{ pantry?: { updatedRowIds?: string[] } }>('POST', '/cook-logs', {
      recipeId: recipe.id,
      ...(menuId ? { menuId, dayIndex: p.dayIndex, meal: p.meal } : {}),
      ...(typeof p.servings === 'number' ? { servings: p.servings } : {}),
      ...(p.notes ? { notes: String(p.notes).slice(0, 500) } : {}),
    })
    const pantry = res?.pantry?.updatedRowIds?.length ?? 0
    return text(`Hecho: apuntado que has cocinado "${recipe.name}"${pantry ? ` (despensa actualizada: ${pantry} ingredientes)` : ''}.`, { recipeId: recipe.id })
  },
}

const updateRecipeNotes: SkillDefinition = {
  name: 'update_recipe_notes',
  description:
    'Valora o anota una receta para el hogar: rating 1-5 estrellas, notas ("le va bien un toque de comino"), sustituciones, etiquetas propias, y minServings: "las lentejas siempre las hago para 6 y congelo" → minServings 6 (la compra comprara al menos para 6 cada vez; 0 lo quita). Las notas se añaden a las existentes salvo notesMode=replace.',
  parameters: {
    type: 'object',
    properties: {
      recipeName: { type: 'string' },
      rating: { type: 'number', description: '1 a 5' },
      notes: { type: 'string' },
      notesMode: { type: 'string', enum: ['append', 'replace'] },
      substitutions: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
      minServings: { type: 'number', description: 'Raciones minimas que siempre cocina (1-24); 0 para quitarlo.' },
    },
    required: ['recipeName'],
  },
  async handler(p, ctx) {
    const recipe = await findRecipe(ctx, p.recipeName, { menuFirst: true })
    if (!recipe) return text(`No encontre "${p.recipeName}"; no he anotado nada.`)
    const current = await api(ctx)<{ notes?: string | null; customTags?: string[] | null } | null>('GET', `/recipes/${recipe.id}/notes`).catch(() => null)
    const body: Record<string, unknown> = {}
    if (typeof p.rating === 'number') body.rating = Math.max(1, Math.min(5, Math.round(p.rating)))
    if (p.notes) body.notes = p.notesMode === 'replace' || !current?.notes ? p.notes : `${current.notes}\n${p.notes}`
    if (p.substitutions) body.substitutions = p.substitutions
    if (Array.isArray(p.tags) && p.tags.length) body.customTags = [...(current?.customTags ?? []), ...p.tags]
    if (typeof p.minServings === 'number') body.minServings = p.minServings >= 1 ? Math.min(24, Math.round(p.minServings)) : null
    if (Object.keys(body).length === 0) return text('No me has dicho que anotar; no he cambiado nada.')
    await api(ctx)('PUT', `/recipes/${recipe.id}/notes`, body)
    const what = [
      body.rating ? `${body.rating} estrellas` : null,
      p.notes ? 'nota' : null,
      p.substitutions ? 'sustituciones' : null,
      p.tags?.length ? `etiquetas ${p.tags.join(', ')}` : null,
      'minServings' in body ? (body.minServings ? `siempre para al menos ${body.minServings}` : 'sin minimo de raciones') : null,
    ].filter(Boolean)
    return { data: { recipeId: recipe.id }, summary: `Hecho: "${recipe.name}" — ${what.join(', ')}.`, uiHint: 'recipe' }
  },
}

const myRecipes = async (ctx: SkillContext) =>
  (await api(ctx)<{ own?: Array<{ id: string; name: string }> }>('GET', `/user/${ctx.userId}/recipes`))?.own ?? []

const deleteRecipe: SkillDefinition = {
  name: 'delete_recipe',
  description: 'Borra una receta PROPIA del usuario. Es irreversible: pide confirmacion antes con [[opciones: Sí | No]] y solo llamala tras un "si".',
  parameters: { type: 'object', properties: { recipeName: { type: 'string' } }, required: ['recipeName'] },
  async handler(p, ctx) {
    const hit = bestMatch(await myRecipes(ctx), p.recipeName, (r) => r.name)
    if (!hit) return text(`No tienes ninguna receta propia parecida a "${p.recipeName}"; no he borrado nada.`)
    await api(ctx)('DELETE', `/recipes/${hit.id}`)
    return text(`Hecho: receta "${hit.name}" borrada.`)
  },
}

const manageCookbook: SkillDefinition = {
  name: 'manage_cookbook',
  description:
    'Gestiona recetarios del hogar ("Recetas de mi madre"): action list, create, rename, delete, add_recipe, remove_recipe.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'create', 'rename', 'delete', 'add_recipe', 'remove_recipe'] },
      cookbookName: { type: 'string' },
      newName: { type: 'string' },
      recipeName: { type: 'string' },
      emoji: { type: 'string' },
    },
    required: ['action'],
  },
  async handler(p, ctx) {
    const books = await api(ctx)<Array<{ id: string; name: string; recipeCount?: number }>>('GET', '/cookbooks')
    if (p.action === 'list') return text(books.length ? `Recetarios: ${books.map((b) => b.name).join(', ')}.` : 'No hay recetarios.')
    if (!p.cookbookName) return text('Falta el nombre del recetario.')
    if (p.action === 'create') {
      await api(ctx)('POST', '/cookbooks', { name: p.cookbookName, ...(p.emoji ? { emoji: p.emoji } : {}) })
      return text(`Hecho: recetario "${p.cookbookName}" creado.`)
    }
    let book = bestMatch(books, p.cookbookName, (b) => b.name)
    if (!book && p.action === 'add_recipe') {
      book = await api(ctx)('POST', '/cookbooks', { name: p.cookbookName })
    }
    if (!book) return text(`No hay ningun recetario parecido a "${p.cookbookName}".`)
    if (p.action === 'rename') {
      await api(ctx)('PATCH', `/cookbooks/${book.id}`, { name: p.newName })
      return text(`Hecho: "${book.name}" ahora se llama "${p.newName}".`)
    }
    if (p.action === 'delete') {
      await api(ctx)('DELETE', `/cookbooks/${book.id}`)
      return text(`Hecho: recetario "${book.name}" borrado (las recetas no se borran).`)
    }
    if (!p.recipeName) return text('Falta el nombre de la receta.')
    const recipe = await findRecipe(ctx, p.recipeName, { menuFirst: true })
    if (!recipe) return text(`No encontre "${p.recipeName}".`)
    await api(ctx)(p.action === 'add_recipe' ? 'POST' : 'DELETE', `/cookbooks/${book.id}/recipes/${recipe.id}`)
    return text(`Hecho: "${recipe.name}" ${p.action === 'add_recipe' ? 'añadida a' : 'quitada de'} "${book.name}".`)
  },
}

const regenerateRecipeImage: SkillDefinition = {
  name: 'regenerate_recipe_image',
  description: 'Genera una foto nueva con IA para una receta propia (cuenta para el limite mensual de imagenes).',
  parameters: { type: 'object', properties: { recipeName: { type: 'string' } }, required: ['recipeName'] },
  async handler(p, ctx) {
    const hit = bestMatch(await myRecipes(ctx), p.recipeName, (r) => r.name)
    if (!hit) return text(`Solo puedo regenerar la foto de recetas tuyas y no encuentro "${p.recipeName}".`)
    await api(ctx)('POST', `/recipes/${hit.id}/regenerate-image`)
    return { data: { recipeId: hit.id }, summary: `Hecho: foto nueva para "${hit.name}".`, uiHint: 'recipe' }
  },
}

// ─── Profile, weekly template, household ─────────────────────────

const updateProfile: SkillDefinition = {
  name: 'update_profile',
  description:
    'Actualiza el perfil: restricciones alimentarias del perfil (addRestrictions / removeRestrictions, ej. "sin gluten", "vegetariano"), prioridad (quick, varied, healthy, cheap), sexo, edad, peso (kg), altura (cm), actividad (none, light, moderate, high). Para gustos y disgustos usa update_memory.',
  parameters: {
    type: 'object',
    properties: {
      addRestrictions: { type: 'array', items: { type: 'string' } },
      removeRestrictions: { type: 'array', items: { type: 'string' } },
      priority: { type: 'string', enum: ['quick', 'varied', 'healthy', 'cheap'] },
      sex: { type: 'string', enum: ['male', 'female'] },
      age: { type: 'number' },
      weight: { type: 'number' },
      height: { type: 'number' },
      activityLevel: { type: 'string', enum: ['none', 'light', 'moderate', 'high'] },
    },
    required: [],
  },
  async handler(p, ctx) {
    const body: Record<string, unknown> = {}
    for (const k of ['priority', 'sex', 'age', 'weight', 'height', 'activityLevel'] as const) {
      if (p[k] !== undefined && p[k] !== null) body[k] = p[k]
    }
    if (p.addRestrictions?.length || p.removeRestrictions?.length) {
      const user = await api(ctx)<{ restrictions?: string[] }>('GET', `/user/${ctx.userId}`)
      const current = user?.restrictions ?? []
      const next = current.filter((r) => !(p.removeRestrictions ?? []).some((x: string) => bestMatch([r], x, (y) => y)))
      for (const r of p.addRestrictions ?? []) if (!next.some((x) => normalize(x) === normalize(r))) next.push(r)
      body.restrictions = next
    }
    if (Object.keys(body).length === 0) return text('No me has dicho que cambiar del perfil.')
    // Sex, age, weight, height, activity and restrictions are health data:
    // only with the art. 9 consent in force (PRO-21).
    const health = ['sex', 'age', 'weight', 'height', 'activityLevel', 'restrictions'].filter((k) => k in body)
    if (health.length > 0) {
      const consent = await api(ctx)<{ active?: boolean }>('GET', `/user/${ctx.userId}/health-consent`)
      if (!consent?.active) {
        for (const k of health) delete body[k]
        if (Object.keys(body).length === 0) return text(HEALTH_CONSENT_SKILL_REPLY)
      }
    }
    await api(ctx)('PUT', `/user/${ctx.userId}`, body)
    return text(`Hecho: perfil actualizado (${Object.entries(body).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') || 'ninguna' : v}`).join('; ')}).`)
  },
}

const TEMPLATE_DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
const TEMPLATE_MEAL: Record<string, string> = { breakfast: 'desayuno', lunch: 'almuerzo', snack: 'merienda', dinner: 'cena' }

/** Pure: apply a diners change to the profile's weekly template blob. */
export function applyTemplateChange(
  template: Record<string, any> | null | undefined,
  change: { days: number[]; meal: string; diners?: number; dishes?: 1 | 2 | 3 },
): Record<string, any> {
  const blob = { ...(template && typeof template === 'object' && !Array.isArray(template) ? template : {}) }
  if (change.diners !== undefined) {
    const mt: Record<string, Record<string, number>> = { ...(blob.mealTemplate ?? {}) }
    for (const d of change.days) {
      const key = TEMPLATE_DAYS[d]
      mt[key] = { ...(mt[key] ?? {}), [TEMPLATE_MEAL[change.meal]]: Math.max(0, Math.round(change.diners)) }
    }
    blob.mealTemplate = mt
  }
  if (change.dishes !== undefined) blob.mealDishCounts = { ...(blob.mealDishCounts ?? {}), [change.meal]: change.dishes }
  return blob
}

const updateWeeklyTemplate: SkillDefinition = {
  name: 'update_weekly_template',
  description:
    'Cambia la plantilla semanal fija del perfil (afecta a los proximos menus): cuantos comensales hay en una comida ciertos dias (diners; 0 = esa comida no se planifica, ej. "entre semana no comemos en casa") y/o cuantos platos lleva esa comida (dishes 1-3, ej. "quiero primero y segundo en la comida").',
  parameters: {
    type: 'object',
    properties: {
      days: { type: 'array', items: { type: 'number' }, description: 'Indices 0-6; vacio o ausente = todos los dias' },
      meal: { type: 'string', enum: [...MEALS] },
      diners: { type: 'number' },
      dishes: { type: 'number', enum: [1, 2, 3] },
    },
    required: ['meal'],
  },
  async handler(p, ctx) {
    if (!MEALS.includes(p.meal)) return text('meal debe ser breakfast, lunch, snack o dinner.')
    if (p.diners === undefined && p.dishes === undefined) return text('Dime comensales (diners) o numero de platos (dishes).')
    const days: number[] = Array.isArray(p.days) && p.days.length ? p.days.filter((d: number) => d >= 0 && d <= 6) : [0, 1, 2, 3, 4, 5, 6]
    const settings = await api(ctx)<{ template?: Record<string, any> } | null>('GET', `/user/${ctx.userId}/settings`).catch(() => null)
    const template = applyTemplateChange(settings?.template, { days, meal: p.meal, diners: p.diners, dishes: p.dishes })
    await api(ctx)('PUT', `/user/${ctx.userId}/settings`, { template })
    const dayLabel = days.length === 7 ? 'todos los dias' : days.map((d) => DAY_NAMES[d]).join(', ')
    const parts = [
      p.diners !== undefined ? (p.diners === 0 ? `sin ${MEAL_ES[p.meal]} (${dayLabel})` : `${p.diners} comensales en la ${MEAL_ES[p.meal]} (${dayLabel})`) : null,
      p.dishes !== undefined ? `${p.dishes} plato(s) en la ${MEAL_ES[p.meal]}` : null,
    ].filter(Boolean)
    return text(`Hecho: plantilla semanal actualizada: ${parts.join('; ')}. Se aplica a los proximos menus.`)
  },
}

const inviteToHousehold: SkillDefinition = {
  name: 'invite_to_household',
  description: 'Crea un enlace de invitacion para que otra persona se una al hogar (comparten menu, lista y despensa). Devuelve el enlace para reenviarlo.',
  parameters: { type: 'object', properties: { role: { type: 'string', enum: ['member', 'child'] } }, required: [] },
  async handler(p, ctx) {
    const inv = await api(ctx)<{ token: string; expiresAt?: string }>('POST', '/households/me/invites', { role: p.role === 'child' ? 'child' : 'member' })
    const url = `${env.WEB_PUBLIC_URL}/invites/${inv.token}`
    return text(`Hecho: enlace de invitacion (caduca en 7 dias): ${url} — dale este enlace tal cual al usuario para que lo reenvie.`, { url })
  },
}

const setWhatsappNotifications: SkillDefinition = {
  name: 'set_whatsapp_notifications',
  description:
    'Activa o desactiva los avisos que Mimo manda por WhatsApp sin que el usuario escriba. kind: all (todos), daily_brief (resumen de la mañana), weekly_nudge (propuesta de menu del domingo), prep_alerts (descongelar, remojo…), cooking_reminder (empezar a cocinar), dinner_checkin ("¿hiciste la cena?"), shopping_reminder (recordatorio de la compra). Ej: "no me mandes el resumen de la mañana".',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['all', ...PROACTIVE_KINDS] },
      enabled: { type: 'boolean' },
    },
    required: ['kind', 'enabled'],
  },
  async handler(p, ctx) {
    const enabled = p.enabled !== false
    if (p.kind === 'all') {
      await api(ctx)('PATCH', '/whatsapp/link', { notify: enabled })
      return text(`Hecho: avisos por WhatsApp ${enabled ? 'activados' : 'desactivados'}.`)
    }
    if (!PROACTIVE_KINDS.includes(p.kind)) return text('Tipo de aviso desconocido.')
    const body: Record<string, unknown> = { prefs: { [p.kind]: enabled } }
    if (enabled) body.notify = true // turning one kind on implies the master switch
    await api(ctx)('PATCH', '/whatsapp/link', body)
    return text(`Hecho: ${PROACTIVE_LABELS[p.kind as ProactiveKind]} ${enabled ? 'activado' : 'desactivado'}.`)
  },
}

export const appSkills: SkillDefinition[] = [
  setMealNote,
  clearMeal,
  setDaySkipped,
  addDish,
  removeDish,
  setMealServings,
  lockMeal,
  moveMeal,
  banRecipe,
  setLeftovers,
  addShoppingItems,
  removeShoppingItems,
  regenerateShoppingList,
  manageStaples,
  updatePantry,
  logCooked,
  updateRecipeNotes,
  deleteRecipe,
  manageCookbook,
  regenerateRecipeImage,
  updateProfile,
  updateWeeklyTemplate,
  inviteToHousehold,
  setWhatsappNotifications,
]
