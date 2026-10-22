/**
 * «Afina tu menú» (PRO-146, specs/taste.md): the deck (starter, variety,
 * Claude's pick with a fake model), «¿Qué es lo que no?» into memory, the
 * offers, and what the menu generator does with the verdicts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import catalog from './fixtures/catalog-2026-10-12.json'
import catalog1022 from './fixtures/catalog-2026-10-22.json'
import { TASTE_STARTER_DECK } from '@ona/shared'
import {
  cardMeta,
  formatMinutes,
  isBasicIngredient,
  mainIngredients,
  proteinGroup,
  starterDeck,
  toCard,
  varietyOrder,
  withArticle,
  type TasteRecipe,
} from '../services/tasteDeck.js'
import {
  analyseTasteReason,
  normalizePicks,
  normalizeReasonFacts,
  pickNextWithClaude,
  ruleBasedReasonFacts,
} from '../services/tasteAI.js'
import { DEFAULT_KITCHEN_EQUIPMENT, mergeTasteFact, tasteOffers, verdictSets } from '../services/tasteStore.js'
import { householdRatingSets, withHouseholdRatings, withVerdicts } from '../services/householdRatings.js'
import { nextBatch } from '../routes/taste.js'
import { breaksTasteRules } from '../services/tasteStore.js'
import { compileRestrictions } from '../services/dietaryRestrictions.js'
import { checkStarterDeck, formatDeckCheck } from '../services/tasteDeckCheck.js'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'

const tasteCatalog: TasteRecipe[] = (catalog as any[]).map((r, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  name: r.name,
  imageUrl: null,
  prepTime: 30 + (i % 5) * 20,
  totalTime: null,
  tags: [],
  equipment: [],
  course: null,
  ingredients: r.ingredients.map((n: string, j: number) => ({ ingredientName: n, quantity: 300 - j * 20, unit: 'g' })),
}))

const fakeModel = (text: string) =>
  vi.fn(async () => ({ content: [{ type: 'text', text, citations: null }], usage: { input_tokens: 100, output_tokens: 20 } }) as any)

describe('cards', () => {
  it('article by gender and number', () => {
    expect(withArticle('cilantro')).toBe('el cilantro')
    expect(withArticle('espinacas')).toBe('las espinacas')
    expect(withArticle('garbanzos')).toBe('los garbanzos')
    expect(withArticle('coliflor')).toBe('la coliflor')
    expect(withArticle('calabaza')).toBe('la calabaza')
  })

  it('basics (salt, oil, garlic, onion) are never offered', () => {
    for (const b of ['sal', 'Aceite de oliva virgen extra', 'ajo', 'cebolla', 'pimienta negra', 'agua']) expect(isBasicIngredient(b)).toBe(true)
    const main = mainIngredients({
      ingredients: [
        { ingredientName: 'aceite de oliva', quantity: 500, unit: 'ml' },
        { ingredientName: 'cebolla', quantity: 400, unit: 'g' },
        { ingredientName: 'pescado blanco', quantity: 400, unit: 'g' },
        { ingredientName: 'cilantro', quantity: 10, unit: 'g' },
        { ingredientName: 'cebolla morada', quantity: 100, unit: 'g' },
        { ingredientName: 'sal', quantity: 5, unit: 'g' },
        { ingredientName: 'lima', quantity: 2, unit: 'u' },
      ],
    })
    expect(main.map((m) => m.name)).toEqual(['pescado blanco', 'lima', 'cebolla morada'])
    expect(main[0].label).toBe('el pescado blanco')
  })

  it('meta: kind of dish · time', () => {
    expect(formatMinutes(28)).toBe('28 min')
    expect(formatMinutes(200)).toBe('3 h 20 min')
    const lentejas = tasteCatalog.find((r) => r.name === 'Lentejas estofadas')!
    expect(cardMeta({ ...lentejas, totalTime: 53 })).toBe('Cuchara · 53 min')
    expect(toCard(lentejas).recipeId).toBe(lentejas.id)
  })

  it('protein group: meat, fish or neither', () => {
    expect(proteinGroup({ name: 'Carrilleras de ternera con vino tinto', ingredients: [] })).toBe('carne')
    expect(proteinGroup({ name: 'Bacalao con tomate', ingredients: [] })).toBe('pescado')
    expect(proteinGroup({ name: 'Coliflor gratinada', ingredients: [{ ingredientName: 'coliflor', quantity: 1, unit: 'u' }] })).toBe(null)
  })
})

/**
 * PRO-283 (Cocina, COC-10): the deck against the published catalogue of
 * 2026-10-22 (`fixtures/catalog-2026-10-22.json`: name, allergens and
 * ingredient names of the 243 catalogue recipes of the public API).
 */
