/**
 * Menú del comedor escolar (PRO-224, D-069). Reads the school's monthly menu
 * from a photo or PDF (Claude, like recipe photos), keeps per household and
 * school day the main dish and its group, and gives the weekly generator and
 * the single-slot paths the group the dinner should not repeat.
 *
 * Wording rule (constitution §6): «para no repetir», never «para equilibrar».
 */
import { CLAUDE_MODEL } from '../config/models.js'
import Anthropic from '@anthropic-ai/sdk'
import { and, between, eq, gt, inArray, or } from 'drizzle-orm'
import {
  SCHOOL_DISH_MAX,
  SCHOOL_MENU_MAX_DAYS,
  dishFoodGroup,
  isFoodGroup,
  recipeFoodGroup,
  type FoodGroup,
  type SchoolLunch,
} from '@ona/shared'
import { NotASchoolMenuError, schoolLunchLines } from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { householdMembers, householdPersons, profileFacts, schoolLunches, users } from '../db/schema.js'
import { recordAnthropicCost } from './costLedger.js'
import { fitImageForClaude } from './visionImage.js'

type Db = typeof defaultDb

/** D-070: at least Opus 5.5 in every product call. */
export const SCHOOL_MENU_MODEL = CLAUDE_MODEL

export const SCHOOL_MENU_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type SchoolMenuMimeType = (typeof SCHOOL_MENU_MIME_TYPES)[number]
export function isSchoolMenuMimeType(m: string | null | undefined): m is SchoolMenuMimeType {
  return !!m && (SCHOOL_MENU_MIME_TYPES as readonly string[]).includes(m)
}

// ─── The reader ──────────────────────────────────────────────────

export function schoolMenuPrompt(today: string): string {
  return `Eres un asistente que lee el menú mensual del comedor de un colegio (foto o PDF).
Hoy es ${today}. Si el menú no dice el año, es el del mes que viene más cerca de hoy (el actual o el siguiente).

Para cada día lectivo del menú, devuelve el PLATO PRINCIPAL de la comida (el segundo plato si hay primero y segundo; si solo hay un plato, ese) y su grupo:
- "legumbre" (lentejas, garbanzos, alubias…), "pescado", "carne", "huevo", "pasta_arroz" (pasta, arroz, fideos…) o "verdura".
Si el primer plato es de legumbre, pasta o arroz y el segundo es de carne, pescado o huevo, el grupo es el del segundo y en "dish" pones los dos separados por « · » (p. ej. «Lentejas · Merluza al horno»). Si no está claro, "group": null.

Responde SOLO con JSON, sin markdown:
{"days":[{"date":"AAAA-MM-DD","dish":"…","group":"legumbre"}]}
Si el archivo no es un menú escolar, responde {"error":"not_a_school_menu"}.
No incluyas días festivos ni sin menú. No escribas nada sobre salud ni nutrición.`
}

export type SchoolMenuReader = (file: { data: Buffer; mimeType: SchoolMenuMimeType }, today: string, userId: string | null) => Promise<unknown>

/** The real reader: one Claude call with the image or the PDF. */
export const anthropicSchoolMenuReader: SchoolMenuReader = async (file, today, userId) => {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured')
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const data = file.data.toString('base64')
  const source =
    file.mimeType === 'application/pdf'
      ? ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } as const)
      : ({ type: 'image', source: { type: 'base64', media_type: file.mimeType, data } } as const)
  const response = await client.messages.create({
    model: SCHOOL_MENU_MODEL,
    max_tokens: 8000,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: [source as any, { type: 'text', text: schoolMenuPrompt(today) }] }],
  } as any)
  recordAnthropicCost('school_menu_read', SCHOOL_MENU_MODEL, (response as any).usage, userId)
  const text = (response as any).content?.find((b: any) => b.type === 'text')?.text ?? ''
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('school menu answer was not JSON')
    return JSON.parse(m[0])
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}$/
const validDate = (s: string) => ISO.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s

