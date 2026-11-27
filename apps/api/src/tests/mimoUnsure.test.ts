/**
 * PRO-1338 (D-1029) · «No estoy seguro» en primera persona cuando importa: la
 * regla del prompt (`UNSURE_RULE`) y sus dos casos en el examen fijo de Mimo
 * (`MIMO_EXAM_ADDED_CASES`): un producto de marca con un alérgeno dudoso y
 * una dieta poco común.
 */
import { describe, expect, it } from 'vitest'
import { ALLERGEN_CHECK_RULE, UNSURE_RULE, buildSystemParts } from '../services/assistant/systemPrompt.js'
import { MIMO_EXAM_CASES } from '../services/assistant/mimoExamCases.js'
import { MIMO_EXAM_ADDED_CASES, MIMO_EXAM_ALL_CASES } from '../services/assistant/mimoExamAddedCases.js'
import { EXAM_CRITERIA, JUDGE_SYSTEM, codeAnswerOf, examOnboarding } from '../services/assistant/mimoExam.js'
import { runExam, type MessagesLike } from '../services/assistant/mimoExamRun.js'
import { toolsFor } from '../services/assistant/skills.js'

describe('la regla', () => {
  for (const mode of ['text', 'voice', 'whatsapp'] as const) {
    it(`${mode}: va en las instrucciones fijas, justo después de la de alérgenos`, () => {
      const { instructions, context } = buildSystemParts('ctx', mode)
      expect(instructions).toContain(`${ALLERGEN_CHECK_RULE}\n${UNSURE_RULE}`)
      expect(context).not.toContain(UNSURE_RULE)
    })
  }

  it('en primera persona, con cómo comprobarlo y sin afirmar ni el impersonal', () => {
    expect(UNSURE_RULE).toMatch(/dieta o la salud/)
    expect(UNSURE_RULE).toMatch(/producto de marca[\s\S]*gluten/)
    expect(UNSURE_RULE).toMatch(/primera persona, "No estoy seguro/)
    expect(UNSURE_RULE).toMatch(/la etiqueta del envase/)
    expect(UNSURE_RULE).toMatch(/quien le indico la dieta/)
    expect(UNSURE_RULE).toMatch(/Nunca lo afirmes ni lo niegues/)
    expect(UNSURE_RULE).toMatch(/impersonal/)
  })
})

describe('los dos casos del examen', () => {
  it('son dos, con su forma, y no repiten un id de los 75', () => {
    expect(MIMO_EXAM_ADDED_CASES.map((c) => c.id)).toEqual(['duda-001', 'duda-002'])
    expect(MIMO_EXAM_ALL_CASES).toHaveLength(MIMO_EXAM_CASES.length + 2)
    expect(new Set(MIMO_EXAM_ALL_CASES.map((c) => c.id)).size).toBe(MIMO_EXAM_ALL_CASES.length)
    for (const c of MIMO_EXAM_ADDED_CASES) {
      expect(c.criterio_principal).toBe('verdad_comprobada')
      expect(EXAM_CRITERIA).toContain(c.criterio_principal)
      expect(c.debe.some((d) => /no está seguro/.test(d)), c.id).toBe(true)
      expect(c.no_debe.some((d) => /impersonal/.test(d)), c.id).toBe(true)
      expect(c.sin_modelo).toBe(false)
      expect(codeAnswerOf(c), c.id).toBeNull()
    }
    expect(MIMO_EXAM_ADDED_CASES[0].mensaje).toMatch(/marca[\s\S]*gluten/)
    expect(MIMO_EXAM_ADDED_CASES[1].hogar).toMatch(/baja en histamina/)
  })

  it('no llevan teléfonos, correos ni enlaces', () => {
    expect(JSON.stringify(MIMO_EXAM_ADDED_CASES)).not.toMatch(/https?:\/\/|www\.|@[a-z]|\+34|\b\d{3} ?\d{3} ?\d{3}\b/i)
  })

  it('cada herramienta esperada existe en su canal', () => {
    for (const c of MIMO_EXAM_ADDED_CASES) {
      const mode = c.canal === 'app' ? 'text' : 'whatsapp'
      const names = new Set(toolsFor({ mode, onboarding: examOnboarding(c) } as never).map((s) => s.name))
      for (const t of c.herramientas) expect(names.has(t), `${c.id}: ${t}`).toBe(true)
    }
  })

  it('pasan por el motor y el corrector, con su nota y su precio', async () => {
    const client: MessagesLike = {
      messages: {
        async create(args: any) {
          if (args.system === JUDGE_SYSTEM) {
            const verdict = Object.fromEntries(['hecho_entero', 'respeta_la_casa', 'platos_con_sentido', 'corto_sin_relleno', 'verdad_comprobada'].map((k) => [k, { nota: 2, porque: 'ok' }]))
            return { content: [{ type: 'text', text: JSON.stringify(verdict) }], stop_reason: 'end_turn' }
          }
          const histamina = JSON.stringify(args.system).includes('histamina')
          const answered = args.messages.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'))
          if (histamina && !answered) return { content: [{ type: 'tool_use', id: 'tu_1', name: 'get_recipe_details', input: {} }], stop_reason: 'tool_use' }
          return { content: [{ type: 'text', text: 'No estoy seguro. Míralo en la etiqueta del envase.' }], stop_reason: 'end_turn' }
        },
      },
    }
    const { resumen, casos } = await runExam(MIMO_EXAM_ADDED_CASES, { client, remote: true, eurPerUsd: 0.92 })
    expect(casos.filter((c) => c.error)).toEqual([])
    expect(resumen.corregidos).toBe(2)
    expect(casos.find((c) => c.id === 'duda-002')!.herramientas).toContain('get_recipe_details')
    for (const c of casos) {
      expect(c.nota, c.id).toBe(2)
      expect(c.precioEur, c.id).toBeGreaterThan(0)
    }
  })
})
