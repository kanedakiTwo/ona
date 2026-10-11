/**
 * PRO-09 — from the "anti-inflammatory index" to the "balance of the week".
 *
 * Why: the constitution (§6) forbids health effects and naming diseases, and
 * the EU borderline manual cites "your inflammation index" as an example of a
 * calculator that is a medical device. Mimo keeps the kitchen signals (veg,
 * legumes, salt, processed food, fried dishes) but talks about them in cooking
 * words, with no score, and sends health questions to a professional.
 *
 * (1) guards that the tool, its description, Mimo's prompt and the default
 *     principles never say "inflam…" or name a disease;
 * (2) checks that a veg-heavy week and a fried week read differently and in
 *     kitchen words.
 */
import { describe, it, expect, vi } from 'vitest'
import { ONA_PRINCIPLES } from '@ona/shared'

vi.mock('../services/scopeResolver.js', () => ({
  resolveScope: vi.fn(async (userId: string) => ({ kind: 'user', value: userId })),
  scopeWhere: vi.fn(() => ({})),
  getPrimaryHouseholdId: vi.fn(async () => null),
}))

import { skills, recipeBalance, describeWeekBalance, describeRecipeBalance } from '../services/assistant/skills.js'
import { buildSystemPrompt } from '../services/assistant/systemPrompt.js'

const BANNED: Array<[RegExp, string]> = [
  [/inflam/i, 'inflamación'],
  [/antiinflamatori/i, 'antiinflamatorio'],
  [/diabet/i, 'diabetes'],
  [/\bc[aá]ncer/i, 'cáncer'],
  [/cardiovascular/i, 'enfermedad cardiovascular'],
  [/hipertensi[oó]n/i, 'hipertensión'],
  [/colesterol/i, 'colesterol'],
  [/obesidad/i, 'obesidad'],
]
const hits = (text: string) => BANNED.filter(([re]) => re.test(text)).map(([, l]) => l)

/** The kb/ block is Miguel's internal framework, loaded at runtime; the
 *  instructions Mimo gets from us end before it. */
const instructionsOnly = (p: string) => p.split('Base de conocimiento nutricional')[0]

describe('Mimo talks about kitchen balance, not health (constitution §6)', () => {
  it('no tool name, description or parameter mentions inflammation or diseases', () => {
    expect(skills.find((s) => s.name === 'get_inflammation_index')).toBeUndefined()
    const balance = skills.find((s) => s.name === 'get_week_balance')
    expect(balance).toBeDefined()
    for (const s of skills) {
      expect(hits(`${s.name} ${s.description} ${JSON.stringify(s.parameters)}`), s.name).toEqual([])
    }
  })

  for (const mode of ['text', 'voice', 'whatsapp', 'onboarding'] as const) {
    it(`Mimo's prompt (${mode}) has no inflammation or disease words and routes to get_week_balance`, () => {
      const p = instructionsOnly(buildSystemPrompt('Usuario de prueba', mode))
      expect(hits(p)).toEqual([])
      expect(p).toContain('get_week_balance')
      expect(p).toMatch(/profesional sanitario/)
    })
  }

  it('the default principles shown in /profile/creencias say nothing about inflammation', () => {
    expect(hits(JSON.stringify(ONA_PRINCIPLES))).toEqual([])
  })

  it('evaluate_food_health frames foods without inflammation', async () => {
    const s = skills.find((x) => x.name === 'evaluate_food_health')!
    const r = await s.handler({ food: 'pan blanco' }, { userId: 'u', db: {} as any })
    expect(hits(r.summary)).toEqual([])
  })
})

const rb = (name: string, ings: string[], steps: string[] = [], nps: any = null) =>
  recipeBalance({ id: name, name, nutritionPerServing: nps }, ings, steps)

describe('get_week_balance — kitchen words', () => {
  const crema = rb('Crema de calabacín', ['Calabacín', 'Cebolla', 'Aceite de oliva'], ['Cocer y triturar'])
  const lentejas = rb('Lentejas estofadas', ['Lentejas', 'Zanahoria', 'Pimiento'], ['Cocer 40 minutos'])
  const ensalada = rb('Ensalada de garbanzos', ['Garbanzos', 'Tomate', 'Pepino'])
  const croquetas = rb('Croquetas de jamón', ['Harina blanca', 'Leche', 'Bacon'], ['Rebozar y freír'])
  const nuggets = rb('Nuggets', ['Pollo', 'Pan rallado'], ['Freír en abundante aceite'])
  const pizza = rb('Pizza congelada', ['Masa', 'Salchichas'], [], { saltG: 4.2 })

  it('reads signals from ingredient names (accents ignored) and steps', () => {
    expect(crema).toMatchObject({ verdura: true, legumbre: false, frito: false })
    expect(lentejas).toMatchObject({ verdura: true, legumbre: true, fibra: true })
    expect(croquetas.frito).toBe(true)
    expect(croquetas.procesados.length).toBeGreaterThan(0)
    expect(pizza.salada).toBe(true)
  })

  it('a veg-heavy week and a fried week give different, kitchen-worded messages', () => {
    const good = describeWeekBalance([
      { day: 0, recipes: [crema] },
      { day: 1, recipes: [lentejas] },
      { day: 2, recipes: [ensalada] },
      { day: 3, recipes: [lentejas] },
    ])
    const fried = describeWeekBalance([
      { day: 0, recipes: [pizza] },
      { day: 1, recipes: [crema] },
      { day: 3, recipes: [croquetas] },
      { day: 4, recipes: [nuggets] },
    ])
    expect(good.summary).not.toEqual(fried.summary)
    expect(good.summary).toMatch(/Bien de verdura/)
    expect(good.summary).toMatch(/Legumbre 3 días/)
    expect(good.summary).toMatch(/Ningún frito/)

    expect(fried.summary).toMatch(/vas corto de verdura/)
    expect(fried.summary).toMatch(/El jueves y el viernes repiten fritos/)
    expect(fried.summary).toMatch(/No hay legumbre/)
    expect(fried.summary).toMatch(/sal: .*Pizza congelada/)
    expect(fried.summary).toMatch(/procesados: .*Croquetas de jamón/)

    for (const s of [good.summary, fried.summary]) {
      expect(hits(s)).toEqual([])
      expect(s).not.toMatch(/\/100|puntuaci|[ií]ndice/i)
    }
  })

  it('describes a single recipe in a sentence', () => {
    expect(describeRecipeBalance(lentejas)).toBe('Lentejas estofadas: lleva verdura y legumbre; nada frito ni procesado.')
    expect(describeRecipeBalance(croquetas)).toMatch(/^Croquetas de jamón: no lleva verdura ni legumbre; ojo: es frito o rebozado/)
  })
})
