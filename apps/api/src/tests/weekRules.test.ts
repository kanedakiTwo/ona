/**
 * PRO-254 — reglas de una semana bien hecha (COC-14), una prueba por regla,
 * con PRO-238 (platos repetidos). specs/menus.md → «Reglas de una semana bien hecha».
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu } from '@ona/shared'
import {
  asksLightDinners,
  isFishDish,
  isFriedDish,
  isLightDish,
  isSpoonLegume,
  mainProteinOf,
  sameDishKey,
  scoreWeek,
  vegetableGramsPerServing,
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
  it('passes with a shared fresh ingredient (here two: calabacín, espinacas)', () => {
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

// ─── PRO-280 · las definiciones de Cocina (COC-14) y las 4 reglas blandas (COC-17) ───

/** [nombre, cantidad, unidad, extra] — extra: pasillo, peso por unidad, merma… */
type Line = [string, number, string, Partial<WeekRecipe['ingredients'][number]>?]
const VEG = { aisle: 'produce' } as const
const m = (id: string, name: string, tipo: string, lines: Line[], over: Partial<WeekRecipe> = {}): WeekRecipe => ({
  id,
  name,
  seasons: [],
  servings: 4,
  internalTags: [`tipo:${tipo}`],
  ingredients: lines.map(([ingredientName, quantity, unit, extra]) => ({ ingredientName, quantity, unit, ...extra })),
  ...over,
})
const u = (unitWeight: number, extra: Partial<WeekRecipe['ingredients'][number]> = {}) => ({ unitWeight, ...extra })

