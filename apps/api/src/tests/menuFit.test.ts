/**
 * PRO-155 · «El menú dice cuánto ha acertado, y Mimo lo cuenta con humildad».
 *
 * The real case of 2026-10-16: a beta household said it likes cremas y
 * sopas, carbonara, pastel de carne con puré, rodaballo al horno, croquetas
 * de cocido, buñuelos de bacalao and chuletón, and got a week with none of
 * them. The evaluator (Claude Haiku, faked here) must call it low, say which
 * dishes we don't have and which we have but didn't fit, and the missing ones
 * must become catalogue wishes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MenuFit } from '@ona/shared'
import {
  buildFitPrompt,
  candidateRecipes,
  evaluateMenuFit,
  evaluateAndSaveMenuFit,
  menuFitSummary,
  menuRecipeNames,
  MENU_FIT_FEATURE,
  MENU_FIT_MODEL,
  normalizeFit,
  recordFitWishes,
  setMenuFitModelForTests,
  unusedAddMethodsFrom,
  type FitInput,
} from '../services/menuFit.js'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'
import { buildSystemPrompt } from '../services/assistant/systemPrompt.js'

const FAVOURITES = [
  'cremas y sopas',
  'carbonara',
  'pastel de carne con puré',
  'rodaballo al horno',
  'croquetas de cocido',
  'buñuelos de bacalao',
  'chuletón',
]
const MENU = [
  'Lentejas estofadas',
  'Onigirazu de salmón',
  'Menestra de verduras con carne',
  'Curry de tofu',
  'Oreja a la plancha',
  'Curry de patatas y guisantes',
]
/** What the generator could pick from: the week, six cremas y sopas, and look-alikes that share one word only. */
const CATALOG = [
  ...MENU,
  'Crema de calabaza',
  'Crema de calabacín',
  'Crema de zanahorias',
  'Sopa juliana',
  'Sopa miso',
  'Sopa de cocido',
  'Bacalao al pil pil',
  'Pastel de verduras',
]

const realCase = (): FitInput => ({
  preferences: FAVOURITES.map((text) => ({ text, source: 'plato' as const })),
  menuRecipes: MENU,
  catalogNames: CATALOG,
  unusedAddMethods: ['foto', 'enlace', 'escrita'],
})

const fakeModel = (json: unknown, usage = { input_tokens: 900, output_tokens: 200 }) =>
  vi.fn(async () => ({ content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }], usage })) as any

/** A model that gets everything right… */
const RIGHT = {
  acierto: 5,
  gustos: [
    { n: 1, estado: 'no_cabia', receta: null },
    ...[2, 3, 4, 5, 6, 7].map((n) => ({ n, estado: 'no_catalogo', receta: null })),
  ],
}
/** …and one that calls everything «no está en el catálogo» (the hand check must fix cremas y sopas). */
const SLOPPY = { acierto: 5, gustos: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ n, estado: 'no_catalogo', receta: null })) }

afterEach(() => {
  setMenuFitModelForTests(null)
  setCostSinkForTests(null)
})

