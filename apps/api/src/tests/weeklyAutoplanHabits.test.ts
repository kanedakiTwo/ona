/**
 * PRO-1262 · La semana hecha el jueves respeta a la casa (the Thursday week
 * goes through the weekly generator, `weeklyAutoplan.ts` → `generateAndSaveMenu`):
 * weekday lunches and dinners within the ficha's time, a batch-cooking
 * household's week as a Sunday batch with its leftovers, and a household
 * with favourites gets at least the share its own weeks carry. With an
 * invented catalogue; the real generator end to end is in `weeklyAutoplan.smoke.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchServingsOf, type DayMenu, type DayTemplate, type RecipeDish } from '@ona/shared'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import { applyBatchWeek } from '../services/menuBatchWeek.js'
import { ensureFavoriteShare, favoriteShareOf } from '../services/menuFavoriteShare.js'
import { WORKDAY_MAX_MINUTES } from '../services/menuSlotPick.js'
import { batchCookingOf } from '../services/profile/reader.js'

const VEG = ['calabacín', 'berenjena', 'pimiento', 'espinacas', 'acelgas', 'brócoli', 'coliflor', 'puerro', 'zanahoria', 'calabaza']
const recipe = (id: string, totalTime: number | null, i = 0, extra: Partial<RecipeWithCourse> = {}) =>
  ({
    id,
    name: `Plato ${id}`,
    meals: ['lunch', 'dinner'],
    seasons: [],
    frequency: null,
    tags: [],
    internalTags: [],
    allergens: [],
    course: null,
    totalTime,
    ingredients: [{ ingredientId: `i-${id}`, ingredientName: VEG[i % VEG.length], quantity: 100, unit: 'g', allergenTags: [] }],
    ...extra,
  }) as unknown as RecipeWithCourse

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
afterEach(() => vi.restoreAllMocks())

const dish = (recipeId: string, extra: Partial<RecipeDish> = {}): RecipeDish => ({ kind: 'recipe', recipeId, recipeName: `Plato ${recipeId}`, course: null, ...extra })
/** Lunch and dinner every day, one dish each: `l<day>` and `d<day>`. */
const drawnWeek = (servings?: number): DayMenu[] =>
  Array.from({ length: 7 }, (_, d) => ({
    lunch: { ...(servings ? { servings } : {}), dishes: [dish(`l${d}`)] },
    dinner: { ...(servings ? { servings } : {}), dishes: [dish(`d${d}`)] },
  }))

describe('weekday times (the Ruiz family: 85, 90 and 122 min on weekdays with three kids)', () => {
  // 20 long (90–180 min, Sfiha, pimientos rellenos…) and 20 within the hour.
  const catalogue = [
    ...Array.from({ length: 20 }, (_, i) => recipe(`long${i}`, 90 + i * 5, i)),
    ...Array.from({ length: 20 }, (_, i) => recipe(`short${i}`, 25 + i, i)),
  ]
  const totalOf = new Map(catalogue.map((r) => [r.id, r.totalTime as number]))
  const draw = (template: DayTemplate[], pool: RecipeWithCourse[], workdayCapOf?: (d: number, m: string) => number | null) =>
    buildRandomMenu(template, pool, 'autumn', [], new Set(), {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, null, undefined, undefined, workdayCapOf).days
  const weekday = (d: number, m: string) => (d < 5 && (m === 'lunch' || m === 'dinner') ? WORKDAY_MAX_MINUTES : null)

  it('Monday to Friday, every lunch and dinner within the cap; the weekend draws from everything', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(7))
    let weekendLong = 0
    for (let i = 0; i < 20; i++) {
      const days = draw(defaultTemplate(), catalogue, weekday)
      days.forEach((day, d) => {
        for (const slot of Object.values(day)) {
          for (const x of slot?.dishes ?? []) {
            const t = totalOf.get((x as RecipeDish).recipeId)!
            if (d < 5) expect(t).toBeLessThanOrEqual(WORKDAY_MAX_MINUTES)
            else if (t > WORKDAY_MAX_MINUTES) weekendLong++
          }
        }
      })
    }
    expect(weekendLong).toBeGreaterThan(0)
  })

  it('the ficha’s `effort` sets the cap; without the cap (before) long dishes came out on weekdays', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(8))
    const before = draw(defaultTemplate(), catalogue)
    expect(before.slice(0, 5).some((day) => Object.values(day).some((s) => (s?.dishes ?? []).some((x) => totalOf.get((x as RecipeDish).recipeId)! > 60)))).toBe(true)
    const effort = draw(defaultTemplate(), catalogue, (d, m) => (d < 5 && m === 'dinner' ? 30 : null))
    for (const day of effort.slice(0, 5)) expect(totalOf.get((day.dinner!.dishes[0] as RecipeDish).recipeId)!).toBeLessThanOrEqual(30)
  })

  it('no dish within the cap: the slot is still filled; unknown times pass', () => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(9))
    const longOnly = catalogue.filter((r) => r.id.startsWith('long'))
    const days = draw([{ dinner: true }], longOnly, weekday)
    expect(days[0].dinner?.dishes).toHaveLength(1)
    const unknown = draw([{ dinner: true }], [...longOnly, recipe('x', null)], weekday)
    expect((unknown[0].dinner!.dishes[0] as RecipeDish).recipeId).toBe('x')
  })
})

