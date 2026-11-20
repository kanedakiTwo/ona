import { alertKindOn, type DayMenu } from '@ona/shared'
import { mealEntriesForDay, recipeLinkLines, recipesOfDay, shortRecipeLink } from '../menuText.js'
import type { OutboundMessage } from './render.js'
import { guideInLanguage, type GuideSpec } from './guided.js'
import { taperReminderLine } from '../taper.js'
import { agreementFacts } from './dishAgreement.js'
import { freezerReviewDue, freezerReviewGuide, freezerReviewMessages, isFreezerReviewWindow, type FreezerItem } from './freezerReview.js'
import { localizeButtons, type Lang } from './language.js'

/**
 * Pure planning for messages Mimoia sends first (the Instinct-style "it texts
 * you when something needs attention"):
 *   - daily brief at breakfast time: today's menu + "¿cambio algo?"
 *   - Sunday evening nudge: "¿te preparo el menú de la semana que viene?"
 *     when next week has no menu yet — only for whoever switched off the
 *     Thursday autopilot (`weekly_autoplan`, PRO-381)
 * Prep alerts ("saca el pescado del congelador") come from the existing
 * notification_schedule queue — see notificationScheduler.ts.
 *
 * The clock is Europe/Madrid regardless of the server's TZ (Railway = UTC).
 */

export { MADRID_TZ, madridParts, mondayOf, type MadridParts } from '../madridTime.js'
import type { MadridParts } from '../madridTime.js'

export const PROACTIVE_KINDS = [
  'daily_brief',
  'weekly_nudge',
  'prep_alerts',
  'cooking_reminder',
  'dinner_checkin',
  'shopping_reminder',
  'freezer_review',
] as const
export type ProactiveKind = (typeof PROACTIVE_KINDS)[number]

export const PROACTIVE_LABELS: Record<ProactiveKind, string> = {
  daily_brief: 'resumen de la mañana',
  weekly_nudge: 'propuesta de menú del domingo',
  prep_alerts: 'avisos de preparación (descongelar, remojo…)',
  cooking_reminder: 'aviso de empezar a cocinar',
  dinner_checkin: '"¿hiciste la cena?"',
  shopping_reminder: 'recordatorio de la compra',
  freezer_review: 'repaso del congelador (una vez al mes)',
}

/**
 * Kinds that only go to whoever asked for them (PRO-215, D-069: «el resumen
 * de cada mañana sale solo a quien lo pida»): off unless `prefs[kind] === true`.
 */
export const OPT_IN_KINDS: ReadonlySet<ProactiveKind> = new Set<ProactiveKind>(['daily_brief'])

/** Missing key = on (except the opt-in kinds: missing = off); the master `notify` switch is checked separately. */
export function kindEnabled(prefs: Record<string, boolean> | null | undefined, kind: ProactiveKind): boolean {
  if (OPT_IN_KINDS.has(kind)) return prefs?.[kind] === true
  return prefs?.[kind] !== false
}

/**
 * PRO-216: which avisos a PATCH switches off (for the `notifications_off`
 * usage event): `all` when the master switch goes from on to off, plus each
 * kind that was on and now isn't.
 */
export function kindsSwitchedOff(
  before: { notify: boolean; prefs: Record<string, boolean> | null | undefined },
  patch: { notify?: boolean; prefs?: Record<string, boolean> },
): string[] {
  const out: string[] = []
  if (before.notify && patch.notify === false) out.push('all')
  for (const [k, v] of Object.entries(patch.prefs ?? {})) {
    if (v === false && (PROACTIVE_KINDS as readonly string[]).includes(k) && kindEnabled(before.prefs, k as ProactiveKind)) out.push(k)
  }
  return out
}

/** "20:30" → 1230; garbage → fallback. */
export function minutesOf(time: string | null | undefined, fallback: number): number {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback
}
const nowMinutes = (p: Pick<MadridParts, 'hour' | 'minute'>) => p.hour * 60 + p.minute
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export const DEFAULT_DINNER_MIN = 21 * 60

/**
 * 19-nov (55 «hora de cocinar» → 3 answers): only dishes that make you start
 * early, more than 45 min (marinar, descongelar and remojo keep their own
 * prep alerts). A 20-minute window ending when the user should start so
 * dinner is ready at their dinner time (10-min buffer).
 */
