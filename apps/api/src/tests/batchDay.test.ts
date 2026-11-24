/**
 * PRO-1046 · El lote del domingo sale el domingo, no el lunes (Dani y Sara,
 * 2026-10-25 a 2026-11-24). They cook on Sunday for Monday to Thursday; the
 * menu showed Sunday «Día marcado sin cocinar» and the bowl ×8 on Monday as a
 * dish to cook. Now a dish can be cooked in an earlier batch
 * (`RecipeDish.batchDate`):
 *   - the batch day lists «Bowl de pollo ×8 (para lunes a jueves)», reading
 *     the next week too (a Sunday batch feeds the week after);
 *   - the meal itself and its leftovers are tápers; the list still buys it;
 *   - «Lo cocino en el lote del domingo» in the meal's sheet, and Mimo's
 *     `set_batch_day` (instead of a note on Sunday).
 *
 * The route is in batchDayRoute.smoke.ts and the screen in
 * apps/web/e2e/menu-batch-day.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  batchCookingOn,
  batchCookLine,
  batchForLabel,
  isBatchCooked,
  isValidBatchDate,
  MENU_SHEET_ACTIONS,
  type DayMenu,
  type MealSlot,
  type RecipeDish,
} from '@ona/shared'
import { patchDish } from '../services/menuDishes.js'
import { sumDinersByRecipe, withLeftoverBatches } from '../services/shoppingList.js'
import { dishLabel } from '../services/menuText.js'
import { setBatchDay } from '../services/assistant/batchDaySkills.js'
import { skills } from '../services/assistant/skills.js'
import { TOOL_GROUPS } from '../services/assistant/toolGroups.js'
import { mealSheetOptions } from '../../../web/src/lib/mealSheet'
import { patchDishIn } from '../../../web/src/lib/menuOptimistic'

const SUNDAY = '2026-10-25'
const NEXT_MONDAY = '2026-10-26'
const PREV_MONDAY = '2026-10-19'

const bowl = (over: Partial<RecipeDish> = {}): RecipeDish => ({ kind: 'recipe', recipeId: 'r-bowl', recipeName: 'Bowl de pollo', ...over })
const leftoverOfMonday: RecipeDish = { kind: 'recipe', recipeId: 'r-bowl', recipeName: 'Bowl de pollo', variant: 'leftover', leftoverOf: { day: 0, meal: 'lunch', dishPosition: 0 } }
const dinner = (id: string, name: string, over: Partial<RecipeDish> = {}): MealSlot => ({ dishes: [{ kind: 'recipe', recipeId: id, recipeName: name, ...over }] })

/** Dani y Sara's week of the 26th: the bowl Monday lunch with leftovers Tuesday to Thursday; the rice on Friday, frozen in the batch. */
function weekOf26(batch = true): DayMenu[] {
  return [
    { lunch: { servings: 2, dishes: [bowl(batch ? { batchDate: SUNDAY } : {})] }, dinner: dinner('r-gambas', 'Revuelto de gambas') },
    { lunch: { dishes: [leftoverOfMonday] }, dinner: dinner('r-brocoli', 'Pollo con brócoli') },
    { lunch: { dishes: [leftoverOfMonday] }, dinner: dinner('r-bacalao', 'Bacalao con tomate') },
    { lunch: { dishes: [leftoverOfMonday] }, dinner: dinner('r-fajitas', 'Fajitas') },
    { lunch: dinner('r-arroz', 'Arroz con pollo y garbanzos', batch ? { batchDate: SUNDAY } : {}), dinner: dinner('r-calabacin', 'Pollo con calabacín') },
    {},
    {},
  ]
}

describe('the batch day lists what it cooks, for which days', () => {
  it('Sunday the 25th: «Bowl de pollo ×8 (para lunes a jueves)» and the rice «para el viernes», from next week', () => {
    const items = batchCookingOn(SUNDAY, [{ weekStart: PREV_MONDAY, days: [{}, {}, {}, {}, {}, {}, {}] }, { weekStart: NEXT_MONDAY, days: weekOf26() }], 2)
    expect(items.map(batchCookLine)).toEqual(['Bowl de pollo ×8 (para lunes a jueves)', 'Arroz con pollo y garbanzos ×2 (para el viernes)'])
    expect(items[0]).toMatchObject({ recipeId: 'r-bowl', weekStart: NEXT_MONDAY, day: 0, meal: 'lunch', position: 0, servings: 8 })
    expect(items[0].forDates).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'])
  })

  it('another day, or a week without the batch, lists nothing', () => {
    expect(batchCookingOn('2026-10-24', [{ weekStart: NEXT_MONDAY, days: weekOf26() }], 2)).toEqual([])
    expect(batchCookingOn(SUNDAY, [{ weekStart: NEXT_MONDAY, days: weekOf26(false) }], 2)).toEqual([])
    expect(batchCookingOn(SUNDAY, [null, undefined], 2)).toEqual([])
  })

  it('the same week twice counts once', () => {
    const w = { weekStart: NEXT_MONDAY, days: weekOf26() }
    expect(batchCookingOn(SUNDAY, [w, w], 2)).toHaveLength(2)
  })

  it('a batch inside the week: Wednesday for Thursday and Friday', () => {
    const days: DayMenu[] = [{}, {}, {}, { dinner: dinner('r-chili', 'Chili', { batchDate: '2026-10-28' }) }, { dinner: { dishes: [{ kind: 'recipe', recipeId: 'r-chili', recipeName: 'Chili', variant: 'leftover', leftoverOf: { day: 3, meal: 'dinner', dishPosition: 0 } }] } }, {}, {}]
    const [chili] = batchCookingOn('2026-10-28', [{ weekStart: NEXT_MONDAY, days }], 2)
    expect(batchCookLine(chili)).toBe('Chili ×4 (para el jueves y el viernes)')
  })
})

