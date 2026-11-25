/**
 * D-1028 · «Comida rica de verdad… con 30 minutos de tu tiempo como mucho».
 * The menu's draw keeps every dish within 30 min of hands-on time (the total
 * may be longer), on top of the household's own limit, except on a special
 * occasion: a holiday, a meal with guests, a recipe the household chose. When
 * nothing fits the cap the meal still gets a dish.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EVERYDAY_WORK_MINUTES,
  fitsEverydayWork,
  weekHolidays,
  weekWorkMinutes,
  workTimeLabel,
  type DayMenu,
  type DayTemplate,
} from '@ona/shared'
import { buildRandomMenu } from '../services/menuGenerator.js'
import { slotWorkCap, workCapForSlot } from '../services/menuHolidays.js'
import { matchRecipes, withWorkCapFallback, type MatcherOptions } from '../services/recipeMatcher.js'
import { pickForSlot } from '../services/menuSlotPick.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import type { DishSpec } from '../services/weekTypePlan.js'

afterEach(() => vi.restoreAllMocks())

const recipe = (id: string, times: { activeTime?: number; prepTime?: number; totalTime?: number }, extra: Partial<RecipeWithCourse> = {}) =>
  ({
    id,
    name: `Plato ${id}`,
    meals: ['lunch', 'dinner'],
    seasons: [],
    frequency: null,
    tags: [],
    allergens: [],
    course: null,
    ingredients: [{ ingredientId: `i-${id}`, ingredientName: `verdura ${id}`, quantity: 100, unit: 'g', allergenTags: [] }],
    ...times,
    ...extra,
  }) as unknown as RecipeWithCourse

const quick = Array.from({ length: 20 }, (_, i) => recipe(`q${i}`, { activeTime: 10 + (i % 3) * 10, totalTime: 120 }))
const long = Array.from({ length: 20 }, (_, i) => recipe(`l${i}`, { activeTime: 45 + i, totalTime: 90 }))
const longIds = new Set(long.map((r) => r.id))

const ids = (days: DayMenu[]) => days.flatMap((d, day) => Object.entries(d).flatMap(([meal, s]) => (s?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [{ day, meal, id: x.recipeId }] : []))))
const lunchDinner: DayTemplate[] = Array.from({ length: 7 }, () => ({ lunch: true, dinner: true }))

/** buildRandomMenu with names for the arguments this file uses. */
function week(pool: RecipeWithCourse[], workCapOf?: (day: number, meal: string) => number | null, o: { onlyFavoriteIds?: Set<string>; slotSpecs?: Record<string, DishSpec[]> } = {}) {
  return buildRandomMenu(
    lunchDinner, pool, 'autumn', [], new Set(), {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, o.onlyFavoriteIds, o.slotSpecs, undefined, undefined, undefined, workCapOf,
  )
}
const everyday = () => EVERYDAY_WORK_MINUTES

describe('the rule (shared)', () => {
  it('30 minutes of work; activeTime first, prepTime when missing; unknown passes', () => {
    expect(EVERYDAY_WORK_MINUTES).toBe(30)
    expect(fitsEverydayWork({ activeTime: 20, totalTime: 200 })).toBe(true) // a cocido of 2 h with 20 min of work
    expect(fitsEverydayWork({ activeTime: 31, totalTime: 31 })).toBe(false)
    expect(fitsEverydayWork({ prepTime: 40, cookTime: 5 })).toBe(false)
    expect(fitsEverydayWork({ totalTime: 90 })).toBe(true)
  })
})

describe('which slots are a special occasion', () => {
  it('a normal day: 30; a holiday: none; a meal with guests: none', () => {
    expect(workCapForSlot(1, 'dinner', {})).toBe(30)
    expect(workCapForSlot(3, 'lunch', { holidayDays: new Set([3]) })).toBeNull()
    const guests = [{ day: 5, meal: 'lunch' as const, diners: 8 }, { day: 6, diners: 6 }]
    expect(workCapForSlot(5, 'lunch', { guests })).toBeNull()
    expect(workCapForSlot(5, 'dinner', { guests })).toBe(30)
    // A guest entry without a meal covers the whole day.
    expect(workCapForSlot(6, 'dinner', { guests })).toBeNull()
  })
  it('single-slot changes: none on a holiday of the household\'s comunidad', () => {
    // Week of Monday 2026-12-07: Tuesday 8 is the Inmaculada, national.
    const days = weekHolidays('2026-12-07', 'MD').map((h) => h.dayIndex)
    expect(days).toContain(1)
    const memory = { region: { value: 'MD' } }
    expect(slotWorkCap(memory, '2026-12-07', 1)).toBeNull()
    expect(slotWorkCap(memory, '2026-12-07', 2)).toBe(30)
    expect(slotWorkCap(null, null, 2)).toBe(30)
  })
})

describe('the matcher: the cap on top of the household\'s limit', () => {
  const base: MatcherOptions = { meal: 'dinner', season: 'autumn', usedRecipeIds: new Set(), restrictions: [], favoriteRecipeIds: new Set(), dayIndex: 1 }
  const cocido = recipe('cocido', { activeTime: 20, totalTime: 200 })
  const lasana = recipe('lasana', { activeTime: 60, totalTime: 90 })
  const tortilla = recipe('tortilla', { activeTime: 25, totalTime: 25 })
  const pool = [cocido, lasana, tortilla]
  it('with the cap only what asks for 30 min of work or less; the total may be longer', () => {
    expect(matchRecipes(pool, { ...base, workCap: 30 }).map((r) => r.id)).toEqual(['cocido', 'tortilla'])
    expect(matchRecipes(pool, base).map((r) => r.id)).toEqual(['cocido', 'lasana', 'tortilla'])
  })
  it('the stricter wins: «20 min de trabajo» of the household, or «30 min en total»', () => {
    expect(matchRecipes(pool, { ...base, workCap: 30, timeBudget: { mode: 'activo', minutes: 20 } }).map((r) => r.id)).toEqual(['cocido'])
    expect(matchRecipes(pool, { ...base, workCap: 30, timeBudget: { mode: 'total', minutes: 30 } }).map((r) => r.id)).toEqual(['tortilla'])
  })
  it('the exempt recipes (the household\'s own choice) never drop', () => {
    expect(matchRecipes(pool, { ...base, workCap: 30, workCapExempt: new Set(['lasana']) }).map((r) => r.id)).toEqual(['cocido', 'lasana', 'tortilla'])
  })
  it('nothing within the cap → the search again without it', () => {
    const find = (o: MatcherOptions) => matchRecipes([lasana], o)[0]
    expect(withWorkCapFallback({ ...base, workCap: 30 }, find)).toBe(lasana)
    expect(withWorkCapFallback({ ...base, workCap: 30, timeBudget: { mode: 'activo', minutes: 20 } }, find)).toBeUndefined()
  })
})

describe('the weekly draw', () => {
  it('every day, every dish within 30 min of work while there are enough', () => {
    for (let i = 0; i < 20; i++) {
      const drawn = ids(week([...quick, ...long], everyday).days)
      expect(drawn).toHaveLength(14)
      expect(drawn.filter((d) => longIds.has(d.id))).toEqual([])
    }
  })
  it('without the cap (as before) the long ones come out too', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const drawn = ids(week([...quick, ...long]).days)
    expect(drawn.some((d) => longIds.has(d.id))).toBe(true)
  })
  it('a holiday or a meal with guests: anything; the other meals keep the cap', () => {
    const capOf = (day: number, meal: string) => workCapForSlot(day, meal, { holidayDays: new Set([3]), guests: [{ day: 5, meal: 'lunch', diners: 8 }] })
    const isSpecial = (d: { day: number; meal: string }) => d.day === 3 || (d.day === 5 && d.meal === 'lunch')
    let longOnSpecial = 0
    for (let i = 0; i < 40; i++) {
      const drawn = ids(week([...quick, ...long], capOf).days)
      expect(drawn.filter((d) => !isSpecial(d) && longIds.has(d.id))).toEqual([])
      longOnSpecial += drawn.filter((d) => isSpecial(d) && longIds.has(d.id)).length
    }
    // Half the pool is long: on 3 special slots × 40 weeks some must come out.
    expect(longOnSpecial).toBeGreaterThan(10)
  })
  it('no recipe within the cap → every meal still gets a dish', () => {
    const drawn = ids(week(long, everyday).days)
    expect(drawn).toHaveLength(14)
  })
  it('chosen by hand: a concrete recipe of the semana tipo stays, and «mis favoritas» keep their long favourites', () => {
    const cocido = long[0]
    const specs = { '1:dinner': [{ kind: 'preset', dish: { kind: 'recipe', recipeId: cocido.id, recipeName: cocido.name } }] } as unknown as Record<string, DishSpec[]>
    const preset = ids(week([...quick, cocido], everyday, { slotSpecs: specs }).days)
    expect(preset).toContainEqual({ day: 1, meal: 'dinner', id: cocido.id })

    const favourites = new Set(long.slice(0, 4).map((r) => r.id))
    for (let i = 0; i < 10; i++) {
      const drawn = ids(week([...quick, ...long], everyday, { onlyFavoriteIds: favourites }).days)
      for (const id of favourites) expect(drawn.map((d) => d.id)).toContain(id)
      expect(drawn.filter((d) => longIds.has(d.id) && !favourites.has(d.id))).toEqual([])
    }
  })
})