describe('the batch week (Dani y Sara: «Batch cooking», every meal «Solo hoy: 2» and no leftovers)', () => {
  it('reads «Batch cooking» and `batch_cooking` from the ficha (a «no» wins; Saturday when they say so)', () => {
    expect(batchCookingOf([{ type: 'cooking_style', value: { style: 'batch' } }])).toEqual({ daysBefore: 1 })
    expect(batchCookingOf([{ type: 'cooking_style', value: { style: 'daily' } }])).toBeNull()
    expect(batchCookingOf([{ type: 'batch_cooking', value: { batches: true, days: ['sabado'] } }])).toEqual({ daysBefore: 2 })
    expect(batchCookingOf([{ type: 'batch_cooking', value: { batches: true, days: ['domingo', 'sabado'] } }])).toEqual({ daysBefore: 1 })
    expect(batchCookingOf([{ type: 'cooking_style', value: { style: 'batch' } }, { type: 'batch_cooking', value: { batches: false } }])).toBeNull()
    expect(batchCookingOf([])).toBeNull()
  })

  it('Monday and Wednesday cooked on Sunday, Tuesday and Thursday their leftovers; Friday and the weekend as drawn', () => {
    const days = applyBatchWeek(drawnWeek(2), { weekStart: '2026-11-16' })
    for (const meal of ['lunch', 'dinner'] as const) {
      for (const [first, second] of [[0, 1], [2, 3]]) {
        const cooked = days[first][meal]!.dishes[0] as RecipeDish
        expect(cooked).toMatchObject({ recipeId: `${meal[0]}${first}`, batchDate: '2026-11-15' })
        const left = days[second][meal]!
        expect(left.servings).toBe(2)
        expect(left.dishes[0]).toMatchObject({ recipeId: cooked.recipeId, variant: 'leftover', leftoverOf: { day: first, meal, dishPosition: 0 } })
        expect((left.dishes[0] as RecipeDish).batchDate).toBeUndefined()
        // Cooked for both days: 2 + 2 rations (the shopping list and «Cocinas hoy»).
        expect(batchServingsOf(days, first, meal, 2)).toBe(4)
      }
    }
    for (const d of [4, 5, 6]) expect(days[d]).toEqual(drawnWeek(2)[d])
  })

  it('Saturday: the batch date is two days before Monday', () => {
    const days = applyBatchWeek(drawnWeek(), { weekStart: '2026-11-16', daysBefore: 2 })
    expect((days[0].lunch!.dishes[0] as RecipeDish).batchDate).toBe('2026-11-14')
  })

  it('never a locked slot, a «sin cocinar» day, the week type’s slots nor a note', () => {
    const week = drawnWeek()
    week[2].dinner = { dishes: [{ kind: 'note', text: 'Pizza' }] }
    const days = applyBatchWeek(week, {
      weekStart: '2026-11-16',
      locked: { '1': { lunch: true } },
      skippedDays: new Set([3]),
      keep: (d, m) => d === 0 && m === 'dinner',
    })
    // Monday lunch is cooked on Sunday, but Tuesday's is locked: no leftovers there.
    expect((days[0].lunch!.dishes[0] as RecipeDish).batchDate).toBe('2026-11-15')
    expect(days[1].lunch).toEqual(week[1].lunch)
    expect(days[0].dinner).toEqual(week[0].dinner)
    expect(days[1].dinner).toEqual(week[1].dinner)
    expect(days[2].dinner).toEqual(week[2].dinner)
    // Thursday «sin cocinar»: Wednesday lunch is batch-cooked alone.
    expect((days[2].lunch!.dishes[0] as RecipeDish).batchDate).toBe('2026-11-15')
    expect(days[3]).toEqual(week[3])
  })

  it('a dish that wouldn’t keep until its last day is swapped for one that does; with none, cooked each day', () => {
    const keeps = (id: string, n: number) => id !== 'l2' || n <= 2
    const swapped = applyBatchWeek(drawnWeek(), { weekStart: '2026-11-16', keeps, replace: (_d, _m, _x, n) => (n === 4 ? dish('guiso') : null) })
    expect(swapped[2].lunch!.dishes[0]).toMatchObject({ recipeId: 'guiso', batchDate: '2026-11-15' })
    expect(swapped[3].lunch!.dishes[0]).toMatchObject({ recipeId: 'guiso', variant: 'leftover' })
    const none = applyBatchWeek(drawnWeek(), { weekStart: '2026-11-16', keeps, replace: () => null })
    expect(none[2].lunch).toEqual(drawnWeek()[2].lunch)
    expect(none[3].lunch).toEqual(drawnWeek()[3].lunch)
  })
})

