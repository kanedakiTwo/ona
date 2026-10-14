import type { DayMenu, Dish } from '@ona/shared'

/**
 * Pure: a menu day → Spanish lines the assistant (and WhatsApp messages) can
 * read, e.g. "comida: Lentejas estofadas + Ensalada verde". Understands the
 * multi-dish slot shape (`{ dishes: [...] }`, recipes + free-text notes).
 */

export const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner'] as const
export const MEAL_LABEL_ES: Record<string, string> = {
  breakfast: 'desayuno',
  lunch: 'comida',
  snack: 'merienda',
  dinner: 'cena',
}

function dishLabel(d: Dish): string | null {
  if (d.kind === 'note') return d.text?.trim() || null
  if (d.kind === 'recipe') {
    const name = d.recipeName?.trim() || 'receta sin nombre'
    return d.variant === 'leftover' ? `${name} (sobras)` : name
  }
  return null
}

export function mealEntriesForDay(day: DayMenu | null | undefined): { meal: string; label: string; dishes: string[] }[] {
  if (!day || typeof day !== 'object') return []
  const meals = [
    ...MEAL_ORDER.filter((m) => m in day),
    ...Object.keys(day).filter((m) => !(MEAL_ORDER as readonly string[]).includes(m)),
  ]
  const out: { meal: string; label: string; dishes: string[] }[] = []
  for (const meal of meals) {
    const slot = day[meal]
    const dishes = Array.isArray(slot?.dishes)
      ? slot!.dishes.map(dishLabel).filter((x): x is string => Boolean(x))
      : []
    if (dishes.length > 0) out.push({ meal, label: MEAL_LABEL_ES[meal] ?? meal, dishes })
  }
  return out
}

/**
 * PRO-85: the short form of a recipe's page for WhatsApp, e.g.
 * `mimoia.com/recipes/<id>` (no scheme or `www.`; WhatsApp still makes it a
 * link). `webUrl` is `WEB_PUBLIC_URL`.
 */
export function shortRecipeLink(webUrl: string, recipeId: string): string {
  const host = webUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
  return `${host}/recipes/${recipeId}`
}

/**
 * Pure: the recipes of a day (or of one meal's dishes), in menu order, once
 * each — free-text notes have no page, so they never appear.
 */
export function recipesOfDay(day: DayMenu | null | undefined, meals?: readonly string[]): { id: string; name: string }[] {
  if (!day || typeof day !== 'object') return []
  const order = meals ?? [
    ...MEAL_ORDER.filter((m) => m in day),
    ...Object.keys(day).filter((m) => !(MEAL_ORDER as readonly string[]).includes(m)),
  ]
  const out: { id: string; name: string }[] = []
  for (const meal of order) {
    const dishes = day[meal]?.dishes
    if (!Array.isArray(dishes)) continue
    for (const d of dishes) {
      if (d?.kind !== 'recipe' || !d.recipeId || out.some((r) => r.id === d.recipeId)) continue
      out.push({ id: d.recipeId, name: d.recipeName?.trim() || 'Receta' })
    }
  }
  return out
}

/** Pure: one line per recipe, `→ Lentejas estofadas: mimoia.com/recipes/<id>`. */
export function recipeLinkLines(recipes: { id: string; name: string }[], webUrl: string): string[] {
  return recipes.map((r) => `→ ${r.name}: ${shortRecipeLink(webUrl, r.id)}`)
}

export function mealLinesForDay(day: DayMenu | null | undefined): string[] {
  return mealEntriesForDay(day).map((e) => `${e.label}: ${e.dishes.join(' + ')}`)
}

const DAY_SHORT_ES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** Monday `YYYY-MM-DD` → "del 12 al 18 de octubre" / "del 28 de septiembre al 4 de octubre". */
export function weekRangeEs(weekStart: string): string {
  const [y, m, d] = weekStart.slice(0, 10).split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, d))
  const end = new Date(Date.UTC(y, m - 1, d + 6))
  const sm = MONTHS_ES[start.getUTCMonth()]
  const em = MONTHS_ES[end.getUTCMonth()]
  return sm === em
    ? `del ${start.getUTCDate()} al ${end.getUTCDate()} de ${em}`
    : `del ${start.getUTCDate()} de ${sm} al ${end.getUTCDate()} de ${em}`
}

export const MENU_DIGEST_INVITE =
  '¿Cambiamos algo? Dímelo aquí, por ejemplo «el jueves pon pescado» o «otra cena el martes».'

/**
 * Pure: a week's menu → the compact WhatsApp summary that follows "Hecho" when
 * the menu is generated, so the user reads it and iterates without opening the
 * app. Header names the meals planned that week (in order); one line per day
 * with one entry per planned meal ("—" when that day has none), the dishes of a
 * multi-dish slot joined with " + ", free-text notes as written. With `webUrl`
 * (PRO-85), each day is followed by one link line per recipe (a day line with
 * links inline would be too long); notes get none.
 */
export function weekMenuDigest(
  menu: {
    weekStart: string
    days: Array<DayMenu | null | undefined> | null | undefined
    skippedDays?: number[] | null
  },
  webUrl?: string,
): string {
  const days = Array.isArray(menu.days) ? menu.days : []
  const byDay = days.map((day) => new Map(mealEntriesForDay(day).map((e) => [e.meal, e.dishes])))
  const planned = [
    ...MEAL_ORDER.filter((m) => byDay.some((d) => d.has(m))),
    ...[...new Set(byDay.flatMap((d) => [...d.keys()]))].filter((m) => !(MEAL_ORDER as readonly string[]).includes(m)),
  ]
  const header = `*Tu semana ${weekRangeEs(menu.weekStart)}*${planned.length > 1 ? ` (${planned.map((m) => MEAL_LABEL_ES[m] ?? m).join(' · ')})` : ''}`
  const lines = DAY_SHORT_ES.flatMap((label, i) => {
    if (menu.skippedDays?.includes(i)) return [`*${label}* sin cocinar`]
    const meals = byDay[i]
    if (!meals || meals.size === 0) return [`*${label}* —`]
    const dayLine = `*${label}* ${planned.map((m) => meals.get(m)?.join(' + ') ?? '—').join(' · ')}`
    return webUrl ? [dayLine, ...recipeLinkLines(recipesOfDay(days[i], planned), webUrl)] : [dayLine]
  })
  return [header, ...lines, '', MENU_DIGEST_INVITE].join('\n')
}
