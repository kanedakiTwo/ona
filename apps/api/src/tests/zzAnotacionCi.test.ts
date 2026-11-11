import { describe, expect, it } from 'vitest'

// PROVOCADO: comprobar que un test que falla sale como anotación (se quita en el commit siguiente)
describe('anotación del CI', () => {
  it('falla a propósito', () => {
    expect(1 + 1).toBe(3)
  })
})