export const COOKING_REMINDER_MIN_TOTAL = 45
/** Minutes between «empieza a cocinar» + the dish's minutes and dinner time. */
export const COOKING_MARGIN_MIN = 10
export function isCookingReminderWindow(p: MadridParts, dinnerTime: string | null, totalMinutes: number): boolean {
  if (totalMinutes <= COOKING_REMINDER_MIN_TOTAL) return false
  const start = minutesOf(dinnerTime, DEFAULT_DINNER_MIN) - totalMinutes - COOKING_MARGIN_MIN
  return nowMinutes(p) >= start - 10 && nowMinutes(p) < start + 10
}
/**
 * Between 2 h and 3 h after dinner time — but never after 22:30 (PRO-236):
 * a late dinner moves it to 22:00–22:30, as long as that's at least 1 h
 * after dinner (dinner after 21:00 → no check-in that day).
 */
export function isDinnerCheckinWindow(p: MadridParts, dinnerTime: string | null): boolean {
  const d = minutesOf(dinnerTime, DEFAULT_DINNER_MIN)
  const start = Math.min(d + 120, 22 * 60)
  const end = Math.min(d + 180, 22 * 60 + 30)
  if (start < d + 60) return false
  return nowMinutes(p) >= start && nowMinutes(p) < end
}
/**
 * 19-nov: how a household uses the shopping list, from its ticks on it
 * (`activity_events` shopping_check / shopping_stock). The reminder only goes
 * to whoever used it in the last 14 days; when they tick it on the same
 * weekday at least twice in the last 4 weeks, it goes that day, an hour
 * before they usually start (`day`/`hour`); otherwise Saturday 10:00–12:59.
 */
export interface ShoppingUse {
  usedRecently: boolean
  /** Madrid weekday (0 = Monday) and hour the reminder goes; null = Saturday 10:00. */
  day: number | null
  hour: number | null
}
export const SHOPPING_USE_DAYS = 14
export const SHOPPING_HABIT_DAYS = 28
export function shoppingUseFrom(checks: readonly Date[], now: Date, partsOf: (d: Date) => MadridParts): ShoppingUse {
  const DAY = 24 * 60 * 60 * 1000
  const recent = checks.filter((d) => now.getTime() - d.getTime() <= SHOPPING_HABIT_DAYS * DAY && d.getTime() <= now.getTime())
  const usedRecently = recent.some((d) => now.getTime() - d.getTime() <= SHOPPING_USE_DAYS * DAY)
  // Earliest tick of each Madrid day.
  const firstOfDay = new Map<string, MadridParts>()
  for (const d of recent) {
    const p = partsOf(d)
    const prev = firstOfDay.get(p.isoDate)
    if (!prev || p.hour * 60 + p.minute < prev.hour * 60 + prev.minute) firstOfDay.set(p.isoDate, p)
  }
  const byWeekday = new Map<number, number[]>()
  for (const p of firstOfDay.values()) byWeekday.set(p.weekday, [...(byWeekday.get(p.weekday) ?? []), p.hour])
  const ranked = [...byWeekday.entries()].sort((a, b) => b[1].length - a[1].length)
  const [top, second] = ranked
  if (!usedRecently || !top || top[1].length < 2 || (second && second[1].length === top[1].length)) return { usedRecently, day: null, hour: null }
  const hours = [...top[1]].sort((a, b) => a - b)
  const median = hours[Math.floor((hours.length - 1) / 2)]
  return { usedRecently, day: top[0], hour: Math.min(20, Math.max(9, median - 1)) }
}
/** The household's shopping time (two hours from `hour` on `day`), else Saturday 10:00–12:59 Madrid. */
export function isShoppingReminderWindow(p: MadridParts, use?: ShoppingUse | null): boolean {
  if (use && use.day !== null && use.hour !== null) return p.weekday === use.day && p.hour >= use.hour && p.hour < use.hour + 2
  return p.weekday === 5 && p.hour >= 10 && p.hour < 13
}
/** Cooking reminders can only fire in the afternoon/evening; cheap pre-check. */
export function couldNeedCookingReminder(p: MadridParts, dinnerTime: string | null): boolean {
  const d = minutesOf(dinnerTime, DEFAULT_DINNER_MIN)
  return nowMinutes(p) >= d - 4 * 60 && nowMinutes(p) < d
}

/**
 * 19-nov: two buttons under «hora de cocinar». «Lo hago» is recorded without
 * the model; «Cambia a algo rápido» reaches Mimo as `COOKING_SWAP_REQUEST`,
 * so it swaps tonight's dinner with its own tool. (WhatsApp: ≤ 20 chars.)
 */
export const COOKING_BUTTONS = [
  { id: 'cooking:ok', title: 'Lo hago' },
  { id: 'cooking:swap', title: 'Cambia a algo rápido' },
] as const
export const COOKING_SWAP_REQUEST: Record<Lang, string> = {
  es: 'Cámbiame la cena de hoy por algo rápido',
  en: "Swap tonight's dinner for something quick",
}
export const COOKING_OK_REPLY: Record<Lang, string> = {
  es: '¡Genial! Que salga rica la cena.',
  en: 'Great, enjoy cooking!',
}

