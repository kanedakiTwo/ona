/**
 * PRO-1292 (ahorro de API): messages the code answers without the model.
 *
 * From 19 to 23 Nov «siguiente» in cook mode and «¿qué hay hoy?» / «mándame el
 * menú» still went to the model (0,16–0,28 € a turn, after a pause) to read
 * something already stored. Now a narrow recognizer, by closed phrases and
 * only when the WHOLE message is that, answers them here:
 *   - `ver_menu`: today's, tomorrow's, a weekday's menu, or the week's (on
 *     WhatsApp the week goes as the same picture as always, inbound.ts);
 *   - `paso_cocina`: «siguiente», «anterior», «repite» in cook mode (web).
 * Anything else — another request, a doubt, a menu that isn't there — goes to
 * the model as before. The reply runs the same tools the model would
 * (get_todays_menu, get_weekly_menu), so it says what the app says, and leaves
 * the same trace (⟦hecho: …⟧ in history). Event `mimo_code_reply {kind}`.
 */
import type { DayMenu } from '@ona/shared'
import { madridParts } from '../madridTime.js'
import { mealEntriesForDay, weekRangeEs } from '../menuText.js'
import { DAY_NAMES, menuDayOf } from './menuDay.js'
import type { CookStep } from './pageContext.js'
import type { AssistantResponse, SkillContext, SkillResult, ToolTrace } from './types.js'

export type CodeReplyKind = 'ver_menu' | 'paso_cocina'
export const CODE_REPLY_KINDS: readonly CodeReplyKind[] = ['ver_menu', 'paso_cocina']

export type MealFilter = 'breakfast' | 'lunch' | 'dinner'
export type StepDirection = 'next' | 'previous' | 'repeat'

export type CodeIntent =
  | { kind: 'ver_menu'; scope: 'day'; day: string; meal: MealFilter | null }
  | { kind: 'ver_menu'; scope: 'week'; nextWeek: boolean }
  | { kind: 'paso_cocina'; direction: StepDirection }

/** Accents and punctuation off, lower case, one space: what the phrases compare. */
export function normalizeCodeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Words around the request that change nothing («venga, siguiente», «hola mimo, ¿qué hay hoy?», «… porfa»).
const LEAD = /^(?:hola|buenas|buenos dias|buenas tardes|buenas noches|mimo|oye|venga|vale|ok|okey|okay|bueno|bien|perfecto|genial|listo|hecho|ya esta|ya|pues|a ver|y|eh)\s+/
const TAIL = /\s+(?:por favor|porfa|plis|gracias|mimo|vale|ok)$/

function strip(t: string): string {
  let prev = ''
  while (prev !== t) {
    prev = t
    t = t.replace(LEAD, '').replace(TAIL, '')
  }
  return t.trim()
}

const STEP_NEXT = /^(?:(?:dime |lee(?:me)? |pasa(?:me)? al |vamos al |ve al )?(?:el )?(?:paso )?(?:siguiente|proximo)(?: paso)?|sigue|seguimos|continua|continuamos|adelante)$/
const STEP_PREVIOUS = /^(?:(?:vuelve al |volvemos al |ve al |dime |lee(?:me)? )?(?:el )?(?:paso )?anterior(?: paso)?|atras|vuelve atras|(?:vuelve |ve )?un paso atras|paso atras)$/
const STEP_REPEAT = /^(?:repite(?:lo|me|melo)?(?: el paso)?(?: otra vez)?|repitemelo|me lo repites|puedes repetir(?:lo|melo)?|otra vez|vuelve a leer(?:lo|melo| el paso)?|lee(?:lo|melo)? otra vez)$/

const WEEKDAY = '(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)'
const DAY = `(?:hoy|manana|pasado manana|esta noche|(?:el |este |del )?${WEEKDAY})`
// «¿qué hay / toca / comemos / cenamos …?»
const VERB =
  '(?:hay|toca|tenemos|tengo|comemos|como|cenamos|ceno|desayunamos|desayuno|vamos a comer|vamos a cenar|se come|se cena)'
const MEAL_WORDS = '(?:de comer|para comer|de comida|de cenar|para cenar|de cena|de desayuno|para desayunar|de desayunar)'
const ASK = '(?:dime|dame|mandame|enviame|ensename|pasame|ver|quiero ver|me pasas|me mandas|me envias|me dices|puedes pasarme|puedes mandarme|cual es)'
const WEEK_WORDS = '(?:semanal|de (?:la|esta|toda la) semana|para (?:la|esta) semana)'
const NEXT_WEEK_WORDS = '(?:de la semana que viene|de la proxima semana|de la semana proxima|de la semana siguiente|para la semana que viene|para la proxima semana)'

