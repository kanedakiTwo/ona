/**
 * PRO-228 · Congelador en la despensa y repaso mensual.
 *   - the migration only adds columns (default «despensa»);
 *   - rows group / filter by place;
 *   - once a month, only with something 4+ weeks in the freezer, Mimo asks
 *     «¿Lo meto en el menú de estas semanas?» — an ordinary proactive message
 *     (priority 2 of the weekly cap, PRO-215), so it spends budget;
 *   - «Sí, mételo» → plan_freezer_items puts it in the next two weeks.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { freezerItemsDue, groupPantryByLocation, isPantryLocation } from '@ona/shared'

const hitsByName: Record<string, any[]> = {}
vi.mock('../services/withWhatIHave.js', () => ({
  findRecipesWithWhatIHave: vi.fn(async (_u: string, chosen: Array<{ name: string }>) => hitsByName[chosen[0].name] ?? []),
}))

import { planProactive, PROACTIVE_KINDS, type ProactiveInput } from '../services/whatsapp/proactive.js'
import { FREEZER_REVIEW_PRIORITY, freezerReviewDue } from '../services/whatsapp/freezerReview.js'
import { GUIDED_KINDS } from '../services/whatsapp/guided.js'
import { freeMealOf, nextDays, planFreezerItems, taperRecipe } from '../services/assistant/freezerSkills.js'
import { madridParts } from '../services/madridTime.js'

const DAY = 86_400_000
const now = new Date('2026-11-01T11:30:00Z') // Sunday 1 Nov, 12:30 in Madrid
const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString()
const row = (over: Record<string, unknown>) => ({ id: String(over.name), name: 'x', ingredientId: null, quantity: 1, unit: 'u', location: 'despensa', storedAt: ago(1), createdAt: ago(1), ...over }) as any

describe('the migration', () => {
  it('only adds columns: the place (default «despensa») and when it went in', () => {
    const sql = readFileSync(join(__dirname, '../db/migrations/0071_pantry_location.sql'), 'utf8')
    expect(sql.trim()).toBe(
      'ALTER TABLE "pantry_items" ADD COLUMN "location" text DEFAULT \'despensa\' NOT NULL;--> statement-breakpoint\nALTER TABLE "pantry_items" ADD COLUMN "stored_at" timestamp with time zone;',
    )
  })
})

describe('by place', () => {
  it('groups nevera → congelador → despensa, unknown places as despensa, empty groups out', () => {
    const groups = groupPantryByLocation([row({ name: 'arroz' }), row({ name: 'pollo', location: 'congelador' }), row({ name: 'raro', location: 'garaje' }), row({ name: 'nata', location: 'nevera' })])
    expect(groups.map((g) => [g.location, g.items.map((i) => i.name)])).toEqual([
      ['nevera', ['nata']],
      ['congelador', ['pollo']],
      ['despensa', ['arroz', 'raro']],
    ])
    expect(isPantryLocation('congelador')).toBe(true)
    expect(isPantryLocation('garaje')).toBe(false)
  })

  it('freezer rows due after 4 weeks (from when they went in; created_at for old rows), used-up ones out', () => {
    const rows = [
      row({ name: 'merluza', location: 'congelador', storedAt: ago(30) }),
      row({ name: 'guisantes', location: 'congelador', storedAt: ago(10) }),
      row({ name: 'pechugas', location: 'congelador', storedAt: null, createdAt: ago(40) }),
      row({ name: 'gambas', location: 'congelador', storedAt: ago(60), quantity: 0 }),
      row({ name: 'arroz', storedAt: ago(90) }),
    ]
    expect(freezerItemsDue(rows, now).map((r) => r.name)).toEqual(['merluza', 'pechugas'])
  })
})

describe('the monthly freezer review (WhatsApp)', () => {
  const base = (over: Partial<ProactiveInput> = {}): ProactiveInput => ({
    parts: madridParts(now),
    breakfastTime: null,
    dinnerTime: null,
    prefs: {},
    sentRecently: {},
    todayDay: async () => null,
    todayDinner: async () => null,
    cookedToday: async () => false,
    pendingShopping: async () => [],
    hasNextWeekMenu: async () => true,
    lastFreezerReviewAt: async () => null,
    freezerItemsDue: async () => [{ name: 'Merluza', quantity: 4, unit: 'u', storedAt: ago(30) }],
    webUrl: 'https://mimoia.com',
    ...over,
  })

  it('asks on a Sunday morning with what has been there 4+ weeks', async () => {
    const out = await planProactive(base())
    expect(out.map((p) => p.kind)).toEqual(['freezer_review'])
    const m = out[0].messages[0] as any
    expect(m.text).toBe('En el congelador tienes:\n- Merluza (4 u), desde el 2 de octubre\n\n¿Lo meto en el menú de estas semanas?')
    expect(m.buttons.map((b: any) => b.title)).toEqual(['Sí, mételo', 'Ahora no'])
    expect(out[0].guide?.required).toEqual(['Merluza', '¿Lo meto en el menú de estas semanas?'])
  })

  it('once a month: not again this month, yes again next month', async () => {
    expect(await planProactive(base({ lastFreezerReviewAt: async () => new Date('2026-11-01T10:00:00Z') }))).toEqual([])
    expect((await planProactive(base({ lastFreezerReviewAt: async () => new Date('2026-10-04T10:00:00Z') }))).map((p) => p.kind)).toEqual(['freezer_review'])
    expect(freezerReviewDue(madridParts(now), new Date('2026-10-31T23:30:00Z'))).toBe(false) // already 00:30 on 1 Nov in Madrid
  })

  it('only with something 4+ weeks old, only in its window, and it can be switched off', async () => {
    expect(await planProactive(base({ freezerItemsDue: async () => [] }))).toEqual([])
    expect(await planProactive(base({ parts: { ...madridParts(now), hour: 18 } }))).toEqual([])
    expect(await planProactive(base({ parts: { ...madridParts(now), weekday: 2 } }))).toEqual([])
    expect(await planProactive(base({ prefs: { freezer_review: false } }))).toEqual([])
  })

  it('spends the weekly budget as priority 2: an ordinary proactive kind with its own guide', () => {
    expect(PROACTIVE_KINDS).toContain('freezer_review')
    expect(GUIDED_KINDS).toContain('freezer_review')
    expect(FREEZER_REVIEW_PRIORITY).toBe(2)
  })
})

describe('plan_freezer_items («Sí, mételo»)', () => {
  const weekA = nextDays(now)[0].weekStart // Monday 2 Nov
  const weekB = nextDays(now)[7].weekStart
  const recipeDish = (id: string) => ({ dishes: [{ kind: 'recipe', recipeId: id, recipeName: id }] })
  const menuOf = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    days: Array.from({ length: 7 }, (_, i) => ({ lunch: recipeDish(`l${i}`), dinner: recipeDish(`d${i}`) })),
    locked: {},
    skippedDays: [],
    ...over,
  })

  function fakeApi(pantry: any[], menus: Record<string, any>) {
    const calls: Array<[string, string, unknown]> = []
    const api = vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body])
      if (path.startsWith('/pantry')) return pantry
      const m = /^\/menu\/u-1\/(\d{4}-\d{2}-\d{2})$/.exec(path)
      if (m) {
        if (menus[m[1]]) return menus[m[1]]
        const { AppApiError } = await import('../services/assistant/appApi.js')
        throw new AppApiError(404, 'no menu')
      }
      return {}
    })
    return { api, calls }
  }

  it('puts each old freezer thing in a free dinner from tomorrow, one per day, and says what had no room', async () => {
    vi.useFakeTimers({ now })
    hitsByName['Merluza'] = [{ recipe: { id: 'r-merluza', name: 'Merluza en salsa verde' }, uses: ['Merluza'], missing: [] }]
    hitsByName['Táper de lentejas'] = [{ recipe: { id: 'r-lentejas', name: 'Lentejas estofadas' }, uses: [], missing: [] }]
    const pantry = [
      row({ id: 'p1', name: 'Merluza', ingredientId: 'i-merluza', location: 'congelador', storedAt: ago(30) }),
      row({ id: 'p2', name: 'Táper de lentejas', location: 'congelador', storedAt: ago(35) }),
      row({ id: 'p3', name: 'Guisantes', location: 'congelador', storedAt: ago(3) }),
    ]
    // Monday's dinner is locked: Monday lunch takes it instead.
    const { api, calls } = fakeApi(pantry, { [weekA]: menuOf('m-a', { locked: { '0': { dinner: true } } }) })
    const r = await planFreezerItems.handler({}, { userId: 'u-1', db: {} as any, api } as any)
    vi.useRealTimers()

    const writes = calls.filter(([m]) => m !== 'GET')
    expect(writes).toEqual([
      ['PUT', '/menu/m-a/day/0/meal/lunch', { recipeId: 'r-merluza' }],
      ['DELETE', '/menu/m-a/day/1/meal/dinner', undefined],
      ['POST', '/menu/m-a/day/1/meal/dinner/dish', { kind: 'recipe', recipeId: 'r-lentejas', variant: 'freezer' }],
    ])
    expect(r.summary).toContain('- Merluza: Merluza en salsa verde, comida del lunes 2')
    expect(r.summary).toContain('- Táper de lentejas: Lentejas estofadas (del congelador, no suma a la compra), cena del martes 3')
    expect(r.summary).not.toContain('Guisantes') // only 3 days in the freezer
    expect(r.summary).toContain(`aun no tiene menu`)
    expect((r.data as any).noMenuWeeks).toEqual([weekB])
  })

  it('nothing old in the freezer → changes nothing', async () => {
    const { api, calls } = fakeApi([row({ name: 'Guisantes', location: 'congelador', storedAt: ago(3) })], {})
    const r = await planFreezerItems.handler({}, { userId: 'u-1', db: {} as any, api } as any)
    expect(r.summary).toContain('no he cambiado nada')
    expect(calls.filter(([m]) => m !== 'GET')).toEqual([])
  })

  it('a táper is a dish only when it says so or names a recipe exactly', () => {
    const hits = [{ recipe: { name: 'Pechugas al limón' } }, { recipe: { name: 'Lentejas estofadas' } }]
    expect(taperRecipe(hits, 'pechugas de pollo')).toBeNull()
    expect(taperRecipe(hits, 'táper de lentejas')?.recipe.name).toBe('Lentejas estofadas')
    expect(taperRecipe(hits, 'Lentejas estofadas')?.recipe.name).toBe('Lentejas estofadas')
  })

  it('never uses a skipped day, a leftover or a freezer dish', () => {
    const m: any = menuOf('m', { skippedDays: [2] })
    m.days[3].dinner = { dishes: [{ kind: 'recipe', recipeId: 'x', variant: 'leftover' }] }
    m.days[3].lunch = { dishes: [{ kind: 'recipe', recipeId: 'y', variant: 'freezer' }] }
    expect(freeMealOf(m, 2)).toBeNull()
    expect(freeMealOf(m, 3)).toBeNull()
    expect(freeMealOf(m, 4)).toBe('dinner')
  })
})
