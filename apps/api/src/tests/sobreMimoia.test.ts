/**
 * D-053 (2026-10-15) — Mimo knows Mimoia in detail and answers public
 * questions: what it is, what it does, plans and prices, mission, privacy.
 *
 * `kb/sobre-mimoia.md` carries the facts; prices come from the same constants
 * `/precios` shows (`PLANS`, `PLAN_FEATURE_GROUPS`), never from the file, so a price change
 * on the web can't leave Mimo quoting an old one.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { BRAND_SUPPORT_EMAIL, FOUNDER_FOOTER, FOUNDER_FOOTER_BETA, PLANS, PLAN_FEATURE_GROUPS } from '@ona/shared'
import {
  ABOUT_FILE,
  WHATSAPP_OFF_TOPIC_REPLY,
  buildSystemPrompt,
  knowledgeBaseReady,
  pricingBlock,
} from '../services/assistant/systemPrompt.js'

const REPO = resolve(__dirname, '../../../..')
const ABOUT_PATH = resolve(REPO, 'kb', ABOUT_FILE)
const about = () => readFileSync(ABOUT_PATH, 'utf8')

/** Intended purpose, word for word (constitution §6, /terminos, D-038). */
const INTENDED_PURPOSE =
  'Mimoia es un planificador de menús, recetas y lista de la compra para hogares, según sus gustos, preferencias y restricciones declaradas.'

/** Constitution §6: health effects and diseases never appear in what Mimo says. */
const BANNED = [
  /inflam/i, /insul[ií]n/i, /gluc(osa|emia)/i, /microbio/i, /defensas/i, /adelgaz/i, /perder peso/i,
  /quema\w* grasa/i, /depura/i, /desintox/i, /diabet/i, /c[aá]ncer/i, /cardio/i, /m[aá]s energ[ií]a/i,
  /paciente/i, /tratamiento/i, /prescrip/i,
]

describe('kb/sobre-mimoia.md', () => {
  it('exists and states the intended purpose word for word', () => {
    expect(existsSync(ABOUT_PATH)).toBe(true)
    expect(about().startsWith('# Sobre Mimoia')).toBe(true)
    expect(about()).toContain(INTENDED_PURPOSE)
    expect(about()).toContain('ni sustituye a un profesional sanitario')
  })

  it('covers what people ask: mission, channels, how to start, plans, privacy, contact', () => {
    for (const heading of ['## Qué es Mimoia', '## Misión, visión y origen', '## Qué puedes hacer con Mimoia',
      '## Dónde se usa', '## Cómo empezar', '## Planes y precios', '## Privacidad y datos', '## Contacto']) {
      expect(about(), heading).toContain(heading)
    }
    expect(about()).toContain(BRAND_SUPPORT_EMAIL)
  })

  it('never writes a price: prices come from PLANS', () => {
    expect(about()).not.toMatch(/\d\s*€|€\s*\d|\d+,\d{2}\b/)
  })

  it('says nothing the §6 claims guide forbids', () => {
    expect(BANNED.filter((re) => re.test(about())).map(String)).toEqual([])
  })
})

describe("Mimo's prompt carries the public facts and today's prices", () => {
  beforeAll(async () => {
    await knowledgeBaseReady
  })

  it('pricingBlock: both plans with both prices, Esencial recommended, every feature row and the conditions', () => {
    const block = pricingBlock()
    for (const p of PLANS) {
      expect(block).toContain(`${p.name}${p.featured ? ' (el que recomendamos)' : ''}: ${p.prices.mensual.label} o ${p.prices.anual.label}`)
      for (const h of p.highlights) expect(block).toContain(h)
    }
    for (const f of PLAN_FEATURE_GROUPS.flatMap((g) => g.features)) expect(block).toContain(`- ${f.label}: Esencial`)
    expect(block).toContain('- Hablar con Mimo por voz: Esencial no; Plus si')
    expect(block).toContain(FOUNDER_FOOTER)
    expect(block).toContain(FOUNDER_FOOTER_BETA)
    expect(block).toContain('LINK.COM* MIMOIA')
  })

  for (const mode of ['text', 'voice', 'whatsapp', 'onboarding'] as const) {
    it(`${mode}: includes «Sobre Mimoia» and the price of every plan`, () => {
      const p = buildSystemPrompt('Usuario de prueba', mode)
      expect(p).toContain(INTENDED_PURPOSE)
      expect(p).toContain('que en casa solo quede la parte divertida de cocinar')
      for (const plan of PLANS) for (const period of ['mensual', 'anual'] as const) expect(p).toContain(plan.prices[period].label)
    })
  }

  it('WhatsApp treats questions about Mimoia as on-topic, not as off-topic', () => {
    const p = buildSystemPrompt('Usuario de prueba', 'whatsapp')
    expect(p).toContain('cualquier pregunta sobre Mimoia (que es, que puede hacer, como funciona, planes y precios')
    expect(p).toContain(WHATSAPP_OFF_TOPIC_REPLY)
  })
})
