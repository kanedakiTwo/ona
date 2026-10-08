/**
 * WhatsApp prompt: the system appends the menu / list digests, so the model
 * must not write them itself; and shop-order links are only the ones returned
 * THIS turn (2026-10-08: "dame la compra otra vez" re-sent this morning's /c/
 * links from history, so the shops got the pre-v1.1 message).
 */
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../services/assistant/systemPrompt.js'

describe('whatsapp prompt', () => {
  const p = buildSystemPrompt('', 'whatsapp')
  it('leaves the menu and list digests to the system', () => {
    expect(p).toMatch(/generate_weekly_menu\) o consultado la lista de la compra \(get_shopping_list\), no los escribas tu: el sistema añade debajo el resumen/)
  })
  it('only copies shop-order links returned this turn', () => {
    expect(p).toMatch(/en ESTE turno SI los copias tal cual/)
    expect(p).toMatch(/Nunca reenvies enlaces \/c\/ de mensajes anteriores/)
  })
})
