/**
 * PRO-270 (Familia Ruiz, Laura, 2026-10-19/20): what was bought for one week
 * ticked the same product on another week («Merluza · 750 g» of Monday 26
 * came out bought: the last merluza was bought for Saturday 17), and the
 * eggs «ya tienes 15» became «ya tienes 4» without anyone touching them (a
 * shorter range shrank the remembered amount).
 */
import { describe, expect, it } from 'vitest'
import type { ShoppingItem } from '@ona/shared'
import { carryItemState, mondayOfIso, setHaveAtHome, toggleChecked, type ItemStateMap } from '../services/shoppingItemState.js'
import { withWeekShares } from '../services/shoppingWeeks.js'

const W12 = '2026-10-12'
const W19 = '2026-10-19'
const W26 = '2026-10-26'

const line = (ingredientId: string, quantity: number, weeks?: Record<string, number>, extra: Partial<ShoppingItem> = {}): ShoppingItem =>
  ({
    id: `menu:${ingredientId}:${extra.unit ?? 'g'}`,
    ingredientId,
    name: ingredientId,
    quantity,
    unit: 'g',
    aisle: 'proteinas',
    checked: false,
    inStock: false,
    kind: 'menu',
    ...(weeks ? { weeks } : {}),
    ...extra,
  }) as ShoppingItem

/** One GET: rebuild `fresh` over the previous list, as the rolling route does. */
function rebuild(fresh: ShoppingItem[], prev: { items: ShoppingItem[]; state: ItemStateMap }, today: string) {
  return carryItemState(fresh, prev.items, prev.state, undefined, { today, rangeTo: '2026-11-08' })
}

