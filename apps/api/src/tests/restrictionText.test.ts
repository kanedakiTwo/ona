/**
 * The allergies box: «nada» is not an allergy (test household, 2026-10-22:
 * «nada. como d todo, el crio tb» was saved as a restriction). Typed text is
 * also added when the box loses focus, so this matters on «Guardar».
 */
import { describe, expect, it } from 'vitest'
import { saysNone } from '../../../web/src/lib/restrictionText'

describe('saysNone', () => {
  it('«nada», «ninguna», «no tengo» are no restriction', () => {
    for (const t of ['nada', 'Nada. Como d todo, el crio tb', 'ninguna', 'Ninguna alergia', 'ningún', 'no', 'No tengo', 'no tengo ninguna']) expect(saysNone(t), t).toBe(true)
  })

  it('a real one is kept, also when it starts with «nada de» or «no como»', () => {
    for (const t of ['pimiento', 'intolerancia al pimiento', 'nada de cerdo', 'no como cerdo', 'no tomo lactosa', 'sin gluten']) expect(saysNone(t), t).toBe(false)
  })
})