export function formatCookingReminder(name: string, totalMinutes: number, dinnerTime: string | null, lang: Lang = 'es'): OutboundMessage {
  const at = hhmm(minutesOf(dinnerTime, DEFAULT_DINNER_MIN))
  const text =
    lang === 'en'
      ? `To have dinner at ${at}, it's time to start *${name}* (about ${totalMinutes} min).`
      : `Si quieres cenar a las ${at}, toca empezar con *${name}* (unos ${totalMinutes} min).`
  return { type: 'buttons', text, buttons: COOKING_BUTTONS.map((b) => ({ ...b })) }
}

/**
 * 19-nov (21 Saturday reminders → 1 answer: «quedan 139 cosas», «ajo,
 * albahaca, apio…»): no count and no alphabetical list. The link to the list
 * and, if any, the fresh things still to buy (fruit, veg, meat, fish), five
 * at most.
 */
export const FRESH_AISLES: ReadonlySet<string> = new Set(['produce', 'proteinas'])
export const FRESH_MAX = 5
export function freshPending(items: ReadonlyArray<{ name: string; aisle?: string | null }>): string[] {
  return [...new Set(items.filter((i) => i.aisle && FRESH_AISLES.has(i.aisle)).map((i) => i.name))].slice(0, FRESH_MAX)
}
export function formatShoppingReminder(fresh: readonly string[], webUrl: string, lang: Lang = 'es'): string {
  const link = `${webUrl}/shopping`
  if (lang === 'en') {
    return fresh.length
      ? `Shopping today? Fresh things still on your list: ${fresh.join(', ')}.\n\nYour list: ${link}`
      : `Shopping today? Your list is ready: ${link}`
  }
  return fresh.length
    ? `¿Hoy toca compra? De lo fresco te falta: ${fresh.join(', ')}.\n\nTu lista: ${link}`
    : `¿Hoy toca compra? Aquí tienes tu lista: ${link}`
}

/** Sunday 18:00–21:59 Madrid. */
export function isWeeklyNudgeWindow(p: MadridParts): boolean {
  return p.weekday === 6 && p.hour >= 18 && p.hour < 22
}

/** From the user's breakfast time (default 09:00) for 90 minutes. */
export function isDailyBriefWindow(p: MadridParts, breakfastTime: string | null | undefined): boolean {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(breakfastTime ?? '')
  const start = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60
  const now = p.hour * 60 + p.minute
  return now >= start && now < start + 90
}

export const DAILY_BRIEF_COOLDOWN_MS = 20 * 60 * 60 * 1000
export const WEEKLY_NUDGE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000

/**
 * PRO-225: the questions asked before planning go in the same Sunday message
 * (not another one). Answered in free text («el jueves cenamos fuera, el
 * sábado somos 6»), they shape only next week's menu (`generate_weekly_menu`
 * `mealsOut` / `guests`); «Sí, prepáralo» generates it as usual.
 */
export const WEEK_PLAN_QUESTIONS = ['¿Alguna comida fuera de casa esta semana?', '¿Viene alguien?'] as const
/** PRO-229: once a week, in this same Sunday message (not another one); text or a photo. */
export const FRIDGE_QUESTION = '¿Qué te queda en la nevera?'

export const WEEKLY_NUDGE_TEXT =
  'Domingo de planificar: ¿te preparo el menú de la semana que viene?\n\n' +
  `Antes, por si acaso: ${WEEK_PLAN_QUESTIONS.join(' ')} ${FRIDGE_QUESTION} ` +
  'Dímelo con tus palabras o mándame una foto de la nevera (p. ej. «el jueves cenamos fuera, el sábado somos 6, queda medio calabacín») y lo tengo en cuenta solo esa semana.'

export function formatDailyBrief(day: DayMenu | null | undefined, webUrl: string): string | null {
  const entries = mealEntriesForDay(day).filter((e) => e.meal !== 'breakfast')
  if (entries.length === 0) return null
  // PRO-85: each recipe right under its meal, with its link; notes get none.
  const lines = entries.flatMap((e) => [
    `- ${capitalize(e.label)}: ${e.dishes.join(' + ')}`,
    ...recipeLinkLines(recipesOfDay(day, [e.meal]), webUrl),
  ])
  return `Buenos días. Hoy toca:\n${lines.join('\n')}\n\n¿Quieres cambiar algo?\n\nVer menú: ${webUrl}/menu`
}

/**
 * PRO-156: what the writer may use for the morning brief and what it must
 * carry (every dish, every recipe link, the menu link). Null when the day is empty.
 */
