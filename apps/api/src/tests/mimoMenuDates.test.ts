/**
 * PRO-63 — que Mimo no diga «hecho» sin hacerlo (hogares de prueba,
 * 2026-10-11 y 2026-10-12). Three promises, one block each:
 *
 * 1. The menu tools turn «hoy», «mañana», «martes», «el sábado», «la semana
 *    que viene» into the right date from today in Europe/Madrid (fixed clock,
 *    Sunday included).
 * 2. A dish change lands in the week the day belongs to — even when next
 *    week's menu already exists — and the tool hands back the real day, date
 *    and dish, which the prompt asks Mimo to repeat. «Hecho» only when the
 *    saved row has the dish.
 * 3. Asking for a dish never regenerates the week.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// eq/and tagged so the fake db can see which week / which row a query targets.
vi.mock('drizzle-orm', async (importOriginal) => {
  const orig = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...orig,
    eq: (_col: unknown, value: unknown) => ({ __eq: value }),
    and: (...parts: unknown[]) => ({ __and: parts }),
  }
})
vi.mock('../services/menuGenerator.js', () => ({
  generateMenu: vi.fn(async () => ({ days: [{}, {}, {}, {}, {}, {}, {}], warnings: [] })),
}))
vi.mock('../services/scopeResolver.js', () => ({
  resolveScope: vi.fn(async (userId: string) => ({ kind: 'user', value: userId })),
  scopeWhere: vi.fn(() => ({})),
  getPrimaryHouseholdId: vi.fn(async () => null),
}))
vi.mock('../services/recipeVisibility.js', () => ({
  visibleAuthorIds: vi.fn(async () => ['u-1']),
  visibleRecipeWhere: vi.fn(() => ({})),
}))
vi.mock('../services/withWhatIHave.js', () => ({
  loadUserRestrictions: vi.fn(async () => ({ restrictions: [], dislikes: [] })),
  findRecipesWithWhatIHave: vi.fn(),
}))
vi.mock('../services/notificationScheduler.js', () => ({
  enqueuePrepAlertsForMenu: vi.fn(async () => ({ inserted: 0, skipped: 0 })),
}))

import { resolveMenuDay, dateLabel } from '../services/assistant/menuDay.js'
import { skills, weekHasDishes } from '../services/assistant/skills.js'
import { appSkills } from '../services/assistant/appSkills.js'
import { buildSystemParts } from '../services/assistant/systemPrompt.js'
import { generateMenu } from '../services/menuGenerator.js'
import { menus, recipes } from '../db/schema.js'
import type { AppApi } from '../services/assistant/appApi.js'

// 2026-10-12 is a Monday. 10:00 UTC = 12:00 Madrid (CEST, UTC+2).
const MONDAY = new Date('2026-10-12T10:00:00Z')
const SUNDAY_EVENING = new Date('2026-10-11T18:00:00Z') // domingo 20:00 Madrid
const WEDNESDAY = new Date('2026-10-14T10:00:00Z')

const iso = (r: ReturnType<typeof resolveMenuDay>) => {
  if ('error' in r) throw new Error(r.error)
  return r.isoDate
}

describe('1. days resolve to the right date in Madrid', () => {
  it('on Monday 12: hoy, mañana, martes, el sábado, el jueves, la cena de hoy', () => {
    expect(iso(resolveMenuDay({ day: 'hoy' }, MONDAY))).toBe('2026-10-12')
    expect(iso(resolveMenuDay({ day: 'la cena de hoy' }, MONDAY))).toBe('2026-10-12')
    expect(iso(resolveMenuDay({ day: 'mañana' }, MONDAY))).toBe('2026-10-13')
    expect(iso(resolveMenuDay({ day: 'pasado mañana' }, MONDAY))).toBe('2026-10-14')
    expect(iso(resolveMenuDay({ day: 'martes' }, MONDAY))).toBe('2026-10-13')
    expect(iso(resolveMenuDay({ day: 'el jueves' }, MONDAY))).toBe('2026-10-15')
    expect(iso(resolveMenuDay({ day: 'el sábado' }, MONDAY))).toBe('2026-10-17')
    expect(iso(resolveMenuDay({ day: 'el sabado' }, MONDAY))).toBe('2026-10-17')
    expect(iso(resolveMenuDay({ day: 'el lunes' }, MONDAY))).toBe('2026-10-12') // hoy incluido
    expect(iso(resolveMenuDay({ day: 'el sábado por la mañana' }, MONDAY))).toBe('2026-10-17')
  })

  it('«la semana que viene» and «el próximo» go to next week', () => {
    expect(iso(resolveMenuDay({ day: 'el martes de la semana que viene' }, MONDAY))).toBe('2026-10-20')
    expect(iso(resolveMenuDay({ day: 'sábado de la próxima semana' }, MONDAY))).toBe('2026-10-24')
    expect(iso(resolveMenuDay({ day: 'el próximo lunes' }, MONDAY))).toBe('2026-10-19')
    expect(iso(resolveMenuDay({ day: 'la semana que viene', dayIndex: 2 }, MONDAY))).toBe('2026-10-21')
    expect(iso(resolveMenuDay({ dayIndex: 5, nextWeek: true }, MONDAY))).toBe('2026-10-24')
  })

  it('on Sunday 11: «el martes» is the day after tomorrow, not last Tuesday (Familia Ruiz, 2026-10-11)', () => {
    expect(iso(resolveMenuDay({ day: 'el martes' }, SUNDAY_EVENING))).toBe('2026-10-13')
    expect(iso(resolveMenuDay({ day: 'mañana' }, SUNDAY_EVENING))).toBe('2026-10-12')
    expect(iso(resolveMenuDay({ day: 'hoy' }, SUNDAY_EVENING))).toBe('2026-10-11')
    expect(iso(resolveMenuDay({ day: 'el domingo' }, SUNDAY_EVENING))).toBe('2026-10-11')
    expect(iso(resolveMenuDay({ day: 'el sábado' }, SUNDAY_EVENING))).toBe('2026-10-17')
    expect(iso(resolveMenuDay({ day: 'el martes de la semana que viene' }, SUNDAY_EVENING))).toBe('2026-10-13')
  })

  it('past days, «este», dates and day-of-month', () => {
    expect(iso(resolveMenuDay({ day: 'el lunes pasado' }, WEDNESDAY))).toBe('2026-10-12')
    expect(iso(resolveMenuDay({ day: 'este lunes' }, WEDNESDAY))).toBe('2026-10-12')
    expect(iso(resolveMenuDay({ day: 'el lunes' }, WEDNESDAY))).toBe('2026-10-19')
    expect(iso(resolveMenuDay({ day: 'ayer' }, WEDNESDAY))).toBe('2026-10-13')
    expect(iso(resolveMenuDay({ day: '2026-10-17' }, WEDNESDAY))).toBe('2026-10-17')
    expect(iso(resolveMenuDay({ day: 'el sábado 17' }, WEDNESDAY))).toBe('2026-10-17')
    expect(iso(resolveMenuDay({ day: 'el 24' }, WEDNESDAY))).toBe('2026-10-24')
  })

  it('uses the Madrid wall clock, not UTC, around midnight', () => {
    // 22:30 UTC Monday = 00:30 Tuesday in Madrid.
    expect(iso(resolveMenuDay({ day: 'hoy' }, new Date('2026-10-12T22:30:00Z')))).toBe('2026-10-13')
    // 23:30 UTC Sunday 18 = 01:30 Monday 19 in Madrid: «hoy» is already next week.
    const r = resolveMenuDay({ day: 'hoy' }, new Date('2026-10-18T23:30:00Z'))
    expect('error' in r ? null : r.weekStart).toBe('2026-10-19')
  })

  it('names the week and the label the tool repeats; unknown words are an error, never a guess', () => {
    const r = resolveMenuDay({ day: 'el sábado' }, MONDAY)
    expect(r).toEqual({ weekStart: '2026-10-12', dayIndex: 5, isoDate: '2026-10-17', label: 'sábado 17 de octubre' })
    expect(dateLabel('2026-10-19')).toBe('lunes 19 de octubre')
    expect(resolveMenuDay({ day: 'cuando sea' }, MONDAY)).toHaveProperty('error')
    expect(resolveMenuDay({}, MONDAY)).toHaveProperty('error')
  })
})

// ─── A db that answers by week (menus) and records every query ──────────

interface Q { ops: Record<string, unknown[]> }
function valuesIn(cond: any, out: unknown[] = []): unknown[] {
  if (!cond || typeof cond !== 'object') return out
  if ('__eq' in cond) out.push(cond.__eq)
  if (Array.isArray(cond.__and)) for (const c of cond.__and) valuesIn(c, out)
  return out
}
function weekDb(rows: Array<{ id: string; weekStart: string; days: any[] }>, catalogue: Array<{ id: string; name: string }>) {
  const log: Q[] = []
  const answer = (q: Q) => {
    log.push(q)
    const vals = valuesIn(q.ops.where?.[0])
    if (q.ops.update) {
      const row = rows.find((r) => vals.includes(r.id))
      if (!row) return []
      Object.assign(row, q.ops.set?.[0] ?? {})
      return [row]
    }
    if (q.ops.insert) return [{ id: 'nuevo' }]
    if (q.ops.from?.[0] === menus) return rows.filter((r) => vals.includes(r.weekStart)).slice(0, 1)
    if (q.ops.from?.[0] === recipes) return catalogue.map((c) => ({ ...c, authorId: null }))
    return []
  }
  const make = (q: Q): any =>
    new Proxy(() => {}, {
      get(_, prop) {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(answer(q)).then(res, rej)
        return (...args: unknown[]) => make({ ops: { ...q.ops, [prop as string]: args } })
      },
    })
  return { db: make({ ops: {} }), log }
}

const slot = (name: string) => ({ dishes: [{ kind: 'recipe', recipeId: `r-${name}`, recipeName: name }] })
const weekOf = (prefix: string) =>
  Array.from({ length: 7 }, (_, i) => ({ lunch: slot(`${prefix} comida ${i}`), dinner: slot(`${prefix} cena ${i}`) }))
const skill = (name: string) => skills.find((s) => s.name === name)!

describe('2. a dish change lands in the right week and the tool says where', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(MONDAY)
    vi.mocked(generateMenu).mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('«el sábado» on Monday 12 changes Saturday 17 even when next week (19–25) was created later (Ruiz, Dani y Sara 2026-10-12)', async () => {
    // The newer row is next week's: the old "latest menu" lookup picked it.
    const thisWeek = { id: 'm-12', weekStart: '2026-10-12', days: weekOf('esta') }
    const nextWeek = { id: 'm-19', weekStart: '2026-10-19', days: weekOf('siguiente') }
    const { db } = weekDb([nextWeek, thisWeek], [{ id: 'r-mac', name: 'Macarrones con tomate' }])
    const r = await skill('swap_meal').handler({ day: 'el sábado', meal: 'lunch', recipeName: 'macarrones' }, { userId: 'u-1', db })

    expect(thisWeek.days[5].lunch).toEqual({ dishes: [{ kind: 'recipe', recipeId: 'r-mac', recipeName: 'Macarrones con tomate' }] })
    expect(nextWeek.days[5].lunch).toEqual(slot('siguiente comida 5'))
    expect(r.summary).toBe('Hecho. He puesto "Macarrones con tomate" en la comida del sábado 17 de octubre.')
    expect(r.data.change).toEqual({ weekStart: '2026-10-12', date: '2026-10-17', dayIndex: 5, meal: 'lunch', dish: 'Macarrones con tomate' })
  })

  it('«la cena de hoy» changes today, a note included', async () => {
    const thisWeek = { id: 'm-12', weekStart: '2026-10-12', days: weekOf('esta') }
    const nextWeek = { id: 'm-19', weekStart: '2026-10-19', days: weekOf('siguiente') }
    const { db } = weekDb([nextWeek, thisWeek], [])
    const r = await skill('swap_meal').handler({ day: 'hoy', meal: 'dinner', recipeName: 'revuelto de setas de la abuela' }, { userId: 'u-1', db })
    expect(thisWeek.days[0].dinner).toEqual({ dishes: [{ kind: 'note', text: 'Revuelto de setas de la abuela' }] })
    expect(nextWeek.days[0].dinner).toEqual(slot('siguiente cena 0'))
    expect(r.summary).toContain('cena del lunes 12 de octubre')
  })

  it('«el jueves de la semana que viene» does go to next week', async () => {
    const thisWeek = { id: 'm-12', weekStart: '2026-10-12', days: weekOf('esta') }
    const nextWeek = { id: 'm-19', weekStart: '2026-10-19', days: weekOf('siguiente') }
    const { db } = weekDb([thisWeek, nextWeek], [{ id: 'r-chili', name: 'Chili con carne' }])
    const r = await skill('swap_meal').handler({ day: 'el jueves de la semana que viene', meal: 'lunch', recipeName: 'chili' }, { userId: 'u-1', db })
    expect(nextWeek.days[3].lunch.dishes[0].recipeName).toBe('Chili con carne')
    expect(thisWeek.days[3].lunch).toEqual(slot('esta comida 3'))
    expect(r.summary).toContain('jueves 22 de octubre')
  })

  it('no menu for that week: says so and changes nothing — never another week', async () => {
    const nextWeek = { id: 'm-19', weekStart: '2026-10-19', days: weekOf('siguiente') }
    const { db, log } = weekDb([nextWeek], [{ id: 'r-mac', name: 'Macarrones con tomate' }])
    const r = await skill('swap_meal').handler({ day: 'el sábado', meal: 'lunch', recipeName: 'macarrones' }, { userId: 'u-1', db })
    expect(r.summary).toMatch(/^No hay menu para la semana del lunes 12 de octubre; no he cambiado nada/)
    expect(log.some((q) => q.ops.update)).toBe(false)
    expect(nextWeek.days[5].lunch).toEqual(slot('siguiente comida 5'))
  })

  it('never «Hecho» when the save did not come back with the dish', async () => {
    const rows = [{ id: 'm-12', weekStart: '2026-10-12', days: weekOf('esta') }]
    const fake = weekDb(rows, [{ id: 'r-mac', name: 'Macarrones con tomate' }])
    // The menu is found, but the update returns no row (deleted meanwhile).
    const db = new Proxy(fake.db, {
      get(target, prop) {
        if (prop === 'update') return () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) })
        return (target as any)[prop]
      },
    })
    const r = await skill('swap_meal').handler({ day: 'el sábado', meal: 'lunch', recipeName: 'macarrones' }, { userId: 'u-1', db })
    expect(r.summary).toMatch(/^No he podido guardar el cambio en la comida del sábado 17 de octubre; no esta hecho/)
    expect(r.data).toBeNull()
  })

  it('the app-parity tools (servings, notes…) also edit the resolved week and repeat the date', async () => {
    const calls: string[] = []
    const api: AppApi = async (method, path) => {
      calls.push(`${method} ${path}`)
      return (method === 'GET' ? { id: path.endsWith('2026-10-12') ? 'm-12' : 'm-19', days: weekOf('x') } : {}) as any
    }
    const servings = appSkills.find((s) => s.name === 'set_meal_servings')!
    const r = await servings.handler({ day: 'el martes', meal: 'dinner', servings: 6 }, { userId: 'u1', db: null, api })
    expect(calls).toEqual(['GET /menu/u1/2026-10-12', 'PATCH /menu/m-12/day/1/meal/dinner'])
    expect(r.summary).toBe('Hecho: la cena del martes 13 de octubre queda para 6 personas.')
    expect(r.data).toMatchObject({ weekStart: '2026-10-12', date: '2026-10-13', dayIndex: 1, meal: 'dinner' })
  })

  it('the prompt asks Mimo to pass the user words as day and to repeat day, date and dish', () => {
    const prompt = buildSystemParts('', 'whatsapp').instructions
    expect(prompt).toMatch(/pasa day con esas palabras/)
    expect(prompt).toMatch(/con el dia, la fecha y el plato tal como los devolvio la herramienta/)
    expect(prompt).toMatch(/"no he cambiado nada" o falla, eso no esta hecho/)
  })
})

describe('3. asking for a dish never regenerates the week', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(MONDAY)
    vi.mocked(generateMenu).mockClear()
  })
  afterEach(() => vi.useRealTimers())

  it('swap_meal touches one slot and never generates or inserts a menu (Laura lost her táperes, 2026-10-11)', async () => {
    const thisWeek = { id: 'm-12', weekStart: '2026-10-12', days: weekOf('esta') }
    const before = JSON.parse(JSON.stringify(thisWeek.days))
    const { db, log } = weekDb([thisWeek], [{ id: 'r-mac', name: 'Macarrones con tomate' }])
    await skill('swap_meal').handler({ day: 'el jueves', meal: 'lunch', recipeName: 'macarrones' }, { userId: 'u-1', db })
    expect(generateMenu).not.toHaveBeenCalled()
    expect(log.some((q) => q.ops.insert)).toBe(false)
    const changed = thisWeek.days.flatMap((d, i) =>
      (['lunch', 'dinner'] as const).filter((m) => JSON.stringify((d as any)[m]) !== JSON.stringify(before[i][m])).map((m) => `${i}:${m}`),
    )
    expect(changed).toEqual(['3:lunch'])
  })

  it('generate_weekly_menu refuses to remake a week that has dishes unless the user confirmed', async () => {
    const thisWeek = { id: 'm-12', weekStart: '2026-10-12', days: weekOf('esta') }
    const { db, log } = weekDb([thisWeek], [])
    const r = await skill('generate_weekly_menu').handler({}, { userId: 'u-1', db })
    expect(r.summary).toMatch(/^No he cambiado nada: la semana del lunes 12 de octubre ya tiene menu/)
    expect(r.summary).toContain('replaceExisting: true')
    expect(generateMenu).not.toHaveBeenCalled()
    expect(log.some((q) => q.ops.insert)).toBe(false)
  })

  it('an empty week (the web creates it just by opening it) is generated without asking', () => {
    expect(weekHasDishes([{}, {}, {}, {}, {}, {}, {}] as any)).toBe(false)
    expect(weekHasDishes(undefined)).toBe(false)
    expect(weekHasDishes([{ lunch: { dishes: [{ kind: 'note', text: 'Fuera' }] } }] as any)).toBe(true)
  })
})
