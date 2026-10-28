/**
 * PRO-348: a new question after a change to the list or the menu gets its
 * answer. The test households (2026-10-22) got «No he cambiado nada en el
 * menú… Dime qué cambio quieres» and «Como me pediste, no he tocado el
 * menú… sigue igual» to «lo mínimo para la semana del 26, en euros», and
 * «En este mensaje no he cambiado nada: solo he mirado tu lista…» to «como se
 * lo adapto a leo?».
 */
import { describe, expect, it } from 'vitest'
import { buildSystemParts, NEW_QUESTION_RULE } from '../services/assistant/systemPrompt.js'
import { runToolLoop, UNBACKED_CLAIM_NOTE } from '../services/assistant/engine.js'
import { ANSWERS_LAST_CHANGE_RE, MIMO_EVAL_CASES, mimoReplyProblems } from '../services/assistant/mimoEvalCases.js'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const byId = (id: string) => MIMO_EVAL_CASES.find((c) => c.id === id)!

describe('the prompt answers the last message (PRO-348)', () => {
  for (const mode of ['text', 'voice', 'whatsapp'] as const) {
    it(`${mode}: the rule is in the cached instructions`, () => {
      const { instructions, context } = buildSystemParts('ctx', mode)
      expect(instructions).toContain(NEW_QUESTION_RULE)
      expect(context).not.toContain(NEW_QUESTION_RULE)
    })
  }

  it('says to answer the new question, not to summarise or deny changes again', () => {
    expect(NEW_QUESTION_RULE).toMatch(/Contesta siempre a su ULTIMO mensaje/)
    expect(NEW_QUESTION_RULE).toMatch(/no vuelvas a resumirlo/)
    expect(NEW_QUESTION_RULE).toMatch(/no empieces diciendo que no has cambiado nada/)
  })

  it('the engine\'s claim note says to answer a question without talking about changes', () => {
    expect(UNBACKED_CLAIM_NOTE).toMatch(/Si su ultimo mensaje es una pregunta o no pide ningun cambio, contesta solo a esa pregunta/)
    expect(UNBACKED_CLAIM_NOTE).toMatch(/sin decir que no has cambiado nada/)
  })
})

describe('battery: a new question after a change (PRO-348)', () => {
  it('has the cases of the test households, each after a change in the previous turn', () => {
    const cases = MIMO_EVAL_CASES.filter((c) => c.check === 'pregunta-nueva')
    expect(cases.map((c) => c.id)).toEqual(['minimo-euros-tras-cambio', 'adaptar-leo-tras-lista'])
    for (const c of cases) expect(c.history.at(-1)!.content).toMatch(/^⟦hecho: /)
    expect(byId('adaptar-leo-tras-lista').message).toBe('como se lo adapto a leo?')
  })

  it('the replies Mimo gave fail', () => {
    expect(mimoReplyProblems(byId('minimo-euros-tras-cambio').badReply, byId('minimo-euros-tras-cambio'))).toEqual(['contesta-lo-anterior', 'no-confirma'])
    expect(mimoReplyProblems(byId('adaptar-leo-tras-lista').badReply, byId('adaptar-leo-tras-lista'))).toEqual(['contesta-lo-anterior', 'no-confirma'])
    expect(mimoReplyProblems('Como me pediste, no he tocado el menú: sigue igual.', byId('minimo-euros-tras-cambio'))).toContain('contesta-lo-anterior')
  })

  it('repeating the previous turn\'s «Hecho:» fails even with the answer', () => {
    const c = byId('minimo-euros-tras-cambio')
    expect(mimoReplyProblems('Hecho:\n- Miércoles 28, cena: Pollo al horno\nLo mínimo, unos 75 €.', c)).toEqual(['contesta-lo-anterior'])
  })

  it('a reply that answers the question passes', () => {
    expect(mimoReplyProblems('Con la lista de esa semana, lo mínimo serían entre 75 y 95 €.', byId('minimo-euros-tras-cambio'))).toEqual([])
    expect(
      mimoReplyProblems('Aparta su ración antes de salar y chafa un poco las lentejas con el tenedor para que las coja con la mano.', byId('adaptar-leo-tras-lista')),
    ).toEqual([])
  })

  it('the pattern leaves alone a reply about cooking or money', () => {
    expect(ANSWERS_LAST_CHANGE_RE.test(fold('Para Leo, sin sal y bien chafadas. La zanahoria, en trocitos blandos.'))).toBe(false)
    expect(ANSWERS_LAST_CHANGE_RE.test(fold('Unos 80 € para la semana del 26.'))).toBe(false)
  })
})

describe('the claim retry on a question (PRO-348)', () => {
  it('a question answered with a «ya está…» claim gets the note and the answer goes out', async () => {
    const replies = [
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ya está cambiado el miércoles. Lo mínimo, unos 80 €.' }], usage: {} },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Lo mínimo para esa semana, unos 80 €.' }], usage: {} },
    ]
    const calls: any[] = []
    const client = { messages: { create: async (args: any) => (calls.push(structuredClone(args)), replies.shift()) } }
    const r = await runToolLoop({ client, system: 's', tools: [], messages: [{ role: 'user', content: 'y lo mínimo en euros?' }], skills: [], ctx: { userId: 'u', db: null, channel: 'whatsapp' } as any })
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(calls[1].messages.at(-1))).toContain('contesta solo a esa pregunta')
    expect(r.message).toBe('Lo mínimo para esa semana, unos 80 €.')
  })
})
