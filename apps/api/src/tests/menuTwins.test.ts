/**
 * PRO-390 — gemelos de los hogares reales (specs/smart-menu.md): only fixed
 * options (never free text), allergies drawn from the beta's and never the
 * household's own, and no combination of fewer than 3 households.
 */
import { describe, expect, it } from 'vitest'
import { COOKING_STYLES, WEEKDAY_COOKING_CHOICES } from '@ona/shared'
import {
  TWIN_ALLERGIES, TWIN_BUDGETS, TWIN_CUISINES, TWIN_DIETS, TWIN_MIN_GROUP,
  buildTwins, drawTwins, groupProfiles, ownAllergies, profileKey, twinProfile, twinSignup, type Rng, type TwinSource,
} from '../services/menuTwins.js'

const source = (over: Partial<TwinSource> = {}): TwinSource => ({
  adults: 2, kidsCount: 0, restrictions: [], cookingStyle: 'daily', timeAvailable: undefined,
  weeklyBudgetEur: null, cuisineBias: null, swappedTypes: [], ...over,
})

/** A seeded dice, so a failure can be replayed. */
function seeded(seed: number): Rng {
  let s = seed
  return (n) => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s % n
  }
}

const countBy = (keys: string[]) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())

describe('twinProfile: only fixed options', () => {
  it('drops every free text: notes, unknown cuisines, unknown dish types, an odd cooking style', () => {
    const p = twinProfile(source({
      adults: 7, kidsCount: 5,
      restrictions: ['vegano', 'kiwi de mi abuela Pepa', 'sin gluten'],
      cookingStyle: 'cocino cuando me llama Juan',
      timeAvailable: { lunes: { mode: 'total', minutes: 25 } },
      weeklyBudgetEur: 85,
      cuisineBias: { 'Española': 90, 'la de mi pueblo': 100, italiana: 70, mexicana: 20 },
      swappedTypes: ['tipo:frito', 'tipo:frito', 'tipo:guiso', 'lentejas de Pepa', 'lentejas de Pepa', 'tipo:x y z', 'tipo:x y z'],
    }))
    expect(p).toEqual({
      adults: 4, kidsCount: 2, diet: 'vegana', cookingStyle: null, weekdayCooking: 'rapido', budget: '60_100',
      cuisines: ['espanola', 'italiana'], swapsOut: ['tipo:frito'],
    })
    expect(JSON.stringify(p)).not.toMatch(/Pepa|Juan|pueblo|kiwi|gluten/)
  })

  it('every field comes from a closed list', () => {
    const p = twinProfile(source({ restrictions: ['vegetariano'], cookingStyle: 'batch', timeAvailable: { lunes: { mode: 'activo', minutes: 15 } }, weeklyBudgetEur: 40 }))
    expect(TWIN_DIETS).toContain(p.diet)
    expect(COOKING_STYLES).toContain(p.cookingStyle)
    expect(WEEKDAY_COOKING_CHOICES).toContain(p.weekdayCooking)
    expect(TWIN_BUDGETS).toContain(p.budget)
    expect(p).toMatchObject({ diet: 'vegetariana', weekdayCooking: 'poco_trabajo', budget: 'hasta_60' })
  })
})

describe('ownAllergies', () => {
  it('finds the chips, written either way, and those sharing an allergen', () => {
    expect(ownAllergies(['Sin Gluten', 'huevos'])).toEqual(expect.arrayContaining(['sin gluten', 'huevo']))
    expect(ownAllergies(['marisco'])).toContain('marisco')
    expect(ownAllergies(['vegano', 'kiwi'])).toEqual([])
  })
})

describe('groupProfiles: no combination of fewer than 3 households', () => {
  const base = twinProfile(source())
  it('a single one takes the most similar combination', () => {
    const near = { ...base, budget: 'hasta_60' as const }
    const far = { ...base, adults: 1 as const, diet: 'vegana' as const }
    const out = groupProfiles([base, base, base, far, far, far, near])!
    expect(out[6]).toEqual(base)
    expect([...countBy(out.map(profileKey)).values()].every((n) => n >= TWIN_MIN_GROUP)).toBe(true)
  })

  it('nothing comes out with fewer than 3 households in all', () => {
    expect(groupProfiles([base, base])).toBeNull()
    expect(buildTwins([source(), source()])).toEqual([])
  })

  it('all different: merged until every combination has 3', () => {
    const many = Array.from({ length: 10 }, (_, i) => twinProfile(source({ adults: (i % 4) + 1, kidsCount: i % 3, weeklyBudgetEur: 30 + i * 15 })))
    const out = groupProfiles(many)!
    expect(out).toHaveLength(10)
    expect([...countBy(out.map(profileKey)).values()].every((n) => n >= TWIN_MIN_GROUP)).toBe(true)
  })
})