const DAY_ASK = new RegExp(`^que ${VERB}(?: ${MEAL_WORDS})?(?: (?:para )?(${DAY}))?(?: ${MEAL_WORDS})?(?: en el menu)?$`)
const DAY_FIRST = new RegExp(`^(${DAY}) que ${VERB}(?: ${MEAL_WORDS})?$`)
const DAY_MENU = new RegExp(`^(?:${ASK} )?(?:el )?menu (?:de |para )?(${DAY})$`)
const WEEK_MENU = new RegExp(`^(?:${ASK} )?(?:el )?menu(?: ${WEEK_WORDS})?$`)
const WEEK_ASK = new RegExp(`^que ${VERB} (?:esta semana|en la semana)$`)
const NEXT_WEEK_MENU = new RegExp(`^(?:${ASK} )?(?:el )?menu ${NEXT_WEEK_WORDS}$`)
const NEXT_WEEK_ASK = new RegExp(`^que ${VERB} (?:la semana que viene|la proxima semana)$`)

/** The meal a «¿qué cenamos…?» asks for (null = the whole day). */
function mealOf(t: string): MealFilter | null {
  if (/\b(cenamos|ceno|cenar|cena|esta noche)\b/.test(t)) return 'dinner'
  if (/\b(desayunamos|desayuno|desayunar)\b/.test(t)) return 'breakfast'
  if (/\b(comemos|como|comer|comida)\b/.test(t)) return 'lunch'
  return null
}

/** «el jueves» / «del jueves» / «este jueves» → the words get_todays_menu takes. */
function dayWords(raw: string | undefined): string {
  if (!raw) return 'hoy'
  const t = raw.replace(/^del /, 'el ')
  if (t === 'manana') return 'mañana'
  if (t === 'pasado manana') return 'pasado mañana'
  if (t === 'esta noche') return 'hoy'
  if (new RegExp(`^${WEEKDAY}$`).test(t)) return `el ${t}`
  return t
}

/**
 * Pure: the closed phrase the whole message is, or null (→ the model).
 * `cooking` = the person writes from cook mode with a step on screen: only
 * there «siguiente» / «anterior» / «repite» are a step.
 */
export function recognizeCodeIntent(message: string, opts: { cooking?: boolean } = {}): CodeIntent | null {
  if (typeof message !== 'string' || message.length > 120) return null
  // Two lines are two things (WhatsApp joins quick messages with a line break).
  if (/\n/.test(message.trim())) return null
  const t = strip(normalizeCodeText(message))
  if (!t) return null

  if (opts.cooking) {
    if (STEP_NEXT.test(t)) return { kind: 'paso_cocina', direction: 'next' }
    if (STEP_PREVIOUS.test(t)) return { kind: 'paso_cocina', direction: 'previous' }
    if (STEP_REPEAT.test(t)) return { kind: 'paso_cocina', direction: 'repeat' }
  }

  if (NEXT_WEEK_MENU.test(t) || NEXT_WEEK_ASK.test(t)) return { kind: 'ver_menu', scope: 'week', nextWeek: true }
  if (WEEK_MENU.test(t) || WEEK_ASK.test(t)) return { kind: 'ver_menu', scope: 'week', nextWeek: false }
  const m = t.match(DAY_ASK) ?? t.match(DAY_FIRST) ?? t.match(DAY_MENU)
  // «¿Qué hay?» alone is a greeting: «hay / tenemos» need a day or a meal.
  if (m && !m[1] && !new RegExp(MEAL_WORDS).test(t) && /^que (hay|tenemos|tengo)\b/.test(t)) return null
  if (m) return { kind: 'ver_menu', scope: 'day', day: dayWords(m[1]), meal: mealOf(t) }
  return null
}