export function dailyBriefGuide(day: DayMenu | null | undefined, webUrl: string): GuideSpec | null {
  const entries = mealEntriesForDay(day).filter((e) => e.meal !== 'breakfast')
  if (entries.length === 0) return null
  const facts: string[] = []
  const required: string[] = []
  for (const e of entries) {
    facts.push(`${capitalize(e.label)}: ${e.dishes.join(' + ')}`)
    required.push(...e.dishes)
    for (const r of recipesOfDay(day, [e.meal])) {
      const link = shortRecipeLink(webUrl, r.id)
      facts.push(`  enlace de ${r.name}: ${link}`)
      required.push(link)
    }
  }
  facts.push(`Enlace «Ver menú»: Ver menú: ${webUrl}/menu`)
  required.push(`${webUrl}/menu`)
  // PRO-274: gender and number of each dish, so articles and adjectives agree.
  const dishes = [...new Set(entries.flatMap((e) => e.dishes))]
  facts.push(...agreementFacts(dishes))
  return { kind: 'daily_brief', facts, required: [...new Set(required)], dishes }
}

/**
 * 18-nov: the writer used to get only the dinner time and the dish's minutes,
 * and did its own sums («son casi las 20:12» sent at 19:56, «83 min por
 * delante» with 100 to go). Now it gets the time the message goes out, the
 * time to start and the real minutes, and the validator lets through no other
 * hour or minute count (`allowedTimes` / `allowedMinutes`).
 */
export function cookingReminderGuide(
  name: string,
  totalMinutes: number,
  dinnerTime: string | null,
  now: Pick<MadridParts, 'hour' | 'minute'>,
): GuideSpec {
  const dinner = minutesOf(dinnerTime, DEFAULT_DINNER_MIN)
  const at = hhmm(dinner)
  const start = dinner - totalMinutes - COOKING_MARGIN_MIN
  const current = nowMinutes(now)
  const untilStart = start - current
  const untilDinner = dinner - current
  // 20-nov (reviewer): «en 7 min… lleva 48 min y la cena es a las 21:00» read
  // as a wrong sum (19:55 + 7 + 48 ≠ 21:00): the 10 min of margin were silent.
  return {
    kind: 'cooking_reminder',
    facts: [
      `Plato de la cena: ${name}`,
      ...agreementFacts([name]),
      `Hora a la que sale este mensaje: ${hhmm(current)}`,
      untilStart > 0 ? `Empieza a cocinar a las ${hhmm(start)} (dentro de ${untilStart} min)` : `Empieza a cocinar ya (tocaba a las ${hhmm(start)})`,
      `Hora de la cena: ${at} (faltan ${untilDinner} min)`,
      `Lleva unos ${totalMinutes} min, y la hora de empezar deja ${COOKING_MARGIN_MIN} min de margen antes de la cena`,
      `Si das la hora de empezar y los minutos del plato, di también los ${COOKING_MARGIN_MIN} min de margen, para que las cuentas cuadren.`,
      'Horas y minutos: solo los de estos datos, tal cual. No calcules ni redondees otros.',
      `Botones debajo: «${COOKING_BUTTONS[0].title}» / «${COOKING_BUTTONS[1].title}» (cambiarla por algo rápido). No los repitas en el texto.`,
    ],
    required: [name, at, String(totalMinutes)],
    dishes: [name],
    allowedTimes: [hhmm(current), hhmm(start), at],
    allowedMinutes: [totalMinutes, untilDinner, COOKING_MARGIN_MIN, ...(untilStart > 0 ? [untilStart] : [])],
  }
}

/**
 * 19-nov (47 check-ins → 12 answers): ONE question, «¿qué tal la cena?»,
 * and three buttons that answer it without the model (checkinButtons.ts):
 * 👍 (made, liked: rating 4), 👎 (made, not again: rating 1 — it no longer
 * comes out on its own) and «No la hice».
 */
export const CHECKIN_BUTTONS = [
  { id: 'checkin:up', title: '👍' },
  { id: 'checkin:down', title: '👎' },
  { id: 'checkin:no', title: 'No la hice' },
] as const

export function dinnerCheckinGuide(name: string): GuideSpec {
  return {
    kind: 'dinner_checkin',
    facts: [
      `Cena de hoy en el menú: ${name}`,
      ...agreementFacts([name]),
      'Una sola pregunta, con un único «?»: qué tal salió hoy esa cena. Los botones de debajo dicen si gustó, si no, o si no la hicieron: no preguntes nada más.',
      'Habla de «la cena» (el botón dice «No la hice»), con el nombre del plato al lado.',
      `Botones debajo: «${CHECKIN_BUTTONS[0].title}» / «${CHECKIN_BUTTONS[1].title}» / «${CHECKIN_BUTTONS[2].title}»`,
    ],
    required: [name],
    dishes: [name],
  }
}