describe('the real case (beta household, 2026-10-16)', () => {
  for (const [label, answer] of [['a careful model', RIGHT], ['a sloppy model', SLOPPY]] as const) {
    it(`low fit; «no está en el catálogo» for six dishes and «no cabía» for cremas y sopas (${label})`, async () => {
      const fit = await evaluateMenuFit(realCase(), { create: fakeModel(answer) })
      expect(fit).not.toBeNull()
      expect(fit!.level).toBe('bajo')
      expect(fit!.score).toBeLessThan(40)
      expect(fit!.met).toEqual([])
      const reason = Object.fromEntries(fit!.missed.map((m) => [m.preference, m.reason]))
      expect(reason).toEqual({
        'cremas y sopas': 'no_cabia',
        carbonara: 'no_catalogo',
        'pastel de carne con puré': 'no_catalogo',
        'rodaballo al horno': 'no_catalogo',
        'croquetas de cocido': 'no_catalogo',
        'buñuelos de bacalao': 'no_catalogo',
        'chuletón': 'no_catalogo',
      })
    })
  }

  it('the model sees, for each dish, the look-alike recipes we have (cremas y sopas → the six)', () => {
    expect(candidateRecipes('cremas y sopas', CATALOG)).toEqual(
      expect.arrayContaining(['Crema de calabaza', 'Crema de calabacín', 'Crema de zanahorias', 'Sopa juliana', 'Sopa miso', 'Sopa de cocido']),
    )
    const prompt = buildFitPrompt(realCase())
    expect(prompt).toContain('1. cremas y sopas')
    expect(prompt).toContain('2. carbonara\n   Parecidas en el catálogo: ninguna')
    expect(prompt).toContain('- Menestra de verduras con carne')
  })

  it('the missing favourites become catalogue wishes (source evaluador); «no cabía» does not', async () => {
    const fit = (await evaluateMenuFit(realCase(), { create: fakeModel(RIGHT) }))!
    const record = vi.fn(async () => ({ wishId: 'w', created: true, households: 1 }))
    const recorded = await recordFitWishes(fit, realCase().preferences, 'u-1', record as any)
    expect(recorded).toEqual(['carbonara', 'pastel de carne con puré', 'rodaballo al horno', 'croquetas de cocido', 'buñuelos de bacalao', 'chuletón'])
    expect(record).toHaveBeenCalledWith({ dish: 'carbonara', source: 'evaluador', userId: 'u-1' })
    expect(record).not.toHaveBeenCalledWith(expect.objectContaining({ dish: 'cremas y sopas' }))
  })

  it('a «Me encanta» recipe is never a wish, and never «no está en el catálogo»', async () => {
    const input: FitInput = { ...realCase(), preferences: [{ text: 'Crema de calabaza', source: 'me_encanta' }] }
    const fit = normalizeFit({ acierto: 0, gustos: [{ n: 1, estado: 'no_catalogo' }] }, input)!
    expect(fit.missed).toEqual([{ preference: 'Crema de calabaza', reason: 'no_cabia' }])
    const record = vi.fn()
    expect(await recordFitWishes(fit, input.preferences, 'u-1', record as any)).toEqual([])
  })
})

describe('normalizeFit', () => {
  it('a met preference keeps its recipe only when it is in the week; level from the score', () => {
    const fit = normalizeFit(
      { acierto: 82, gustos: [{ n: 1, estado: 'si', receta: 'Curry de tofu' }, { n: 2, estado: 'si', receta: 'Inventada' }] },
      { ...realCase(), preferences: [{ text: 'curry', source: 'plato' }, { text: 'tofu', source: 'plato' }] },
    )!
    expect(fit.level).toBe('alto')
    expect(fit.met).toEqual([{ preference: 'curry', recipe: 'Curry de tofu' }, { preference: 'tofu', recipe: null }])
  })

  it('clamps the score and derives it when missing; a skipped preference counts as missed', () => {
    const input = { ...realCase(), preferences: [{ text: 'curry', source: 'plato' as const }, { text: 'chuletón', source: 'plato' as const }] }
    expect(normalizeFit({ acierto: 140, gustos: [{ n: 1, estado: 'si' }] }, input)!.score).toBe(100)
    const derived = normalizeFit({ gustos: [{ n: 1, estado: 'si' }] }, input)!
    expect(derived.score).toBe(50)
    expect(derived.level).toBe('medio')
    expect(derived.missed).toEqual([{ preference: 'chuletón', reason: 'no_catalogo' }])
  })

  it('garbage → null', () => {
    expect(normalizeFit(null, realCase())).toBeNull()
    expect(normalizeFit({ acierto: 50 }, realCase())).toBeNull()
    expect(normalizeFit({ gustos: [{ n: 99, estado: 'si' }] }, realCase())).toBeNull()
  })
})

