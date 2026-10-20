import type { DayMenu } from '@ona/shared'
import { mealEntriesForDay, recipeLinkLines, recipesOfDay, shortRecipeLink } from '../menuText.js'
import type { OutboundMessage } from './render.js'
import type { GuideSpec } from './guided.js'
import { taperReminderLine } from '../taper.js'
import { agreementFacts } from './dishAgreement.js'
import { freezerReviewDue, freezerReviewGuide, freezerReviewMessages, isFreezerReviewWindow, type FreezerItem } from './freezerReview.js'

/**
 * Pure planning for messages Mimoia sends first (the Instinct-style "it texts
 * you when something needs attention"):
 *   - daily brief at breakfast time: today's menu + "¿cambio algo?"
 *   - Sunday evening nudge: "¿te preparo el menú de la semana que viene?"
 *     when next week has no menu yet
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
const nowMinutes = (p: MadridParts) => p.hour * 60 + p.minute
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export const DEFAULT_DINNER_MIN = 21 * 60

/**
 * Long dinners only (≥ 40 min): a 20-minute window ending when the user
 * should start so dinner is ready at their dinner time (10-min buffer).
 */
export const COOKING_REMINDER_MIN_TOTAL = 40
export function isCookingReminderWindow(p: MadridParts, dinnerTime: string | null, totalMinutes: number): boolean {
  if (totalMinutes < COOKING_REMINDER_MIN_TOTAL) return false
  const start = minutesOf(dinnerTime, DEFAULT_DINNER_MIN) - totalMinutes - 10
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
/** Saturday 10:00–12:59 Madrid. */
export function isShoppingReminderWindow(p: MadridParts): boolean {
  return p.weekday === 5 && p.hour >= 10 && p.hour < 13
}
/** Cooking reminders can only fire in the afternoon/evening; cheap pre-check. */
export function couldNeedCookingReminder(p: MadridParts, dinnerTime: string | null): boolean {
  const d = minutesOf(dinnerTime, DEFAULT_DINNER_MIN)
  return nowMinutes(p) >= d - 4 * 60 && nowMinutes(p) < d
}

export function formatCookingReminder(name: string, totalMinutes: number, dinnerTime: string | null): string {
  return `Si quieres cenar a las ${hhmm(minutesOf(dinnerTime, DEFAULT_DINNER_MIN))}, toca empezar con *${name}* (unos ${totalMinutes} min).`
}
export function formatShoppingReminder(pending: string[], webUrl: string): string {
  const shown = pending.slice(0, 8).join(', ')
  return `¿Toca compra? Te faltan ${pending.length} cosas: ${shown}${pending.length > 8 ? '…' : ''}.\n\nVer lista de la compra: ${webUrl}/shopping`
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

export function cookingReminderGuide(name: string, totalMinutes: number, dinnerTime: string | null): GuideSpec {
  const at = hhmm(minutesOf(dinnerTime, DEFAULT_DINNER_MIN))
  return {
    kind: 'cooking_reminder',
    facts: [`Plato de la cena: ${name}`, ...agreementFacts([name]), `Hora de la cena: ${at}`, `Lleva unos ${totalMinutes} min`],
    required: [name, at, String(totalMinutes)],
    dishes: [name],
  }
}

export function dinnerCheckinGuide(name: string, askRating = false): GuideSpec {
  if (askRating) {
    return {
      kind: 'dinner_checkin',
      facts: [
        `Cena de hoy en el menú: ${name}`,
        ...agreementFacts([name]),
        'En el mismo mensaje: si la hizo, qué tal estuvo y si la repetimos; si no les gustó, que lo diga y no vuelve a salir sola.',
        `Botones debajo: «${CHECKIN_RATING_BUTTONS[0].title}» / «${CHECKIN_RATING_BUTTONS[1].title}» / «${CHECKIN_RATING_BUTTONS[2].title}»`,
      ],
      required: [name],
      dishes: [name],
    }
  }
  return {
    kind: 'dinner_checkin',
    facts: [`Cena de hoy en el menú: ${name}`, ...agreementFacts([name]), `Botones debajo: «${CHECKIN_BUTTONS[0].title}» / «${CHECKIN_BUTTONS[1].title}»`],
    required: [name],
    dishes: [name],
  }
}

/**
 * PRO-274: the buttons don't carry the dish's gender («Sí, la hice» read
 * wrong under «Sándwich vegetal»): «Sí, hecho» fits any dish. The ids are
 * what counts; the reply's title reaches Mimo as the user's words.
 */
export const CHECKIN_BUTTONS = [
  { id: 'checkin:yes', title: 'Sí, hecho' },
  { id: 'checkin:no', title: 'No' },
] as const

/**
 * PRO-235: «¿hiciste la cena?» and «¿repetimos?» (PRO-110) are ONE message.
 * When the household hasn't rated tonight's recipe (30-day rule,
 * `shouldAskRating`), the check-in asks both and its buttons answer both
 * (5 = «Repetir a menudo», 3 = «Bien»); «mejor no» (1) by text.
 */
export const CHECKIN_RATING_BUTTONS = [
  { id: 'checkin:yes:5', title: 'Sí, ¡a repetir!' },
  { id: 'checkin:yes:3', title: 'Sí, estuvo bien' },
  { id: 'checkin:no', title: 'No' },
] as const
export function formatDinnerCheckin(name: string, askRating: boolean): OutboundMessage {
  if (!askRating) {
    return {
      type: 'buttons',
      text: `¿Hiciste hoy la cena (*${name}*)? Así lo apunto.`,
      buttons: CHECKIN_BUTTONS.map((b) => ({ ...b })),
    }
  }
  return {
    type: 'buttons',
    text: `¿Hiciste hoy la cena (*${name}*)? Si la hiciste, ¿qué tal? ¿La repetimos? Si no os gustó, dímelo y no vuelve a salir sola.`,
    buttons: CHECKIN_RATING_BUTTONS.map((b) => ({ ...b })),
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

export function shoppingReminderGuide(pending: string[], webUrl: string): GuideSpec {
  return {
    kind: 'shopping_reminder',
    facts: [`Cosas pendientes en la lista: ${pending.length}`, `Algunas: ${pending.slice(0, 8).join(', ')}`, `Enlace a la lista: ${webUrl}/shopping`],
    required: [String(pending.length), `${webUrl}/shopping`],
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
  pendingShopping: () => Promise<string[]>
  hasNextWeekMenu: () => Promise<boolean>
  /** PRO-235: the person already saw today's menu this morning in a conversation. */
  sawTodaysMenu?: () => Promise<boolean>
  /** PRO-235: ask «¿qué tal? ¿repetimos?» about this recipe (not rated in the last 30 days). */
  askRating?: (recipeId: string) => Promise<boolean>
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
        messages: [{ type: 'text', text: formatCookingReminder(dinner.names[0], dinner.totalMinutes, input.dinnerTime) }],
        guide: cookingReminderGuide(dinner.names[0], dinner.totalMinutes, input.dinnerTime),
      })
    }
  }

  if (can('dinner_checkin') && isDinnerCheckinWindow(p, input.dinnerTime)) {
    const dinner = await input.todayDinner()
    if (dinner?.names.length && !(await input.cookedToday())) {
      const recipeId = dinner.recipeIds?.[0]
      const rate = Boolean(recipeId && input.askRating && (await input.askRating(recipeId)))
      out.push({
        kind: 'dinner_checkin',
        messages: [formatDinnerCheckin(dinner.names[0], rate)],
        guide: dinnerCheckinGuide(dinner.names[0], rate),
      })
    }
  }

  if (can('shopping_reminder') && isShoppingReminderWindow(p)) {
    const pending = await input.pendingShopping()
    if (pending.length >= 3) {
      out.push({
        kind: 'shopping_reminder',
        messages: [{ type: 'text', text: formatShoppingReminder(pending, input.webUrl) }],
        guide: shoppingReminderGuide(pending, input.webUrl),
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

  if (can('weekly_nudge') && isWeeklyNudgeWindow(p) && !(await input.hasNextWeekMenu())) {
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

  return out
}

/** Any proactive window that could fire now (cheap pre-check before DB work). */
export function anyProactiveWindow(p: MadridParts, breakfastTime: string | null, dinnerTime: string | null): boolean {
  return (
    isDailyBriefWindow(p, breakfastTime) ||
    couldNeedCookingReminder(p, dinnerTime) ||
    isDinnerCheckinWindow(p, dinnerTime) ||
    isShoppingReminderWindow(p) ||
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