describe('a tick covers the weeks it was bought for (PRO-270)', () => {
  it('compro merluza el 17, la semana del 26 la pide otra vez → pendiente', () => {
    // Saturday 17: the list (17 → 25) asks merluza for Saturday's dinner; ticked.
    let list = rebuild([line('merluza', 750, { [W12]: 750 })], { items: [], state: {} }, '2026-10-17')
    toggleChecked(list.items[0])
    expect(list.items[0].checked).toBe(true)
    // Sunday 18: nothing with merluza in the range; the mark is remembered.
    list = rebuild([], list, '2026-10-18')
    // Monday 19: Mimo puts merluza on Monday 26 (19 → 1 nov).
    list = rebuild([line('merluza', 750, { [W26]: 750 })], list, '2026-10-19')
    expect(list.items[0]).toMatchObject({ checked: false, inStock: false })
    expect(list.items[0].haveQuantity).toBeUndefined()
  })

  it('even when the old tick is still on the previous rows', () => {
    const prev = [line('merluza', 750, { [W19]: 750 }, { checked: true })]
    const { items } = carryItemState([line('merluza', 750, { [W26]: 750 })], prev, null, undefined, { today: '2026-10-24' })
    expect(items[0].checked).toBe(false)
  })

  it('bought for both weeks → next week, the new week asks the rest («Te faltan»)', () => {
    let list = rebuild([line('merluza', 1500, { [W19]: 750, [W26]: 750 })], { items: [], state: {} }, '2026-10-19')
    toggleChecked(list.items[0])
    list = rebuild([line('merluza', 1500, { [W19]: 750, [W26]: 750 })], list, '2026-10-20')
    expect(list.items[0].checked).toBe(true)
    // Monday 26 (26 → 8 nov): Monday 2 asks for merluza again.
    list = rebuild([line('merluza', 1500, { [W26]: 750, '2026-11-02': 750 })], list, '2026-10-26')
    expect(list.items[0]).toMatchObject({ checked: false, haveQuantity: 750, haveSource: 'checked' })
  })

  it('a dish of the same week that asks more says how much is missing', () => {
    let list = rebuild([line('merluza', 750, { [W26]: 750 })], { items: [], state: {} }, '2026-10-19')
    toggleChecked(list.items[0])
    list = rebuild([line('merluza', 1000, { [W26]: 1000 })], list, '2026-10-19')
    expect(list.items[0]).toMatchObject({ checked: false, haveQuantity: 750 })
  })

  it('ticked on «La que viene», then on «Esta semana» → both weeks bought', () => {
    let list = rebuild([line('ajo', 50, { [W26]: 50 })], { items: [], state: {} }, '2026-10-20')
    toggleChecked(list.items[0])
    // «Esta semana»: the garlic of this week is pending (the tick was for the 26th).
    list = rebuild([line('ajo', 25, { [W19]: 25 })], list, '2026-10-20')
    expect(list.items[0].checked).toBe(false)
    toggleChecked(list.items[0])
    // Both weeks again: all bought.
    list = rebuild([line('ajo', 75, { [W19]: 25, [W26]: 50 })], list, '2026-10-20')
    expect(list.items[0].checked).toBe(true)
  })

  it('«en casa» is the pantry: it covers any week', () => {
    let list = rebuild([line('aceite', 100, { [W19]: 100 })], { items: [], state: {} }, '2026-10-19')
    list.items[0].inStock = true
    list = rebuild([line('aceite', 100, { [W26]: 100 })], list, '2026-10-19')
    expect(list.items[0].inStock).toBe(true)
  })

  it('a tick saved before weeks were stored counts for the current week only', () => {
    const remembered: ItemStateMap = { 'merluza|g': { checked: true, inStock: false, pricePerUnit: null, quantity: 750 } }
    const same = carryItemState([line('merluza', 750, { [W19]: 750 })], [], remembered, undefined, { today: '2026-10-20' })
    expect(same.items[0].checked).toBe(true)
    const next = carryItemState([line('merluza', 750, { [W26]: 750 })], [], remembered, undefined, { today: '2026-10-20' })
    expect(next.items[0].checked).toBe(false)
  })

  it('weeks already gone are forgotten', () => {
    const remembered: ItemStateMap = { 'merluza|g': { checked: true, inStock: false, pricePerUnit: null, quantity: 750, weeks: { [W12]: 750 } } }
    const { state } = carryItemState([], [], remembered, undefined, { today: '2026-10-19' })
    expect(state['merluza|g']).toBeUndefined()
  })

  it('a joined line only gathers ticks of its weeks', () => {
    const remembered: ItemStateMap = { 'yema|u': { checked: true, inStock: false, pricePerUnit: null, quantity: 2, weeks: { [W19]: 2 } } }
    const eggs = line('huevo', 6, { [W26]: 6 }, { unit: 'u', mergedIngredientIds: ['yema'] })
    const { items } = carryItemState([eggs], [], remembered, undefined, { today: '2026-10-20' })
    expect(items[0].checked).toBe(false)
  })
})