describe('best effort: the menu goes out the same without it', () => {
  it('no model (no key) → null, without touching the database', async () => {
    const db = new Proxy({}, { get: () => { throw new Error('db touched') } }) as any
    expect(await evaluateAndSaveMenuFit({ userId: 'u-1', menuId: 'm-1', days: [] }, db)).toBeNull()
  })

  it('error, timeout or garbage from the model → null', async () => {
    expect(await evaluateMenuFit(realCase(), { create: vi.fn(async () => { throw new Error('overloaded') }) as any })).toBeNull()
    expect(await evaluateMenuFit(realCase(), { create: vi.fn(() => new Promise(() => {})) as any, timeoutMs: 20 })).toBeNull()
    expect(await evaluateMenuFit(realCase(), { create: fakeModel('lo siento, no puedo') })).toBeNull()
  })

  it('nothing to compare with (no favourites) → no call', async () => {
    const create = fakeModel(RIGHT)
    expect(await evaluateMenuFit({ ...realCase(), preferences: [] }, { create })).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })

  it('the call is billed to the household (feature menu_fit, Haiku price)', async () => {
    const rows: CostRow[] = []
    setCostSinkForTests(async (r) => {
      rows.push(r)
    })
    await evaluateMenuFit(realCase(), { create: fakeModel(RIGHT), userId: 'u-1' })
    await new Promise((r) => setTimeout(r, 0))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ feature: MENU_FIT_FEATURE, model: MENU_FIT_MODEL, provider: 'anthropic', userId: 'u-1' })
    expect(rows[0].costMicros).toBeGreaterThan(0)
  })
})

describe('what Mimo gets, by level (it writes the message itself, following the guide)', () => {
  const base = { unusedAddMethods: ['enlace' as const], evaluatedAt: '2026-10-18T00:00:00Z' }
  const alto: MenuFit = { ...base, score: 85, level: 'alto', met: [{ preference: 'carbonara', recipe: 'Espaguetis a la carbonara' }], missed: [] }
  const medio: MenuFit = { ...base, score: 55, level: 'medio', met: [{ preference: 'curry', recipe: 'Curry de tofu' }], missed: [{ preference: 'cremas y sopas', reason: 'no_cabia' }] }
  const bajo: MenuFit = {
    ...base, score: 5, level: 'bajo', met: [],
    missed: [{ preference: 'carbonara', reason: 'no_catalogo' }, { preference: 'cremas y sopas', reason: 'no_cabia' }],
  }

  it('three different summaries; only the low one carries the ways to add recipes (the unused ones)', () => {
    const [a, m, b] = [alto, medio, bajo].map(menuFitSummary)
    expect(new Set([a, m, b]).size).toBe(3)
    expect(a).toContain('Acierto con sus gustos: 85/100 (alto)')
    expect(a).toContain('Se cumplen: carbonara (Espaguetis a la carbonara)')
    expect(m).toContain('No cabian esta semana (las tenemos): cremas y sopas')
    expect(b).toContain('No estan en el catalogo: carbonara')
    expect(b).toContain('Formas de añadir recetas que este hogar aun no ha usado: pasarme el enlace')
    expect(b).not.toContain('foto')
    expect(a).not.toContain('Formas de añadir')
    expect(m).not.toContain('Formas de añadir')
    expect(menuFitSummary(null)).toBe('')
  })

  it('the prompt has the guide: sure and short / says what is missing and offers / humble, invites to add recipes', () => {
    for (const mode of ['whatsapp', 'text'] as const) {
      const p = buildSystemPrompt('', mode)
      expect(p).toContain('Acierto del menu')
      expect(p).toMatch(/- alto: seguro y breve/)
      expect(p).toMatch(/- medio: di que no has podido meter/)
      expect(p).toMatch(/- bajo: humilde[^\n]*añadir sus recetas[^\n]*formas que aun no ha usado/)
      expect(p).toContain('distintas cada vez')
      expect(p).toContain('Nunca digas que solo caben cinco platos favoritos')
    }
  })
})