describe('favourites (the Ruiz family: tortilla, macarrones, croquetas, pollo empanado)', () => {
  const chosen = new Set(['tortilla', 'macarrones', 'croquetas', 'empanado', 'crema'])

  it('the share of their own weeks: lunches and dinners, leftovers and tápers aside', () => {
    const week = drawnWeek()
    week[0].dinner = { dishes: [dish('tortilla')] }
    week[1].dinner = { dishes: [dish('tortilla', { variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner', dishPosition: 0 } })] }
    week[2].dinner = { dishes: [dish('croquetas', { variant: 'freezer' })] }
    week[3].breakfast = { dishes: [dish('macarrones')] }
    // 14 slots, 2 aside: 1 of 12.
    expect(favoriteShareOf([week], chosen)).toBeCloseTo(1 / 12)
    expect(favoriteShareOf([], chosen)).toBe(0)
  })

  it('short of the share, drawn dishes become chosen ones the slot allows', () => {
    const pick = vi.fn((d: number, _m: string, _x: RecipeDish, _days: DayMenu[], used: ReadonlySet<string>) => {
      if (d >= 5) return null // e.g. nothing fits the weekend
      const next = [...chosen].find((id) => !used.has(id))
      return next ? dish(next) : null
    })
    const { days, swapped } = ensureFavoriteShare(drawnWeek(), { share: 0.25, chosen, pick, random: seeded(1) })
    // 14 dishes × 0.25 → at least 4.
    expect(swapped).toBe(4)
    expect(favoriteShareOf([days], chosen)).toBeGreaterThanOrEqual(0.25)
    const ids = days.flatMap((d) => Object.values(d).flatMap((s) => (s?.dishes ?? []).map((x) => (x as RecipeDish).recipeId)))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never a locked slot, the week type’s, a batch or a leftover; already there, nothing changes', () => {
    const week = applyBatchWeek(drawnWeek(), { weekStart: '2026-11-16' })
    const pick = vi.fn((_d: number, _m: string, _x: RecipeDish, _days: DayMenu[], used: ReadonlySet<string>) => {
      const next = [...chosen].find((id) => !used.has(id))
      return next ? dish(next) : null
    })
    const { days } = ensureFavoriteShare(week, { share: 1, chosen, pick, locked: { '4': { lunch: true } }, keep: (d, m) => d === 5 && m === 'lunch', random: seeded(2) })
    for (const d of [0, 1, 2, 3]) expect(days[d]).toEqual(week[d])
    expect(days[4].lunch).toEqual(week[4].lunch)
    expect(days[5].lunch).toEqual(week[5].lunch)
    for (const [d] of pick.mock.calls) expect([4, 5, 6]).toContain(d)
    expect(ensureFavoriteShare(days, { share: 0, chosen, pick }).swapped).toBe(0)
  })
})