describe('the days it feeds, in words', () => {
  it('consecutive days, one day, two days, scattered days', () => {
    expect(batchForLabel(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'])).toBe('para lunes a jueves')
    expect(batchForLabel(['2026-10-30'])).toBe('para el viernes')
    expect(batchForLabel(['2026-10-26', '2026-10-27'])).toBe('para el lunes y el martes')
    expect(batchForLabel(['2026-10-30', '2026-10-26', '2026-10-28'])).toBe('para el lunes, el miércoles y el viernes')
    expect(batchForLabel([])).toBe('')
  })
})

describe('which dates a batch can be', () => {
  it('1 to 6 days before the meal; never the same day, after it or a week before', () => {
    expect(isValidBatchDate(SUNDAY, '2026-10-26')).toBe(true)
    expect(isValidBatchDate(SUNDAY, '2026-10-31')).toBe(true) // Saturday
    expect(isValidBatchDate(SUNDAY, '2026-11-01')).toBe(false) // Sunday after: 7 days
    expect(isValidBatchDate(SUNDAY, SUNDAY)).toBe(false)
    expect(isValidBatchDate('2026-10-27', '2026-10-26')).toBe(false)
    expect(isValidBatchDate('domingo', '2026-10-26')).toBe(false)
  })

  it('only a planned recipe is in a batch: never a leftover copy, a táper or a note', () => {
    expect(isBatchCooked(bowl({ batchDate: SUNDAY }))).toBe(true)
    expect(isBatchCooked(bowl({ batchDate: null }))).toBe(false)
    expect(isBatchCooked({ ...leftoverOfMonday, batchDate: SUNDAY })).toBe(false)
    expect(isBatchCooked(bowl({ batchDate: SUNDAY, variant: 'freezer' }))).toBe(false)
    expect(isBatchCooked({ kind: 'note', text: 'Batch: chili' })).toBe(false)
  })
})

describe('the shopping list still buys the batch', () => {
  it('the bowl in the batch is bought for 8, the same as cooked on Monday', () => {
    const diners = (days: DayMenu[]) => sumDinersByRecipe(withLeftoverBatches(days, 2), 2)
    expect(diners(weekOf26()).get('r-bowl')).toBe(8)
    expect(diners(weekOf26()).get('r-arroz')).toBe(2)
    expect(diners(weekOf26())).toEqual(diners(weekOf26(false)))
  })
})

describe('setting it on a dish', () => {
  it('patchDish sets and clears batchDate; a táper drops it', () => {
    const [set] = patchDish([bowl()], 0, { batchDate: SUNDAY })
    expect(set).toMatchObject({ batchDate: SUNDAY })
    const [cleared] = patchDish([set], 0, { batchDate: null })
    expect((cleared as RecipeDish).batchDate).toBeNull()
    const [frozen] = patchDish([set], 0, { variant: 'cooked' })
    expect(frozen).not.toHaveProperty('batchDate')
    const [leftover] = patchDish([leftoverOfMonday], 0, { batchDate: SUNDAY })
    expect(leftover).not.toHaveProperty('batchDate')
  })

  it('the web paints it at once (optimistic), the same rule', () => {
    const menu = { days: weekOf26(false) }
    const next = patchDishIn(menu, 0, 'lunch', 0, { batchDate: SUNDAY })
    expect((next.days[0].lunch!.dishes[0] as RecipeDish).batchDate).toBe(SUNDAY)
    const back = patchDishIn(next, 0, 'lunch', 0, { variant: 'cooked' })
    expect((back.days[0].lunch!.dishes[0] as RecipeDish).batchDate).toBeNull()
  })
})

describe('«Ya está hecho / táper»: «Lo cocino en el lote del domingo»', () => {
  const slot = (dish: Partial<RecipeDish> = {}, over: Partial<MealSlot> = {}): MealSlot => ({ dishes: [bowl(dish)], ...over })

  it('Monday to Saturday, a recipe to cook: «Lo cocino en el lote del domingo»', () => {
    expect(mealSheetOptions({ slot: slot(), when: 'future', canTaper: false, canBatch: true }).done).toContain('lote_si')
    expect(mealSheetOptions({ slot: slot(), when: 'future', canTaper: false }).done).not.toContain('lote_si')
  })

  it('already in the batch: «Lo cocino su día»', () => {
    const o = mealSheetOptions({ slot: slot({ batchDate: SUNDAY }), when: 'future', canTaper: false, canBatch: true })
    expect(o.done).toContain('lote_no')
    expect(o.done).not.toContain('lote_si')
    expect(o.more).toContain('ya_hecho')
  })

  it('not on leftovers, tápers or a meal already eaten', () => {
    for (const s of [{ dishes: [leftoverOfMonday] }, slot({ variant: 'freezer' }), slot({}, { eaten: true })] as MealSlot[]) {
      const done = mealSheetOptions({ slot: s, when: 'today', canTaper: false, canBatch: true }).done
      expect(done).not.toContain('lote_si')
    }
  })

  it('both options are counted as menu_sheet_action of the meal sheet', () => {
    expect(MENU_SHEET_ACTIONS.comida).toEqual(expect.arrayContaining(['lote_si', 'lote_no']))
  })
})

describe('what Mimo reads', () => {
  it('Monday\'s bowl is «táper del lote del domingo»', () => {
    expect(dishLabel(bowl({ batchDate: SUNDAY }))).toBe('Bowl de pollo (táper del lote del domingo)')
    expect(dishLabel(bowl())).toBe('Bowl de pollo')
  })
})

describe('Mimo: set_batch_day', () => {
  it('is a tool, in the sobras group, chosen when the household says «lote» or «batch»', () => {
    expect(skills.map((s) => s.name)).toContain('set_batch_day')
    expect(TOOL_GROUPS.sobras.tools).toContain('set_batch_day')
    expect(TOOL_GROUPS.sobras.words.test('el domingo hacemos batch')).toBe(true)
    expect(TOOL_GROUPS.sobras.words.test('lo hago en el lote')).toBe(true)
  })

  const run = async (params: Record<string, unknown>, days = weekOf26(false)) => {
    vi.useFakeTimers({ now: new Date('2026-10-24T10:00:00Z') }) // Saturday in Madrid
    const calls: Array<[string, string, unknown]> = []
    const api = vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body])
      if (method === 'GET') return { id: 'm-26', days }
      return {}
    })
    try {
      const r = await setBatchDay.handler(params, { userId: 'u-1', db: {} as any, api } as any)
      return { r, calls }
    } finally {
      vi.useRealTimers()
    }
  }

  it('«el domingo hacemos el bowl de lunes a jueves y el arroz del viernes»: marks both dishes, once per week read', async () => {
    const { r, calls } = await run({
      batchDay: 'domingo',
      dishes: [{ day: 'lunes', meal: 'lunch' }, { day: 'viernes', meal: 'lunch' }],
    })
    expect(calls).toEqual([
      ['GET', '/menu/u-1/2026-10-26', undefined],
      ['PATCH', '/menu/m-26/day/0/meal/lunch/dish/0', { batchDate: SUNDAY }],
      ['PATCH', '/menu/m-26/day/4/meal/lunch/dish/0', { batchDate: SUNDAY }],
    ])
    expect(r.summary).toContain('el domingo 25 de octubre es día de lote')
    expect(r.summary).toContain('«Bowl de pollo» (comida del lunes 26 de octubre)')
    expect(r.summary).toContain('la lista de la compra no cambia')
  })

  it('leftovers, a day too far or a meal without a recipe are left as they were, and said', async () => {
    const { r, calls } = await run({
      batchDay: 'domingo',
      dishes: [{ day: 'martes', meal: 'lunch' }, { day: 'domingo 1', meal: 'lunch' }, { day: 'sábado 31', meal: 'dinner' }],
    })
    expect(calls.filter(([m]) => m === 'PATCH')).toEqual([])
    expect(r.summary).toContain('No he cambiado nada')
    expect(r.summary).toContain('son sobras, ya salen del lote de su plato')
    expect(r.summary).toContain('de 1 a 6 días antes')
    expect(r.summary).toContain('no tiene una receta que cocinar')
  })

  it('remove: back to its own day', async () => {
    const { r, calls } = await run({ remove: true, dishes: [{ day: 'lunes', meal: 'lunch' }] }, weekOf26(true))
    expect(calls[1]).toEqual(['PATCH', '/menu/m-26/day/0/meal/lunch/dish/0', { batchDate: null }])
    expect(r.summary).toContain('ya no salen del lote')
  })
})
