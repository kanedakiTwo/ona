/**
 * 2026-11-26: «pásale a Mimo la dieta de tu nutricionista». A photo or PDF
 * sent with the message goes to the model for that turn only (a PDF as a
 * `document` block), the conversation keeps «[Adjunto]», the prompt says what
 * Mimo notes and what it never does, and /admin/usage counts it.
 */
import { describe, expect, it } from 'vitest'
import { buildTurnMessages } from '../services/assistant/engine.js'
import { buildSystemParts, NUTRITIONIST_DIET_RULE } from '../services/assistant/systemPrompt.js'
import { HEALTH_RULE } from '../services/assistant/healthGuard.js'
import {
  ATTACHMENT_MARKER,
  CHAT_ATTACHMENT_MAX_BYTES,
  ChatAttachmentError,
  attachmentForModel,
  looksLikeDietDocument,
  mentionsDiet,
  withAttachmentMarker,
} from '../services/assistant/chatAttachment.js'
import { USAGE_EVENTS, sanitizeProps } from '../services/usageEvents.js'
import { BREAKDOWN_EVENTS, USAGE_DEFINITIONS, buildTotals, dayRange } from '../services/usageReport.js'

const NOW = new Date('2026-11-26T10:00:00Z')

describe('engine: the file goes with the message', () => {
  it('a PDF is a document block, between the clock and the words', () => {
    const msgs = buildTurnMessages([], 'Te mando la dieta de mi nutricionista.', [{ mediaType: 'application/pdf', data: 'JVBERi0=' }], NOW)
    const blocks = msgs[0].content as any[]
    expect(blocks.map((b) => b.type)).toEqual(['text', 'document', 'text'])
    expect(blocks[1].source).toEqual({ type: 'base64', media_type: 'application/pdf', data: 'JVBERi0=' })
    expect(blocks[2].text).toBe('Te mando la dieta de mi nutricionista.')
  })

  it('a photo is still an image block; a PDF with no words gets «(documento sin texto)»', () => {
    const photo = buildTurnMessages([], 'mira', [{ mediaType: 'image/png', data: 'AAA' }], NOW)[0].content as any[]
    expect(photo[1]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } })
    const bare = buildTurnMessages([], '', [{ mediaType: 'application/pdf', data: 'AAA' }], NOW)[0].content as any[]
    expect(bare.at(-1).text).toBe('(documento sin texto)')
  })
})

describe('chatAttachment', () => {
  it('a PDF passes as it is (base64); another type is refused', async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Page >> endobj')
    expect(await attachmentForModel(pdf, 'application/pdf')).toEqual({ mediaType: 'application/pdf', data: pdf.toString('base64') })
    await expect(attachmentForModel(Buffer.from('hola'), 'text/plain')).rejects.toMatchObject({ reason: 'type' })
    await expect(attachmentForModel(Buffer.from('hola'), null)).rejects.toBeInstanceOf(ChatAttachmentError)
  })

  it('too big: over 20 MB, or a PDF over 100 pages', async () => {
    await expect(attachmentForModel(Buffer.alloc(CHAT_ATTACHMENT_MAX_BYTES + 1), 'application/pdf')).rejects.toMatchObject({ reason: 'too_big' })
    const manyPages = Buffer.from('%PDF-1.4\n' + '<< /Type /Page >>\n'.repeat(101))
    await expect(attachmentForModel(manyPages, 'application/pdf')).rejects.toMatchObject({ reason: 'too_big' })
  })

  it('the conversation keeps «[Adjunto]», never the file', () => {
    expect(withAttachmentMarker('la dieta')).toBe(`${ATTACHMENT_MARKER} la dieta`)
    expect(withAttachmentMarker('  ')).toBe(ATTACHMENT_MARKER)
    expect(withAttachmentMarker(null)).toBe('[Adjunto]')
  })

  it('what counts as the diet: any PDF, or a photo with words about it', () => {
    expect(mentionsDiet('Esta es la dieta de mi nutricionista')).toBe(true)
    expect(mentionsDiet('lo que me ha dicho la médica')).toBe(true)
    expect(mentionsDiet('Mi endocrino me ha puesto esto')).toBe(true)
    expect(mentionsDiet('la receta de mi abuela')).toBe(false)
    expect(mentionsDiet('remedios caseros')).toBe(false)
    expect(looksLikeDietDocument(null, 'application/pdf')).toBe(true)
    expect(looksLikeDietDocument('mira qué plato', 'image/jpeg')).toBe(false)
    expect(looksLikeDietDocument('la dieta del médico', 'image/jpeg')).toBe(true)
  })
})

