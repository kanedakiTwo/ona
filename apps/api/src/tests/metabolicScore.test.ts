/**
 * ONA's opinion in the generator (kb/10 mandamientos.md): real food, fibre
 * and many plants beat refined carbs and processed food. The fitness used
 * to optimise calories + macros only.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { menuMetabolicQuality, recipeMetabolicProfile, PLANT_VARIETY_TARGET } from '../services/metabolicScore.js'

const score = (names: string[]) => recipeMetabolicProfile(names).score

describe('recipeMetabolicProfile', () => {
  it('ranks a vegetable stew above refined pasta and a sugary dish', () => {
    const stew = score(['lentejas', 'zanahoria', 'cebolla', 'pimiento rojo', 'ajo', 'aceite de oliva virgen extra'])
    const pasta = score(['espaguetis', 'ajo', 'aceite de oliva'])
    const sweet = score(['harina de trigo', 'azúcar', 'mantequilla'])
    expect(stew).toBeGreaterThan(0.7)
    expect(pasta).toBeLessThan(0.2)
    expect(sweet).toBeLessThan(pasta)
  })

  it('penalises processed meats and refined oils', () => {
    expect(score(['salchichas', 'aceite de girasol'])).toBeLessThan(-0.5)
  })

  it('does not treat whole grains or pastes as refined', () => {
    expect(score(['harina de garbanzo'])).toBeGreaterThanOrEqual(0)
    expect(score(['pan integral', 'tomate'])).toBeGreaterThan(0)
    expect(score(['pasta de tomate', 'berenjena'])).toBeGreaterThan(0)
  })

  it('is bounded to [-1, 1] and lists distinct plants', () => {
    const p = recipeMetabolicProfile(['tomate', 'tomates cherry', 'cebolla morada', 'ajo', 'perejil'])
    expect(p.plants.sort()).toEqual(['ajo', 'cebolla', 'perejil', 'tomate'])
    expect(score(['azucar', 'harina', 'pan', 'bacon', 'margarina', 'galletas'])).toBe(-1)
  })
})

describe('menuMetabolicQuality', () => {
  const profiles = new Map([
    ['good', recipeMetabolicProfile(['garbanzos', 'espinacas', 'tomate', 'cebolla', 'ajo', 'pimiento', 'aceite de oliva'])],
    ['bad', recipeMetabolicProfile(['espaguetis', 'bacon', 'nata industrial'])],
    ['other', recipeMetabolicProfile(['brocoli', 'calabaza', 'puerro', 'salmon'])],
  ])
  const week = (ids: string[]) => ids.map((id) => ({ lunch: { dishes: [{ kind: 'recipe', recipeId: id, recipeName: id }] } })) as any

  it('a better week scores higher on quality and variety', () => {
    const good = menuMetabolicQuality(week(['good', 'other', 'good']), profiles)
    const bad = menuMetabolicQuality(week(['bad', 'bad', 'bad']), profiles)
    expect(good.quality01).toBeGreaterThan(bad.quality01)
    expect(good.variety01).toBeGreaterThan(bad.variety01)
    expect(good.variety01).toBeCloseTo(9 / PLANT_VARIETY_TARGET)
  })

  it('ignores notes and unknown recipes', () => {
    const q = menuMetabolicQuality([{ lunch: { dishes: [{ kind: 'note', text: 'fuera' }] } }] as any, profiles)
    expect(q).toEqual({ quality01: 0.5, variety01: 0 })
  })
})
