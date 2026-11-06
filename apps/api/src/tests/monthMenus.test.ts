/**
 * PRO-378 · «Menú del mes». Cocina's file (`fixtures/menu-del-mes-inventado.json`,
 * invented dishes) checked with the week's rules on import, and «Copiar a mi
 * semana»: only the meals of the household's plantilla, and a dish that
 * breaks an allergy swapped for a similar one.
 */
import express, { type RequestHandler } from 'express'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { DayTemplate } from '@ona/shared'
import {
  checkMonthMenuRules,
  copyMonthMenu,
  copyNotice,
  madridMonth,
  monthMenuTitle,
  parseMonthMenuFile,
  resolveMonthMenuRefs,
  similarRecipePicker,
  type CopyRecipe,
  type MonthMenuWeek,
} from '../services/monthMenus.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import { createMonthMenusRouter } from '../routes/monthMenus.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const FILE = JSON.parse(readFileSync(path.join(here, 'fixtures', 'menu-del-mes-inventado.json'), 'utf8'))

function recipe(id: string, name: string, protein: string, minutes: number, ings: Array<[string, string[]?]> = [], course: 'main' | null = 'main'): RecipeWithCourse {
  const allergens = [...new Set(ings.flatMap(([, tags]) => tags ?? []))]
  return {
    id,
    name,
    meals: ['breakfast', 'lunch', 'dinner'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    tags: [],
    totalTime: minutes,
    allergens,
    course,
    internalTags: [`proteina:${protein}`],
    ingredients: ings.map(([n, tags]) => ({ ingredientId: `ing-${n}`, ingredientName: n, quantity: 100, unit: 'g', allergenTags: tags ?? [], containsTags: [] })),
  } as RecipeWithCourse
}

const lentejas = recipe('lentejas', 'Lentejas de prueba', 'legumbre', 40, [['Lentejas']])
const crema = recipe('crema', 'Crema de prueba', 'ninguna', 30, [['Calabaza']])
const merluza = recipe('merluza', 'Merluza de prueba', 'pescado-blanco', 25, [['Merluza', ['pescado']]])
const tortilla = recipe('tortilla', 'Tortilla de prueba', 'huevo', 20, [['Huevo', ['huevo']], ['Patata']])
const pollo = recipe('pollo', 'Pollo de prueba', 'pollo', 35, [['Pollo']])
const gambas = recipe('gambas', 'Arroz con gambas de prueba', 'marisco', 40, [['Arroz'], ['Gambas', ['crustaceos']]])
const tostadas = recipe('tostadas', 'Tostadas de prueba', 'ninguna', 10, [['Pan', ['gluten']]], null)
const merluzaVerde = recipe('merluza-verde', 'Merluza en salsa verde de prueba', 'pescado-blanco', 30, [['Merluza', ['pescado']], ['Perejil']])
const garbanzos = recipe('garbanzos', 'Garbanzos de prueba', 'legumbre', 40, [['Garbanzos']])
const CATALOGUE = [lentejas, crema, merluza, tortilla, pollo, gambas, tostadas, merluzaVerde, garbanzos]
const byId = (list: RecipeWithCourse[]) => new Map(list.map((r) => [r.id, r as CopyRecipe]))

/** The fixture, resolved against the invented catalogue. */
function fixtureWeek(file: unknown = FILE): MonthMenuWeek {
  const parsed = parseMonthMenuFile(file)
  expect(parsed.problems).toEqual([])
  const { week, problems } = resolveMonthMenuRefs(parsed.refs, CATALOGUE)
  expect(problems).toEqual([])
  return week
}

describe('the file and the import rules', () => {
  it('reads Cocina’s file: days and meals in Spanish, dishes by name, title from the month', () => {
    const parsed = parseMonthMenuFile(FILE)
    expect(parsed.title).toBe('Menú de noviembre')
    expect(parsed.refs[2].lunch).toEqual(['Pollo de prueba'])
    expect(parsed.refs[5].breakfast).toEqual(['Tostadas de prueba'])
    const week = fixtureWeek()
    expect(week[3]).toEqual({ lunch: ['gambas'], dinner: ['tortilla'] })
    expect(checkMonthMenuRules(week, byId(CATALOGUE))).toEqual([])
  })

  it('rejects a menu with fish at lunch and at dinner the same day', () => {
    const file = structuredClone(FILE)
    file.days.martes.cena = ['Merluza en salsa verde de prueba']
    const problems = checkMonthMenuRules(fixtureWeek(file), byId(CATALOGUE))
    expect(problems).toEqual([
      'Martes: pescado en la comida («Merluza de prueba») y en la cena («Merluza en salsa verde de prueba»); el mismo día, solo en una.',
    ])
  })

  it('seafood counts as fish too', () => {
    const file = structuredClone(FILE)
    file.days.jueves.cena = ['Merluza de prueba']
    expect(checkMonthMenuRules(fixtureWeek(file), byId(CATALOGUE))[0]).toMatch(/^Jueves: pescado en la comida \(«Arroz con gambas de prueba»\)/)
  })

  it('rejects dishes longer than 45 min from Monday to Friday, not at the weekend', () => {
    const slow = recipe('pollo', 'Pollo de prueba', 'pollo', 60, [['Pollo']])
    const catalogue = byId([...CATALOGUE.filter((r) => r.id !== 'pollo'), slow])
    expect(checkMonthMenuRules(fixtureWeek(), catalogue)).toEqual([
      'Miércoles, comida: «Pollo de prueba» tarda 60 min; entre semana, como mucho 45.',
    ])
  })

  it('needs at least 5 days with lunch and dinner', () => {
    const file = structuredClone(FILE)
    delete file.days.lunes.cena
    delete file.days.martes.cena
    expect(checkMonthMenuRules(fixtureWeek(file), byId(CATALOGUE))).toEqual(['Hacen falta al menos 5 días con comida y cena (hay 4).'])
  })

  it('says what is wrong in the file, in Spanish', () => {
    expect(parseMonthMenuFile({ month: '2026-13', days: {} }).problems).toEqual(['month: El mes va como AAAA-MM (p. ej. 2026-11).'])
    expect(parseMonthMenuFile({ month: '2026-11', days: { lunnes: { comida: ['x'] }, martes: { brunch: ['x'] } } }).problems).toEqual([
      '«lunnes» no es un día: usa lunes, martes, miércoles, jueves, viernes, sábado o domingo.',
      'Martes: «brunch» no es una comida; usa desayuno, comida, merienda o cena.',
    ])
    const parsed = parseMonthMenuFile({ month: '2026-11', days: { lunes: { comida: ['Cocido inventado', 'lentejas DE prueba'] } } })
    expect(resolveMonthMenuRefs(parsed.refs, CATALOGUE)).toEqual({
      week: [{ lunch: ['lentejas'] }, {}, {}, {}, {}, {}, {}],
      problems: ['Lunes, comida: «Cocido inventado» no está en el catálogo publicado.'],
    })
  })

  it('month helpers', () => {
    expect(monthMenuTitle('2026-03')).toBe('Menú de marzo')
    expect(madridMonth(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11')
  })
})

const LUNCH_AND_DINNER: DayTemplate[] = Array.from({ length: 7 }, () => ({ lunch: true, dinner: true }))

describe('«Copiar a mi semana»', () => {
  const noPick = () => {
    throw new Error('nothing should be swapped')
  }

  it('a household without breakfasts gets only its lunches and dinners', () => {
    const { days, copied, swaps } = copyMonthMenu({ week: fixtureWeek(), template: LUNCH_AND_DINNER, recipesById: byId(CATALOGUE), restrictions: [], pick: noPick })
    expect(swaps).toEqual([])
    expect(copied).toBe(13)
    for (const day of days) expect(Object.keys(day).sort()).toEqual(['dinner', 'lunch'])
    expect(days[5].lunch!.dishes).toEqual([{ kind: 'recipe', recipeId: 'pollo', recipeName: 'Pollo de prueba', course: 'main' }])
    // Sunday has no dinner in the month's menu: the household's dinner stays, empty.
    expect(days[6].dinner).toEqual({ dishes: [] })
  })

  it('with breakfasts in the plantilla, the weekend breakfasts come too; «sin cocinar» days stay out', () => {
    const template = LUNCH_AND_DINNER.map((d, i) => (i >= 5 ? { ...d, breakfast: true } : d))
    const { days } = copyMonthMenu({ week: fixtureWeek(), template, skippedDays: new Set([0]), recipesById: byId(CATALOGUE), restrictions: [], pick: noPick })
    expect(days[0]).toEqual({})
    expect(days[5].breakfast!.dishes[0]).toMatchObject({ recipeId: 'tostadas' })
    expect(days[4].breakfast).toBeUndefined()
  })

  it('a household allergic to shellfish gets a similar dish instead of the rice with prawns', () => {
    const pool = CATALOGUE
    const pick = similarRecipePicker(pool, { weekStart: '2026-11-02', restrictions: ['marisco'] })
    const spy = vi.fn(pick)
    const result = copyMonthMenu({ week: fixtureWeek(), template: LUNCH_AND_DINNER, recipesById: byId(pool), restrictions: ['marisco'], pick: spy })
    expect(result.swaps).toEqual([
      { day: 3, meal: 'lunch', from: 'Arroz con gambas de prueba', to: 'Merluza en salsa verde de prueba' },
      // The other fish is in the week already: any dish not repeated.
      { day: 6, meal: 'lunch', from: 'Arroz con gambas de prueba', to: 'Garbanzos de prueba' },
    ])
    expect(result.days[3].lunch!.dishes).toEqual([{ kind: 'recipe', recipeId: 'merluza-verde', recipeName: 'Merluza en salsa verde de prueba', course: 'main' }])
    const all = result.days.flatMap((d) => Object.values(d).flatMap((s) => s!.dishes)) as Array<{ recipeId: string }>
    expect(all.some((d) => d.recipeId === 'gambas')).toBe(false)
    expect(spy.mock.calls[0][0]).toMatchObject({ day: 3, meal: 'lunch', course: 'main', original: { id: 'gambas' } })
    expect(copyNotice(result)).toBe('Hemos copiado 13 platos a tu semana. 2 no encajaban con vuestras alergias o dieta y los hemos cambiado por otro parecido.')
  })

  it('a dish with nothing to put instead leaves the slot empty and the notice says so', () => {
    const result = copyMonthMenu({ week: fixtureWeek(), template: LUNCH_AND_DINNER, recipesById: byId(CATALOGUE), restrictions: ['huevo'], pick: () => null })
    expect(result.swaps.map((s) => [s.day, s.meal, s.to])).toEqual([[1, 'dinner', null], [3, 'dinner', null]])
    expect(result.days[1].dinner).toEqual({ dishes: [] })
    expect(copyNotice(result)).toBe('Hemos copiado 11 platos a tu semana. 2 huecos se han quedado sin plato: no había otro que encajara.')
  })
})

// ─── Routes ─────────────────────────────────────────────────

const USER = '11111111-1111-4111-8111-111111111111'
const servers: Server[] = []
async function serve(router: express.Router): Promise<string> {
  const app = express()
  app.use(express.json())
  app.use(router)
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})
const signedIn: RequestHandler = (req, _res, next) => {
  ;(req as any).userId = USER
  next()
}
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('routes', () => {
  it('every route needs an account', async () => {
    const base = await serve(createMonthMenusRouter())
    expect((await fetch(`${base}/month-menus/current`)).status).toBe(401)
    expect((await post(`${base}/month-menus/2026-11/copy`, { weekStart: '2026-11-02' })).status).toBe(401)
    expect((await post(`${base}/admin/month-menus`, { file: FILE })).status).toBe(401)
  })

  it('copy: asks before replacing a week with dishes, then copies with force', async () => {
    const copy = vi.fn(async (o: { force?: boolean }) =>
      o.force ? ({ status: 'ok', menuId: 'm1', copied: 13, swapped: 0, dropped: 0, notice: 'Hemos copiado 13 platos a tu semana.' } as const) : ({ status: 'not_empty' } as const),
    )
    const base = await serve(createMonthMenusRouter({ auth: signedIn, copy: copy as any }))
    const first = await post(`${base}/month-menus/2026-11/copy`, { weekStart: '2026-11-02' })
    expect(first.status).toBe(409)
    expect(await first.json()).toMatchObject({ code: 'MENU_NOT_EMPTY', error: 'Se cambiarán los platos de esta semana.' })
    const second = await post(`${base}/month-menus/2026-11/copy`, { weekStart: '2026-11-02', force: true })
    expect(second.status).toBe(201)
    expect(copy).toHaveBeenLastCalledWith({ userId: USER, month: '2026-11', weekStart: '2026-11-02', force: true })
    expect((await post(`${base}/month-menus/noviembre/copy`, { weekStart: '2026-11-02' })).status).toBe(400)
  })

  it('import: admin only, 422 with the problems in Spanish', async () => {
    const notAdmin: RequestHandler = (_req, res) => {
      res.status(403).json({ error: 'Admin only' })
    }
    expect((await post(`${await serve(createMonthMenusRouter({ auth: signedIn, admin: notAdmin }))}/admin/month-menus`, { file: FILE })).status).toBe(403)
    const imp = vi.fn(async () => ({ ok: false as const, problems: ['Martes: pescado en la comida y en la cena.'] }))
    const base = await serve(createMonthMenusRouter({ auth: signedIn, admin: (_q, _s, next) => next(), import: imp }))
    const res = await post(`${base}/admin/month-menus`, { file: FILE })
    expect(res.status).toBe(422)
    expect((await res.json()).problems).toEqual(['Martes: pescado en la comida y en la cena.'])
    expect(imp).toHaveBeenCalledWith(FILE, USER)
  })
})