export function formatDinnerCheckin(name: string, lang: Lang = 'es'): OutboundMessage {
  return {
    type: 'buttons',
    text: lang === 'en' ? `How did tonight's dinner go (*${name}*)? I'll note it down.` : `¿Qué tal ha salido hoy la cena (*${name}*)? Así lo apunto.`,
    buttons: CHECKIN_BUTTONS.map((b) => ({ ...b })),
  }
}

/**
 * 19-nov: never ask about a dessert («¿hiciste la cena?» about a flan) nor
 * a dessert's minutes in «hora de cocinar». Pure.
 */
export function isDessert(r: { course?: string | null; tags?: readonly string[] | null; dishTypes?: readonly string[] | null }): boolean {
  if (r.course === 'dessert') return true
  const tags = (r.tags ?? []).map((t) => t.toLowerCase())
  if (tags.includes('postre') || tags.includes('dulce')) return true
  return (r.dishTypes ?? []).includes('dulce-finde')
}

/**
 * Pure: tonight's dinner from its dishes and their recipes, desserts left
 * out (names, ids and the longest time are the savoury dishes'). Null when
 * nothing is left.
 */
export function todayDinnerOf(
  dishes: ReadonlyArray<{ kind: string; recipeId?: string; recipeName?: string }>,
  recipeRows: ReadonlyArray<{ id: string; totalTime: number | null; prepTime: number | null; cookTime: number | null; course?: string | null; tags?: string[] | null; dishTypes?: string[] | null }>,
  menuId?: string,
): TodayDinner | null {
  const byId = new Map(recipeRows.map((r) => [r.id, r]))
  const mains = dishes.filter((d) => d.kind === 'recipe' && d.recipeId && !(byId.get(d.recipeId) && isDessert(byId.get(d.recipeId)!)))
  if (mains.length === 0) return null
  const minutes = mains
    .map((d) => byId.get(d.recipeId!))
    .map((r) => (r ? r.totalTime ?? ((r.prepTime ?? 0) + (r.cookTime ?? 0) || null) : null))
    .filter((m): m is number => typeof m === 'number' && m > 0)
  return {
    names: mains.map((d) => d.recipeName ?? 'la cena'),
    recipeIds: mains.map((d) => d.recipeId!),
    totalMinutes: minutes.length ? Math.max(...minutes) : null,
    ...(menuId ? { menuId } : {}),
  }
}

/**
 * PRO-235: tools that show today's menu in a conversation. If the person
 * already saw it this morning (asked Mimo, or generated the week), the
 * morning brief doesn't repeat it.
 */
export const MENU_VIEW_TOOLS: ReadonlySet<string> = new Set(['get_todays_menu', 'get_weekly_menu', 'generate_weekly_menu', 'complete_onboarding'])
export function sawTodaysMenu(turns: ReadonlyArray<{ tools?: readonly string[] | null }>): boolean {
  return turns.some((t) => (t.tools ?? []).some((name) => MENU_VIEW_TOOLS.has(name)))
}

export function shoppingReminderGuide(fresh: readonly string[], webUrl: string): GuideSpec {
  return {
    kind: 'shopping_reminder',
    facts: [
      fresh.length ? `Lo fresco que aún falta (frutas, verduras, carne, pescado), tal cual: ${fresh.join(', ')}` : 'No falta nada fresco: solo recuerda la lista.',
      'No digas cuántas cosas quedan ni enumeres el resto de la lista.',
      `Enlace a la lista: ${webUrl}/shopping`,
    ],
    required: [...fresh, `${webUrl}/shopping`],
  }
}

