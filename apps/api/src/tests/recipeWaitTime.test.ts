/**
 * PRO-1078 — the recipe's time counts the waits (resting, rising, the
 * fridge…), never a soak the night before. Cases from the hogares de prueba.
 */
import { describe, expect, it } from 'vitest'
import {
  isDayBeforeStep,
  isWaitStep,
  planWaitTime,
  totalWithWaits,
  waitFloor,
  waitStepMinutes,
} from '../services/recipeWaitTime.js'
import { planTimeTrim } from '../services/recipeTimeTrim.js'
import { computeTotalTime } from '../services/recipePersistence.js'

// «Pizza casera de jamón y queso» (Familia Ruiz, 2026-10-30): prep 30, cook 15, total 45.
const pizza = [
  { text: 'Mezcla la harina, la levadura, el agua tibia, el aceite y la sal' },
  { text: 'Amasa 10 minutos hasta que la masa quede lisa' },
  { text: 'Tapa la masa y déjala reposar 1 hora' },
  { text: 'Estira la masa, pon el tomate, el jamón y la mozzarella' },
  { text: 'Hornea 15 minutos a 220 °C' },
]
// «Hamburguesa casera» (Marta y Jorge, 2026-11-01): prep 16, cook 10, total 18.
const burger = [
  { text: 'Mezcla la carne con el huevo, el pan rallado y la sal' },
  { text: 'Forma las hamburguesas y refrigera al menos 30 minutos' },
  { text: 'Hazlas a la plancha 5 minutos por cada lado' },
]
// «Croquetas de jamón» (Familia Ruiz, 2026-11-17): the dough sleeps in the fridge.
const croquetas = [
  { text: 'Haz la bechamel con el jamón picado' },
  { text: 'Pasa la masa a una fuente, tápala y déjala en la nevera toda la noche' },
  { text: 'Forma las croquetas, rebózalas y fríelas' },
]

describe('waits', () => {
  it('resting, rising, marinating and the fridge are waits; the oven and a soak are not', () => {
    expect(isWaitStep(pizza[2])).toBe(true)
    expect(isWaitStep(burger[1])).toBe(true)
    expect(isWaitStep({ text: 'Deja levar la masa hasta que doble su volumen' })).toBe(true)
    expect(isWaitStep({ text: 'Marina el pollo 2 horas' })).toBe(true)
    expect(isWaitStep(pizza[4])).toBe(false)
    expect(isWaitStep({ text: 'Pon los garbanzos a remojo la noche antes' })).toBe(false)
    expect(isWaitStep(croquetas[1])).toBe(false)
    expect(isDayBeforeStep(croquetas[1])).toBe(true)
    expect(isDayBeforeStep({ text: 'Remojo', durationMin: 720 })).toBe(true)
  })

  it('minutes in figures or in words', () => {
    expect(waitStepMinutes(pizza[2])).toBe(60)
    expect(waitStepMinutes({ text: 'Déjala reposar una hora' })).toBe(60)
    expect(waitStepMinutes({ text: 'Déjala reposar media hora' })).toBe(30)
    expect(waitStepMinutes({ text: 'Déjala levar una hora y media' })).toBe(90)
    expect(waitStepMinutes({ text: 'Déjala reposar' })).toBeNull()
  })
})

describe('the total with its waits', () => {
  it('the pizza: 45 min → 90 (prep 30, then the dough rests 1 hour, then 15 of oven)', () => {
    expect(waitFloor(30, 15, pizza)).toBe(90)
    expect(totalWithWaits({ prepTime: 30, cookTime: 15, totalTime: 45 }, pizza)).toBe(90)
    expect(planWaitTime({ prepTime: 30, cookTime: 15, totalTime: 45 }, pizza)).toBe(90)
  })

  it('the same when the cook time already holds the rest (Mimo puts «reposo» in the cook time)', () => {
    expect(totalWithWaits({ prepTime: 30, cookTime: 75, totalTime: 105 }, pizza)).toBe(105)
    expect(waitFloor(30, 75, pizza)).toBe(90)
  })

  it('the burger: 18 min → counts the 30 in the fridge', () => {
    const t = totalWithWaits({ prepTime: 16, cookTime: 10, totalTime: 18 }, burger)!
    expect(t).toBeGreaterThanOrEqual(18 + 30)
    expect(t).toBe(16 + 10 + 30 - 8)
  })

  it('a night in the fridge or a soak is not minutes', () => {
    expect(totalWithWaits({ prepTime: 40, cookTime: 20, totalTime: 60 }, croquetas)).toBe(60)
  })

  it('a total that summed the soak loses it («COMIDA · 830 MIN»)', () => {
    const balilah = [
      { text: 'Pon los garbanzos a remojo la noche antes', durationMin: 720 },
      { text: 'Cuece los garbanzos', durationMin: 90 },
      { text: 'Aliña con el comino y el limón', durationMin: 20 },
    ]
    expect(planWaitTime({ prepTime: null, cookTime: null, totalTime: 830 }, balilah)).toBe(110)
    expect(computeTotalTime({ steps: balilah as any, prepTime: null, cookTime: null })).toBe(110)
  })

  it('without waits nothing changes, and it is idempotent', () => {
    const oven = [{ text: 'Hornear 40 minutos', durationMin: 40 }]
    expect(planWaitTime({ prepTime: 20, cookTime: 40, totalTime: 48 }, oven)).toBe(48)
    expect(planWaitTime({ prepTime: 30, cookTime: 15, totalTime: 90 }, pizza)).toBe(90)
  })

  it('a saved recipe (the house\'s, Mimo\'s) gets it too', () => {
    expect(computeTotalTime({ steps: pizza as any, prepTime: 30, cookTime: 15 })).toBe(90)
    expect(computeTotalTime({ steps: [{ text: 'Mezclar' }] as any, prepTime: 30, cookTime: 15 })).toBe(45)
  })

  it('the PRO-284 trim no longer caps the pizza at the total it had, and stays a fixed point', () => {
    const first = planTimeTrim({ prepTime: 30, cookTime: 15, activeTime: 30, totalTime: 45 }, pizza, { trimPrep: false })
    expect(first.totalTime).toBe(90)
    const again = planTimeTrim({ prepTime: 30, cookTime: 15, activeTime: first.activeTime, totalTime: 90 }, pizza, { trimPrep: false })
    expect(again.totalTime).toBe(90)
    expect(planWaitTime({ prepTime: 30, cookTime: 15, totalTime: 90 }, pizza)).toBe(90)
  })
})
