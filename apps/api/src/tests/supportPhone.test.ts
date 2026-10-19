/**
 * PRO-249 (D-071): the support phone comes only from env vars
 * (`NEXT_PUBLIC_SUPPORT_PHONE` on the web, `SUPPORT_PHONE` in the API). With
 * the var, the web line and Mimo give the number and the hours; without it,
 * no phone line anywhere and Mimo never makes a number up.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BRAND_SUPPORT_EMAIL, SUPPORT_PHONE_HOURS, supportPhone, supportPhoneLine } from '@ona/shared'
import { buildSystemPrompt, contactBlock, knowledgeBaseReady } from '../services/assistant/systemPrompt.js'

const PHONE = '600 000 000'

describe('supportPhoneLine (web /aviso-legal, /terminos)', () => {
  it('with a number: number, weekday hours and the email outside them', () => {
    expect(supportPhoneLine(` ${PHONE} `)).toBe(
      `Teléfono: ${PHONE} (de lunes a viernes, de 10:00 a 13:00; fuera de ese horario, escríbenos a ${BRAND_SUPPORT_EMAIL})`,
    )
  })

  it('without a number (unset or blank): no line at all', () => {
    expect(supportPhoneLine(undefined)).toBeNull()
    expect(supportPhoneLine('')).toBeNull()
    expect(supportPhoneLine('   ')).toBeNull()
    expect(supportPhone(null)).toBeNull()
  })

  it('the code never holds a real number: only the web and API env vars do', () => {
    const repo = resolve(__dirname, '../../../..')
    const contact = readFileSync(resolve(repo, 'apps/web/src/lib/contact.ts'), 'utf8')
    expect(contact).toContain('process.env.NEXT_PUBLIC_SUPPORT_PHONE')
    expect(contact).not.toMatch(/\b[6789]\d{2}\s?\d{3}\s?\d{3}\b/)
  })
})

describe('contactBlock (what Mimo knows about the phone)', () => {
  beforeAll(async () => {
    await knowledgeBaseReady
  })

  it('with SUPPORT_PHONE: Mimo gives the number and the hours', () => {
    const block = contactBlock(PHONE)
    expect(block).toContain(PHONE)
    expect(block).toContain(SUPPORT_PHONE_HOURS)
    expect(block).toContain(BRAND_SUPPORT_EMAIL)
  })

  it('without SUPPORT_PHONE: no number, says there is none and gives the email', () => {
    const block = contactBlock('')
    expect(block).not.toMatch(/\d{3}/)
    expect(block).toContain('no hay telefono')
    expect(block).toContain(BRAND_SUPPORT_EMAIL)
    expect(block).toContain('Nunca inventes un numero')
  })

  it('the prompt carries the block (env unset in tests → the no-phone version)', () => {
    const prompt = buildSystemPrompt('', 'whatsapp')
    expect(prompt).toContain(contactBlock())
    expect(prompt).toContain(contactBlock(''))
  })
})
