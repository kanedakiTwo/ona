/**
 * The allergies box: «nada» is not an allergy (test household, 2026-10-22:
 * «nada. como d todo, el crio tb» was saved as a restriction). Typed text is
 * also added when the box loses focus, so this matters on «Guardar».
 */
import { describe, expect, it } from 'vitest'
import { saysNone, withTyped } from '../../../web/src/lib/restrictionText'

describe('saysNone', () => {
  it('«nada», «ninguna», «no tengo» are no restriction', () => {
    for (const t of ['nada', 'Nada. Como d todo, el crio tb', 'ninguna', 'Ninguna alergia', 'ningún', 'no', 'No tengo', 'no tengo ninguna', 'no tengo alergias', 'No tengo ninguna alergia', 'sin alergias', 'no tengo alergias ni intolerancias']) expect(saysNone(t), t).toBe(true)
  })

  it('a real one is kept, also when it starts with «nada de» or «no como»', () => {
    for (const t of ['pimiento', 'intolerancia al pimiento', 'nada de cerdo', 'no como cerdo', 'no tomo lactosa', 'sin gluten', 'no tengo alergia al marisco']) expect(saysNone(t), t).toBe(false)
  })
})

describe('saysNone after a «nada» (PRO-1263)', () => {
  it('a «nada» followed by what someone doesn\'t eat is kept', () => {
    for (const t of [
      'nada d alergias. la abuela no come higado ni ver y el peque las acelgas tampoco jaja',
      'nada d cerdo',
      'ninguna alergia, pero el niño no come pescado',
      'nada, excepto el picante',
    ]) expect(saysNone(t), t).toBe(false)
  })

  it('a «nada» that only says there is none is still none', () => {
    for (const t of ['nada d alergias', 'Nada de alergias ni intolerancias', 'nada, no tengo alergias']) expect(saysNone(t), t).toBe(true)
  })
})

describe('withTyped', () => {
  it('what is typed counts, once, and «nada» does not', () => {
    expect(withTyped([], ' Pimiento ')).toEqual(['pimiento'])
    expect(withTyped(['sin gluten'], 'pimiento')).toEqual(['sin gluten', 'pimiento'])
    expect(withTyped(['pimiento'], 'pimiento')).toEqual(['pimiento'])
    expect(withTyped(['sin gluten'], 'nada')).toEqual(['sin gluten'])
    expect(withTyped(['sin gluten'], '  ')).toEqual(['sin gluten'])
  })
})