describe('what is marked never shrinks by itself (PRO-270, huevos 15 → 4)', () => {
  it('15 eggs at home, a shorter range asks for 4, back to two weeks → still 15', () => {
    const two = () => line('huevo', 39, { [W19]: 20, [W26]: 19 }, { unit: 'u' })
    let list = rebuild([two()], { items: [], state: {} }, '2026-10-20')
    setHaveAtHome(list.items[0], 15)
    expect(list.items[0]).toMatchObject({ haveQuantity: 15, haveSource: 'inStock' })
    // Shop orders / «Hoy» rebuild a shorter range that only asks for 4.
    list = rebuild([line('huevo', 4, { [W19]: 4 }, { unit: 'u' })], list, '2026-10-20')
    expect(list.items[0].inStock).toBe(true)
    list = rebuild([two()], list, '2026-10-20')
    expect(list.items[0]).toMatchObject({ inStock: false, haveQuantity: 15 })
  })

  it('a tick on two weeks survives looking at «Hoy»', () => {
    const two = () => line('merluza', 1500, { [W19]: 750, [W26]: 750 })
    let list = rebuild([two()], { items: [], state: {} }, '2026-10-20')
    toggleChecked(list.items[0])
    list = rebuild([line('merluza', 750, { [W19]: 750 })], list, '2026-10-20')
    expect(list.items[0].checked).toBe(true)
    list = rebuild([two()], list, '2026-10-20')
    expect(list.items[0].checked).toBe(true)
  })

  it('«tengo una docena» on a line of 4 is remembered as 12', () => {
    let list = rebuild([line('huevo', 4, { [W19]: 4 }, { unit: 'u' })], { items: [], state: {} }, '2026-10-20')
    setHaveAtHome(list.items[0], 12)
    expect(list.items[0].inStock).toBe(true)
    list = rebuild([line('huevo', 39, { [W19]: 20, [W26]: 19 }, { unit: 'u' })], list, '2026-10-20')
    expect(list.items[0]).toMatchObject({ haveQuantity: 12 })
  })

  it('unticking forgets the mark', () => {
    let list = rebuild([line('ajo', 50, { [W19]: 50 })], { items: [], state: {} }, '2026-10-20')
    toggleChecked(list.items[0])
    list = rebuild([line('ajo', 25, { [W19]: 25 })], list, '2026-10-20')
    toggleChecked(list.items[0])
    expect(list.items[0].checked).toBe(false)
    list = rebuild([line('ajo', 50, { [W19]: 50 })], list, '2026-10-20')
    expect(list.items[0].checked).toBe(false)
  })
})

describe('withWeekShares', () => {
  it('spreads each line over the weeks that ask for it, in its unit', () => {
    const range = [line('merluza', 1500), line('huevo', 10, undefined, { unit: 'u', mergedIngredientIds: ['yema'] })]
    const perWeek = [
      { week: W19, items: [line('merluza', 600), line('yema', 2, undefined, { unit: 'u' })] },
      { week: W26, items: [line('merluza', 900), line('huevo', 300, undefined, { unit: 'g' })] },
    ]
    const convert = (_id: string, q: number, from: string, to: string) => (from === 'g' && to === 'u' ? q / 50 : null)
    const out = withWeekShares(range, perWeek, convert)
    expect(out[0].weeks).toEqual({ [W19]: 600, [W26]: 900 })
    // 2 yolks + 300 g (6 eggs) → 10 eggs split 2 : 6.
    expect(out[1].weeks).toEqual({ [W19]: 2.5, [W26]: 7.5 })
  })

  it('one week: the whole line is that week', () => {
    expect(withWeekShares([line('ajo', 25)], [{ week: W19, items: [] }])[0].weeks).toEqual({ [W19]: 25 })
  })

  it('mondayOfIso', () => {
    expect(mondayOfIso('2026-10-25')).toBe(W19)
    expect(mondayOfIso('2026-10-26')).toBe(W26)
  })
})

describe('ticks from paths that only flip the flag (Mimo, PRO-270)', () => {
  it('Mimo ticks a line whose old tick was for another week → bought for this one', () => {
    let list = rebuild([line('calabacin', 400, { [W26]: 400 })], { items: [], state: {} }, '2026-10-19')
    toggleChecked(list.items[0])
    list = rebuild([line('calabacin', 200, { [W19]: 200 })], list, '2026-10-19')
    expect(list.items[0].checked).toBe(false)
    list.items[0].checked = true // check_shopping_item sets the flag only
    list = rebuild([line('calabacin', 200, { [W19]: 200 })], list, '2026-10-19')
    expect(list.items[0].checked).toBe(true)
  })

  it('Mimo unticks a covered line → pending', () => {
    let list = rebuild([line('ajo', 50, { [W19]: 50 })], { items: [], state: {} }, '2026-10-19')
    toggleChecked(list.items[0])
    list = rebuild([line('ajo', 50, { [W19]: 50 })], list, '2026-10-19')
    expect(list.items[0].mark?.covered).toBe(true)
    list.items[0].checked = false
    list = rebuild([line('ajo', 50, { [W19]: 50 })], list, '2026-10-19')
    expect(list.items[0].checked).toBe(false)
  })
})
