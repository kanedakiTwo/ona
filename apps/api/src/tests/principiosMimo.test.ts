/**
 * PRO-67 — Mimo's principles in cooking words (constitution §6).
 *
 * Until 2026-10-13 the whole of `kb/10 mandamientos.md` went into Mimo's
 * prompt («La inflamación sistémica es el mecanismo subyacente…», insulin as
 * the central metric, the microbiome), and three tool texts and one default
 * principle still spoke of insulin and the microbiome. Miguel rewrote the
 * principles («Cómo cocina Mimoia», 2026-10-12): `kb/principios-mimo.md`
 * goes literally into the prompt instead.
 *
 * The approved text names inflammation, insulin, glucose and the microbiome
 * once, in principle 10, only to forbid talking about them; the fixed health
 * rule (PRO-62, `HEALTH_RULE`) does the same with the §6 diseases. Those two
 * prohibitions are cut out before scanning; nothing else may say them.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ONA_PRINCIPLES } from '@ona/shared'
import { buildSystemPrompt, knowledgeBaseReady, KB_FILE } from '../services/assistant/systemPrompt.js'
import { HEALTH_RULE } from '../services/assistant/healthGuard.js'
import { skills } from '../services/assistant/skills.js'

const REPO = resolve(__dirname, '../../../..')
const KB_PATH = resolve(REPO, 'kb', KB_FILE)

/** Principle 10 of the approved text: the list is a prohibition. */
const PRINCIPLE_10_BAN = 'Nunca habla de efectos en el cuerpo: inflamación, insulina, glucosa, defensas, microbioma o peso.'

const BANNED: Array<[RegExp, string]> = [
  [/inflam/i, 'inflam…'],
  [/insul[ií]n/i, 'insulin…'],
  [/microbio/i, 'microbioma'],
  [/cardi[oó]log/i, 'cardiólogo'],
  // §6: «Nombrar enfermedades (diabetes, cáncer, enfermedad cardiovascular…)».
  [/diabet/i, 'diabetes'],
  [/c[aá]ncer/i, 'cáncer'],
  [/cardiovascular/i, 'enfermedad cardiovascular'],
]
const hits = (text: string) => BANNED.filter(([re]) => re.test(text)).map(([, l]) => l)

describe('kb/principios-mimo.md replaces kb/10 mandamientos.md', () => {
  it('is the file of principles the prompt loads (the public facts live apart, in sobre-mimoia.md), and the old one is gone', () => {
    expect(KB_FILE).toBe('principios-mimo.md')
    expect(existsSync(KB_PATH)).toBe(true)
    expect(existsSync(resolve(REPO, 'kb', '10 mandamientos.md'))).toBe(false)
  })

  it('carries the approved text: ten principles, ending with «Mimo no es médico»', () => {
    const kb = readFileSync(KB_PATH, 'utf8')
    expect(kb.startsWith('# Cómo cocina Mimoia')).toBe(true)
    expect(kb.match(/^\d+\. \*\*/gm)).toHaveLength(10)
    expect(kb).toContain('10. **Mimo no es médico.**')
    expect(kb).toContain('«Mimoia no sustituye a un profesional sanitario»')
    expect(kb).toContain(PRINCIPLE_10_BAN)
  })
})

describe("Mimo's prompt: cooking principles, no health framework", () => {
  beforeAll(async () => {
    await knowledgeBaseReady
  })

  for (const mode of ['text', 'voice', 'whatsapp', 'onboarding'] as const) {
    it(`${mode}: includes «Cómo cocina Mimoia» and no inflammation, insulin, microbiome, cardiologist or §6 disease`, () => {
      const p = buildSystemPrompt('Usuario de prueba', mode)
      expect(p).toContain('Cómo cocina Mimoia')
      expect(p).toContain(HEALTH_RULE)
      expect(p).toContain(PRINCIPLE_10_BAN)
      const scanned = p.replace(HEALTH_RULE, '').replace(PRINCIPLE_10_BAN, '')
      expect(hits(scanned)).toEqual([])
    })
  }

  it('no tool description, parameter or fixed tool text speaks of insulin, the microbiome or inflammation', () => {
    for (const s of skills) {
      expect(hits(`${s.name} ${s.description} ${JSON.stringify(s.parameters)}`), s.name).toEqual([])
    }
    // Advice strings returned by get_variety_score / get_eating_window live in the handlers.
    const source = readFileSync(resolve(__dirname, '../services/assistant/skills.ts'), 'utf8')
    expect(hits(source)).toEqual([])
  })

  it('evaluate_food_health frames foods in cooking words', async () => {
    const s = skills.find((x) => x.name === 'evaluate_food_health')!
    const r = await s.handler({ food: 'arroz blanco' }, { userId: 'u', db: {} as any })
    expect(hits(r.summary)).toEqual([])
    expect(r.summary).toMatch(/principios de cocina/)
  })

  it('the default principles in /profile/creencias say nothing about glucose or insulin', () => {
    const text = JSON.stringify(ONA_PRINCIPLES)
    expect(hits(text)).toEqual([])
    expect(text).not.toMatch(/glucosa/i)
    expect(ONA_PRINCIPLES.map((p) => p.title)).toContain('Comida de verdad, poco ultraprocesado')
  })
})
