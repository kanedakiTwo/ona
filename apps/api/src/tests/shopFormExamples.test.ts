/**
 * PRO-76 (privacy): the examples in «Añadir tienda» are shown to every user,
 * so they must be made up — never the name or number of a real shop, nor of a
 * real person. Until 2026-10-14 the form showed real shops of the founder's
 * test household and his own name.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FORM = resolve(__dirname, '../../../web/src/components/compra/ShopForm.tsx')
const source = readFileSync(FORM, 'utf8')
const digits = source.replace(/[\s.-]/g, '')

const REAL_NAMES = ['Miguel', 'Fruits of the World', 'Ben-Car', 'Alonso', 'Corte Ingl', 'elcorteingles']
const REAL_NUMBERS = ['638015827', '916339217', '913525111']

describe('«Añadir tienda» examples', () => {
  it.each(REAL_NAMES)('do not mention %s', (name) => {
    expect(source).not.toContain(name)
  })

  it.each(REAL_NUMBERS)('do not show the real number %s', (n) => {
    expect(digits).not.toContain(n)
  })

  it('use made-up examples', () => {
    expect(source).toContain('Ej: Frutería del barrio')
    expect(source).toContain('Ej: 600 000 000')
    expect(source).toContain('Ej: 910 000 000')
    expect(source).toContain('Ana, la del 3.º B')
    expect(source).toContain('https://www.tutienda.es')
  })
})