const published: TasteRecipe[] = (catalog1022 as Array<{ name: string; allergens: string[]; ingredients: string[] }>).map((r, i) => ({
  id: `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`,
  name: r.name,
  imageUrl: null,
  prepTime: 30,
  totalTime: null,
  tags: [],
  equipment: [],
  course: null,
  allergens: r.allergens,
  ingredients: r.ingredients.map((n) => ({ ingredientName: n, quantity: 100, unit: 'g' })),
}))
const VEGETARIAN = compileRestrictions(['vegetariano'])
const rowOf = (name: string) => TASTE_STARTER_DECK.findIndex((row) => row.names.includes(name))

describe('the starter deck (PRO-283)', () => {
  it('every name of the deck exists in the published catalogue', () => {
    const r = checkStarterDeck(published.map((x) => ({ name: x.name, ingredients: x.ingredients, allergens: (x as any).allergens })))
    const missing = r.rows.flatMap((row) => row.names.filter((n) => !n.exists).map((n) => `${row.covers}: ${n.name}`))
    expect(missing).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('the names Cocina listed as missing are gone', () => {
    const names = TASTE_STARTER_DECK.flatMap((row) => row.names)
    for (const gone of ['Lubina', 'Tian de verduras', 'Salmon al horno con brocoli', 'Huevos al plato', 'Cocido N', 'Ramen', 'Pizza']) {
      expect(names, gone).not.toContain(gone)
    }
  })

  it('«largo» is not the cocido while it is incomplete: carrilleras and fabada first', () => {
    const largo = TASTE_STARTER_DECK.find((row) => row.covers === 'largo')!.names
    expect(largo.slice(0, 2)).toEqual(['Carrilleras de ternera con vino tinto', 'Fabada asturiana'])
    expect(largo.indexOf('Cocido madrileño')).toBeGreaterThan(1)
    const deck = starterDeck(published)
    expect(deck).toHaveLength(TASTE_STARTER_DECK.length)
    expect(deck.map((r) => r.name)).not.toContain('Cocido madrileño')
    // The carrilleras go to «carne» (an earlier row), so «largo» is the fabada.
    expect(deck[TASTE_STARTER_DECK.findIndex((row) => row.covers === 'largo')].name).toBe('Fabada asturiana')
    const check = checkStarterDeck(published.map((x) => ({ name: x.name, ingredients: x.ingredients })))
    expect(check.rows.find((row) => row.covers === 'largo')!.card).toBe('Fabada asturiana')
  })

  it('«algo de niños»: «Macarrones de casa» and «Pollo empanado» before the fajitas', () => {
    const kids = TASTE_STARTER_DECK.find((row) => row.covers === 'algo de niños')!.names
    expect(kids).toContain('Macarrones de casa')
    expect(kids).toContain('Pollo empanado')
    expect(kids.indexOf('Macarrones de casa')).toBeLessThan(kids.indexOf('Fajitas de pollo'))
    expect(kids.indexOf('Pollo empanado')).toBeLessThan(kids.indexOf('Fajitas de pollo'))
  })

  it('a vegetarian household (catalogue with only vegetarian recipes) gets a card in every row', () => {
    const vegetarian = published.filter((r) => !breaksTasteRules({ ...r, allergens: (r as any).allergens }, VEGETARIAN))
    expect(vegetarian.length).toBeLessThan(published.length)
    expect(vegetarian.some((r) => r.name === 'Bacalao con tomate')).toBe(false)
    const deck = starterDeck(vegetarian)
    expect(deck).toHaveLength(TASTE_STARTER_DECK.length)
    // One per row, in row order, each from its own row.
    deck.forEach((r, i) => expect(TASTE_STARTER_DECK[i].names).toContain(r.name))
    expect(deck.map((r) => r.name)).toEqual([
      'Lentejas estofadas',
      'Tortilla de patatas',
      'Berenjenas con queso',
      'Coliflor gratinada',
      'Lasaña de verduras',
      'Revuelto de calabacín',
      'Falafel',
      'Garbanzos con espinacas',
      'Curry de berenjena',
      'Pizza de colores con verduras',
    ])
    expect(checkStarterDeck(published.map((x) => ({ name: x.name, ingredients: x.ingredients, allergens: (x as any).allergens }))).vegetarianOk).toBe(true)
  })

  it('the check fails when a row has no name that exists, and says which', () => {
    const r = checkStarterDeck([{ name: 'Lentejas estofadas', ingredients: [{ ingredientName: 'lentejas' }] }], [
      { covers: 'cuchara', names: ['Lentejas estofadas'] },
      { covers: 'pescado', names: ['Lubina', 'Ramen'] },
    ])
    expect(r.ok).toBe(false)
    expect(r.rows[0]).toMatchObject({ card: 'Lentejas estofadas', vegetarianCard: 'Lentejas estofadas' })
    const text = formatDeckCheck(r, 'prueba')
    expect(text).toContain('NO existe Lubina')
    expect(text).toContain('← FALLA: ningún nombre existe')
    expect(text).toContain('FALLA: hay filas sin ningún nombre que exista.')
    expect(rowOf('Falafel')).toBe(TASTE_STARTER_DECK.findIndex((row) => row.covers === 'frito'))
  })
})

describe('the deck', () => {
  const noAi = vi.fn(async () => null)
  const run = (verdicts: Array<{ recipeId: string; verdict: string }>, extra: Partial<Parameters<typeof nextBatch>[0]> = {}) =>
    nextBatch({ catalog: tasteCatalog, verdicts, excludeIds: new Set(), avoid: new Set(), limit: 10, pick: noAi, ...extra })

  it('the production catalogue has every row of the starter deck', () => {
    expect(starterDeck(tasteCatalog)).toHaveLength(TASTE_STARTER_DECK.length)
  })

  it('the first 10 cards are the starter deck, in order', async () => {
    const out = await run([])
    expect(out.source).toBe('starter')
    expect(out.recipes.map((r) => r.id)).toEqual(starterDeck(tasteCatalog).map((r) => r.id))
    expect(noAi).not.toHaveBeenCalled()
  })

  it('never repeats a rated recipe (skips included) and fills the deck by variety', async () => {
    const deck = starterDeck(tasteCatalog)
    const verdicts = deck.slice(0, 4).map((r, i) => ({ recipeId: r.id, verdict: i === 0 ? 'skip' : 'like' }))
    const out = await run(verdicts)
    const ids = out.recipes.map((r) => r.id)
    expect(out.source).toBe('starter')
    expect(ids).toHaveLength(10)
    for (const v of verdicts) expect(ids).not.toContain(v.recipeId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('after the starter deck, Claude picks the next batch from the answers', async () => {
    const verdicts = starterDeck(tasteCatalog).map((r) => ({ recipeId: r.id, verdict: r.name.includes('Boquerones') ? 'nope' : 'like' }))
    const create = fakeModel('{"picks":[3,1,2]}')
    const pick = vi.fn((input: Parameters<typeof pickNextWithClaude>[0]) => pickNextWithClaude(input, { create }))
    const out = await run(verdicts, { pick })
    expect(out.source).toBe('ai')
    const prompt = (create.mock.calls[0] as any)[0].messages[0].content as string
    expect(prompt).toContain('Boquerones fritos')
    expect(prompt).toContain('NO para mí')
    const candidates = pick.mock.calls[0][0].candidates
    expect(out.recipes.slice(0, 3).map((r) => r.id)).toEqual([candidates[2].id, candidates[0].id, candidates[1].id])
    expect(out.recipes).toHaveLength(10)
    const rated = new Set(verdicts.map((v) => v.recipeId))
    for (const r of out.recipes) expect(rated.has(r.id)).toBe(false)
  })

  it('when Claude fails, the variety order', async () => {
    const verdicts = starterDeck(tasteCatalog).map((r) => ({ recipeId: r.id, verdict: 'like' }))
    const create = vi.fn(async () => {
      throw new Error('overloaded')
    })
    const out = await run(verdicts, { pick: (input) => pickNextWithClaude(input, { create }) })
    expect(out.source).toBe('variety')
    expect(out.recipes).toHaveLength(10)
  })

  it('a slow model also falls back', async () => {
    const create = vi.fn(() => new Promise<any>(() => {}))
    const ids = await pickNextWithClaude({ candidates: tasteCatalog.slice(0, 5), answered: [], limit: 3 }, { create, timeoutMs: 20 })
    expect(ids).toBeNull()
  })

  it('an avoided protein group is not shown (3 «No para mí» in a row of meat)', async () => {
    const out = await run([], { avoid: new Set(['carne']) })
    expect(out.recipes.length).toBe(10)
    for (const r of out.recipes) expect(proteinGroup(r)).not.toBe('carne')
  })

  it('variety: two cards in a row never share kind of dish and protein when there is choice', () => {
    const order = varietyOrder(tasteCatalog).slice(0, 12)
    for (let i = 1; i < order.length; i++) {
      const same = toCard(order[i]).meta.split(' · ')[0] === toCard(order[i - 1]).meta.split(' · ')[0] && proteinGroup(order[i]) === proteinGroup(order[i - 1])
      expect(same).toBe(false)
    }
  })

  it('normalizePicks keeps valid, unique numbers', () => {
    expect(normalizePicks({ picks: [2, 2, 99, '1', 'x'] }, tasteCatalog.slice(0, 3), 10)).toEqual([tasteCatalog[1].id, tasteCatalog[0].id])
    expect(normalizePicks(null, tasteCatalog, 10)).toEqual([])
  })
})

describe('«¿Qué es lo que no?» into memory', () => {
  afterEach(() => setCostSinkForTests(null))

  it('rules: «no tengo horno» → equipment without horno', () => {
    const facts = ruleBasedReasonFacts('No tengo horno', 'Coliflor gratinada')
    expect(facts).toEqual([{ key: 'equipment', value: [], remove: ['horno'] }])
    const equipment = mergeTasteFact(undefined, facts[0])
    expect(equipment).not.toContain('horno')
    expect(equipment).toEqual(DEFAULT_KITCHEN_EQUIPMENT.filter((e) => e !== 'horno'))
    expect(mergeTasteFact(['horno', 'wok'], facts[0])).toEqual(['wok'])
  })

  it('rules: «no me gusta el cilantro» → dislikes; anything else → a note', () => {
    expect(ruleBasedReasonFacts('no me gusta el cilantro', 'Ceviche')).toEqual([{ key: 'dislikes', value: ['cilantro'] }])
    expect(ruleBasedReasonFacts('la como fuera, no en casa', 'Ceviche')[0].key).toBe('notes')
    expect(ruleBasedReasonFacts('a mediodía como fuera', 'Cocido madrileño')).toEqual([{ key: 'prep_habits', value: ['a mediodía como fuera'] }])
    expect(mergeTasteFact(['pimiento'], { key: 'dislikes', value: ['Cilantro', 'pimiento'] })).toEqual(['pimiento', 'Cilantro'])
  })

  it('Claude reads the free text like update_memory, and the household pays it', async () => {
    const rows: CostRow[] = []
    setCostSinkForTests(async (r) => {
      rows.push(r)
    })
    const create = fakeModel('{"facts":[{"key":"equipment","value":[],"remove":["horno"]},{"key":"restrictions","value":["gluten"]}]}')
    const facts = await analyseTasteReason('no tengo horno', 'Coliflor gratinada', { create })
    expect(facts).toEqual([{ key: 'equipment', value: [], remove: ['horno'] }])
    expect(rows[0]).toMatchObject({ feature: 'taste_reason', provider: 'anthropic' })
  })

  it('without a usable answer the user’s words stay as a note', async () => {
    const facts = await analyseTasteReason('es que me recuerda a mi suegra', 'Cocido madrileño', { create: fakeModel('nada') })
    expect(facts).toEqual([{ key: 'notes', value: ['Sobre Cocido madrileño: es que me recuerda a mi suegra'] }])
    expect(normalizeReasonFacts({ facts: [{ key: 'physical.age', value: [30] }] })).toEqual([])
  })
})

describe('offers', () => {
  it('«Novedad» once for accounts with no verdicts; the card after «Ahora no» until dismissed', () => {
    expect(tasteOffers({ onboardingDone: true, verdictCount: 0, state: {} })).toEqual({ showIntro: true, showCard: false })
    expect(tasteOffers({ onboardingDone: false, verdictCount: 0, state: {} }).showIntro).toBe(false)
    expect(tasteOffers({ onboardingDone: true, verdictCount: 1, state: {} }).showIntro).toBe(false)
    expect(tasteOffers({ onboardingDone: true, verdictCount: 0, state: { onboardingAt: 'x' } }).showIntro).toBe(false)
    expect(tasteOffers({ onboardingDone: true, verdictCount: 0, state: { introAt: 'x', introChoice: 'later' } })).toEqual({ showIntro: false, showCard: true })
    expect(tasteOffers({ onboardingDone: true, verdictCount: 0, state: { introAt: 'x', introChoice: 'later', cardDismissedAt: 'y' } }).showCard).toBe(false)
    expect(tasteOffers({ onboardingDone: true, verdictCount: 2, state: { introAt: 'x', introChoice: 'later' } }).showCard).toBe(false)
  })
})

describe('the menu generator with the verdicts', () => {
  const pool: RecipeWithCourse[] = (catalog as any[]).map((r, i) => ({
    id: `r${i}`,
    name: r.name,
    meals: r.meals,
    seasons: r.seasons,
    mealFit: r.mealFit ?? undefined,
    seasonFit: r.seasonFit ?? undefined,
    frequency: null,
    tags: [],
    allergens: r.allergens,
    course: null,
    ingredients: r.ingredients.map((n: string, j: number) => ({ ingredientId: `i${i}-${j}`, ingredientName: n, quantity: 100, unit: 'g', allergenTags: [] })),
  }))
  const target = pool.find((r) => r.meals.includes('lunch') && r.meals.includes('dinner'))!.id
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  afterEach(() => vi.restoreAllMocks())
  const share = (rows: Array<{ recipeId: string; verdict: string }>) => {
    const rated = withHouseholdRatings(new Set(), new Set(), withVerdicts(householdRatingSets([]), verdictSets(rows)))
    vi.spyOn(Math, 'random').mockImplementation(seeded(7))
    let n = 0
    for (let i = 0; i < 300; i++) {
      const days = buildRandomMenu(defaultTemplate(), pool, 'autumn', [], rated.favoriteRecipeIds, {}, undefined, rated.bannedRecipeIds, undefined, undefined, undefined, undefined, undefined, undefined, rated.likedRecipeIds).days
      if (days.some((d) => Object.values(d).some((s) => (s?.dishes ?? []).some((x) => x.kind === 'recipe' && x.recipeId === target)))) n++
    }
    vi.restoreAllMocks()
    return n / 300
  }

  it('«No para mí» (of anyone in the household) never comes out', () => {
    expect(share([{ recipeId: target, verdict: 'nope' }])).toBe(0)
    // Another member's «Me encanta» doesn't beat it.
    expect(share([{ recipeId: target, verdict: 'nope' }, { recipeId: target, verdict: 'love' }])).toBe(0)
  })

  it('«Me encanta» weighs like a favourite; «Me apetece» a little more than nothing', () => {
    const love = withVerdicts(householdRatingSets([]), verdictSets([{ recipeId: target, verdict: 'love' }]))
    expect(love.boost.has(target)).toBe(true)
    const sLove = share([{ recipeId: target, verdict: 'love' }])
    const sLike = share([{ recipeId: target, verdict: 'like' }])
    const sNone = share([])
    expect(sLove).toBeGreaterThan(sLike)
    expect(sLike).toBeGreaterThan(sNone)
  })
})