/** Las recetas de las dos semanas de ejemplo de Cocina (`departments/cocina/reglas-semana.md`), 4 raciones salvo el cocido. */
const C = {
  // Semana buena
  lentejasCalabaza: m('c-lentejas-calabaza', 'Lentejas estofadas con calabaza', 'legumbre', [
    ['lentejas pardinas', 300, 'g'], ['calabaza', 400, 'g', VEG], ['zanahoria', 2, 'u', u(80, VEG)], ['cebolla', 1, 'u', u(150, VEG)], ['pimentón dulce', 1, 'cdita'], ['aceite de oliva virgen extra', 2, 'cda'],
  ], { totalTime: 50 }),
  tortilla: m('c-tortilla', 'Tortilla de patatas con ensalada', 'tortilla', [
    ['huevo', 6, 'u', u(55)], ['patata', 800, 'g', VEG], ['cebolla', 1, 'u', u(150, VEG)], ['lechuga', 1, 'u', u(400, VEG)], ['aceite de oliva virgen extra', 100, 'ml', { density: 0.92 }],
  ], { totalTime: 40 }),
  polloBrocoli: m('c-pollo-brocoli', 'Pollo a la plancha con brócoli', 'plancha', [
    ['pechuga de pollo', 600, 'g'], ['brócoli', 500, 'g', VEG], ['ajo', 2, 'u', u(5, VEG)], ['aceite de oliva virgen extra', 2, 'cda'],
  ], { totalTime: 25 }),
  cremaZanahoria: m('c-crema-zanahoria', 'Crema de zanahoria', 'crema', [
    ['zanahoria', 600, 'g', VEG], ['puerro', 1, 'u', u(150, VEG)], ['patata', 1, 'u', u(170, VEG)], ['caldo de verduras', 800, 'ml'],
  ], { totalTime: 35 }),
  arrozBacalao: m('c-arroz-bacalao', 'Arroz con bacalao', 'arroz', [
    ['arroz bomba', 320, 'g'], ['bacalao desalado', 400, 'g'], ['pimiento rojo', 1, 'u', u(200, VEG)], ['tomate', 2, 'u', u(120, VEG)], ['ajo', 2, 'u', u(5, VEG)], ['caldo de pescado', 1200, 'ml'],
  ], { totalTime: 45 }),
  revuelto: m('c-revuelto', 'Revuelto de calabacín', 'revuelto', [
    ['huevo', 6, 'u', u(55)], ['calabacín', 2, 'u', u(250, VEG)], ['cebolla', 0.5, 'u', u(150, VEG)],
  ], { totalTime: 20 }),
  garbanzosEspinacas: m('c-garbanzos-espinacas', 'Garbanzos con espinacas', 'legumbre', [
    ['garbanzos cocidos', 800, 'g'], ['espinacas', 400, 'g', VEG], ['ajo', 2, 'u', u(5, VEG)], ['pimentón dulce', 1, 'cdita'],
  ], { totalTime: 30 }),
  salmon: m('c-salmon', 'Salmón al horno con patatas', 'horno', [
    ['salmón', 600, 'g'], ['patata', 600, 'g', VEG], ['limón', 1, 'u', u(120, VEG)],
  ], { totalTime: 40 }),
  terneraPimientos: m('c-ternera-pimientos', 'Ternera con pimientos', 'salteado', [
    ['ternera', 600, 'g'], ['pimiento rojo', 2, 'u', u(200, VEG)], ['pimiento verde', 2, 'u', u(150, VEG)], ['cebolla', 1, 'u', u(150, VEG)],
  ], { totalTime: 45 }),
  sopaJuliana: m('c-sopa-juliana', 'Sopa juliana', 'sopa', [
    ['zanahoria', 2, 'u', u(80, VEG)], ['puerro', 1, 'u', u(150, VEG)], ['nabo', 1, 'u', u(150, VEG)], ['judías verdes', 150, 'g', VEG], ['caldo de verduras', 1200, 'ml'],
  ], { totalTime: 40 }),
  cocido: m('c-cocido', 'Cocido madrileño', 'cocido', [
    ['garbanzos', 400, 'g'], ['morcillo de ternera', 500, 'g'], ['gallina', 800, 'g', { edibleFraction: 0.7 }], ['chorizo', 150, 'g'], ['morcilla', 150, 'g'], ['tocino', 100, 'g'],
    ['hueso de jamón', 1, 'u', u(300, { edibleFraction: 0 })], ['repollo', 1, 'u', u(1200, VEG)], ['fideos', 150, 'g'],
  ], { servings: 6, totalTime: 240 }),
  ensaladaGriega: m('c-ensalada-griega', 'Ensalada griega', 'ensalada', [
    ['tomate', 4, 'u', u(120, VEG)], ['pepino', 1, 'u', u(300, VEG)], ['pimiento verde', 1, 'u', u(150, VEG)], ['cebolla morada', 0.5, 'u', u(150, VEG)], ['queso feta', 200, 'g'], ['aceitunas negras', 80, 'g'],
  ], { totalTime: 15 }),
  ropaVieja: m('c-ropa-vieja', 'Ropa vieja del cocido', 'salteado', [
    ['sobras del cocido', 600, 'g'], ['cebolla', 1, 'u', u(150, VEG)], ['pimiento rojo', 1, 'u', u(200, VEG)],
  ], { totalTime: 20 }),
  coliflor: m('c-coliflor', 'Coliflor gratinada', 'horno', [
    ['coliflor', 1, 'u', u(1000, VEG)], ['leche entera', 500, 'ml'], ['harina de trigo', 40, 'g'], ['mantequilla', 40, 'g'], ['queso rallado', 100, 'g'],
  ], { totalTime: 50 }),
  // Semana mala
  polloAgridulce: m('c-pollo-agridulce', 'Pollo agridulce', 'salteado', [
    ['pechuga de pollo', 600, 'g'], ['pimiento rojo', 1, 'u', u(200, VEG)], ['piña', 200, 'g', VEG], ['cebolla', 1, 'u', u(150, VEG)], ['salsa de soja', 3, 'cda'], ['azúcar', 1, 'cda'],
  ], { totalTime: 30 }),
  alitas: m('c-alitas', 'Alitas de pollo al horno', 'asado', [
    ['alitas de pollo', 1000, 'g', { edibleFraction: 0.54 }], ['ajo', 3, 'u', u(5, VEG)], ['pimentón dulce', 1, 'cda'], ['limón', 1, 'u', u(120, VEG)],
  ], { totalTime: 45 }),
  lentejasEstofadas: m('c-lentejas-estofadas', 'Lentejas estofadas', 'legumbre', [
    ['lentejas pardinas', 300, 'g'], ['zanahoria', 2, 'u', u(80, VEG)], ['cebolla', 1, 'u', u(150, VEG)], ['pimiento verde', 1, 'u', u(150, VEG)], ['pimentón dulce', 1, 'cdita'], ['laurel', 1, 'u', u(0.2)],
  ], { totalTime: 50 }),
  lentejasGuisadas: m('c-lentejas-guisadas', 'Lentejas guisadas', 'legumbre', [
    ['lentejas', 320, 'g'], ['zanahoria', 1, 'u', u(80, VEG)], ['cebolla', 1, 'u', u(150, VEG)], ['ajo', 2, 'u', u(5, VEG)], ['comino', 1, 'cdita'],
  ], { totalTime: 45 }),
  boquerones: m('c-boquerones', 'Boquerones fritos', 'frito', [
    ['boquerones', 800, 'g'], ['harina de trigo', 100, 'g'], ['aceite de oliva', 500, 'ml', { density: 0.92, note: 'para freír' }], ['limón', 1, 'u', u(120, VEG)],
  ], { totalTime: 30 }),
  ensaladaAtun: m('c-ensalada-atun', 'Ensalada de atún', 'ensalada', [
    ['atún en conserva', 360, 'g'], ['lechuga', 1, 'u', u(400, VEG)], ['tomate', 2, 'u', u(120, VEG)], ['huevo', 2, 'u', u(55)], ['aceitunas verdes', 50, 'g'],
  ], { totalTime: 15 }),
  costillas: m('c-costillas', 'Costillas a la riojana', 'guiso', [
    ['costillas de cerdo', 1000, 'g', { edibleFraction: 0.7 }], ['patata', 800, 'g', VEG], ['carne de pimiento choricero', 2, 'cda'], ['cebolla', 1, 'u', u(150, VEG)], ['pimentón dulce', 1, 'cda'],
  ], { totalTime: 60 }),
  albondigas: m('c-albondigas', 'Albóndigas en salsa española', 'guiso', [
    ['carne picada mixta', 500, 'g'], ['pan rallado', 50, 'g'], ['huevo', 1, 'u', u(55)], ['harina de trigo', 30, 'g'], ['puerro', 1, 'u', u(150, VEG)], ['vino blanco', 100, 'ml'], ['caldo de carne', 400, 'ml'],
  ], { totalTime: 50 }),
  espaguetis: m('c-espaguetis', 'Espaguetis con ajo y aceite', 'pasta', [
    ['espaguetis', 320, 'g'], ['ajo', 4, 'u', u(5, VEG)], ['guindilla', 1, 'u', u(2, VEG)], ['perejil', 10, 'g', VEG], ['aceite de oliva virgen extra', 60, 'ml', { density: 0.92 }],
  ], { totalTime: 20 }),
  pizza: m('c-pizza', 'Pizza de colores con verduras', 'pizza', [
    ['masa de pizza', 1, 'u', u(400)], ['tomate triturado', 150, 'g'], ['calabacín', 80, 'g', VEG], ['pimiento amarillo', 80, 'g', VEG], ['mozzarella', 125, 'g'],
  ], { totalTime: 35 }),
  carrilleras: m('c-carrilleras', 'Carrilleras de ternera con vino tinto', 'guiso', [
    ['carrillera de ternera', 800, 'g'], ['vino tinto', 300, 'ml'], ['cebolla', 1, 'u', u(150, VEG)], ['champiñones', 200, 'g', VEG],
  ], { totalTime: 150 }),
  rinones: m('c-rinones', 'Riñones al jerez', 'guiso', [
    ['riñones de cordero', 600, 'g'], ['vino de jerez', 100, 'ml'], ['ajo', 2, 'u', u(5, VEG)], ['perejil', 5, 'g', VEG], ['harina de trigo', 10, 'g'],
  ], { totalTime: 30 }),
  sandwich: m('c-sandwich', 'Sándwich mixto', 'bocadillo', [
    ['pan de molde', 8, 'u', u(25)], ['jamón cocido', 160, 'g'], ['queso en lonchas', 160, 'g'], ['mantequilla', 20, 'g'],
  ], { totalTime: 10 }),
}
const C_RECIPES = new Map(Object.values(C).map((x) => [x.id, x]))
const OCTOBER = { season: 'autumn' as const }
const cocina = (plan: Plan, variants: Record<string, 'leftover' | 'freezer'> = {}, opts: Parameters<typeof scoreWeek>[2] = OCTOBER) =>
  scoreWeek(week(plan, variants), C_RECIPES, opts)