describe('the prompt rule', () => {
  it('is in every mode, after the allergy rule and before the health rule', () => {
    for (const mode of ['text', 'voice', 'whatsapp'] as const) {
      const { instructions } = buildSystemParts('', mode)
      expect(instructions, mode).toContain(NUTRITIONIST_DIET_RULE)
      expect(instructions.indexOf('update_profile addRestrictions (suya)')).toBeLessThan(instructions.indexOf(NUTRITIONIST_DIET_RULE))
      expect(instructions.indexOf(NUTRITIONIST_DIET_RULE)).toBeLessThan(instructions.indexOf(HEALTH_RULE))
    }
  })

  it('follows Legal (LEG-509): only the allergy path, literal, no clinical data, no advice, the right words', () => {
    // Everything from the diet goes through the allergy path, so the one-time health permission covers it.
    expect(NUTRITIONIST_DIET_RULE).toContain('update_profile addRestrictions')
    expect(NUTRITIONIST_DIET_RULE).toContain('note_ficha_fact restrictions con about=person')
    expect(NUTRITIONIST_DIET_RULE).toMatch(/el permiso lo pide el sistema/)
    // Tools that would skip the permission are not used for the diet.
    for (const tool of ['update_memory dislikes', 'menu_rule', 'set_fixed_meal']) expect(NUTRITIONIST_DIET_RULE).not.toContain(tool)
    expect(NUTRITIONIST_DIET_RULE).toMatch(/No deduzcas ni completes nada/)
    expect(NUTRITIONIST_DIET_RULE).toMatch(/no llames a update_profile con weight, height, age ni activityLevel/)
    expect(NUTRITIONIST_DIET_RULE).toMatch(/medicacion/)
    expect(NUTRITIONIST_DIET_RULE).toMatch(/Si es la de otro adulto, no apuntes nada/)
    expect(NUTRITIONIST_DIET_RULE).toMatch(/lista corta/)
    expect(NUTRITIONIST_DIET_RULE).toMatch(/calorias/)
    expect(NUTRITIONIST_DIET_RULE).toMatch(/No cambies, completes ni valores su dieta/)
    expect(NUTRITIONIST_DIET_RULE).toMatch(/si la cumple o se la salta/)
    expect(NUTRITIONIST_DIET_RULE).toContain('«Eso comentalo con tu nutricionista.')
    expect(NUTRITIONIST_DIET_RULE).toContain('«la dieta de tu nutricionista»')
    expect(NUTRITIONIST_DIET_RULE).toMatch(/nunca «pauta», «tratamiento», «consulta», «paciente» ni «prescrito»/)
  })
})

describe('mimo_diet_document in /admin/usage', () => {
  it('is a usage event, broken down by kind and counted in the totals', () => {
    expect(USAGE_EVENTS).toContain('mimo_diet_document')
    expect(BREAKDOWN_EVENTS).toContain('mimo_diet_document')
    expect(USAGE_DEFINITIONS.breakdown).toContain('mimo_diet_document')
    expect(sanitizeProps({ kind: 'pdf' })).toEqual({ kind: 'pdf' })
    const totals = buildTotals({
      days: dayRange('2026-11-23', '2026-11-26'),
      today: '2026-11-26',
      counts: [
        { day: '2026-11-25', name: 'mimo_diet_document', channel: 'web', count: 2 },
        { day: '2026-11-26', name: 'mimo_diet_document', channel: 'whatsapp', count: 1 },
      ],
      householdDays: [
        { householdId: 'h1', day: '2026-11-25', name: 'mimo_diet_document', channel: 'web' },
        { householdId: 'h2', day: '2026-11-26', name: 'mimo_diet_document', channel: 'whatsapp' },
      ],
    })
    expect(totals.events.mimo_diet_document).toBe(3)
    expect(totals.householdsByEvent.mimo_diet_document).toBe(2)
  })
})
