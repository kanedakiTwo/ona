/**
 * PRO-1040: Mimo learns from its context where WhatsApp connects for this
 * account, so it stops making the steps up («Perfil → WhatsApp» with the
 * channel off, «mimoia.com» for an account on staging).
 */
import { describe, expect, it } from 'vitest'
import { whatsappContextLine } from '../services/assistant/contextLoader.js'

describe('whatsappContextLine', () => {
  it('channel on, not linked: the real steps, in this same web', () => {
    const line = whatsappContextLine({ available: true, linked: false })
    expect(line).toContain('Perfil → WhatsApp → «Conectar WhatsApp»')
    expect(line).toContain('codigo')
    expect(line).toContain('No le mandes a otra web')
    expect(line).not.toContain('mimoia.com')
  })

  it('channel off: says it is not available yet and gives no steps', () => {
    const line = whatsappContextLine({ available: false, linked: false })
    expect(line).toContain('todavia no esta disponible')
    expect(line).toContain('no le des pasos')
    expect(line).not.toContain('Conectar WhatsApp')
  })

  it('linked: connected, whatever the channel says now', () => {
    expect(whatsappContextLine({ available: false, linked: true })).toMatch(/^WhatsApp: conectado/)
  })
})