describe('«Cambiar» a dish (pickForSlot)', () => {
  const options: MatcherOptions = { meal: 'dinner', season: 'autumn', usedRecipeIds: new Set(), restrictions: [], favoriteRecipeIds: new Set(), workCap: 30 }
  it('a quick one of the whole pool beats a long one of the preferred pool', () => {
    const pick = { pool: [long[0], quick[0]], preferred: [long[0]], options }
    for (let i = 0; i < 20; i++) expect(pickForSlot(pick, null)).toBe(quick[0])
  })
  it('only long ones → one of them (never nothing); on a holiday (no cap) they are drawn as before', () => {
    expect(pickForSlot({ pool: [long[0]], options }, null)).toBe(long[0])
    expect(pickForSlot({ pool: [long[0]], options: { ...options, workCap: null } }, null)).toBe(long[0])
  })
})

describe('«25 min de trabajo · 2 h en total» and the week\'s minutes', () => {
  it('the hands-on time first, the total when longer', () => {
    expect(workTimeLabel({ activeTime: 25, totalTime: 120 })).toBe('25 min de trabajo · 2 h en total')
    expect(workTimeLabel({ activeTime: 25, totalTime: 120 }, { short: true })).toBe('25 min de trabajo · 2 h')
    expect(workTimeLabel({ activeTime: 20, totalTime: 20 })).toBe('20 min de trabajo')
    expect(workTimeLabel({ prepTime: 15, cookTime: 75 })).toBe('15 min de trabajo · 1 h 30 min en total')
    expect(workTimeLabel({ totalTime: 40 })).toBe('40 min')
    expect(workTimeLabel({})).toBe('')
  })
  it('sums the work of the dishes with a recipe; skipped days, removed meals and tápers add nothing', () => {
    const a = { kind: 'recipe', recipeId: 'a', activeTime: 25, totalTime: 120 }
    const b = { kind: 'recipe', recipeId: 'b', activeTime: 40 }
    const c = { kind: 'recipe', recipeId: 'c', prepTime: 15 }
    const days = [
      { lunch: { dishes: [a, c] }, dinner: { dishes: [b] } },
      {}, // a meal removed: no slot
      { lunch: { dishes: [{ ...b, leftoverOf: { day: 0, meal: 'dinner' } }] }, dinner: { dishes: [{ kind: 'note', text: 'Cena fuera' }] } },
      { lunch: { dishes: [{ kind: 'recipe', recipeId: 'zzz' }] } }, // no times: nothing
      { lunch: { dishes: [a] } }, // a day marked «sin cocinar»
    ]
    expect(weekWorkMinutes(days, [4])).toBe(80)
    expect(weekWorkMinutes(days)).toBe(105)
    expect(weekWorkMinutes([{}, {}])).toBeNull()
  })
})
