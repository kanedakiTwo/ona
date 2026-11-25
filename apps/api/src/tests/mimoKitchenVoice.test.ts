/**
 * D-1028 · the kitchen manifesto in Mimo's voice: a friend who cooks well and
 * fast (the shortcut, «haz el doble y congela la mitad», the twist of the
 * world with what's at home, the children's version), no health promises,
 * and never an everyday dish of more than 30 minutes of work without saying
 * so. The rule is constant text in the cached instructions.
 */
import { describe, expect, it } from 'vitest'
import { buildSystemParts, KITCHEN_VOICE_RULE } from '../services/assistant/systemPrompt.js'
import { MIMO_EVAL_CASES, mimoReplyProblems, workMinutesNamed } from '../services/assistant/mimoEvalCases.js'

const byId = (id: string) => MIMO_EVAL_CASES.find((c) => c.id === id)!

describe('the rule', () => {
  for (const mode of ['text', 'voice', 'whatsapp'] as const) {
    it(`${mode}: in the cached instructions, never in the per-user context`, () => {
      const { instructions, context } = buildSystemParts('ctx', mode)
      expect(instructions).toContain(KITCHEN_VOICE_RULE)
      expect(context).not.toContain(KITCHEN_VOICE_RULE)
    })
  }
  it('says the manifesto: shortcut, double and freeze, the world, children, 30 min of work, no health promises', () => {
    expect(KITCHEN_VOICE_RULE).toMatch(/amigo que cocina bien y rapido/)
    expect(KITCHEN_VOICE_RULE).toMatch(/atajo/)
    expect(KITCHEN_VOICE_RULE).toMatch(/haz el doble y congela la mitad/)
    expect(KITCHEN_VOICE_RULE).toMatch(/giro del mundo/)
    expect(KITCHEN_VOICE_RULE).toMatch(/sin picante y la salsa aparte/)
    expect(KITCHEN_VOICE_RULE).toMatch(/30 minutos de trabajo/)
    expect(KITCHEN_VOICE_RULE).toMatch(/Sin promesas de salud/)
  })
  it('never says «sano», «sana» or «saludable» (kb and social replies forbid them)', () => {
    expect(KITCHEN_VOICE_RULE).not.toMatch(/\b(sano|sana|sanos|sanas|saludables?)\b/i)
  })
})

describe('battery: cocina-rapida', () => {
  it('has the three cases', () => {
    expect(MIMO_EVAL_CASES.filter((c) => c.check === 'cocina-rapida').map((c) => c.id)).toEqual(['cena-ligera-sin-promesas', 'curry-con-ninos', 'martes-largo-sin-decirlo'])
  })
  it('the bad replies fail, each for its reason', () => {
    expect(mimoReplyProblems(byId('cena-ligera-sin-promesas').badReply, byId('cena-ligera-sin-promesas'))).toEqual(['promesa-salud'])
    expect(mimoReplyProblems(byId('curry-con-ninos').badReply, byId('curry-con-ninos'))).toEqual(['sin-version-ninos'])
    expect(mimoReplyProblems(byId('martes-largo-sin-decirlo').badReply, byId('martes-largo-sin-decirlo'))).toEqual(['largo-sin-decirlo'])
  })
  it('good replies pass', () => {
    expect(mimoReplyProblems('Una tortilla de calabacín con ensalada: 15 minutos y lista.', byId('cena-ligera-sin-promesas'))).toEqual([])
    expect(
      mimoReplyProblems('Dora el pollo, añade la pasta de curry rojo y la leche de coco, 15 minutos. Para los niños, aparta su parte antes del curry y les pones la salsa aparte.', byId('curry-con-ninos')),
    ).toEqual([])
    expect(mimoReplyProblems('Unas albóndigas en salsa de tomate de bote: 20 min de trabajo. Y si tienes más tiempo el finde, lasaña.', byId('martes-largo-sin-decirlo'))).toEqual([])
    expect(mimoReplyProblems('Lasaña casera: 75 min de trabajo, mejor para un festivo o el fin de semana.', byId('martes-largo-sin-decirlo'))).toEqual([])
  })
  it('reads the minutes of work named', () => {
    expect(workMinutesNamed('son 75 min de trabajo')).toBe(75)
    expect(workMinutesNamed('1 h de trabajo y 2 h de horno')).toBe(60)
    expect(workMinutesNamed('2 h en total')).toBe(0)
  })
})
