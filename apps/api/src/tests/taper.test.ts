/**
 * PRO-223 · «El táper de mañana». Marking Tuesday's lunch as táper turns it
 * into Monday's dinner as a leftover and that dinner gets one more ration;
 * the list counts it once (never a second cooking); Mimo does the same with
 * «mañana me llevo táper»; the reminder rides on a message that goes out
 * anyway that day.
 */
import { describe, expect, it, vi } from 'vitest'
import type { DayMenu, MealSlot } from '@ona/shared'
import { applyTaper, applyTemplateTapers, removeTaper, taperDaysOf, taperReminderLine, taperTomorrow } from '../services/taper.js'
import { sumDinersByRecipe, withLeftoverBatches } from '../services/shoppingList.js'
import { batchServings, taperSourceOf } from '../../../web/src/lib/menuDay'
import { setTaper } from '../services/assistant/taperSkills.js'
import { planProactive, type ProactiveInput } from '../services/whatsapp/proactive.js'
import { madridParts } from '../services/madridTime.js'

const cooked = (recipeId: string, servings?: number): MealSlot => ({
  ...(servings != null ? { servings } : {}),
  dishes: [{ kind: 'recipe', recipeId, recipeName: recipeId === 'lentejas' ? 'Lentejas estofadas' : recipeId }],
})
const week = (mondayDinnerServings?: number): DayMenu[] => [
  { lunch: cooked('ensalada'), dinner: cooked('lentejas', mondayDinnerServings) },
  { lunch: cooked('pasta'), dinner: cooked('merluza') },
  {}, {}, {}, {}, {},
]
const diners = (days: DayMenu[], household: number) => sumDinersByRecipe(withLeftoverBatches(days, household), household)

describe('marking Tuesday’s lunch as táper', () => {
  it('becomes the leftovers of Monday’s dinner, one ration, and the plantilla-free week is otherwise untouched', () => {
    const before = week()
    const r = applyTaper(before, 1, 'lunch')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.days[1].lunch).toEqual({
      servings: 1,
      taper: 1,
      dishes: [{ kind: 'recipe', recipeId: 'lentejas', recipeName: 'Lentejas estofadas', variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner', dishPosition: 0 } }],
    })
    expect(r.days[0].dinner).toEqual(before[0].dinner)
    expect(r.days[1].dinner).toEqual(before[1].dinner)
    expect(before[1].lunch?.dishes[0]).toMatchObject({ recipeId: 'pasta' }) // pure
  })

  it('the list buys Monday’s dinner for one more and no pasta, without counting the dinner twice', () => {
    const r = applyTaper(week(), 1, 'lunch')
    if (!r.ok) throw new Error(r.error)
    // Household of 2: lentejas 2 + 1 táper = 3; pasta gone; merluza as it was.
    expect(diners(r.days, 2).get('lentejas')).toBe(3)
    expect(diners(r.days, 2).has('pasta')).toBe(false)
    expect(diners(r.days, 2).get('merluza')).toBe(2)
    // With «Solo hoy: 4» on Monday's dinner the táper is still one more (4 + 1), never 4 + 4.
    const r2 = applyTaper(week(4), 1, 'lunch')
    if (!r2.ok) throw new Error(r2.error)
    expect(diners(r2.days, 2).get('lentejas')).toBe(5)
    // Two tápers → two rations more.
    const r3 = applyTaper(week(), 1, 'lunch', 2)
    if (!r3.ok) throw new Error(r3.error)
    expect(diners(r3.days, 2).get('lentejas')).toBe(4)
  })

  it('the dinner’s cook link opens with that ration more', () => {
    const r = applyTaper(week(4), 1, 'lunch')
    if (!r.ok) throw new Error(r.error)
    expect(batchServings(r.days, 0, 'dinner', 2)).toBe(5)
    const r2 = applyTaper(week(), 1, 'lunch')
    if (!r2.ok) throw new Error(r2.error)
    expect(batchServings(r2.days, 0, 'dinner', 2)).toBe(3)
    expect(taperSourceOf(week(), 1, 'lunch', (d) => ['lunes', 'martes'][d])).toEqual({ dayLabel: 'lunes', recipeName: 'Lentejas estofadas' })
    expect(taperSourceOf(week(), 0, 'lunch', (d) => String(d))).toBeNull()
  })

  it('refuses Monday, a dinner, a locked meal and a day before without a cooked dinner; undo empties it', () => {
    expect(applyTaper(week(), 0, 'lunch')).toMatchObject({ ok: false, status: 409 })
    expect(applyTaper(week(), 1, 'dinner')).toMatchObject({ ok: false, status: 400 })
    expect(applyTaper(week(), 1, 'lunch', 1, { '1': { lunch: true } })).toMatchObject({ ok: false, status: 400 })
    expect(applyTaper(week(), 3, 'lunch')).toMatchObject({ ok: false, status: 404 })
    const r = applyTaper(week(), 1, 'lunch')
    if (!r.ok) throw new Error(r.error)
    const undone = removeTaper(r.days, 1, 'lunch')
    expect(undone).toMatchObject({ ok: true })
    if (undone.ok) expect(undone.days[1].lunch).toEqual({ dishes: [] })
    expect(removeTaper(week(), 1, 'lunch')).toMatchObject({ ok: false, status: 404 })
  })

  it('the plantilla’s «días de táper» do it on generation (skipping Monday and skipped days)', () => {
    expect(taperDaysOf({ taperDays: ['martes', 'lunes', 'jueves', 'otro'] })).toEqual([0, 1, 3])
    const days = applyTemplateTapers(week(), { taperDays: ['martes', 'lunes'] })
    expect(days[1].lunch?.taper).toBe(1)
    expect(days[0].lunch?.dishes[0]).toMatchObject({ recipeId: 'ensalada' })
    expect(applyTemplateTapers(week(), { taperDays: ['martes'] }, {}, [0])[1].lunch?.taper).toBeUndefined()
  })
})

describe('Mimo: «mañana me llevo táper»', () => {
  it('calls the same route for tomorrow’s lunch and says what changed', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-19T10:00:00Z') }) // Monday in Madrid
    const calls: Array<[string, string, unknown]> = []
    const api = vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body])
      if (method === 'GET') return { id: 'm-1', days: week() }
      const r = applyTaper(week(), 1, 'lunch', (body as any)?.count ?? 1)
      return r.ok ? { id: 'm-1', days: r.days } : null
    })
    const r = await setTaper.handler({ day: 'mañana' }, { userId: 'u-1', db: {} as any, api } as any)
    vi.useRealTimers()
    expect(calls[0]).toEqual(['GET', '/menu/u-1/2026-10-19', undefined])
    expect(calls[1]).toEqual(['POST', '/menu/m-1/day/1/meal/lunch/taper', { count: 1 }])
    expect(r.summary).toContain('es táper de «Lentejas estofadas» (la cena del lunes), que ahora se hace con una ración más')
  })
})

