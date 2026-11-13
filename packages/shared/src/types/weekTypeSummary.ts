/**
 * PRO-1204 · «Vuestra semana»: the household's semana tipo (D-182) summed up
 * as a small picture — the head of the profile and one line per day of the
 * menu. Pure, from the same `WeekTypeDays` the generator follows
 * (`weekTypePlan`): no other data model.
 *
 * Each slot reads as one short kind (colours per kind on the web):
 *   - `legumbre` / `pescado`: those dish types;
 *   - `taper`: the táper of the dinner before (PRO-223);
 *   - `fuera`: «no hay» that meal (lunch or dinner: eaten out);
 *   - `cole`: a free weekday lunch on a day of the school menu (PRO-224);
 *   - `fijo`: a concrete recipe or something fixed («Tostada», «Pizza casera»);
 *   - `plato`: any other dish type (arroz, guiso…);
 *   - `libre`: «Cualquier receta», Mimo picks.
 * With options by turns, the one of the week shown; together, the first.
 */
import { dishTypeInfo } from '../constants/dishTypes.js'
import type { Meal } from '../constants/enums.js'
import { dayTimeBudget, formatDayTimeBudget } from './cookingTime.js'
import { stableSlotJson, fullWeekTypeDays, weekTypeOptionLabel, weekTypeOptionsFor, weekTypeSlotAt, type WeekTypeDays, type WeekTypeOption } from './weekType.js'

export type WeekTypeCellKind = 'legumbre' | 'pescado' | 'taper' | 'fuera' | 'cole' | 'fijo' | 'plato' | 'libre'

export interface WeekTypeCell {
  kind: WeekTypeCellKind
  /** What fits in a cell of ~40 px: «Legum.», «Pesc.», «Fuera», «Tostada». */
  short: string
  /** The whole thing, lower case, for the menu's line and screen readers: «legumbres», «cena fuera». */
  label: string
}

export interface WeekTypeSummary {
  /** The rows, in the order of the day: lunch and dinner always, breakfast and snack when some day has them. */
  meals: Meal[]
  /** `cells[meal][day]`, day 0 = Monday. */
  cells: Record<Meal, WeekTypeCell[]>
  /** The household never touched it: what Mimoia plans by default. */
  isDefault: boolean
  /** What doesn't change, joined with « · » by the web: «Comen en el cole de L a V», «30 min en total entre semana». */
  notes: string[]
}

const MEAL_ORDER: Meal[] = ['breakfast', 'lunch', 'snack', 'dinner']
const MEAL_WORD: Record<Meal, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }
const MEAL_IN: Record<Meal, string> = { breakfast: 'en el desayuno', lunch: 'a mediodía', snack: 'en la merienda', dinner: 'en la cena' }
const DAY_LETTER = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

/** Short names of the dish types that don't fit a cell whole. */
const SHORT_TYPE: Record<string, string> = {
  legumbres: 'Legum.',
  'cremas-sopas': 'Crema',
  guisos: 'Guiso',
  pescado: 'Pesc.',
  huevos: 'Huevo',
  'plancha-brasa': 'Plancha',
  bocadillos: 'Bocata',
  ensaladas: 'Ensal.',
  verduras: 'Verdura',
  'carpaccio-tartar': 'Tartar',
  italiano: 'Italia',
  japones: 'Japo.',
  'chino-wok': 'Wok',
  mexicano: 'Mexic.',
  sudamericano: 'Sudam.',
  'oriente-medio': 'Árabe',
  tostadas: 'Tostada',
  'cereales-avena': 'Cereal',
  'yogur-fruta': 'Yogur',
  'dulce-finde': 'Dulce',
}

const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

function cellOfOption(o: WeekTypeOption): WeekTypeCell {
  const label = weekTypeOptionLabel(o)
  if (o.kind === 'type') {
    const kind: WeekTypeCellKind = o.type === 'legumbres' ? 'legumbre' : o.type === 'pescado' ? 'pescado' : 'plato'
    return { kind, short: SHORT_TYPE[o.type] ?? dishTypeInfo(o.type)?.label ?? o.type, label: lower(label) }
  }
  if (o.kind === 'taper') return { kind: 'taper', short: 'Táper', label: 'táper' }
  if (o.kind === 'any') return { kind: 'libre', short: 'Libre', label: 'cualquier receta' }
  return { kind: 'fijo', short: label, label: lower(label) }
}

/** Pure: the weekdays (0 = Monday) that have a school lunch in the menu of the cole. */
export function schoolWeekdays(lunches: ReadonlyArray<{ date: string }>): number[] {
  const set = new Set<number>()
  for (const l of lunches) {
    const t = Date.parse(`${l.date.slice(0, 10)}T12:00:00Z`)
    if (Number.isFinite(t)) set.add((new Date(t).getUTCDay() + 6) % 7)
  }
  return [...set].sort((a, b) => a - b)
}