/**
 * Pure: the model's answer → clean school days. Bad dates and empty dishes
 * are dropped, a date read twice keeps the first, an unknown group is taken
 * from the dish name (`dishFoodGroup`), weekends are dropped, sorted by date.
 * `{ error }` or nothing usable → NotASchoolMenuError.
 */
export function parseSchoolMenuAnswer(raw: unknown): SchoolLunch[] {
  const obj = raw && typeof raw === 'object' ? (raw as { days?: unknown; error?: unknown }) : null
  if (!obj || obj.error || !Array.isArray(obj.days)) throw new NotASchoolMenuError()
  const seen = new Set<string>()
  const out: SchoolLunch[] = []
  for (const d of obj.days as any[]) {
    const date = typeof d?.date === 'string' ? d.date.trim().slice(0, 10) : ''
    const dish = typeof d?.dish === 'string' ? d.dish.replace(/\s+/g, ' ').trim().slice(0, SCHOOL_DISH_MAX) : ''
    if (!validDate(date) || !dish || seen.has(date)) continue
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
    if (weekday === 0 || weekday === 6) continue
    seen.add(date)
    const group: FoodGroup | null = isFoodGroup(d?.group) ? d.group : dishFoodGroup(dish)
    out.push({ date, dish, group })
    if (out.length >= SCHOOL_MENU_MAX_DAYS) break
  }
  if (out.length === 0) throw new NotASchoolMenuError()
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** Read a school menu file (nothing is saved: the household checks it first). */
export async function readSchoolMenu(
  file: { data: Buffer; mimeType: SchoolMenuMimeType },
  today: string,
  userId: string | null,
  reader: SchoolMenuReader = anthropicSchoolMenuReader,
): Promise<SchoolLunch[]> {
  const fitted = file.mimeType === 'application/pdf' ? file : await fitImageForClaude(file.data, file.mimeType)
  return parseSchoolMenuAnswer(await reader(fitted, today, userId))
}

// ─── Storage ─────────────────────────────────────────────────────

export async function loadSchoolLunches(householdId: string, from: string, to: string, db: Db = defaultDb): Promise<SchoolLunch[]> {
  const rows = await db
    .select({ date: schoolLunches.date, dish: schoolLunches.dish, group: schoolLunches.foodGroup })
    .from(schoolLunches)
    .where(and(eq(schoolLunches.householdId, householdId), between(schoolLunches.date, from, to)))
    .orderBy(schoolLunches.date)
  return rows.map((r) => ({ date: String(r.date).slice(0, 10), dish: r.dish, group: isFoodGroup(r.group) ? r.group : null }))
}

/** Upsert `days` (one row per date) and remove the `clear` dates. */
export async function saveSchoolLunches(
  householdId: string,
  userId: string | null,
  days: SchoolLunch[],
  clear: string[] = [],
  db: Db = defaultDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    const toClear = clear.filter((d) => !days.some((x) => x.date === d))
    if (toClear.length > 0) {
      await tx.delete(schoolLunches).where(and(eq(schoolLunches.householdId, householdId), inArray(schoolLunches.date, toClear)))
    }
    for (const d of days) {
      await tx
        .insert(schoolLunches)
        .values({ householdId, date: d.date, dish: d.dish, foodGroup: d.group, createdByUserId: userId })
        .onConflictDoUpdate({
          target: [schoolLunches.householdId, schoolLunches.date],
          set: { dish: d.dish, foodGroup: d.group, updatedAt: new Date() },
        })
    }
  })
}

const plusDays = (iso: string, n: number) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** Pure: a week's school lunches → day index (0 = Monday) → group to avoid at dinner. */
export function schoolDinnerAvoidGroups(weekStart: string, lunches: SchoolLunch[]): Record<number, FoodGroup> {
  const out: Record<number, FoodGroup> = {}
  for (let i = 0; i < 7; i++) {
    const l = lunches.find((x) => x.date === plusDays(weekStart, i))
    if (l?.group) out[i] = l.group
  }
  return out
}

