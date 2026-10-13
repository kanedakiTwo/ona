/**
 * anonymise(): what the Mimoia HQ agents read from conversations must not
 * identify anyone (company rule: aggregated or anonymised data only). A leak
 * here puts a name, phone or address in front of an agent.
 */
import { describe, expect, it } from 'vitest'
import { anonymise, discoverNames, nameTokens } from '../services/anonymise.js'

describe('anonymise', () => {
  it('masks emails, links (shop-order tokens, wa.me numbers) and phone numbers', () => {
    const out = anonymise(
      'Escríbeme a ana.lopez@gmail.com o al +34 600 111 222 / 913.52.51.11. Pedido: https://mimoia.com/c/AbC123xyz y https://wa.me/34616943425?text=hola',
    )
    expect(out).not.toMatch(/ana\.lopez|gmail|600 111 222|913\.52|AbC123xyz|616943425/)
    expect(out).toContain('[email]')
    expect(out).toContain('[teléfono]')
    expect(out).toContain('[enlace]')
  })

  it('masks street addresses, postcodes and ID numbers', () => {
    const out = anonymise('Te lo llevan a la Calle Mayor 12, 3º B, 28013 Madrid. DNI 12345678Z. También Avda. de la Constitución, 5.')
    expect(out).not.toMatch(/Mayor|28013|12345678Z|Constitución/)
    expect(out).toContain('[dirección]')
    expect(out).toContain('[cp]')
    expect(out).toContain('[documento]')
  })

  it('masks known names (usernames, profile and household names) anywhere, any case', () => {
    const names = nameTokens(['carmen_r', 'carmen.ruiz@example.com', 'Antonio Ruiz', 'Casa de los Ruiz'])
    const out = anonymise('Hola CARMEN. A Antonio le pongo merluza; los Ruiz cenan a las 21:00. carmen_r', names)
    expect(out).not.toMatch(/carmen|antonio|ruiz/i)
  })

  it('masks capitalised names after cues even when they are not known', () => {
    const out = anonymise('Eso, mejor con su medico. Para Antonio, una merluza. Mi marido Paco y Leo comen a las dos. Soy Marta.')
    expect(out).not.toMatch(/Antonio|Paco|Leo|Marta/)
    expect(out).toContain('Para [nombre], una merluza')
  })

  it('keeps cooking content readable: quantities, times, dates, days, shops and the brand', () => {
    const text = 'Hecho: - Lentejas el jueves a las 14:30 (200 g, 1.2 kg). Compra en Mercadona el 2026-10-14. Mimo te avisa.'
    expect(anonymise(text)).toBe(text)
  })

  it('handles empty input', () => {
    expect(anonymise(null)).toBe('')
    expect(anonymise('')).toBe('')
  })
})

describe('discoverNames', () => {
  it('finds the names a text reveals through its cues, so they can be masked where no cue precedes them', () => {
    expect(discoverNames('cambia la cena del jueves para Antonio, y mi hija Lucía no come pescado')).toEqual(['Antonio', 'Lucía'])
    expect(discoverNames('Hecho: lentejas el lunes en Mercadona')).toEqual([])
    const names = discoverNames('para Antonio')
    expect(anonymise('Hecho:\n- Antonio ya tiene merluza el jueves', names)).toBe('Hecho:\n- [nombre] ya tiene merluza el jueves')
  })
})

describe('nameTokens', () => {
  it('splits handles and emails into name tokens, skipping short and generic words', () => {
    const t = nameTokens(['pepe_garcia91', 'Mi casa', 'luisa@example.com', null])
    expect(t).toEqual(expect.arrayContaining(['pepe', 'garcia', 'luisa', 'pepe_garcia91']))
    expect(t).not.toContain('casa')
    expect(t).not.toContain('Mi')
  })
})
