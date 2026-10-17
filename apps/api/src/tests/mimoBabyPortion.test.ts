/**
 * PRO-174 (Marta y Jorge, 2026-10-15; Leo, 10 months): Mimo salted the
 * potatoes in step 2 of a merluza al horno and only said at the end «Para
 * Leo, antes de sazonar, aparta…». With a baby at home, setting the baby's
 * portion aside is its own step, right before the salt (or spice, honey…),
 * and Mimo gives no health reasons for it.
 */
import { describe, expect, it } from 'vitest'
import { BABY_PORTION_RULE, buildSystemParts } from '../services/assistant/systemPrompt.js'
import { babyPortionOrder, MIMO_EVAL_CASES, mimoReplyProblems } from '../services/assistant/mimoEvalCases.js'

describe('the baby-portion rule is in the prompt', () => {
  for (const mode of ['text', 'voice', 'whatsapp'] as const) {
    it(`${mode}: in the cached instructions`, () => {
      const { instructions, context } = buildSystemParts('ctx', mode)
      expect(instructions).toContain(BABY_PORTION_RULE)
      expect(context).not.toContain(BABY_PORTION_RULE)
    })
  }

  it('puts «aparta la ración del bebé» as its own step before the salt, spice or honey, never at the end', () => {
    expect(BABY_PORTION_RULE).toMatch(/hay un bebe .* o te piden adaptar un plato para el/)
    expect(BABY_PORTION_RULE).toMatch(/"Aparta la racion del bebe" es un paso propio, justo antes del primer paso que añade sal, picante o pimienta, miel/)
    expect(BABY_PORTION_RULE).toMatch(/nunca al final/)
  })

  it('gives no health reasons (§6, red line 4)', () => {
    expect(BABY_PORTION_RULE).toMatch(/no expliques por que ni digas que algo es o no es bueno o seguro para el bebe/)
    expect(BABY_PORTION_RULE).not.toMatch(/riñon|rinon|sodio|botulismo|salud/i)
  })
})

describe('battery: merluza al horno with a baby at home', () => {
  const c = MIMO_EVAL_CASES.find((x) => x.id === 'merluza-horno-bebe')!

  it('is the household\'s literal question', () => {
    expect(c.check).toBe('bebe-aparta')
    expect(c.message).toBe('hoy libro. a mediodia merluza al horno con patatas para los 3. cuanto se tarda y como la hago? la de leo aparte')
    expect(c.context).toMatch(/bebe de 10 meses/)
  })

  it('the reply Mimo gave fails: it sets Leo\'s portion aside after salting', () => {
    expect(babyPortionOrder(c.badReply)).toEqual({ setAside: 4, firstSeasoning: 2 })
    expect(mimoReplyProblems(c.badReply, c)).toEqual(['aparta-tarde'])
  })

  it('a reply that sets it aside in the step before the salt passes', () => {
    const good = [
      'Unos 40-45 minutos.',
      '1. Precalienta el horno a 200 °C. Pela las patatas y córtalas en rodajas finas.',
      '2. Ponlas en una fuente con un chorro de aceite y hornéalas 20 minutos.',
      '3. Aparta la ración de Leo: un trozo de lomo y unas patatas, en otra fuente pequeña.',
      '4. Al resto échale sal y pimienta, pon encima los lomos y hornea 12-15 minutos.',
    ].join('\n')
    expect(mimoReplyProblems(good, c)).toEqual([])
  })

  it('flags a reply that never sets it aside, or that gives health reasons', () => {
    expect(mimoReplyProblems('1. Patatas con sal y aceite al horno.\n2. Merluza encima 12 minutos.', c)).toEqual(['sin-apartar'])
    expect(
      mimoReplyProblems('1. Aparta la ración de Leo, que la sal no es buena para sus riñones.\n2. Al resto, sal y pimienta.', c),
    ).toEqual(['razones-salud'])
  })
})