/** The week's groups to avoid at dinner for a household; `{}` when none or on error. */
export async function loadSchoolDinnerAvoidGroups(householdId: string | null, weekStart: string, db: Db = defaultDb): Promise<Record<number, FoodGroup>> {
  if (!householdId) return {}
  try {
    const start = String(weekStart).slice(0, 10)
    return schoolDinnerAvoidGroups(start, await loadSchoolLunches(householdId, start, plusDays(start, 6), db))
  } catch (err) {
    console.warn('[school-menu] could not load the week (no school rule):', err)
    return {}
  }
}

/** Ages of a person without an account («Tu ficha») that go to school. */
export const SCHOOL_AGE_BANDS = ['0-2', '3-5', '6-12', '13-17'] as const

/**
 * Does the app show «Menú del cole»? Only with a child in the household (D-069: discreet),
 * known by any of: a member with the «niño» role; a member who counted children 2–10 in the
 * web sign-up; a person without an account in «Tu ficha» under 18; or children 2–10 in the
 * household's ficha (the WhatsApp sign-up and Mimo write it there). The last two since
 * 2026-10-22: Miguel and a beta tester with children only reached it by its URL.
 * (Mimo works either way.)
 */
export async function householdShowsSchoolMenu(householdId: string | null, db: Db = defaultDb): Promise<boolean> {
  if (!householdId) return false
  const [member] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(and(eq(householdMembers.householdId, householdId), or(eq(householdMembers.role, 'child'), gt(users.kidsCount, 0))))
    .limit(1)
  if (member) return true
  const [person] = await db
    .select({ id: householdPersons.id })
    .from(householdPersons)
    .where(and(eq(householdPersons.householdId, householdId), inArray(householdPersons.ageBand, [...SCHOOL_AGE_BANDS])))
    .limit(1)
  if (person) return true
  const kids = await db
    .select({ value: profileFacts.value })
    .from(profileFacts)
    .where(and(eq(profileFacts.householdId, householdId), eq(profileFacts.type, 'household.kids_2_to_10'), eq(profileFacts.status, 'active')))
  return kids.some((f) => Number(f.value) > 0)
}

// ─── The dinner rule ────────────────────────────────────────────

/** Recipe → its food group, computed once per recipe object. */
const foodGroupCache = new WeakMap<object, FoodGroup | null>()
function cachedFoodGroup(r: { name: string; ingredients?: ReadonlyArray<{ ingredientName: string }> }): FoodGroup | null {
  if (!foodGroupCache.has(r)) foodGroupCache.set(r, recipeFoodGroup(r))
  return foodGroupCache.get(r) ?? null
}

type GroupableRecipe = { name: string; ingredients?: ReadonlyArray<{ ingredientName: string }> }

/** Pure: the pool without the recipes of `group` (recipes without a known group stay). */
export function withoutFoodGroup<T extends GroupableRecipe>(pool: T[], group: FoodGroup): T[] {
  return pool.filter((r) => cachedFoodGroup(r) !== group)
}

/**
 * For the single-slot paths (Cambiar al azar, add a meal, regenerate a
 * dish): a dinner on a school day draws from the pool without the group the
 * kids ate. Anything else → the pool as it is.
 */
export async function schoolDinnerPool<T extends GroupableRecipe>(
  pool: T[],
  menu: { householdId?: string | null; weekStart: string | Date },
  dayIndex: number,
  meal: string,
  db: Db = defaultDb,
): Promise<T[]> {
  if (meal !== 'dinner' || !menu.householdId) return pool
  const start = typeof menu.weekStart === 'string' ? menu.weekStart : menu.weekStart.toISOString()
  const groups = await loadSchoolDinnerAvoidGroups(menu.householdId, start.slice(0, 10), db)
  const g = groups[dayIndex]
  return g ? withoutFoodGroup(pool, g) : pool
}

export { NotASchoolMenuError, schoolLunchLines }
