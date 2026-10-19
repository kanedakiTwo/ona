/**
 * PRO-254 — reglas de una semana bien hecha (COC-14), una prueba por regla,
 * con PRO-238 (platos repetidos). specs/menus.md → «Reglas de una semana bien hecha».
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu } from '@ona/shared'
import {
  asksLightDinners,
  isFishDish,
  isLightDish,
  isSpoonLegume,
  mainProteinOf,
  scoreWeek,
  WEEK_RULE_IDS,
  type WeekRecipe,
  type WeekRuleId,
} from '../services/weekRules.js'

const r = (id: string, name: string, ingredients: string[], over: Partial<WeekRecipe> = {}): WeekRecipe => ({
  id, name, seasons: [], ingredients: ingredients.map((ingredientName) => ({ ingredientName })), ...over,
})

const R = {
  lentejas: r('lentejas', 'Lentejas estofadas', ['lentejas pardinas', 'zanahoria', 'cebolla', 'pimentón']),
  garbanzos: r('garbanzos', 'Garbanzos con espinacas', ['garbanzos cocidos', 'espinacas', 'ajo']),
  merluza: r('merluza', 'Merluza en salsa verde', ['merluza', 'perejil', 'almejas', 'ajo']),
  salmon: r('salmon', 'Salmón a la plancha con calabacín', ['salmón', 'calabacín', 'limón']),
  sardinas: r('sardinas', 'Sardinas asadas', ['sardinas', 'pimiento rojo']),
  bacalao: r('bacalao', 'Bacalao con tomate', ['bacalao', 'tomate']),
  polloEmpanado: r('pollo-emp', 'Pollo empanado', ['pechuga de pollo', 'pan rallado', 'huevo']),
  polloAsado: r('pollo-asado', 'Pollo asado con patatas', ['pollo', 'patata', 'pimiento rojo']),
  crema: r('crema', 'Crema de calabacín', ['calabacín', 'puerro', 'patata'], { internalTags: ['tipo:crema', 'proteina:ninguna'] }),
  tortilla: r('tortilla', 'Tortilla de espinacas', ['huevo', 'espinacas']),
  ensalada: r('ensalada', 'Ensalada de tomate y ventresca', ['tomate', 'ventresca de bonito', 'cebolla']),
  macarrones: r('macarrones', 'Macarrones con tomate', ['macarrones', 'tomate frito', 'queso rallado']),
  carrilleras: r('carrilleras', 'Carrilleras al vino', ['carrillera de cerdo', 'vino tinto', 'zanahoria']),
  gazpacho: r('gazpacho', 'Gazpacho', ['tomate', 'pepino', 'pimiento verde'], { seasons: ['summer'] }),
  revuelto: r('revuelto', 'Revuelto de setas', ['huevo', 'setas', 'espinacas']),
  judias: r('judias', 'Judías verdes con jamón', ['judías verdes', 'jamón serrano', 'patata']),
}
const RECIPES = new Map(Object.values(R).map((x) => [x.id, x]))

type Plan = Array<[lunch?: WeekRecipe | null, dinner?: WeekRecipe | null]>
const week = (plan: Plan, variants: Record<string, 'leftover' | 'freezer'> = {}): DayMenu[] =>
  plan.map(([lunch, dinner], d) => {
    const day: DayMenu = {}
    if (lunch) day.lunch = { dishes: [{ kind: 'recipe', recipeId: lunch.id, recipeName: lunch.name, variant: variants[`${d}|lunch`] }] }
    if (dinner) day.dinner = { dishes: [{ kind: 'recipe', recipeId: dinner.id, recipeName: dinner.name, variant: variants[`${d}|dinner`] }] }
    return day
  })

/** A week that follows every rule (autumn, light dinners asked). */
const GOOD: Plan = [
  [R.lentejas, R.crema],
  [R.polloAsado, R.merluza],
  [R.garbanzos, R.tortilla],
  [R.macarrones, R.salmon],
  [R.carrilleras, R.revuelto],
  [R.polloEmpanado, R.judias],
  [R.bacalao, R.crema],
]
const OPTS = { season: 'autumn' as const, lightDinners: true }
const rule = (days: DayMenu[], id: WeekRuleId, opts: Parameters<typeof scoreWeek>[2] = OPTS) => scoreWeek(days, RECIPES, opts).rules.find((x) => x.id === id)!