const failing = (s: ReturnType<typeof scoreWeek>) => s.rules.filter((x) => x.applies && !x.ok).map((x) => x.id)

/** «Un ejemplo que las cumple» (octubre, hogar sin restricciones). La ropa vieja, sobras del sábado. */
const COCINA_GOOD: Plan = [
  [C.lentejasCalabaza, C.tortilla],
  [C.polloBrocoli, C.cremaZanahoria],
  [C.arrozBacalao, C.revuelto],
  [C.garbanzosEspinacas, C.salmon],
  [C.terneraPimientos, C.sopaJuliana],
  [C.cocido, C.ensaladaGriega],
  [C.ropaVieja, C.coliflor],
]
/** «Un ejemplo que no». */
const COCINA_BAD: Plan = [
  [C.polloAgridulce, C.alitas],
  [C.lentejasEstofadas, C.lentejasGuisadas],
  [C.boquerones, C.ensaladaAtun],
  [C.costillas, C.albondigas],
  [C.espaguetis, C.pizza],
  [C.carrilleras, C.rinones],
  [C.cocido, C.sandwich],
]

describe('las dos semanas de ejemplo de Cocina (PRO-280)', () => {
  it('la buena pasa todas las reglas', () => {
    const s = cocina(COCINA_GOOD, { '6|lunch': 'leftover' })
    expect(s.rules.filter((x) => !x.ok).map((x) => `${x.id}: ${x.detail}`)).toEqual([])
    expect(s.ok).toBe(true)
    expect(s.score).toBe(1)
    const by = (id: WeekRuleId) => s.rules.find((x) => x.id === id)!
    expect(by('legumbre').detail).toBe('3 de 2') // lentejas, garbanzos y el cocido
    expect(by('pescado').detail).toBe('2 (entre 2 y 3)') // bacalao y salmón
    expect(by('carne_roja').detail).toBe('2 (como mucho 2)') // ternera y cocido
    expect(by('fritos').detail).toBe('0 (como mucho 2)')
    expect(by('aprovechar').detail).toContain('zanahoria')
    for (const id of ['verdura_diaria', 'carne_roja', 'fritos', 'largo_con_tiempo'] as const) expect(by(id).applies, id).toBe(true)
  })

  it('la mala falla exactamente la 3, la 4, la 5, la 8 y la 9', () => {
    const s = cocina(COCINA_BAD)
    expect(failing(s)).toEqual(['proteina_mismo_dia', 'plato_repetido', 'aprovechar', 'verdura_diaria', 'carne_roja'])
    expect(s.ok).toBe(false)
    const by = (id: WeekRuleId) => s.rules.find((x) => x.id === id)!
    expect(by('proteina_mismo_dia').detail).toMatch(/^lunes: pollo; martes: legumbre/)
    expect(by('plato_repetido').detail).toBe('Lentejas guisadas (martes)')
    expect(by('verdura_diaria').detail).toContain('viernes')
    expect(by('carne_roja').detail).toBe('5 (como mucho 2)') // costillas, albóndigas, carrilleras, riñones y cocido
    expect(by('carne_roja').slots.map((x) => x.recipeId)).toEqual(['c-costillas', 'c-albondigas', 'c-carrilleras', 'c-rinones', 'c-cocido'])
    // Pasan justo la 1 (lentejas y cocido) y la 2 (boquerones y atún).
    expect(by('legumbre').ok).toBe(true)
    expect(by('pescado').detail).toBe('2 (entre 2 y 3)')
  })
})