// ─── Replies ──────────────────────────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "martes 24" for an ISO date. */
function shortDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`)
  return `${DAY_NAMES[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}`
}

/** Pure: one day's menu, one line per meal (only the meal asked, when it's there). Null = nothing planned. */
export function dayMenuReply(day: DayMenu | null | undefined, isoDate: string, meal: MealFilter | null, now: Date): string | null {
  const entries = mealEntriesForDay(day)
  if (entries.length === 0) return null
  const asked = meal ? entries.filter((e) => e.meal === meal) : []
  const shown = asked.length > 0 ? asked : entries
  const today = madridParts(now).isoDate
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
  const when = isoDate === today ? `Hoy, ${shortDate(isoDate)}` : isoDate === tomorrow ? `Mañana, ${shortDate(isoDate)}` : cap(`el ${shortDate(isoDate)}`)
  return [`${when}:`, ...shown.map((e) => `- ${cap(e.label)}: ${e.dishes.join(' + ')}`)].join('\n')
}

/** Pure: the week, one line per day; the days with nothing say so. Null = nothing planned at all. */
export function weekMenuReply(weekStart: string, days: readonly (DayMenu | null | undefined)[], skippedDays: readonly number[] = []): string | null {
  const skipped = new Set(skippedDays)
  const lines: string[] = []
  let planned = 0
  for (let i = 0; i < 7; i++) {
    const label = cap(shortDate(menuDayOf(weekStart, i).isoDate))
    if (skipped.has(i)) {
      lines.push(`- ${label}: sin cocinar`)
      continue
    }
    const entries = mealEntriesForDay(days[i])
    if (entries.length > 0) planned++
    lines.push(`- ${label}: ${entries.length ? entries.map((e) => `${e.label}, ${e.dishes.join(' + ')}`).join('; ') : 'sin planificar'}`)
  }
  if (planned === 0) return null
  return [`Menú de la semana, ${weekRangeEs(weekStart)}:`, ...lines].join('\n')
}

/** Pure: the step to read after «siguiente» / «anterior» / «repite» from `at`, and what to say about the edges. */
export function cookStepReply(steps: readonly string[], at: CookStep, direction: StepDirection): { message: string; direction: StepDirection } | null {
  const total = steps.length
  if (total === 0 || at.step < 1 || at.step > total) return null
  const step = at.step
  const read = (n: number) => steps[n - 1].replace(/\s+/g, ' ').trim()
  if (direction === 'next') {
    if (step >= total) return { message: `Ya estás en el último paso. ${read(total)}`, direction: 'repeat' }
    const n = step + 1
    return { message: `Paso ${n}${n === total ? ', el último' : ` de ${total}`}: ${read(n)}`, direction: 'next' }
  }
  if (direction === 'previous') {
    if (step <= 1) return { message: `Ya estás en el primer paso. ${read(1)}`, direction: 'repeat' }
    return { message: `Paso ${step - 1} de ${total}: ${read(step - 1)}`, direction: 'previous' }
  }
  return { message: `Paso ${step} de ${total}: ${read(step)}`, direction: 'repeat' }
}

/** A turn answered by the code, shaped like a model turn (same trace → same ⟦hecho: …⟧). */
function codeResponse(message: string, tool: string, input: unknown, result: Pick<SkillResult, 'data' | 'uiHint' | 'summary'>): AssistantResponse {
  const trace: ToolTrace = {
    name: tool,
    input: JSON.stringify(input ?? {}),
    summary: String(result.summary ?? message).replace(/\s+/g, ' ').slice(0, 400),
  }
  return {
    message,
    skillUsed: tool,
    data: result.data,
    uiHint: result.uiHint,
    actionTaken: false,
    toolsUsed: [tool],
    corrections: [],
    toolTrace: [trace],
  }
}

export type RunSkill = (name: string, params: Record<string, unknown>, ctx: SkillContext) => Promise<SkillResult>

/** The real tools (loaded on first use: the recognizer stays free of the DB). */
export const runSkillByName: RunSkill = async (name, params, ctx) => {
  const { skills } = await import('./skills.js')
  const skill = skills.find((s) => s.name === name)
  if (!skill) throw new Error(`unknown skill ${name}`)
  return skill.handler(params, ctx)
}

/**
 * The reply to a `ver_menu` intent, read with the same tools the model uses.
 * Null when there's nothing to read (no menu, an empty day): the model
 * answers then, as before (it can offer to make the menu).
 */
export async function menuCodeReply(
  intent: Extract<CodeIntent, { kind: 'ver_menu' }>,
  ctx: SkillContext,
  opts: { runSkill?: RunSkill; now?: Date } = {},
): Promise<AssistantResponse | null> {
  const run = opts.runSkill ?? runSkillByName
  const now = opts.now ?? new Date()
  if (intent.scope === 'week') {
    const input = intent.nextWeek ? { nextWeek: true } : {}
    const result = await run('get_weekly_menu', input, ctx)
    const data = result?.data as { weekStart?: string; days?: DayMenu[]; skippedDays?: number[] } | null
    if (!data?.weekStart || !Array.isArray(data.days)) return null
    const message = weekMenuReply(data.weekStart, data.days, data.skippedDays ?? [])
    return message ? codeResponse(message, 'get_weekly_menu', input, result) : null
  }
  const input = { day: intent.day }
  const result = await run('get_todays_menu', input, ctx)
  const data = result?.data as { date?: string; day?: DayMenu } | null
  if (!data?.date) return null
  const message = dayMenuReply(data.day, data.date, intent.meal, now)
  return message ? codeResponse(message, 'get_todays_menu', input, result) : null
}

/** The reply to a `paso_cocina` intent: the step's own text and the same `cooking_step` hint the tool gives. */
export function stepCodeReply(steps: readonly string[], at: CookStep, direction: StepDirection): AssistantResponse | null {
  const r = cookStepReply(steps, at, direction)
  if (!r) return null
  return codeResponse(r.message, 'cooking_step', { direction }, { data: { direction: r.direction }, uiHint: 'cooking_step', summary: r.message })
}
