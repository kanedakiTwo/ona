/**
 * «Tu semana con Mimoia» en la newsletter (PRO-1199; specs/newsletter.md →
 * «Tus números con Mimoia»).
 *
 * En la carta de cada **cuenta** (nunca a la lista de espera), un bloque
 * corto con lo que su casa ya ha resuelto en los últimos 7 días, por reglas y
 * sin API (D-156): semanas con menú hecho y sus platos, recetas cocinadas
 * (`cook_logs`), recetas nuevas probadas y si mandó la lista. Si la semana
 * sale vacía, el mes (30 días). Solo las cifras que no son cero; si todo es
 * cero, no hay bloque (nunca «0 recetas»).
 *
 * Nunca nada de salud, dieta ni alergias (D-064, D-110): solo se cuenta, no
 * se nombra ningún plato; ni se compara con otras casas.
 *
 * Las reglas son puras (`numbersBlock`, `numbersSentence`); lo de la base de
 * datos lo trae `loadHouseholdNumbers`.
 */
import { and, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { BRAND_NAME, type DayMenu } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { cookLogs, menus, shopOrders, usageEvents, users } from '../db/schema.js'
import { addDays, madridMidnightUtc, madridParts } from './madridTime.js'

type Db = typeof defaultDb

/** Lo que una casa ha hecho con Mimoia en un periodo. Solo cifras. */
export interface UsageNumbers {
  /** Semanas (lunes) con algún plato del menú en el periodo. */
  menuWeeks: number
  /** Platos del menú en los días del periodo (sin sobras ni tápers). */
  dishes: number
  /** Recetas cocinadas (`cook_logs`; la misma receta el mismo día cuenta una vez). */
  cooked: number
  /** De esas, las que la casa cocinaba por primera vez. */
  newRecipes: number
  /** Mandó la lista de la compra (`shopping_list_shared`) o un pedido a una tienda. */
  listSent: boolean
}

export interface HouseholdNumbers {
  /** Los últimos 7 días (Madrid, hoy incluido). */
  week: UsageNumbers
  /** Los últimos 30 días: solo se usa si la semana sale vacía. */
  month: UsageNumbers
}

export const EMPTY_USAGE_NUMBERS: UsageNumbers = { menuWeeks: 0, dishes: 0, cooked: 0, newRecipes: 0, listSent: false }

/** El bloque ya decidido: su título y sus líneas (al menos una). */
export interface NumbersBlock {
  period: 'semana' | 'mes'
  title: string
  lines: string[]
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** Puro: las líneas de un periodo, solo las que no son cero. */
export function numbersLines(n: UsageNumbers, period: 'semana' | 'mes'): string[] {
  const lines: string[] = []
  if (n.menuWeeks > 0) {
    const menu =
      period === 'semana' && n.menuWeeks === 1 ? 'El menú de la semana hecho' : `${plural(n.menuWeeks, 'semana', 'semanas')} con el menú hecho`
    lines.push(n.dishes > 0 ? `${menu} (${plural(n.dishes, 'plato', 'platos')})` : menu)
  }
  if (n.cooked > 0) lines.push(plural(n.cooked, 'receta cocinada', 'recetas cocinadas'))
  if (n.newRecipes > 0) lines.push(plural(n.newRecipes, 'receta nueva probada', 'recetas nuevas probadas'))
  if (n.listSent) lines.push('La lista de la compra mandada')
  return lines
}

/**
 * Puro: el bloque de una casa. La semana; si sale vacía, el mes; si también,
 * null (no sale nada). La lista de espera no tiene números: null.
 */
export function numbersBlock(n: HouseholdNumbers | null | undefined): NumbersBlock | null {
  if (!n) return null
  const week = numbersLines(n.week, 'semana')
  if (week.length > 0) return { period: 'semana', title: `Tu semana con ${BRAND_NAME}`, lines: week }
  const month = numbersLines(n.month, 'mes')
  if (month.length > 0) return { period: 'mes', title: `Tu mes con ${BRAND_NAME}`, lines: month }
  return null
}

function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

/**
 * Puro: el bloque en una frase, para el hueco `{numeros}` de la carta
 * («Tu semana con Mimoia: el menú de la semana hecho (14 platos) y 2 recetas
 * cocinadas.»). Sin bloque, vacío: el hueco se va.
 */
export function numbersSentence(b: NumbersBlock | null | undefined): string {
  if (!b) return ''
  const lower = b.lines.map((l) => (/^\p{Lu}/u.test(l) ? l.charAt(0).toLocaleLowerCase('es-ES') + l.slice(1) : l))
  return `${b.title}: ${joinEs(lower)}.`
}

/** Puro: los platos de un menú que caen en `[from, to]` (fechas de Madrid), sin sobras, tápers ni días «sin cocinar». */
export function menuDishesInRange(
  m: { weekStart: string; days: unknown; skippedDays?: number[] | null },
  from: string,
  to: string,
): number {
  if (!Array.isArray(m.days)) return 0
  const skipped = new Set(m.skippedDays ?? [])
  let count = 0
  ;(m.days as DayMenu[]).forEach((day, i) => {
    const date = addDays(m.weekStart, i)
    if (date < from || date > to || skipped.has(i) || !day || typeof day !== 'object') return
    for (const slot of Object.values(day)) {
      if (!slot || !Array.isArray(slot.dishes) || slot.taper) continue
      for (const d of slot.dishes) {
        if (d && (d as { kind?: string }).kind === 'recipe' && ((d as { variant?: string }).variant ?? 'planned') === 'planned') count++
      }
    }
  })
  return count
}

/**
 * Puro: las cifras de un periodo con lo leído de la base de datos.
 * `cooked`: lo cocinado en el periodo con su día de Madrid; `cookedBefore`:
 * las recetas que la casa ya había cocinado antes del periodo.
 */
export function usageNumbers(input: {
  menus: Array<{ weekStart: string; days: unknown; skippedDays?: number[] | null }>
  cooked: Array<{ recipeId: string; day: string }>
  cookedBefore: ReadonlySet<string>
  listSent: boolean
  from: string
  to: string
}): UsageNumbers {
  const weeks = new Set<string>()
  let dishes = 0
  for (const m of input.menus) {
    const n = menuDishesInRange(m, input.from, input.to)
    if (n > 0) {
      weeks.add(m.weekStart)
      dishes += n
    }
  }
  const inRange = input.cooked.filter((c) => c.day >= input.from && c.day <= input.to)
  const cooked = new Set(inRange.map((c) => `${c.recipeId}|${c.day}`)).size
  const newRecipes = new Set(inRange.filter((c) => !input.cookedBefore.has(c.recipeId)).map((c) => c.recipeId)).size
  return { menuWeeks: weeks.size, dishes, cooked, newRecipes, listSent: input.listSent }
}

/** Los dos periodos, en fechas de Madrid (hoy incluido). */
export function numbersWindows(now: Date): { today: string; weekFrom: string; monthFrom: string } {
  const today = madridParts(now).isoDate
  return { today, weekFrom: addDays(today, -6), monthFrom: addDays(today, -29) }
}

// ─── Repo ────────────────────────────────────────────────────────

/**
 * Los números de la casa de cada cuenta (por id de cuenta). Una cuenta sin
 * casa no sale. Solo cifras: ningún nombre de plato ni dato de salud.
 */
export async function loadHouseholdNumbers(userIds: string[], now: Date, db: Db = defaultDb): Promise<Map<string, HouseholdNumbers>> {
  const out = new Map<string, HouseholdNumbers>()
  if (userIds.length === 0) return out
  const people = await db
    .select({ id: users.id, householdId: users.primaryHouseholdId })
    .from(users)
    .where(inArray(users.id, userIds))
  const hids = [...new Set(people.flatMap((p) => (p.householdId ? [p.householdId] : [])))]
  if (hids.length === 0) return out

  const { today, weekFrom, monthFrom } = numbersWindows(now)
  const since = madridMidnightUtc(monthFrom)
  const weekSince = madridMidnightUtc(weekFrom)

  // Las semanas que tocan el mes: desde el lunes de 6 días antes.
  const menuRows = await db
    .select({
      householdId: menus.householdId,
      userId: menus.userId,
      userHousehold: users.primaryHouseholdId,
      weekStart: menus.weekStart,
      days: menus.days,
      skippedDays: menus.skippedDays,
      createdAt: menus.createdAt,
    })
    .from(menus)
    .innerJoin(users, eq(users.id, menus.userId))
    .where(
      and(
        gte(menus.weekStart, addDays(monthFrom, -6)),
        or(inArray(menus.householdId, hids), and(isNull(menus.householdId), inArray(users.primaryHouseholdId, hids))),
      ),
    )

  const cookedRows = await db
    .select({
      householdId: cookLogs.householdId,
      recipeId: cookLogs.recipeId,
      day: sql<string>`to_char(${cookLogs.cookedAt} AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD')`,
    })
    .from(cookLogs)
    .where(and(inArray(cookLogs.householdId, hids), gte(cookLogs.cookedAt, since)))

  const recipeIds = [...new Set(cookedRows.map((c) => c.recipeId))]
  const before =
    recipeIds.length > 0
      ? await db
          .select({ householdId: cookLogs.householdId, recipeId: cookLogs.recipeId, first: sql<Date>`min(${cookLogs.cookedAt})` })
          .from(cookLogs)
          .where(and(inArray(cookLogs.householdId, hids), inArray(cookLogs.recipeId, recipeIds)))
          .groupBy(cookLogs.householdId, cookLogs.recipeId)
      : []

  // «Mandar la lista» (PRO-380) o un pedido mandado a una tienda o al súper.
  const shared = await db
    .select({ householdId: sql<string | null>`COALESCE(${usageEvents.householdId}, ${users.primaryHouseholdId})`, at: usageEvents.createdAt })
    .from(usageEvents)
    .innerJoin(users, eq(users.id, usageEvents.userId))
    .where(
      and(
        eq(usageEvents.name, 'shopping_list_shared'),
        gte(usageEvents.createdAt, since),
        or(inArray(usageEvents.householdId, hids), and(isNull(usageEvents.householdId), inArray(users.primaryHouseholdId, hids))),
      ),
    )
  const orders = await db
    .select({ householdId: shopOrders.householdId, at: shopOrders.sentAt })
    .from(shopOrders)
    .where(and(inArray(shopOrders.householdId, hids), isNotNull(shopOrders.sentAt), ne(shopOrders.status, 'cancelled'), gte(shopOrders.sentAt, since)))
  const sends = [...shared, ...orders]

  const byHousehold = new Map<string, HouseholdNumbers>()
  for (const hid of hids) {
    // Si dos personas de la casa tienen menú para la misma semana, vale el último.
    const latest = new Map<string, (typeof menuRows)[number]>()
    for (const m of menuRows) {
      if ((m.householdId ?? m.userHousehold) !== hid) continue
      const prev = latest.get(m.weekStart)
      if (!prev || (m.createdAt?.getTime() ?? 0) > (prev.createdAt?.getTime() ?? 0)) latest.set(m.weekStart, m)
    }
    const cooked = cookedRows.filter((c) => c.householdId === hid)
    const firstOf = new Map(before.filter((b) => b.householdId === hid).map((b) => [b.recipeId, new Date(b.first)]))
    const period = (from: string, fromAt: Date): UsageNumbers =>
      usageNumbers({
        menus: [...latest.values()],
        cooked,
        cookedBefore: new Set([...firstOf].filter(([, first]) => first < fromAt).map(([id]) => id)),
        listSent: sends.some((s) => s.householdId === hid && s.at !== null && new Date(s.at) >= fromAt),
        from,
        to: today,
      })
    byHousehold.set(hid, { week: period(weekFrom, weekSince), month: period(monthFrom, since) })
  }
  for (const p of people) {
    const n = p.householdId ? byHousehold.get(p.householdId) : undefined
    if (n) out.set(p.id, n)
  }
  return out
}
