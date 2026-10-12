/**
 * WhatsApp is about food (Miguel, 2026-10-07): anything clearly unrelated gets
 * one fixed sentence. Since 2026-10-12 (diagnosis of 2026-10-11) everything
 * around food and cooking is in scope and answered with real knowledge: a
 * barbecue question or "¿tienes el vídeo?" used to get the fixed sentence.
 * Plus the control words parser.
 */
import { describe, expect, it } from 'vitest'
import { buildSystemPrompt, WHATSAPP_OFF_TOPIC_REPLY } from '../services/assistant/systemPrompt.js'
import { controlCommand } from '../services/whatsapp/commands.js'

describe('WhatsApp scope', () => {
  it('keeps the fixed sentence only for topics that have nothing to do with food', () => {
    const wa = buildSystemPrompt('', 'whatsapp')
    expect(wa).toContain(WHATSAPP_OFF_TOPIC_REPLY)
    expect(wa).toMatch(/Solo para temas que no tienen nada que ver/)
    expect(wa).toMatch(/Ante la duda, es de comida/)
  })

  it('lets Mimo answer cooking questions with what it knows, on every channel', () => {
    for (const mode of ['whatsapp', 'text'] as const) {
      const p = buildSystemPrompt('', mode)
      expect(p).toMatch(/Sabes cocinar/)
      expect(p).toMatch(/Si solo pregunta como se hace, contestale con lo que sabes de cocina/)
      expect(p).toMatch(/conversacion casual sobre comida/)
      expect(p).not.toMatch(/Responde directamente SOLO para/)
      expect(p).not.toMatch(/no para conversar/)
    }
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
