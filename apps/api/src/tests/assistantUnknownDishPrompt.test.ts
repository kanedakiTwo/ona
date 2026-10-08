/**
 * The system prompt must tell the model to put an unknown dish on the menu
 * (as a note, via swap_meal/add_dish) instead of stopping to ask whether to
 * create the recipe. On 2026-10-08, "ponme X el jueves" over WhatsApp got
 * "esa receta no existe, ¿quieres que la cree?" because one rule said
 * "ofrece crearla" and another "pon la mas parecida".
 */
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../services/assistant/systemPrompt.js'

describe('system prompt: dishes that are not in the catalogue', () => {
  for (const mode of ['text', 'whatsapp', 'voice'] as const) {
    it(`(${mode}) puts them on the menu as a note first, then offers the recipe`, () => {
      const p = buildSystemPrompt('', mode)
      expect(p).toMatch(/si es para ponerla en el menu, NO preguntes primero: llama igualmente a swap_meal/)
      expect(p).toMatch(/como nota con su nombre/)
      // the old contradictory rule is gone
      expect(p).not.toMatch(/pon la mas parecida que si exista/)
    })
  }

  it('(whatsapp) the action-first block says the same and never leaves the slot empty', () => {
    const p = buildSystemPrompt('', 'whatsapp')
    expect(p).toMatch(/no esta en sus recetas ni en el catalogo, llama igualmente a swap_meal/)
    expect(p).toMatch(/Nunca dejes el hueco sin poner ni preguntes antes si quiere crearla/)
  })
})
