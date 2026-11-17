/**
 * PRO-1140 — the equipment filter counts appliances only. Before, a
 * household's list of 5 appliances was taken as its whole kitchen: any
 * recipe asking for a sartén, cazuela, bol or olla was out, ~17 recipes
 * were left and the menu came out the same every week.
 *
 * The catalogue here is the 243 names and ingredients of the 2026-10-22
 * snapshot; that snapshot has no equipment or times, so they are set below
 * by rule (oven for «al horno», «gratinado»…; pans and pots otherwise), with
 * about 4 in 10 recipes within 30 minutes. The household's 5 appliances are
 * written by hand (no ficha is read).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appliancesIn, classifyEquipment, unknownEquipmentCounts } from '@ona/shared'
import catalog1022 from './fixtures/catalog-2026-10-22.json'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'
import { matchRecipes, normaliseEquipment, type MatcherOptions } from '../services/recipeMatcher.js'

/** A household with 5 appliances and no oven, written as people write them. */
const HOUSEHOLD_EQUIPMENT = ['Freidora de aire', 'Microondas', 'Olla exprés', 'Batidora', 'Thermomix']
const owned = new Set(HOUSEHOLD_EQUIPMENT.map(normaliseEquipment))

const base: MatcherOptions = {
  meal: 'lunch',
  season: 'autumn',
  usedRecipeIds: new Set(),
  restrictions: [],
  favoriteRecipeIds: new Set(),
}

const recipe = (id: string, equipment: string[], totalTime = 20): RecipeWithCourse => ({
  id,
  name: id,
  meals: ['lunch', 'dinner'],
  seasons: [],
  tags: [],
  equipment,
  totalTime,
  course: null,
  ingredients: [],
})

const OVEN_RE = /(al horno|horneado|asad|gratinad|pizza|lasa[nñ]a|canelones|bizcocho|tarta|quiche|empanada|rellen)/i
const UTENSIL_SETS = [['sartén'], ['cazuela'], ['olla', 'bol'], ['sartén', 'cazuela'], ['Sartén grande', 'tabla', 'cuchillo'], ['cazo'], ['bol', 'varillas']]
const APPLIANCE_EXTRAS = [['batidora'], ['olla express'], ['freidora de aire'], ['robot de cocina'], ['microondas'], ['plancha eléctrica']]

/** The 243 recipes, lunch and dinner, every season, equipment and times by rule. */
const catalogue: RecipeWithCourse[] = (catalog1022 as Array<{ name: string; allergens: string[]; ingredients: string[] }>).map((r, i) => {
  const equipment = [...UTENSIL_SETS[i % UTENSIL_SETS.length]]
  if (OVEN_RE.test(r.name)) equipment.unshift('horno')
  else if (i % 9 === 0) equipment.push(...APPLIANCE_EXTRAS[(i / 9) % APPLIANCE_EXTRAS.length])
  // 4 in 10 within 30 minutes (15, 20, 25, 30), the rest 40–90.
  const totalTime = i % 10 < 4 ? 15 + 5 * (i % 4) : 40 + 10 * (i % 6)
  return {
    id: `r${i}`,
    name: r.name,
    meals: ['lunch', 'dinner'],
    seasons: [],
    tags: [],
    equipment,
    totalTime,
    allergens: r.allergens,
    course: null,
    ingredients: r.ingredients.map((n, j) => ({ ingredientId: `i${i}-${j}`, ingredientName: n, quantity: 100, unit: 'g', allergenTags: [] })),
  }
})

/** Deterministic Math.random, so the two weeks below are always the same draw. */
function seedRandom(seed: number) {
  let s = seed >>> 0
  vi.spyOn(Math, 'random').mockImplementation(() => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  })
}

function weekRecipeIds(): string[] {
  const thirty = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, { mode: 'total' as const, minutes: 30 }]))
  const { days } = buildRandomMenu(
    defaultTemplate(), catalogue, 'autumn', [], new Set(), {}, undefined, undefined, undefined, [], owned, thirty,
  )
  return days.flatMap((d) => Object.values(d).flatMap((slot) => (slot?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeId] : []))))
}

