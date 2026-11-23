/**
 * 2026-11-19 · «Haz que lo tenga en cuenta, que tenga en cuenta la ficha
 * completa del usuario. Y que legumbres se traduzca a lo que tiene que ser»
 * (Miguel), from three weeks of real conversations:
 *  - «me gustaría prescindir del arroz» → «Cebollas rellenas de arroz»;
 *  - «que no me sugieras recetas de legumbres» → chili sin carne, hummus…;
 *  - «cenas ligeras» → patatas guisadas, garbanzos con chorizo, oreja;
 *  - «arroz no más de un día a la semana», «lentejas dos veces como mucho»;
 *  - «Cambiar» without a dish: a khachapuri of 151 min for a Tuesday dinner,
 *    a sweet mutabbaq as a Sunday dinner, higadillos twice the same week;
 *  - 10 of 17 searches with several conditions found nothing.
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu, DayTemplate } from '@ona/shared'
import { compileRestrictions, violatesRestrictions } from '../services/dietaryRestrictions.js'
import { isLightDish, isSweetDish, mainFoodKey, rulesFromNotes } from '../services/menuRules.js'
import { buildRandomMenu } from '../services/menuGenerator.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import { fichaMenuConstraints, withFichaFilters, type HouseholdFicha } from '../services/profile/reader.js'
import { applySlotRules, pickForSlot, WORKDAY_MAX_MINUTES } from '../services/menuSlotPick.js'
import { parseRecipeCriteria, searchByCriteria } from '../services/recipeCriteria.js'
import { nextWeekTypeSlot } from '../services/weekType.js'

let n = 0
const recipe = (name: string, ings: string[], extra: Partial<RecipeWithCourse> = {}): RecipeWithCourse =>
  ({
    id: `r${n++}`,
    name,
    meals: ['lunch', 'dinner'],
    seasons: [],
    frequency: null,
    tags: [],
    allergens: [],
    course: null,
    totalTime: 30,
    ingredients: ings.map((i, k) => ({ ingredientId: `i${n}-${k}`, ingredientName: i, quantity: 100, unit: 'g', allergenTags: [] })),
    ...extra,
  }) as RecipeWithCourse

const chili = recipe('Chili sin carne', ['alubias rojas cocidas', 'tomate triturado', 'cebolla', 'comino'])
const hummus = recipe('Hummus con crudités', ['garbanzos cocidos', 'tahini', 'zanahoria'])
const lentejas = recipe('Lentejas estofadas', ['lentejas pardinas', 'zanahoria', 'cebolla'], { dishTypes: ['legumbres'] })
const tofu = recipe('Salteado de tofu', ['tofu firme', 'brócoli', 'salsa de soja'])
const cebollasArroz = recipe('Cebollas rellenas de arroz', ['cebolla', 'arroz redondo', 'carne picada de ternera'])
const salmonSoja = recipe('Salmón con salsa de soja', ['lomos de salmón', 'salsa de soja', 'jengibre'])
const judiasVerdes = recipe('Judías verdes con jamón', ['judías verdes', 'jamón serrano'])
const ensaladaArroz = recipe('Ensalada de pepino', ['pepino', 'vinagre de arroz'])
const higadillos = recipe('Higadillos encebollados', ['higadillos de pollo', 'cebolla'])
const oreja = recipe('Oreja a la plancha', ['oreja de cerdo', 'pimentón'])

describe('a category is every food in it (legumbres as marisco)', () => {
  const out = (dislikes: string[], r: RecipeWithCourse) => violatesRestrictions(r, compileRestrictions([], dislikes))
  it.each([
    ['legumbres', chili, true], ['legumbres', hummus, true], ['legumbres', lentejas, true], ['legumbres', tofu, true],
    ['legumbres', salmonSoja, false], ['legumbres', judiasVerdes, false],
    ['legumbres', recipe('Guisantes con jamón', ['guisantes', 'jamón serrano']), true], ['legumbres', recipe('Habas salteadas', ['habas frescas', 'cebolla']), true],
    ['arroz', cebollasArroz, true], ['el arroz', cebollasArroz, true], ['arroz', ensaladaArroz, false],
    ['casquería', higadillos, true], ['vísceras', oreja, true], ['casqueria', recipe('Lenguas de gato', ['harina', 'azúcar', 'mantequilla']), false],
    ['cerdo', oreja, true], ['cerdo', salmonSoja, false], ['carne roja', cebollasArroz, true], ['patatas', recipe('Patatas a lo pobre', ['patata', 'cebolla']), true],
  ] as const)('dislike «%s» · %s → %s', (d, r, excluded) => {
    expect(out([d], r)).toBe(excluded)
  })
  it('as a restriction too («sin legumbres»)', () => {
    expect(violatesRestrictions(chili, compileRestrictions(['sin legumbres']))).toBe(true)
    expect(violatesRestrictions(salmonSoja, compileRestrictions(['sin legumbres']))).toBe(false)
  })
})

describe('what was saved as a note becomes a rule', () => {
  it.each([
    ['Me gustaría prescindir del arroz', { avoid: ['arroz'] }],
    ['Que no me sugieras recetas de legumbres', { avoid: ['legumbres'] }],
    ['Arroz no más de un día a la semana', { weeklyLimits: [{ target: 'arroz', times: 1 }] }],
    ['Lentejas dos veces como mucho', { weeklyLimits: [{ target: 'lenteja', times: 2 }] }],
    ['Prefieren cenas ligeras', { lightMeals: ['dinner'] }],
    ['Unas 6 cenas por semana y 1 comida', {}],
    ['Las cenas primer y segundo plato', {}],
    ['No me gusta que repitas el pollo', {}],
  ] as const)('«%s»', (text, want) => {
    expect(rulesFromNotes([text])).toEqual({ avoid: [], weeklyLimits: [], lightMeals: [], ...want })
  })

  it('the ficha reads `menu_rule`, notes and principles; the memory\'s notes join', () => {
    const fact = (type: string, value: unknown) => ({ id: type, type, value, subjectUserId: null, subjectPersonId: null, origin: 'user', confidence: 1, validUntil: null, sourceMemoryId: null }) as any
    const ficha = { householdId: 'h', portrait: null, persons: [], facts: [
      fact('menu_rule', { rule: 'max_per_week', target: 'arroz', times: 1 }),
      fact('menu_rule', { rule: 'light', meal: 'dinner' }),
      fact('notes', ['Que no me sugieras recetas de legumbres']),
    ] } as unknown as HouseholdFicha
    const c = fichaMenuConstraints(ficha)
    expect(c.weeklyLimits).toEqual([{ target: 'arroz', times: 1 }])
    expect(c.lightMeals).toEqual(['dinner'])
    expect(c.dislikes).toContain('legumbres')
    const f = withFichaFilters({ dislikes: [], availableEquipment: undefined, notes: ['Lentejas dos veces como mucho'] }, c)
    expect(f.weeklyLimits).toEqual([{ target: 'arroz', times: 1 }, { target: 'lenteja', times: 2 }])
  })
})

const template: DayTemplate[] = Array.from({ length: 7 }, () => ({ lunch: true, dinner: true }))
const week = (pool: RecipeWithCourse[], dislikes: string[] = [], rules?: Parameters<typeof buildRandomMenu>[21]) =>
  buildRandomMenu(template, pool, 'autumn', [], new Set(), {}, undefined, undefined, undefined, dislikes, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, rules)
const recipesOf = (days: DayMenu[], pool: RecipeWithCourse[]) =>
  days.flatMap((d) => Object.entries(d).flatMap(([meal, s]) => (s?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [{ meal, r: pool.find((p) => p.id === x.recipeId)! }] : []))))

const filler = Array.from({ length: 20 }, (_, i) => recipe(`Pollo asado ${i}`, ['pollo', 'calabacín']))
const riceDishes = Array.from({ length: 6 }, (_, i) => recipe(`Arroz ${i}`, ['arroz bomba', 'pimiento']))
const legumeDishes = [chili, hummus, lentejas, tofu, ...Array.from({ length: 4 }, (_, i) => recipe(`Garbanzos ${i}`, ['garbanzos', 'espinacas']))]
const heavy = [recipe('Patatas guisadas', ['patata', 'pimentón']), recipe('Garbanzos con chorizo', ['garbanzos', 'chorizo']), oreja]
const sweet = recipe('Mutabbaq', ['harina', 'plátano', 'azúcar', 'leche condensada'])

describe('the weekly menu keeps the ficha', () => {
  it('«sin legumbres» → no legume dish all week, chili and hummus included', () => {
    for (let i = 0; i < 20; i++) {
      const { days } = week([...filler, ...legumeDishes], ['legumbres'])
      expect(recipesOf(days, [...filler, ...legumeDishes]).filter(({ r }) => legumeDishes.includes(r))).toEqual([])
    }
  })
  it('«arroz como mucho un día a la semana» → at most one rice dish', () => {
    const pool = [...filler.slice(0, 8), ...riceDishes]
    for (let i = 0; i < 20; i++) {
      const { days } = week(pool, [], { weeklyLimits: [{ target: 'arroz', times: 1 }] })
      expect(recipesOf(days, pool).filter(({ r }) => riceDishes.includes(r)).length).toBeLessThanOrEqual(1)
    }
  })
  it('«cenas ligeras» → no stew, legume dish or offal for dinner', () => {
    const pool = [...filler, ...heavy]
    for (let i = 0; i < 20; i++) {
      const { days } = week(pool, [], { lightMeals: ['dinner'] })
      expect(recipesOf(days, pool).filter(({ meal, r }) => meal === 'dinner' && heavy.includes(r))).toEqual([])
    }
    expect(heavy.map(isLightDish)).toEqual([false, false, false])
  })
  it('a sweet is never lunch or dinner', () => {
    expect(isSweetDish(sweet)).toBe(true)
    expect(isSweetDish(recipe('Salmón con miel', ['salmón', 'miel']))).toBe(false)
    const pool = [...filler.slice(0, 14), sweet]
    for (let i = 0; i < 20; i++) expect(recipesOf(week(pool).days, pool).some(({ r }) => r === sweet)).toBe(false)
  })
})

describe('«Cambiar» without a dish makes sense', () => {
  const khachapuri = recipe('Khachapuri', ['harina', 'queso', 'huevo'], { totalTime: 151 })
  const tortilla = recipe('Tortilla de calabacín', ['huevo', 'calabacín', 'cebolla'], { totalTime: 25 })
  const merluza = recipe('Merluza al horno', ['merluza', 'patata'], { totalTime: 35 })
  const polenta = recipe('Polenta cremosa', ['polenta', 'caldo de verduras'], { totalTime: 20 })
  const all = [khachapuri, tortilla, merluza, polenta, sweet, higadillos, oreja]
  const byId = new Map(all.map((r) => [r.id, r]))
  const options = { meal: 'dinner' as const, season: 'autumn' as const, usedRecipeIds: new Set<string>(), restrictions: [], favoriteRecipeIds: new Set<string>() }
  const tuesday = (pool: RecipeWithCourse[], days?: DayMenu[], extra: Partial<Parameters<typeof applySlotRules>[1]> = {}) =>
    applySlotRules(pool, { meal: 'dinner', dayIndex: 1, days, weeklyLimits: [], lightMeals: [], workdayCap: WORKDAY_MAX_MINUTES, byId, ...extra })

  it('a Tuesday dinner: never 151 minutes nor a sweet; a dish with protein first', () => {
    const pick = tuesday([khachapuri, sweet, tortilla, polenta])
    expect(pick.pool).not.toContain(khachapuri)
    for (let i = 0; i < 30; i++) expect(pickForSlot({ ...pick, options }, null)).toBe(tortilla)
  })
  it('not the main food already in the week (higadillos twice)', () => {
    const days: DayMenu[] = Array.from({ length: 7 }, () => ({}))
    days[4] = { dinner: { dishes: [{ kind: 'recipe', recipeId: higadillos.id, recipeName: higadillos.name }] } }
    const higadillos2 = recipe('Higadillos al jerez', ['higadillos de pollo', 'ajo'])
    expect(mainFoodKey(higadillos2)).toBe(mainFoodKey(higadillos))
    const pick = tuesday([higadillos2, merluza], days)
    for (let i = 0; i < 30; i++) expect(pickForSlot({ ...pick, options }, null)).toBe(merluza)
  })
  it('the weekly limit counts the rest of the week; light dinners; nothing fits → nothing', () => {
    const rice = riceDishes[0]
    const days: DayMenu[] = Array.from({ length: 7 }, () => ({}))
    days[0] = { lunch: { dishes: [{ kind: 'recipe', recipeId: rice.id, recipeName: rice.name }] } }
    const byId2 = new Map([...byId, ...riceDishes.map((r) => [r.id, r] as const)])
    expect(tuesday([riceDishes[1]], days, { byId: byId2, weeklyLimits: [{ target: 'arroz', times: 1 }] }).pool).toEqual([])
    expect(tuesday([oreja, tortilla], undefined, { lightMeals: ['dinner'] }).pool).toEqual([tortilla])
    expect(pickForSlot({ ...tuesday([khachapuri, sweet]), options }, null)).toBeUndefined()
  })
})

describe('search with several conditions', () => {
  const calabacinRapido = recipe('Calabacín salteado con ajo', ['calabacín', 'ajo'], { totalTime: 15 })
  const calabacinLento = recipe('Calabacines rellenos', ['calabacín', 'carne picada de ternera'], { totalTime: 70 })
  const cenaArroz = recipe('Arroz con verduras', ['arroz', 'pimiento'], { totalTime: 25 })
  const pool = [calabacinRapido, calabacinLento, cenaArroz, hummus, oreja, sweet]

  it('«calabacín rápida menos de 30 minutos» finds the quick one', () => {
    const c = parseRecipeCriteria('calabacín rápida menos de 30 minutos')
    expect(c).toMatchObject({ words: ['calabacin'], maxMinutes: 30 })
    expect(searchByCriteria(pool, c).exact).toEqual([calabacinRapido])
  })
  it('«cena ligera sin arroz sin garbanzos» leaves rice, hummus, offal and sweets out', () => {
    const c = parseRecipeCriteria('cena ligera sin arroz sin garbanzos')
    expect(c).toMatchObject({ words: [], light: true, meal: 'dinner', exclude: ['arroz', 'garbanzos'] })
    expect(searchByCriteria(pool, c).exact).toEqual([calabacinRapido, calabacinLento])
  })
  it('«sin legumbres» counts the whole family', () => {
    expect(searchByCriteria(pool, parseRecipeCriteria('algo sin legumbres para comer')).exact).not.toContain(hummus)
  })
})

describe('semana tipo: dishes in a meal', () => {
  it('«las cenas, primer y segundo plato» → 2 dishes; 1 again → one dish', () => {
    expect(nextWeekTypeSlot({}, { dishes: 2 })).toEqual({ dishes: 2 })
    expect(nextWeekTypeSlot({ dishes: 2 }, { dishes: 1 })).toEqual({})
  })
})

describe('Mimo saves it where the menu reads it (banco `preferencia-menu`)', async () => {
  const { MIMO_EVAL_CASES, mimoReplyProblems } = await import('../services/assistant/mimoEvalCases.js')
  const { TOOL_INSTRUCTIONS } = await import('../services/assistant/systemPrompt.js')
  const cases = MIMO_EVAL_CASES.filter((c) => c.check === 'preferencia-menu')

  it('four real cases; every bad reply fails in CI; the tool\'s confirmation passes', () => {
    expect(cases.map((c) => c.id)).toEqual(['preferencia-sin-legumbres', 'preferencia-arroz-una-vez', 'preferencia-cenas-ligeras', 'preferencia-cenas-dos-platos'])
    for (const c of cases) {
      expect(mimoReplyProblems(c.badReply, c), c.id).not.toEqual([])
      const said = Object.values(c.toolResults ?? {})[0]
      const line = c.id === 'preferencia-sin-legumbres' ? 'Hecho: no te pondré nada con legumbres, ni lentejas ni garbanzos ni alubias.' : said.split('.')[0] + '.'
      expect(mimoReplyProblems(line, c), c.id).toEqual([])
    }
  })
  it('live: a note is the wrong place', () => {
    const c = cases.find((x) => x.id === 'preferencia-arroz-una-vez')!
    const reply = 'Apuntado en la ficha: arroz, como mucho una vez a la semana.'
    expect(mimoReplyProblems(reply, c, ['note_ficha_fact'], [{ name: 'note_ficha_fact', input: '{"type":"menu_rule","value":{"rule":"max_per_week","target":"arroz","times":1},"about":"household"}' }])).toEqual([])
    expect(mimoReplyProblems(reply, c, ['note_ficha_fact'], [{ name: 'note_ficha_fact', input: '{"type":"notes","value":["arroz no más de un día a la semana"]}' }])).toEqual(['guarda-mal'])
  })
  it('the prompt says where each preference goes', () => {
    const line = TOOL_INSTRUCTIONS.find((t) => t.tools?.includes('note_ficha_fact'))!.text
    expect(line).toMatch(/dislikes[\s\S]*menu_rule max_per_week[\s\S]*menu_rule light[\s\S]*set_week_type_slot/)
  })
})