export const WEEKLY_NUDGE_GUIDE: GuideSpec = {
  kind: 'weekly_nudge',
  facts: [
    'Es domingo y la semana que viene aún no tiene menú.',
    'Botones debajo: «Sí, prepáralo» / «Ahora no»',
    // PRO-225: both questions, in this same message, to answer in free text.
    `Pregunta antes de planificar, tal cual: «${WEEK_PLAN_QUESTIONS[0]}»`,
    `Pregunta antes de planificar, tal cual: «${WEEK_PLAN_QUESTIONS[1]}»`,
    'Se contestan con texto libre (p. ej. «el jueves cenamos fuera, el sábado somos 6») y solo cambian esa semana.',
    // PRO-229: the fridge question goes in the same message; a photo of the fridge also works.
    `Pregunta, tal cual: «${FRIDGE_QUESTION}» (vale contestar con texto o con una foto de la nevera)`,
  ],
  required: [...WEEK_PLAN_QUESTIONS, FRIDGE_QUESTION],
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export interface TodayDinner {
  names: string[]
  /** Recipe ids, same order as `names` (PRO-235: to ask «¿repetimos?» about the first). */
  recipeIds?: string[]
  /** The menu the dinner comes from (a tapped check-in button records it there). */
  menuId?: string
  /** Longest total time among today's dinner recipes (min), null if unknown. */
  totalMinutes: number | null
}

export interface ProactiveInput {
  parts: MadridParts
  breakfastTime: string | null
  dinnerTime: string | null
  prefs: Record<string, boolean>
  /** Kinds already sent within their cooldown. */
  sentRecently: Partial<Record<ProactiveKind, boolean>>
  /** Lazy so the DB is only hit inside the right time window. */
  todayDay: () => Promise<DayMenu | null>
  todayDinner: () => Promise<TodayDinner | null>
  cookedToday: () => Promise<boolean>
  /** What is still to buy on the list, with its aisle (19-nov: for the fresh things). */
  pendingShopping: () => Promise<Array<{ name: string; aisle?: string | null }>>
  /** 19-nov: whether and when the household uses the list (null/absent = Saturday, as before). */
  shoppingUse?: ShoppingUse | null
  hasNextWeekMenu: () => Promise<boolean>
  /** PRO-235: the person already saw today's menu this morning in a conversation. */
  sawTodaysMenu?: () => Promise<boolean>
  /** 19-nov: tonight's dish is leftovers of one already cooked and rated → no check-in. */
  ratedLeftover?: (recipeId: string) => Promise<boolean>
  /** 19-nov: the person's language (lazy: only read when something goes out). Absent → Spanish. */
  language?: () => Promise<Lang>
  /** PRO-223: tápers of tomorrow that come from tonight's dinner (null if none). */
  taperTonight?: () => Promise<{ recipeNames: string[]; count: number } | null>
  /** PRO-228: when the last freezer review went out (any time), null if never. */
  lastFreezerReviewAt?: () => Promise<Date | null>
  /** PRO-228: freezer rows that went in 4+ weeks ago. */
  freezerItemsDue?: () => Promise<FreezerItem[]>
  webUrl: string
}

export interface PlannedMessage {
  kind: ProactiveKind
  /** Today's fixed text: what goes out when the guided writer can't (PRO-156). */
  messages: OutboundMessage[]
  /** How to write the (single) message from its guide instead. */
  guide?: GuideSpec
}

export async function planProactive(input: ProactiveInput): Promise<PlannedMessage[]> {
  const out: PlannedMessage[] = []
  const can = (k: ProactiveKind) => kindEnabled(input.prefs, k) && !input.sentRecently[k]
  const p = input.parts
  let langP: Promise<Lang> | null = null
  const lang = () => (langP ??= input.language ? input.language().catch(() => 'es' as const) : Promise.resolve('es' as const))

  if (can('daily_brief') && isDailyBriefWindow(p, input.breakfastTime)) {
    const day = await input.todayDay()
    const text = formatDailyBrief(day, input.webUrl)
    const guide = dailyBriefGuide(day, input.webUrl)
    if (text && guide && !(await input.sawTodaysMenu?.())) out.push({ kind: 'daily_brief', messages: [{ type: 'text', text }], guide })
  }

  if (can('cooking_reminder') && couldNeedCookingReminder(p, input.dinnerTime)) {
    const dinner = await input.todayDinner()
    if (dinner?.totalMinutes && dinner.names.length && isCookingReminderWindow(p, input.dinnerTime, dinner.totalMinutes)) {
      out.push({
        kind: 'cooking_reminder',
        messages: [formatCookingReminder(dinner.names[0], dinner.totalMinutes, input.dinnerTime, await lang())],
        guide: cookingReminderGuide(dinner.names[0], dinner.totalMinutes, input.dinnerTime, p),
      })
    }
  }

  if (can('dinner_checkin') && isDinnerCheckinWindow(p, input.dinnerTime)) {
    const dinner = await input.todayDinner()
    const recipeId = dinner?.recipeIds?.[0]
    // 19-nov: never about leftovers already rated (the check-in asked about them again).
    if (dinner?.names.length && !(await input.cookedToday()) && !(recipeId && (await input.ratedLeftover?.(recipeId)))) {
      out.push({
        kind: 'dinner_checkin',
        messages: [formatDinnerCheckin(dinner.names[0], await lang())],
        guide: dinnerCheckinGuide(dinner.names[0]),
      })
    }
  }

  // 19-nov: only to households that use the list (ticked it in the last 14 days).
  const shopUse = input.shoppingUse
  if (can('shopping_reminder') && shopUse?.usedRecently !== false && isShoppingReminderWindow(p, shopUse)) {
    const pending = await input.pendingShopping()
    if (pending.length >= 3) {
      const fresh = freshPending(pending)
      out.push({
        kind: 'shopping_reminder',
        messages: [{ type: 'text', text: formatShoppingReminder(fresh, input.webUrl, await lang()) }],
        guide: shoppingReminderGuide(fresh, input.webUrl),
      })
    }
  }

  // PRO-223: «haz una ración más, mañana te llevas táper» rides on a message
  // that goes out anyway today (morning brief or «toca empezar»), never alone.
  const carrier = out.find((m) => m.kind === 'cooking_reminder') ?? out.find((m) => m.kind === 'daily_brief')
  if (carrier && input.taperTonight) {
    const t = await input.taperTonight()
    if (t) {
      const line = taperReminderLine(t)
      carrier.messages = carrier.messages.map((m, i) => (i === 0 && (m.type === 'text' || m.type === 'buttons') ? { ...m, text: `${m.text}\n\n${line}` } : m))
      if (carrier.guide) {
        carrier.guide = {
          ...carrier.guide,
          facts: [...carrier.guide.facts, `Recordatorio del táper, tal cual: ${line}`],
          required: [...carrier.guide.required, 'táper'],
        }
      }
    }
  }

  // PRO-228: once a month, only with something 4+ weeks in the freezer.
  // Priority 2 of the weekly cap (FREEZER_REVIEW_PRIORITY, PRO-215).
  if (
    can('freezer_review') && isFreezerReviewWindow(p) && input.freezerItemsDue && input.lastFreezerReviewAt &&
    freezerReviewDue(p, await input.lastFreezerReviewAt())
  ) {
    const items = await input.freezerItemsDue()
    if (items.length > 0) {
      out.push({ kind: 'freezer_review', messages: freezerReviewMessages(items), guide: freezerReviewGuide(items) })
    }
  }

  // PRO-381 (D-158): with the Thursday autopilot on, the Sunday question doesn't go.
  if (can('weekly_nudge') && !alertKindOn('weekly_autoplan', input.prefs) && isWeeklyNudgeWindow(p) && !(await input.hasNextWeekMenu())) {
    out.push({
      kind: 'weekly_nudge',
      messages: [
        {
          type: 'buttons',
          text: WEEKLY_NUDGE_TEXT,
          buttons: [
            { id: 'nudge:yes', title: 'Sí, prepáralo' },
            { id: 'nudge:no', title: 'Ahora no' },
          ],
        },
      ],
      guide: WEEKLY_NUDGE_GUIDE,
    })
  }

  // 19-nov: in the person's language — English button titles and an English
  // writer; the fixed texts that have an English version already use it.
  if (out.length === 0) return out
  const l = await lang()
  if (l === 'es') return out
  return out.map((m) => ({ ...m, messages: localizeButtons(m.messages, l), ...(m.guide ? { guide: guideInLanguage(m.guide, l) } : {}) }))
}

/**
 * 18-nov: avisos whose buttons only Mimo (the model) can answer. With the
 * monthly cap used up, a tap got «Has alcanzado tu límite», so these don't go
 * then. The «¿hiciste la cena?» buttons are recorded without the model
 * (checkinButtons.ts), so the check-in still goes. 19-nov: «hora de cocinar»
 * still goes, without «Cambia a algo rápido» (that one is Mimo's).
 */
export const BUTTONS_NEED_MIMO: ReadonlySet<ProactiveKind> = new Set<ProactiveKind>(['weekly_nudge', 'freezer_review'])
export const MIMO_BUTTON_IDS: ReadonlySet<string> = new Set(['cooking:swap'])
export function withoutMimoButtonAvisos(planned: PlannedMessage[], overCap: boolean): PlannedMessage[] {
  if (!overCap) return planned
  return planned
    .filter((p) => !BUTTONS_NEED_MIMO.has(p.kind))
    .map((p) => ({
      ...p,
      messages: p.messages.map((m) => (m.type === 'buttons' ? { ...m, buttons: m.buttons.filter((b) => !MIMO_BUTTON_IDS.has(b.id)) } : m)),
    }))
}

/** Any proactive window that could fire now (cheap pre-check before DB work). */
export function anyProactiveWindow(p: MadridParts, breakfastTime: string | null, dinnerTime: string | null, shoppingUse?: ShoppingUse | null): boolean {
  return (
    isDailyBriefWindow(p, breakfastTime) ||
    couldNeedCookingReminder(p, dinnerTime) ||
    isDinnerCheckinWindow(p, dinnerTime) ||
    isShoppingReminderWindow(p, shoppingUse) ||
    isWeeklyNudgeWindow(p) ||
    isFreezerReviewWindow(p)
  )
}

/**
 * PRO-215: the avisos of one moment go out as ONE message (they spend one
 * unit of the weekly budget). `parts` come highest priority first; their
 * texts are joined, and the first one with buttons keeps them, with its
 * text last so the question sits right above its buttons. Only when that
 * would pass WhatsApp's 1,024-character limit for a message with buttons
 * do the buttons go in a second message.
 */
export const MERGED_BUTTON_BODY_MAX = 1024
export function mergeMessages(parts: ReadonlyArray<readonly OutboundMessage[]>): OutboundMessage[] {
  if (parts.length === 1) return [...parts[0]]
  const texts: string[] = []
  let withButtons: Extract<OutboundMessage, { type: 'buttons' }> | null = null
  for (const msgs of parts) {
    for (const m of msgs) {
      if (m.type === 'buttons' && !withButtons) withButtons = m
      else if (m.type === 'text' || m.type === 'buttons') texts.push(m.text)
    }
  }
  if (!withButtons) return [{ type: 'text', text: texts.join('\n\n') }]
  const body = [...texts, withButtons.text].join('\n\n')
  if (body.length <= MERGED_BUTTON_BODY_MAX) return [{ ...withButtons, text: body }]
  return [{ type: 'text', text: texts.join('\n\n') }, withButtons]
}

/** Swap the text of a planned message for the guided one (buttons stay as they are). */
export function withText(messages: OutboundMessage[], text: string): OutboundMessage[] {
  if (messages.length !== 1) return messages
  const [m] = messages
  if (m.type === 'text') return [{ ...m, text }]
  if (m.type === 'buttons') return [{ ...m, text }]
  return messages
}

// ─── Delivery channel choice ─────────────────────────────────────

/**
 * Meta lets a business send free-form messages only within 24 h of the
 * user's last message ("customer service window"). Outside it, only an
 * approved template goes through. Keep a 30-minute safety margin.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000 - 30 * 60 * 1000

export type Delivery = 'session' | 'template' | 'skip'

/**
 * Which approved template carries a proactive message of `kind` outside the
 * 24 h window: the per-kind one from WHATSAPP_TEMPLATES (JSON map, e.g.
 * {"daily_brief":"ona_menu_de_hoy","alert":"ona_aviso_preparacion"}),
 * else the generic WHATSAPP_TEMPLATE_NAME, else none (the message is
 * skipped). Meta reviews templates per use: one generic "{{1}}" wrapper
 * for everything is what its policy discourages.
 */
export function templateFor(kind: string, perKind: Readonly<Record<string, string>>, generic: string): string | null {
  const named = perKind[kind]
  if (typeof named === 'string' && named.trim()) return named.trim()
  return generic.trim() || null
}

/** Parse WHATSAPP_TEMPLATES; anything malformed → {} (log once at boot). */
export function parseTemplateMap(raw: string): Record<string, string> {
  if (!raw.trim()) return {}
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter(([, name]) => typeof name === 'string' && name.trim())) as Record<string, string>
  } catch {
    console.warn('[whatsapp] WHATSAPP_TEMPLATES is not valid JSON; ignoring it')
    return {}
  }
}

