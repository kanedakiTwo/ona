import { z } from 'zod'
import { MEALS, type Meal } from '../constants/enums.js'

/**
 * PRO-225 · «Antes de planificar»: what changes this week only, asked right
 * before generating it («¿Alguna comida fuera de casa?», «¿Viene alguien?»).
 * Days are 0 = lunes … 6 = domingo, like every `dayIndex` of the menu.
 * It never touches the household's plantilla: it only shapes the week built
 * from it (see `applyWeekPlan` in apps/api `services/weekPlan.ts`).
 */
export interface WeekPlanMealOut {
  day: number
  /** Absent = every meal of that day. */
  meal?: Meal
}

export interface WeekPlanGuests {
  day: number
  /** Absent = every meal of that day. */
  meal?: Meal
  /** How many eat at home that meal (household + guests). */
  diners: number
}

export interface WeekPlan {
  /**
   * PRO-275 · «esta semana somos dos»: how many eat every meal of this week
   * (1–24). Per-day `guests` still win over it. Only this week.
   */
  diners?: number
  mealsOut?: WeekPlanMealOut[]
  guests?: WeekPlanGuests[]
  /**
   * PRO-229 · «¿Qué te queda en la nevera?»: what's left, as said
   * («medio calabacín», «nata»). Saved in the despensa (nevera) and the
   * week's menu gives more weight to recipes that use it.
   */
  fridge?: string[]
}

const day = z.number().int().min(0).max(6)
export const weekPlanSchema = z.object({
  diners: z.number().int().min(1).max(24).optional(),
  mealsOut: z.array(z.object({ day, meal: z.enum(MEALS).optional() })).max(28).optional(),
  guests: z
    .array(z.object({ day, meal: z.enum(MEALS).optional(), diners: z.number().int().min(1).max(24) }))
    .max(28)
    .optional(),
  fridge: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
})

export function weekPlanIsEmpty(plan: WeekPlan | null | undefined): boolean {
  return !plan || (plan.diners === undefined && (plan.mealsOut?.length ?? 0) === 0 && (plan.guests?.length ?? 0) === 0 && (plan.fridge?.length ?? 0) === 0)
}

/**
 * PRO-229: «medio calabacín y nata, 2 yogures» → ['medio calabacín', 'nata',
 * '2 yogures']. Splits by commas, «y», line breaks and semicolons; drops
 * empty bits and «nada».
 */
export function splitFridgeAnswer(text: string): string[] {
  return text
    .split(/[,;\n]|\s+y\s+|\s+e\s+/i)
    .map((t) => t.replace(/^[\s\-•*·]+|[\s.]+$/g, '').trim())
    .filter((t) => t.length > 0 && !/^(nada|poca cosa|ninguna|nothing)$/i.test(t))
    .map((t) => t.slice(0, 80))
    .slice(0, 20)
}

const QTY_WORDS = /^(medio|media|un|una|unos|unas|uno|poco|poca|pocos|pocas|algo|resto|restos|trozo|trozos|bote|botes|brick|bricks|paquete|paquetes|bolsa|de|del|la|el|los|las|\d+[.,]?\d*|g|gr|kg|ml|l|litro|litros|gramos)$/

/**
 * The food word(s) of what was said: «medio calabacín» → «calabacin»,
 * «un poco de nata» → «nata», «2 yogures naturales» → «yogures naturales».
 * Lower case, no accents.
 */
export function fridgeTerm(said: string): string {
  const words = said.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zñ0-9\s.,]/g, ' ').split(/\s+/).filter(Boolean)
  let i = 0
  while (i < words.length - 1 && QTY_WORDS.test(words[i])) i++
  return words.slice(i).join(' ').trim()
}

// ─── Free-text answer (WhatsApp, Mimo) ───────────────────────────

const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const DAY_WORDS: Array<[RegExp, number]> = [
  [/\blunes\b/, 0],
  [/\bmartes\b/, 1],
  [/\bmiercoles\b/, 2],
  [/\bjueves\b/, 3],
  [/\bviernes\b/, 4],
  [/\bsabado\b/, 5],
  [/\bdomingo\b/, 6],
]

const MEAL_WORDS: Array<[RegExp, Meal]> = [
  [/\b(desayun\w*)\b/, 'breakfast'],
  [/\b(cena\w*|cenamos|ceno|cenan)\b/, 'dinner'],
  [/\b(merienda\w*|merendamos)\b/, 'snack'],
  [/\b(comida|comer|comemos|como|comen|almuerzo|almorzamos)\b/, 'lunch'],
]

const NUMBER_WORDS: Record<string, number> = {
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12,
}

function numberIn(s: string): number | null {
  const m = /\b(\d{1,2})\b/.exec(s)
  if (m) return Number(m[1])
  for (const [w, n] of Object.entries(NUMBER_WORDS)) if (new RegExp(`\\b${w}\\b`).test(s)) return n
  return null
}

/**
 * Best-effort reading of a free answer such as «el jueves cenamos fuera y el
 * sábado somos 6». Splits into clauses by «y», commas and full stops; each
 * clause with a weekday and «fuera» is a meal out (the meal it names, else the
 * whole day), each with a weekday and «somos / seremos / vienen N» sets the
 * diners. Anything it can't read is left out: Mimo passes the structured
 * fields itself and this is only the fallback.
 */
export function parseWeekPlanAnswer(text: string): WeekPlan {
  const mealsOut: WeekPlanMealOut[] = []
  const guests: WeekPlanGuests[] = []
  const clauses = strip(text).split(/[,.;\n]|\by\b|\be\b/)
  let lastDay: number | null = null
  for (const clause of clauses) {
    const days = DAY_WORDS.filter(([re]) => re.test(clause)).map(([, d]) => d)
    const dayList = days.length ? days : lastDay !== null ? [lastDay] : []
    if (days.length) lastDay = days[days.length - 1]
    if (dayList.length === 0) continue
    const meal = MEAL_WORDS.find(([re]) => re.test(clause))?.[1]
    if (/\bfuera\b/.test(clause)) {
      for (const d of dayList) mealsOut.push(meal ? { day: d, meal } : { day: d })
      continue
    }
    if (/\b(somos|seremos|vienen|viene|estamos|estaremos|invitad)/.test(clause)) {
      const n = numberIn(clause)
      if (n && n >= 1 && n <= 24) for (const d of dayList) guests.push(meal ? { day: d, meal, diners: n } : { day: d, diners: n })
    }
  }
  return {
    ...(mealsOut.length ? { mealsOut } : {}),
    ...(guests.length ? { guests } : {}),
  }
}
