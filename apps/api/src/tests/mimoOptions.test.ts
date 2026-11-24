/**
 * 24-nov: the web panel showed Mimo's `[[opciones: Comida | Cena]]` as written
 * (WhatsApp turns it into buttons). `mimoOptions` takes the line out of the
 * text and gives the options (apps/web/src/lib/mimoOptions.ts).
 */
import { describe, expect, it } from 'vitest'
import { MIMO_MAX_OPTIONS, mimoOptions } from '../../../web/src/lib/mimoOptions'

describe('mimoOptions', () => {
  it('takes the options line out and gives the buttons', () => {
    const r = mimoOptions('¿La pongo en la comida (en lugar de los Macarrones de casa) o en la cena?\n\n[[opciones: Comida | Cena]]')
    expect(r.text).toBe('¿La pongo en la comida (en lugar de los Macarrones de casa) o en la cena?')
    expect(r.options).toEqual(['Comida', 'Cena'])
  })
  it('a reply without the line is left as it is, with no buttons', () => {
    expect(mimoOptions('Hecho: el jueves cenáis Rösti de patatas.')).toEqual({ text: 'Hecho: el jueves cenáis Rösti de patatas.', options: [] })
  })
  it('singular, spaces and the line in the middle; never shown, whatever its shape', () => {
    expect(mimoOptions('¿Lo confirmo? [[ opcion : Sí | No ]] Dime.')).toEqual({ text: '¿Lo confirmo? Dime.', options: ['Sí', 'No'] })
    expect(mimoOptions('¿Seguro?\n[[opciones: ]]').text).toBe('¿Seguro?')
    expect(mimoOptions('¿Seguro?\n[[opciones: ]]').options).toEqual([])
    expect(mimoOptions('A [[opciones: Sí | No]] B [[opciones: Uno | Dos]]').text).not.toContain('[[')
    expect(mimoOptions('A [[opciones: Sí | No]] B [[opciones: Uno | Dos]]').options).toEqual(['Sí', 'No'])
  })
  it('long option names stay whole and a long list is capped', () => {
    const many = Array.from({ length: 9 }, (_, i) => `Opción ${i + 1}`)
    const r = mimoOptions(`Elige: [[opciones: ${many.join(' | ')}]]`)
    expect(r.options).toHaveLength(MIMO_MAX_OPTIONS)
    expect(mimoOptions('[[opciones: Garbanzos con espinacas y huevo | Seguir con las lentejas]]').options[0]).toBe('Garbanzos con espinacas y huevo')
  })
})