describe('helpers', () => {
  it('menuRecipeNames: recipe dishes of the week, no notes, no repeats', () => {
    const days = [
      { lunch: { dishes: [{ kind: 'recipe', recipeId: 'a', recipeName: 'Curry de tofu' }, { kind: 'note', text: 'pan' }] } },
      { dinner: { dishes: [{ kind: 'recipe', recipeId: 'a', recipeName: 'Curry de tofu' }] } },
      { lunch: { dishes: [{ kind: 'recipe', recipeId: 'b', recipeName: 'Sopa miso' }] } },
    ]
    expect(menuRecipeNames(days as any)).toEqual(['Curry de tofu', 'Sopa miso'])
  })

  it('unusedAddMethodsFrom: photo, link and written recipes from the usage events', () => {
    expect(unusedAddMethodsFrom([])).toEqual(['foto', 'enlace', 'escrita'])
    expect(unusedAddMethodsFrom([{ name: 'recipe_imported', source: 'whatsapp_photo' }])).toEqual(['enlace', 'escrita'])
    expect(unusedAddMethodsFrom([{ name: 'recipe_imported', source: 'url' }, { name: 'recipe_created' }])).toEqual(['foto'])
  })
})

describe('no cap of five favourites (PRO-155)', () => {
  it('the sign-up schema and Mimo\'s complete_onboarding take the seven dishes of the real case', { timeout: 20_000 }, async () => {
    const { onboardingSchema } = await import('@ona/shared')
    const parsed = onboardingSchema.parse({ adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], favoriteDishes: FAVOURITES, priority: 'varied' })
    expect(parsed.favoriteDishes).toHaveLength(7)
    const { getToolDefinitions } = await import('../services/assistant/skills.js')
    const tool = getToolDefinitions({ mode: 'whatsapp', onboarding: true }).find((t: any) => t.name === 'complete_onboarding') as any
    expect(tool.input_schema.properties.favoriteDishes.maxItems).toBeGreaterThanOrEqual(7)
    expect(tool.input_schema.properties.favoriteDishes.description).toContain('todos los que diga')
  })
})

describe('evaluateAndSaveMenuFit (what the web route and Mimo call)', () => {
  /** Chainable fake: each awaited query takes the next answer; `set(...)` calls are kept. */
  function fakeDb(answers: unknown[], executeRows: unknown[]) {
    const queue = [...answers]
    const sets: unknown[] = []
    const node: any = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (res: any, rej: any) => Promise.resolve(queue.shift()).then(res, rej)
        if (prop === 'execute') return async () => ({ rows: executeRows })
        if (prop === 'set') return (v: unknown) => { sets.push(v); return node }
        return () => node
      },
    })
    return { db: node, sets }
  }
  const days = [{ lunch: { dishes: MENU.map((recipeName, i) => ({ kind: 'recipe', recipeId: `r${i}`, recipeName })) } }]

  it('stores the verdict on the menu row and turns «no está en el catálogo» into wishes', async () => {
    const { db, sets } = fakeDb(
      [
        [{ favoriteDishes: FAVOURITES }], // users
        [], // «Me encanta»
        CATALOG.map((name) => ({ name })), // published catalogue
        [], // own recipes
        undefined, // update menus
      ],
      [{ name: 'recipe_imported', source: 'url' }],
    )
    const recordWish = vi.fn(async () => ({ wishId: 'w', created: true, households: 1 }))
    const fit = await evaluateAndSaveMenuFit({ userId: 'u-1', menuId: 'm-1', days: days as any }, db, { create: fakeModel(RIGHT), recordWish: recordWish as any })
    expect(fit?.level).toBe('bajo')
    expect(fit?.unusedAddMethods).toEqual(['foto', 'escrita'])
    expect(sets).toEqual([{ fit }])
    expect(recordWish).toHaveBeenCalledTimes(6)
  })
})