describe('scoreWeek: a well-made week', () => {
  it('passes every rule (the second crema is a táper from the freezer)', () => {
    const s = scoreWeek(week(GOOD, { '6|dinner': 'freezer' }), RECIPES, OPTS)
    expect(s.rules.map((x) => x.id)).toEqual([...WEEK_RULE_IDS])
    expect(s.rules.filter((x) => !x.ok).map((x) => `${x.id}: ${x.detail}`)).toEqual([])
    expect(s.ok).toBe(true)
    expect(s.score).toBe(1)
  })
})

describe('rule 1 · legumbre de cuchara al menos 2 veces', () => {
  it('fails with one, and green beans don\'t count as a legume', () => {
    expect(isSpoonLegume(R.judias)).toBe(false)
    const plan = GOOD.map((d) => [...d]) as Plan
    plan[2][0] = R.polloAsado
    const res = rule(week(plan), 'legumbre')
    expect(res.ok).toBe(false)
    expect(res.score).toBe(0.5)
    expect(res.detail).toBe('1 de 2')
  })
  it('doesn\'t apply to a short week or a household that can\'t eat pulses', () => {
    expect(rule(week(GOOD.slice(0, 2)), 'legumbre').applies).toBe(false)
    expect(rule(week([[R.polloAsado, R.crema], [R.polloAsado, R.crema], [R.polloAsado, R.crema]]), 'legumbre', { ...OPTS, legumesAllowed: false }).applies).toBe(false)
  })
})

describe('rule 2 · pescado 2 o 3 veces', () => {
  it('fails with one and with six', () => {
    const few = GOOD.map((d) => [...d]) as Plan
    few[3][1] = R.tortilla; few[6][0] = R.polloAsado
    expect(rule(week(few), 'pescado').ok).toBe(false)
    const many = GOOD.map((d) => [...d]) as Plan
    many[0][1] = R.sardinas; many[2][1] = R.salmon; many[4][1] = R.bacalao
    const res = rule(week(many), 'pescado')
    expect(res.ok).toBe(false)
    expect(res.detail).toBe('6 (entre 2 y 3)')
  })
  it('doesn\'t apply when the household can\'t eat fish', () => {
    expect(rule(week(GOOD), 'pescado', { ...OPTS, fishAllowed: false }).applies).toBe(false)
  })
  it('classifies fish by ingredient or by the catalogue tag, not a fish stock', () => {
    expect(isFishDish(R.merluza)).toBe(true)
    expect(isFishDish(r('x', 'Arroz caldoso', ['arroz', 'caldo de pescado']))).toBe(false)
    expect(isFishDish(r('y', 'Plato', ['algo'], { internalTags: ['proteina:pescado-azul'] }))).toBe(true)
  })
})

describe('rule 3 · nunca la misma proteína principal a mediodía y en la cena', () => {
  it('flags lentejas at lunch and dinner the same Sunday (hogar de prueba, 18-oct)', () => {
    const plan = GOOD.map((d) => [...d]) as Plan
    plan[6] = [R.lentejas, R.garbanzos]
    const res = rule(week(plan), 'proteina_mismo_dia')
    expect(res.ok).toBe(false)
    expect(res.detail).toBe('domingo: legumbre')
    expect(res.slots.map((s) => s.meal).sort()).toEqual(['dinner', 'lunch'])
  })
  it('finds the main protein by tag, ingredients or name', () => {
    expect(mainProteinOf(R.polloEmpanado)).toBe('pollo')
    expect(mainProteinOf(R.carrilleras)).toBe('cerdo')
    expect(mainProteinOf(R.crema)).toBe('ninguna')
  })
})