afterEach(() => vi.restoreAllMocks())

describe('equipment vocabulary (@ona/shared)', () => {
  it('tells appliances from utensils, however they are written', () => {
    expect(classifyEquipment('Horno precalentado')).toEqual({ kind: 'appliance', name: 'horno' })
    expect(classifyEquipment('Olla exprés')).toEqual({ kind: 'appliance', name: 'olla express' })
    expect(classifyEquipment('Thermomix')).toEqual({ kind: 'appliance', name: 'robot de cocina' })
    expect(classifyEquipment('Air fryer')).toEqual({ kind: 'appliance', name: 'freidora de aire' })
    for (const u of ['sartén', 'Cazuela de barro', 'olla', 'bol', 'Bandeja de horno', 'papel de horno', 'tabla']) {
      expect(classifyEquipment(u), u).toEqual({ kind: 'utensil' })
    }
    expect(appliancesIn(HOUSEHOLD_EQUIPMENT)).toEqual(['freidora de aire', 'microondas', 'olla express', 'batidora', 'robot de cocina'])
  })

  it('counts the words neither list knows, for Cocina', () => {
    const counts = unknownEquipmentCounts([{ equipment: ['sartén', 'Sifón'] }, { equipment: ['sifón', 'sifon', 'horno'] }, { equipment: null }])
    expect(counts).toEqual([{ name: 'sifon', recipes: 2 }])
  })
})

describe('matchRecipes: only appliances filter (PRO-1140)', () => {
  it('a recipe with sartén and cazuela passes for a household of 5 appliances', () => {
    expect(matchRecipes([recipe('pan', ['sartén', 'cazuela'])], { ...base, availableEquipment: owned })).toHaveLength(1)
  })

  it('a recipe with the oven does not, when the household has no oven', () => {
    expect(matchRecipes([recipe('oven', ['horno', 'bandeja'])], { ...base, availableEquipment: owned })).toHaveLength(0)
  })

  it('an appliance the household has passes, written another way', () => {
    expect(matchRecipes([recipe('robot', ['robot de cocina', 'bol'])], { ...base, availableEquipment: owned })).toHaveLength(1)
  })

  it('an unknown equipment word does not filter', () => {
    expect(matchRecipes([recipe('sifon', ['sifón'])], { ...base, availableEquipment: owned })).toHaveLength(1)
  })

  it('«sin horno» from the ficha still takes out «Horno precalentado»', () => {
    const out = matchRecipes([recipe('oven', ['Horno precalentado']), recipe('pan', ['sartén'])], { ...base, unavailableEquipment: new Set(['horno']) })
    expect(out.map((r) => r.id)).toEqual(['pan'])
  })
})

describe('the household of 5 appliances over the catalogue', () => {
  const opts: MatcherOptions = { ...base, availableEquipment: owned, timeBudget: { mode: 'total', minutes: 30 } }

  it('keeps at least 60 recipes within 30 minutes (the old rule kept almost none)', () => {
    expect(matchRecipes(catalogue, opts).length).toBeGreaterThanOrEqual(60)
    // Before PRO-1140: every equipment line had to be in the household's list.
    const oldRule = catalogue.filter((r) => (r.totalTime ?? 0) <= 30 && (r.equipment ?? []).every((e) => owned.has(normaliseEquipment(e))))
    expect(oldRule.length).toBeLessThan(20)
  })

  it('two weeks in a row share at most 4 of their 14 dishes (10 draws)', () => {
    for (let seed = 1; seed <= 10; seed++) {
      seedRandom(1140 * seed)
      const first = weekRecipeIds()
      const second = weekRecipeIds()
      expect(first).toHaveLength(14)
      expect(second).toHaveLength(14)
      const shared = second.filter((id) => first.includes(id))
      expect(shared.length, `seed ${seed}`).toBeLessThanOrEqual(4)
      vi.restoreAllMocks()
    }
  })
})
