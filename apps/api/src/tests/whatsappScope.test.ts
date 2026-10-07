/**
 * WhatsApp is food-only (Miguel, 2026-10-07): anything else gets one fixed
 * sentence. Plus the control words parser.
 */
import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, WHATSAPP_OFF_TOPIC_REPLY } from '../services/assistant/systemPrompt.js'
import { refusesAction } from '../services/assistant/engine.js'
import { controlCommand } from '../services/whatsapp/commands.js'

describe('WhatsApp scope', () => {
  it('the WhatsApp prompt carries the fixed off-topic reply and no "conversacion casual"', () => {
    const wa = buildSystemPrompt('', 'whatsapp')
    expect(wa).toContain(WHATSAPP_OFF_TOPIC_REPLY)
    expect(wa).not.toContain('conversacion casual')
    expect(buildSystemPrompt('', 'text')).toContain('conversacion casual')
  })

  it('the off-topic reply is not mistaken for a refusal by the engine guard', () => {
    expect(refusesAction(WHATSAPP_OFF_TOPIC_REPLY)).toBe(false)
  })
})

describe('controlCommand', () => {
  it.each([
    ['BAJA', 'stop'], ['Stop', 'stop'], ['darme de baja.', 'stop'], ['No quiero más avisos', 'stop'], ['PARAR', 'stop'],
    ['ALTA', 'start'], ['Sí, avísame', 'start'], ['activar avisos', 'start'],
    ['HUMANO', 'human'], ['¿Puedo hablar con una persona?', null], ['hablar con una persona', 'human'],
    ['para la cena pon lentejas', null], ['baja el fuego', null], ['¿Qué ceno hoy?', null], ['', null],
  ])('%s → %s', (text, expected) => {
    expect(controlCommand(text)).toBe(expected)
  })
})