describe('legumbre y pescado solo como proteína principal (PRO-280)', () => {
  it('una ensalada verde con un puñado de garbanzos no es legumbre', () => {
    const ensalada = m('x-ens-garbanzos', 'Ensalada verde con garbanzos', 'ensalada', [
      ['lechuga', 1, 'u', u(400, VEG)], ['garbanzos cocidos', 100, 'g'], ['tomate', 2, 'u', u(120, VEG)], ['aceite de oliva virgen extra', 3, 'cda'],
    ])
    expect(isSpoonLegume(ensalada)).toBe(false) // 25 g cocidos por ración, de 120
    expect(mainProteinOf(ensalada)).toBeNull()
    // …y con 500 g cocidos (125 g por ración) ya es un plato de legumbre.
    expect(isSpoonLegume({ ...ensalada, ingredients: ensalada.ingredients.map((i) => (i.ingredientName === 'garbanzos cocidos' ? { ...i, quantity: 500 } : i)) })).toBe(true)
    // En seco cuenta desde 50 g por ración.
    expect(isSpoonLegume(C.lentejasEstofadas)).toBe(true) // 75 g
  })

  it('una ensalada con anchoas no es pescado', () => {
    const ensalada = m('x-ens-anchoas', 'Ensalada de tomate con anchoas', 'ensalada', [
      ['tomate', 600, 'g', VEG], ['anchoas', 50, 'g'], ['cebolla morada', 0.5, 'u', u(150, VEG)], ['aceite de oliva virgen extra', 3, 'cda'],
    ])
    expect(isFishDish(ensalada)).toBe(false) // 12,5 g por ración, de 80
    expect(mainProteinOf(ensalada)).toBeNull()
    expect(isFishDish(C.ensaladaAtun)).toBe(true) // 90 g de atún por ración
  })

  it('el pescado se mide en peso comestible: dos doradas de ración para 4 no llegan', () => {
    const dorada = m('x-dorada', 'Dorada a la sal', 'horno', [['dorada', 2, 'u', u(300, { edibleFraction: 0.5 })]])
    expect(isFishDish(dorada)).toBe(false) // 75 g por ración
    expect(isFishDish({ ...dorada, ingredients: [{ ...dorada.ingredients[0], quantity: 4 }] })).toBe(true) // 150 g
  })

  it('el queso es una familia cuando es el plato fuerte (una tortilla de queso es huevo)', () => {
    const provolone = m('x-provolone', 'Provolone al horno con tomate', 'horno', [['queso provolone', 400, 'g'], ['tomate', 2, 'u', u(120, VEG)]])
    expect(mainProteinOf(provolone)).toBe('queso')
    const tortillaQueso = m('x-tortilla-queso', 'Tortilla de queso', 'tortilla', [['huevo', 8, 'u', u(55)], ['queso rallado', 80, 'g']])
    expect(mainProteinOf(tortillaQueso)).toBe('huevo')
  })
})