/** «de L a V», «L, X y V», «el L». */
export function dayLettersLabel(days: readonly number[]): string {
  const ds = [...new Set(days)].sort((a, b) => a - b)
  if (ds.length === 0) return ''
  if (ds.length === 1) return `el ${DAY_LETTER[ds[0]]}`
  if (ds.length >= 3 && ds[ds.length - 1] - ds[0] === ds.length - 1) return `de ${DAY_LETTER[ds[0]]} a ${DAY_LETTER[ds[ds.length - 1]]}`
  const ls = ds.map((d) => DAY_LETTER[d])
  return `${ls.slice(0, -1).join(', ')} y ${ls[ls.length - 1]}`
}

/** Pure: one slot of the week `weekStart` as a cell. */
export function weekTypeCell(days: WeekTypeDays | null | undefined, day: number, meal: Meal, weekStart: string, school: readonly number[] = []): WeekTypeCell {
  const slot = weekTypeSlotAt(days, day, meal)
  if (slot.off) {
    const main = meal === 'lunch' || meal === 'dinner'
    return { kind: 'fuera', short: main ? 'Fuera' : 'No hay', label: main ? `${MEAL_WORD[meal]} fuera` : `sin ${MEAL_WORD[meal]}` }
  }
  const options = weekTypeOptionsFor(slot, weekStart)
  const first = options.find((o) => o.kind !== 'any')
  if (!first) {
    if (meal === 'lunch' && day <= 4 && school.includes(day)) return { kind: 'cole', short: 'Cole', label: 'cole a mediodía' }
    return { kind: 'libre', short: 'Libre', label: 'cualquier receta' }
  }
  const cell = cellOfOption(first)
  const rest = options.filter((o) => o !== first && o.kind !== 'any')
  return rest.length ? { ...cell, label: [cell.label, ...rest.map((o) => cellOfOption(o).label)].join(' y ') } : cell
}

/**
 * Pure: the week type of the week `weekStart` as the profile draws it.
 * `school`: weekdays with school lunch (`schoolWeekdays`); `timeAvailable`:
 * the `time_available` fact (PRO-138), for «30 min en total entre semana».
 */
export function summarizeWeekType(
  days: WeekTypeDays | null | undefined,
  weekStart: string,
  opts: { school?: readonly number[]; timeAvailable?: unknown } = {},
): WeekTypeSummary {
  const school = opts.school ?? []
  const used = (m: Meal) => Array.from({ length: 7 }, (_, d) => d).some((d) => !weekTypeSlotAt(days, d, m).off)
  const meals = MEAL_ORDER.filter((m) => m === 'lunch' || m === 'dinner' || used(m))
  const cells = {} as Record<Meal, WeekTypeCell[]>
  for (const m of MEAL_ORDER) cells[m] = Array.from({ length: 7 }, (_, d) => weekTypeCell(days, d, m, weekStart, school))

  const full = fullWeekTypeDays(days)
  const isDefault = stableSlotJson(full as never) === stableSlotJson(fullWeekTypeDays() as never)

  const notes: string[] = []
  const coleDays = school.filter((d) => d <= 4 && cells.lunch[d].kind === 'cole')
  if (coleDays.length) notes.push(`Comen en el cole ${dayLettersLabel(coleDays)}`)
  const weekday = [0, 1, 2, 3, 4].map((d) => dayTimeBudget(opts.timeAvailable, d))
  const w0 = weekday[0]
  if (w0 && weekday.every((b) => b && b.mode === w0.mode && b.minutes === w0.minutes)) {
    notes.push(`${formatDayTimeBudget(w0)} entre semana`)
  }
  return { meals, cells, isDefault, notes }
}

/**
 * Pure: what the week type asks for one day of the menu, for its line
 * («Según tu semana: legumbres y cena fuera»), or null when it asks for
 * nothing (every meal free). Lunch first and without its name, then dinner,
 * breakfast and snack; a breakfast or snack that isn't there is not said.
 */
export function weekTypeDayLine(days: WeekTypeDays | null | undefined, weekStart: string, day: number, school: readonly number[] = []): string | null {
  const parts: string[] = []
  for (const m of ['lunch', 'dinner', 'breakfast', 'snack'] as Meal[]) {
    const cell = weekTypeCell(days, day, m, weekStart, school)
    if (cell.kind === 'libre') continue
    if (cell.kind === 'fuera') {
      if (m === 'lunch' || m === 'dinner') parts.push(cell.label)
      continue
    }
    parts.push(m === 'lunch' ? cell.label : `${cell.label} ${MEAL_IN[m]}`)
  }
  if (parts.length === 0) return null
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}