describe('rule 4 · el mismo plato no se repite, salvo sobras o táper (PRO-238)', () => {
  it('flags pollo empanado on Tuesday and Sunday (Ruiz, 18-oct)', () => {
    const plan = GOOD.map((d) => [...d]) as Plan
    plan[1][0] = R.polloEmpanado
    const res = rule(week(plan, { '6|dinner': 'freezer' }), 'plato_repetido')
    expect(res.ok).toBe(false)
    expect(res.detail).toBe('Pollo empanado (sábado)')
  })
  it('a second recipe with the same name is a repeat too', () => {
    const twin = r('pollo-emp-2', 'Pollo  empanado', ['pollo'])
    const days = week([[R.polloEmpanado, R.crema], [twin, R.tortilla]])
    expect(scoreWeek(days, new Map([...RECIPES, [twin.id, twin]]), OPTS).rules.find((x) => x.id === 'plato_repetido')!.ok).toBe(false)
  })
  it('leftovers and a táper are not repeats', () => {
    const plan = GOOD.map((d) => [...d]) as Plan
    plan[1][1] = R.lentejas
    expect(rule(week(plan, { '1|dinner': 'leftover', '6|dinner': 'freezer' }), 'plato_repetido').ok).toBe(true)
  })
})

describe('rule 5 · aprovechar un ingrediente en dos platos', () => {
  it('fails when no fresh ingredient is shared (staples like ajo or cebolla don\'t count)', () => {
    const days = week([[R.lentejas, R.merluza], [R.sardinas, R.tortilla]])
    const res = rule(days, 'aprovechar')
    expect(res.detail).not.toMatch(/ajo|cebolla/)
    expect(res.score).toBeLessThan(1)
  })
  it('passes with two shared fresh ingredients (calabacín, espinacas)', () => {
    const days = week([[R.salmon, R.crema], [R.garbanzos, R.tortilla]])
    const res = rule(days, 'aprovechar')
    expect(res.ok).toBe(true)
    expect(res.detail).toContain('calabacin')
    expect(res.detail).toContain('espinacas')
  })
})

describe('rule 6 · cenas ligeras si el hogar lo pidió', () => {
  it('flags heavy dinners only when the household asked', () => {
    const plan = GOOD.map((d) => [...d]) as Plan
    plan[0][1] = R.macarrones
    plan[1][1] = R.carrilleras
    plan[3][0] = R.merluza
    const res = rule(week(plan), 'cenas_ligeras')
    expect(res.ok).toBe(false)
    expect(res.slots.map((s) => s.recipeId)).toEqual(['macarrones', 'carrilleras'])
    expect(rule(week(plan), 'cenas_ligeras', { season: 'autumn' }).applies).toBe(false)
  })
  it('knows what is light and reads the request from the household\'s notes', () => {
    expect(isLightDish(R.crema)).toBe(true)
    expect(isLightDish(R.tortilla)).toBe(true)
    expect(isLightDish(R.lentejas)).toBe(false)
    expect(isLightDish(r('k', 'Pescado', ['merluza'], { nutritionPerServing: { kcal: 750 } }))).toBe(false)
    expect(asksLightDinners(['Sin patata, poco pan, cenas ligeras'])).toBe(true)
    expect(asksLightDinners(['Por la noche algo ligero'])).toBe(true)
    expect(asksLightDinners(['Nos gustan los guisos'])).toBe(false)
  })
})

describe('rule 7 · temporada', () => {
  it('flags gazpacho in autumn', () => {
    const plan = GOOD.map((d) => [...d]) as Plan
    plan[4][1] = R.gazpacho
    const res = rule(week(plan), 'temporada')
    expect(res.ok).toBe(false)
    expect(res.detail).toBe('Gazpacho')
    expect(rule(week(plan), 'temporada', { season: 'summer' }).ok).toBe(true)
  })
})