describe('«mismo plato» por ingrediente principal y tipo de plato (PRO-280)', () => {
  it('«Lentejas estofadas» y «Lentejas guisadas» el mismo día son repetidas', () => {
    const days = week([[C.lentejasEstofadas, C.lentejasGuisadas]])
    const s = scoreWeek(days, C_RECIPES, OCTOBER)
    const rep = s.rules.find((x) => x.id === 'plato_repetido')!
    expect(rep.ok).toBe(false)
    expect(rep.slots.map((x) => x.recipeId)).toEqual(['c-lentejas-guisadas'])
    expect(sameDishKey(C.lentejasEstofadas)).toBe('lenteja|legumbre')
    expect(sameDishKey(C.lentejasGuisadas)).toBe('lenteja|legumbre')
  })

  it('lentejas y garbanzos, o pollo a la plancha y pollo agridulce, no son el mismo plato', () => {
    const days = week([[C.lentejasEstofadas, C.polloBrocoli], [C.garbanzosEspinacas, C.polloAgridulce]])
    expect(scoreWeek(days, C_RECIPES, OCTOBER).rules.find((x) => x.id === 'plato_repetido')!.ok).toBe(true)
  })
})

describe('cenas ligeras: la crema de legumbre sin embutido (PRO-280)', () => {
  const crema = m('x-crema-lentejas', 'Crema de lentejas', 'crema', [
    ['lentejas rojas', 240, 'g'], ['zanahoria', 2, 'u', u(80, VEG)], ['cebolla', 1, 'u', u(150, VEG)], ['comino', 1, 'cdita'],
  ], { nutritionPerServing: { kcal: 380 } })

  it('una crema de lentejas sin embutido es ligera (y sigue contando como legumbre)', () => {
    expect(isLightDish(crema)).toBe(true)
    expect(isSpoonLegume(crema)).toBe(true)
  })
  it('con chorizo o con más de 600 kcal ya no', () => {
    expect(isLightDish({ ...crema, ingredients: [...crema.ingredients, { ingredientName: 'chorizo', quantity: 100, unit: 'g' }] })).toBe(false)
    expect(isLightDish({ ...crema, nutritionPerServing: { kcal: 650 } })).toBe(false)
  })
  it('unas lentejas estofadas siguen sin ser ligeras', () => {
    expect(isLightDish(C.lentejasEstofadas)).toBe(false)
  })
})