describe('buildTwins', () => {
  const beta: TwinSource[] = [
    source({ restrictions: ['sin gluten'] }),
    source({ restrictions: ['huevo', 'frutos secos'] }),
    source({ restrictions: ['marisco'] }),
    source({ restrictions: ['sin lactosa', 'pescado'], adults: 1 }),
    source({ restrictions: [], adults: 1 }),
    source({ restrictions: ['soja'], adults: 1 }),
    source({ restrictions: ['vegetariano', 'pescado'], kidsCount: 2, cookingStyle: 'batch' }),
  ]

  it('allergies: drawn from the beta\'s, never the household\'s own', () => {
    const pool = new Set(beta.flatMap((s) => ownAllergies(s.restrictions)))
    let drawn = 0
    for (let seed = 1; seed <= 300; seed++) {
      const twins = drawTwins(beta, seeded(seed))
      expect(twins).toHaveLength(beta.length)
      twins.forEach((t, i) => {
        const own = ownAllergies(beta[i].restrictions)
        for (const a of t.allergies) {
          expect(pool.has(a)).toBe(true)
          expect(own).not.toContain(a)
          drawn++
        }
      })
    }
    expect(drawn).toBeGreaterThan(0)
  })

  it('a household with every allergy of the beta but one can only get that one', () => {
    const allButSoja = TWIN_ALLERGIES.filter((a) => a !== 'soja')
    const sources = [source({ restrictions: [...allButSoja] }), source({ restrictions: ['soja'] }), source({ restrictions: ['soja', 'huevo'] })]
    for (let seed = 1; seed <= 100; seed++) {
      const [first] = drawTwins(sources, seeded(seed))
      expect(first.allergies.every((a) => a === 'soja')).toBe(true)
    }
  })

  it('nothing but closed-list fields, and no combination of fewer than 3', () => {
    const twins = buildTwins(beta.map((s) => ({ ...s, restrictions: [...s.restrictions, 'nota: mi hija Ana'], cuisineBias: { 'casa de Ana': 100 } })), seeded(7))
    const allowed = ['adults', 'kidsCount', 'diet', 'cookingStyle', 'weekdayCooking', 'budget', 'cuisines', 'swapsOut', 'allergies']
    for (const t of twins) {
      expect(Object.keys(t).sort()).toEqual([...allowed].sort())
      for (const a of t.allergies) expect(TWIN_ALLERGIES).toContain(a)
      for (const c of t.cuisines) expect(TWIN_CUISINES).toContain(c)
    }
    expect(JSON.stringify(twins)).not.toMatch(/Ana|nota/)
    expect([...countBy(twins.map(profileKey)).values()].every((n) => n >= TWIN_MIN_GROUP)).toBe(true)
  })
})

describe('twinSignup (the staging script)', () => {
  it('the sign-up answers and memory facts of a twin; the dish types it swaps stay out', () => {
    const out = twinSignup({ adults: 1, kidsCount: 0, diet: 'vegetariana', cookingStyle: null, weekdayCooking: 'poco_trabajo', budget: '60_100', cuisines: ['italiana'], swapsOut: ['tipo:frito'], allergies: ['frutos secos'] })
    expect(out).toEqual({
      onboarding: { adults: 1, kidsCount: 0, cookingStyle: 'daily', weekdayCooking: 'poco_trabajo', restrictions: ['vegetariano', 'frutos secos'], healthConsent: true },
      facts: [{ key: 'weekly_budget_eur', value: 80 }, { key: 'cuisine_bias', value: { italiana: 80 } }],
    })
    expect(twinSignup({ adults: 2, kidsCount: 0, diet: 'omnivora', cookingStyle: 'batch', weekdayCooking: null, budget: 'sin_dato', cuisines: [], swapsOut: [], allergies: [] }))
      .toEqual({ onboarding: { adults: 2, kidsCount: 0, cookingStyle: 'batch', restrictions: [], healthConsent: false }, facts: [] })
  })
})