describe('the reminder rides on a message that goes out anyway', () => {
  const now = new Date('2026-10-19T18:20:00Z') // Monday 20:20 Madrid
  const base = (over: Partial<ProactiveInput> = {}): ProactiveInput => ({
    parts: madridParts(now),
    breakfastTime: null,
    dinnerTime: '22:00',
    prefs: {},
    sentRecently: {},
    todayDay: async () => null,
    todayDinner: async () => ({ names: ['Lentejas estofadas'], totalMinutes: 90 }),
    cookedToday: async () => false,
    pendingShopping: async () => [],
    hasNextWeekMenu: async () => true,
    taperTonight: async () => taperTomorrow((applyTaper(week(), 1, 'lunch') as any).days, 0),
    webUrl: 'https://mimoia.com',
    ...over,
  })

  it('«toca empezar» carries «haz una ración más», in the same message', async () => {
    const out = await planProactive(base())
    expect(out.map((p) => p.kind)).toEqual(['cooking_reminder'])
    const text = (out[0].messages[0] as any).text as string
    expect(text).toContain('toca empezar con *Lentejas estofadas*')
    expect(text).toContain('🥡 Mañana te llevas táper: haz 1 ración más de *Lentejas estofadas*.')
    expect(out[0].guide?.required).toContain('táper')
  })

  it('no message that day → no extra message just for the táper', async () => {
    const out = await planProactive(base({ parts: { ...madridParts(now), hour: 15 } }))
    expect(out).toEqual([])
  })

  it('formats several tápers', () => {
    expect(taperReminderLine({ recipeNames: ['Lentejas'], count: 2 })).toBe('🥡 Mañana te llevas táper: haz 2 raciones más de *Lentejas*.')
  })
})