describe('las 4 reglas blandas nuevas (COC-17, PRO-280)', () => {
  it('son blandas: restan poco y no tumban la semana', () => {
    const plan = COCINA_GOOD.map((d) => [...d]) as Plan
    plan[1][0] = C.costillas // tercera carne roja de la semana
    const s = cocina(plan, { '6|lunch': 'leftover' })
    expect(failing(s)).toEqual(['carne_roja'])
    expect(s.rules.find((x) => x.id === 'carne_roja')!.soft).toBe(true)
    expect(s.rules.find((x) => x.id === 'legumbre')!.soft).toBe(false)
    expect(s.ok).toBe(true)
    expect(s.score).toBeGreaterThan(0.95)
    expect(s.score).toBeLessThan(1)
  })

  it('verdura_diaria: ≥ 100 g de verdura por ración en la comida o la cena de cada día (la patata no cuenta)', () => {
    expect(vegetableGramsPerServing(C.pizza)).toBeCloseTo(77.5, 1) // tomate triturado, calabacín y pimiento
    expect(vegetableGramsPerServing(C.salmon)).toBe(0)
    const res = cocina([[C.espaguetis, C.pizza], [C.lentejasEstofadas, C.tortilla]]).rules.find((x) => x.id === 'verdura_diaria')!
    expect(res.ok).toBe(false)
    expect(res.detail).toBe('lunes')
  })

  it('fritos: como mucho 2', () => {
    const fritos = m('x-calamares', 'Calamares a la romana', 'frito', [['calamar', 600, 'g']])
    const flamenquines = m('x-flamenquines', 'Flamenquines', 'otro', [['lomo de cerdo', 500, 'g'], ['jamón serrano', 100, 'g']])
    expect(isFriedDish(flamenquines)).toBe(true)
    expect(isFriedDish(m('x-pollo-emp', 'Pollo empanado', 'otro', []))).toBe(true)
    expect(isFriedDish(m('x-empanada', 'Empanada gallega de atún', 'horno', []))).toBe(false)
    const recipes = new Map([...C_RECIPES, [fritos.id, fritos], [flamenquines.id, flamenquines]])
    const res = scoreWeek(week([[C.boquerones, fritos], [flamenquines, C.cremaZanahoria]]), recipes, OCTOBER).rules.find((x) => x.id === 'fritos')!
    expect(res.ok).toBe(false)
    expect(res.detail).toBe('3 (como mucho 2)')
  })

  it('largo_con_tiempo: sin tiempos del hogar, lo largo va al fin de semana', () => {
    const plan: Plan = [[C.lentejasEstofadas, C.cremaZanahoria], [C.polloBrocoli, C.revuelto], [C.cocido, C.tortilla]]
    const res = cocina(plan).rules.find((x) => x.id === 'largo_con_tiempo')!
    expect(res.ok).toBe(false)
    expect(res.detail).toBe('Cocido madrileño (miércoles)')
  })

  it('largo_con_tiempo: con los tiempos del hogar (PRO-138), los días sin límite o de «poco trabajo» tienen tiempo', () => {
    const plan: Plan = [[], [], [C.cocido, C.tortilla], [], [], [C.carrilleras, C.ensaladaGriega]]
    const budgets = { 2: null, 4: { mode: 'total' as const, minutes: 30 }, 5: { mode: 'total' as const, minutes: 30 } }
    const res = cocina(plan, {}, { ...OCTOBER, timeBudgetByDay: budgets }).rules.find((x) => x.id === 'largo_con_tiempo')!
    expect(res.detail).toBe('Carrilleras de ternera con vino tinto (sábado)')
    const relaxed = cocina(plan, {}, { ...OCTOBER, timeBudgetByDay: { ...budgets, 5: { mode: 'activo', minutes: 20 } } })
    expect(relaxed.rules.find((x) => x.id === 'largo_con_tiempo')!.ok).toBe(true)
  })
})
