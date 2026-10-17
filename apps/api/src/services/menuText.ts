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

export function dishLabel(d: Dish): string | null {
  if (d.kind === 'note') return d.text?.trim() || null
  if (d.kind === 'recipe') {
    const name = d.recipeName?.trim() || 'receta sin nombre'
    if (d.variant === 'freezer') return `${name} (del congelador)`
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
  return shortWebLink(webUrl, `/recipes/${recipeId}`)
}

/** `https://www.mimoia.com` + `/menu` → `mimoia.com/menu` (same short form as recipe links). */
export function shortWebLink(webUrl: string, path: string): string {
  const host = webUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '')
  return `${host}${path}`
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

/**
 * What the assistant reads of a day. A slot with diners set by hand («Solo
 * hoy: 4» in the app) says `[solo hoy: 4]` (PRO-101: Mimo said «el menú no
 * me muestra cuántos comensales hay» when the app showed them).
 */
export function mealLinesForDay(day: DayMenu | null | undefined): string[] {
  return mealEntriesForDay(day).map((e) => {
    const servings = day?.[e.meal]?.servings
    const diners = typeof servings === 'number' && servings > 0 ? ` [solo hoy: ${servings}]` : ''
    return `${e.label}${diners}: ${e.dishes.join(' + ')}`
  })
}

export const DAY_NAME_ES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
export const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

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

/** `YYYY-MM-DD` + n days → `YYYY-MM-DD` (calendar arithmetic, no TZ involved). */
export function plusDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/**
 * One fixed marker per meal in the WhatsApp week digest (2026-10-15): it is
 * what tells comida from cena at a glance, so it never changes and the meal
 * lines carry no other emoji.
 */
export const MEAL_EMOJI: Record<string, string> = {
  breakfast: '☕',
  lunch: '☀️',
  snack: '🍎',
  dinner: '🌙',
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Pure: a week's menu → the WhatsApp message that answers "genera el menú"
 * (rewritten 2026-10-15 after the first real feedback: «Overwhelming… too
 * much info»). An opener saying up to when, one block per day — "*Jueves 15 ·
 * hoy*" and one line per meal with its fixed emoji (☕ desayuno, ☀️ comida,
 * 🍎 merienda, 🌙 cena), the dishes of a multi-dish slot joined with " + ",
 * notes as written — then one link to the menu page (no per-recipe links:
 * those stay in the one-day messages) and the invite to change something.
 *
 * `today` is the Europe/Madrid date (`YYYY-MM-DD`). When the week contains it,
 * only today and the days after it are shown; any other week shows its seven
 * days. A skipped day reads "Sin cocinar"; a day with nothing planned is left
 * out; a meal a day doesn't have gets no line.
 *
 * `view: 'viewing'` (the user asked to see the week) opens with «Tu menú de
 * esta semana 🍽️» instead of «Listo: …»; a generated week among the
 * household's first `SNOWBALL_WEEKS` starts with `SNOWBALL_LINE`.
 */
export function weekMenuDigest(menu: WeekMenuInput, opts: WeekReplyOptions): string {
  const { snowball, opener, shown, link, invite, today, tomorrow } = weekDigestParts(menu, opts)
  const blocks = shown.map((d) => {
    const when = d.date === today ? ' · hoy' : d.date === tomorrow ? ' · mañana' : ''
    const title = `*${capitalize(DAY_NAME_ES[d.i])} ${Number(d.date.slice(8, 10))}${when}*`
    if (d.skipped) return `${title}\nSin cocinar`
    const lines = d.entries.map((e) => {
      const dishes = e.dishes.join(' + ')
      return MEAL_EMOJI[e.meal] ? `${MEAL_EMOJI[e.meal]} ${dishes}` : `${e.label}: ${dishes}`
    })
    return [title, ...lines].join('\n')
  })
  return [...(snowball ? [snowball] : []), opener, ...blocks, ...(link ? [link] : []), invite].join('\n\n')
}

/**
 * Pure: the caption of the week image WhatsApp sends instead of the digest
 * (2026-10-15): the digest's opener, menu link and invite, without the day
 * blocks (the image shows them). Built from the same parts as
 * `weekMenuDigest`, so the image and its text fallback never say different
 * things.
 */
export function weekMenuCaption(menu: WeekMenuInput, opts: WeekReplyOptions): string {
  const { snowball, opener, link, invite } = weekDigestParts(menu, opts)
  const caption = [opener, ...(link ? [link] : []), invite].join('\n')
  return snowball ? `${snowball}\n\n${caption}` : caption
}

/**
 * Why WhatsApp shows the week (2026-10-15): Mimo just made it (`generated`,
 * «Listo: …») or the user asked to see it (`viewing`, «Tu menú de esta
 * semana 🍽️»). Same pieces either way, only the opener changes.
 */
export type WeekView = 'generated' | 'viewing'

export interface WeekReplyOptions {
  /** Europe/Madrid date, `YYYY-MM-DD`. */
  today: string
  /** `WEB_PUBLIC_URL`; absent → no menu link line. */
  webUrl?: string
  /** Default `generated`. */
  view?: WeekView
  /**
   * How many different weeks the household has had generated so far, this
   * one included (menus with a `menu_logs` row, counted by `week_start`).
   * Only read for a generated week: up to `SNOWBALL_WEEKS` → `SNOWBALL_LINE`.
   */
  generatedWeeks?: number
}

/**
 * «Efecto bola de nieve» (Miguel, 2026-10-15): the first generated weeks
 * guess less; saying so up front turns corrections into part of the deal.
 * Wording: Marketing's version A, approved 2026-10-17 (PRO-170), on WhatsApp
 * and in the web chat.
 */
export const SNOWBALL_LINE =
  'Las primeras semanas acertaré menos con los gustos de tu casa. Dime qué cambiarías y lo apunto: así iré acertando cada vez más. Es el efecto bola de nieve ⛄'
/** The snowball line goes with the household's first this-many generated weeks (PRO-170: 2). */
export const SNOWBALL_WEEKS = 2

/** The tools that generate a week's menu (WhatsApp shows the week after them). */
export const MENU_GENERATING_TOOLS: ReadonlySet<string> = new Set(['generate_weekly_menu', 'complete_onboarding'])

/** Did this turn generate a week's menu? */
export function generatedMenuThisTurn(toolsUsed: readonly string[] | undefined): boolean {
  return (toolsUsed ?? []).some((t) => MENU_GENERATING_TOOLS.has(t))
}

/**
 * Pure: Mimo's web chat reply after generating a menu, with the snowball line
 * on top in the household's first `SNOWBALL_WEEKS` generated weeks, as on
 * WhatsApp (PRO-170). Anything else comes back as it was.
 */
export function withSnowballLine(message: string, generatedWeeks: number | undefined): string {
  if (!showsSnowball({ view: 'generated', generatedWeeks }) || message.includes(SNOWBALL_LINE)) return message
  return message.trim() ? `${SNOWBALL_LINE}\n\n${message}` : SNOWBALL_LINE
}

/** Pure: does a generated week carry the snowball line? (1st–2nd generated week: yes.) */
export function showsSnowball(opts: Pick<WeekReplyOptions, 'view' | 'generatedWeeks'>): boolean {
  return (opts.view ?? 'generated') === 'generated'
    && typeof opts.generatedWeeks === 'number'
    && opts.generatedWeeks >= 1
    && opts.generatedWeeks <= SNOWBALL_WEEKS
}

export interface WeekMenuInput {
  weekStart: string
  days: Array<DayMenu | null | undefined> | null | undefined
  skippedDays?: number[] | null
}

/** The pieces both the week digest and the week image caption are made of. */
function weekDigestParts(menu: WeekMenuInput, opts: WeekReplyOptions) {
  const days = Array.isArray(menu.days) ? menu.days : []
  const weekStart = menu.weekStart.slice(0, 10)
  const today = opts.today.slice(0, 10)
  const tomorrow = plusDays(today, 1)

  const all = Array.from({ length: 7 }, (_, i) => {
    const skipped = menu.skippedDays?.includes(i) ?? false
    return { i, date: plusDays(weekStart, i), skipped, entries: skipped ? [] : mealEntriesForDay(days[i]) }
  })
  const visibleFrom = (from: number) => all.filter((d) => d.i >= from && (d.skipped || d.entries.length > 0))

  const todayIndex = all.findIndex((d) => d.date === today)
  // Generated mid-week: from today on. Another week, or nothing left from
  // today on: the whole week.
  const fromToday = todayIndex >= 0 && visibleFrom(todayIndex).length > 0
  const shown = visibleFrom(fromToday ? todayIndex : 0)

  // Asked to see it: "Tu menú de esta semana" / "…de la semana del 19 al 25
  // de octubre", never «Listo:» (nothing was just made).
  const opener = opts.view === 'viewing'
    ? todayIndex >= 0
      ? 'Tu menú de esta semana 🍽️'
      : `Tu menú de la semana ${weekRangeEs(weekStart)} 🍽️`
    : !fromToday
      ? `Listo: tu menú de la semana ${weekRangeEs(weekStart)} 🍽️`
      : todayIndex === 6
        ? 'Listo: tu menú de hoy 🍽️'
        : 'Listo: tu menú hasta el domingo 🍽️'
  const snowball = showsSnowball(opts) ? SNOWBALL_LINE : null
  const link = opts.webUrl ? `📖 Recetas y lista de la compra: ${shortWebLink(opts.webUrl, '/menu')}` : null
  const invite = menuDigestInvite(shown.filter((d) => !d.skipped && d.date !== today).map((d) => d.i))
  return { snowball, opener, shown, link, invite, today, tomorrow }
}

/**
 * The closing line of the week digest, with an example on a day still to
 * come that the message shows ("el sábado" on a Thursday): the second such
 * day when there are several, the only one otherwise, "hoy" when today is all
 * that's left.
 */
export function menuDigestInvite(upcomingDayIndexes: number[]): string {
  const i = upcomingDayIndexes[Math.min(1, upcomingDayIndexes.length - 1)]
  const when = i === undefined ? 'hoy' : `el ${DAY_NAME_ES[i]}`
  return `¿Cambio algo? Dímelo, p. ej. «${when}, pescado».`
}