export function chooseDelivery(
  lastInboundAt: Date | null,
  now: Date,
  templateConfigured: boolean,
): Delivery {
  if (lastInboundAt && now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS) return 'session'
  return templateConfigured ? 'template' : 'skip'
}

/**
 * Pure: how a proactive message of `kind` goes out now (PRO-1076). Inside
 * the 24 h window, free-form; outside it, by the kind's approved template
 * (`templateFor`); without one, skipped (logged `fuera_ventana`).
 */
export function deliveryFor(
  kind: string,
  lastInboundAt: Date | null,
  now: Date,
  perKind: Readonly<Record<string, string>>,
  generic: string,
): { delivery: Delivery; template: string | null } {
  const template = templateFor(kind, perKind, generic)
  const delivery = chooseDelivery(lastInboundAt, now, Boolean(template))
  return { delivery, template: delivery === 'template' ? template : null }
}

/**
 * Template body parameters can't contain newlines, tabs or 4+ consecutive
 * spaces (Meta rejects the send). Buttons are folded into the text.
 */
export function templateParamFrom(messages: OutboundMessage[]): string {
  const text = messages
    .map((m) =>
      m.type === 'buttons'
        ? `${m.text} Responde: ${m.buttons.map((b) => b.title).join(' / ')}.`
        : m.text,
    )
    .join(' ')
  return text.replace(/\s+/g, ' ').trim().slice(0, 1000)
}

// ─── Outcome of one channel (see notifications/channels.ts) ─────

export interface ChannelOutcome {
  status: 'ok' | 'skipped' | 'error'
  error?: string
}
