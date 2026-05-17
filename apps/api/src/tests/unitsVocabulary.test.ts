import { describe, it, expect } from 'vitest'
import { VOCABULARY, getTermBySynonym } from '@ona/shared'

describe('vocabulary count', () => {
  it('exports 29 canonical terms', () => {
    expect(VOCABULARY).toHaveLength(29)
  })
})

describe('synonym lookup', () => {
  it.each([
    ['cucharada', 'cda'],
    ['cucharada sopera', 'cda'],
    ['CUCHARADA', 'cda'],
    ['cucharadita', 'cdita'],
    ['cda.', 'cda'],
    ['cdta', 'cdita'],
    // NOTE: `c.s.` is intentionally NOT in any synonym list. It is contextually
    // ambiguous (cda when a number precedes it, otherwise cantidad suficiente).
    // The resolver handles this case explicitly before consulting the synonym
    // index; the vocabulary itself stays unambiguous.
    ['un puñado', 'puñado'],
    ['atadillo', 'manojo'],
    ['ramillete', 'manojo'],
    ['gotita', 'gota'],
    ['dientecillo', 'diente'],
    ['terron', 'terrón'],
    ['terrón', 'terrón'],
    ['una pizca', 'pizca'],
    ['al paladar', 'al gusto'],
    ['q.s.', 'al gusto'],
    ['c.n.', 'cantidad suficiente'],
    ['bouquet garni', 'manojo'],
    ['tbsp', 'cda'],
    ['cdt', 'cdita'],
  ])('"%s" resolves to canonical "%s"', (input, expected) => {
    const term = getTermBySynonym(input)
    expect(term?.canonical).toBe(expected)
  })

  it('caller can pass raw (unnormalized) input', () => {
    expect(getTermBySynonym('  CUCHARADA Sopera ')?.canonical).toBe('cda')
  })

  it('unknown term returns undefined', () => {
    expect(getTermBySynonym('zarandajas')).toBeUndefined()
  })
})
