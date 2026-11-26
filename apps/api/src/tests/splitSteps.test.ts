/**
 * PRO-1115: a pasted preparation becomes its steps — by line breaks and by
 * numbering («1.», «2)», «Paso 3:»).
 *
 * Run: pnpm --filter @ona/api test src/tests/splitSteps.test.ts
 */
import { describe, it, expect } from 'vitest'
import { splitSteps } from '@ona/shared'

describe('splitSteps', () => {
  it('numbered with «1.», with a heading and a wrapped line', () => {
    const text = `Preparación:
1. Pon las lentejas en remojo la noche anterior.
2. Pica la cebolla y el ajo y sofríelos en el aceite
a fuego medio durante 10 minutos.
3. Añade las lentejas escurridas y cubre con agua.
4. Cuece 40 minutos y sala al final.`
    expect(splitSteps(text)).toEqual([
      'Pon las lentejas en remojo la noche anterior.',
      'Pica la cebolla y el ajo y sofríelos en el aceite a fuego medio durante 10 minutos.',
      'Añade las lentejas escurridas y cubre con agua.',
      'Cuece 40 minutos y sala al final.',
    ])
  })

  it('numbered with «1)» and blank lines between steps', () => {
    const text = '1) Precalienta el horno a 180º.\n\n2) Mezcla la harina con el azúcar.\n\n3) Hornea 25 minutos.'
    expect(splitSteps(text)).toEqual([
      'Precalienta el horno a 180º.',
      'Mezcla la harina con el azúcar.',
      'Hornea 25 minutos.',
    ])
  })

  it('«Paso 1:» headings with the text on the next line', () => {
    const text = 'Paso 1:\nLava las patatas.\nPaso 2:\nCórtalas en rodajas.\nPaso 3: Fríelas en abundante aceite.'
    expect(splitSteps(text)).toEqual(['Lava las patatas.', 'Córtalas en rodajas.', 'Fríelas en abundante aceite.'])
  })

  it('numbering inside one paragraph (copied from a web)', () => {
    const text = '1. Pela las patatas. 2. Bate los huevos con sal. 3. Fríe las patatas 20 min. 4. Mezcla y cuaja la tortilla.'
    expect(splitSteps(text)).toEqual([
      'Pela las patatas.',
      'Bate los huevos con sal.',
      'Fríe las patatas 20 min.',
      'Mezcla y cuaja la tortilla.',
    ])
  })

  it('without numbering: each line is a step, bullets go', () => {
    const text = '- Tuesta el pan.\n- Ralla el tomate y mézclalo con aceite y sal.\r\n- Unta el pan y pon el jamón encima.'
    expect(splitSteps(text)).toEqual([
      'Tuesta el pan.',
      'Ralla el tomate y mézclalo con aceite y sal.',
      'Unta el pan y pon el jamón encima.',
    ])
  })

  it('without numbering: a line that continues the sentence joins it; «2 huevos…» is not a number', () => {
    const text = 'Calienta el aceite en una sartén\ngrande y dora el pollo.\n2 huevos batidos se añaden al final.\nSirve caliente.'
    expect(splitSteps(text)).toEqual([
      'Calienta el aceite en una sartén grande y dora el pollo.',
      '2 huevos batidos se añaden al final.',
      'Sirve caliente.',
    ])
  })

  it('one step and nothing', () => {
    expect(splitSteps('Mezcla todo y sirve.')).toEqual(['Mezcla todo y sirve.'])
    expect(splitSteps('  \n\n ')).toEqual([])
  })
})
