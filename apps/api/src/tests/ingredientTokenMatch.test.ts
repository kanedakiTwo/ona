/**
 * Tests for the pure token-set ingredient matcher.
 *
 * The cases below mirror the analysis we did when designing the cascade
 * after a real user hit the "pechuga de pollo → pollo" trap in
 * production. Every "NO information loss" case from that table is
 * encoded here as a regression guard: a future "smart fallback" that
 * brings back the substring trap will fail this suite.
 */

import { describe, expect, it } from 'vitest'
import {
  NOISE_TOKENS,
  STOPWORDS,
  tokenize,
  tokenSetMatch,
  type CatalogEntry,
} from '../services/ingredientTokenMatch.js'

// Tiny stand-in catalogue covering the cases the analysis flagged.
const CATALOG: CatalogEntry[] = [
  { id: 'cebolla-id', name: 'cebolla' },
  { id: 'tomate-id', name: 'tomate' },
  { id: 'tomate-frito-id', name: 'tomate frito' },
  { id: 'pollo-id', name: 'pollo' },
  { id: 'caldo-pollo-id', name: 'caldo de pollo' },
  { id: 'jamon-id', name: 'jamón' },
  { id: 'aceite-id', name: 'aceite' },
  { id: 'aceite-oliva-id', name: 'aceite de oliva' },
  { id: 'sal-marina-id', name: 'sal marina' },
  { id: 'pan-id', name: 'pan' },
]

describe('tokenize', () => {
  it('lowercases, drops stopwords, splits on whitespace', () => {
    expect(tokenize('Pechuga de Pollo')).toEqual(['pechuga', 'pollo'])
    expect(tokenize('Aceite de oliva virgen extra')).toEqual([
      'aceite', 'oliva', 'virgen', 'extra',
    ])
  })

  it('strips punctuation', () => {
    expect(tokenize('cebolla, picada')).toEqual(['cebolla', 'picada'])
    expect(tokenize('cebolla (mediana)')).toEqual(['cebolla', 'mediana'])
  })

  it('returns empty on whitespace-only input', () => {
    expect(tokenize('   ')).toEqual([])
  })

  it('STOPWORDS contains the connectors used in Spanish ingredient names', () => {
    expect(STOPWORDS.has('de')).toBe(true)
    expect(STOPWORDS.has('del')).toBe(true)
    expect(STOPWORDS.has('y')).toBe(true)
  })

  it('NOISE_TOKENS contains the safe cooking-state modifiers', () => {
    expect(NOISE_TOKENS.has('picada')).toBe(true)
    expect(NOISE_TOKENS.has('fresco')).toBe(true)
    expect(NOISE_TOKENS.has('maduro')).toBe(true)
    expect(NOISE_TOKENS.has('rallada')).toBe(true)
  })
})

describe('tokenSetMatch — exact', () => {
  it('matches identical token sets', () => {
    const v = tokenSetMatch('cebolla', CATALOG)
    expect(v.kind).toBe('exact')
    if (v.kind === 'exact') expect(v.catalog.id).toBe('cebolla-id')
  })

  it('matches with different stopwords reshuffled', () => {
    const v = tokenSetMatch('aceite de oliva', CATALOG)
    expect(v.kind).toBe('exact')
    if (v.kind === 'exact') expect(v.catalog.id).toBe('aceite-oliva-id')
  })
})

describe('tokenSetMatch — noise-stripped (legitimate)', () => {
  it('"cebolla picada" matches "cebolla" (picada is cooking state)', () => {
    const v = tokenSetMatch('cebolla picada', CATALOG)
    expect(v.kind).toBe('noise-stripped')
    if (v.kind === 'noise-stripped') {
      expect(v.catalog.id).toBe('cebolla-id')
      expect(v.stripped).toEqual(['picada'])
    }
  })

  it('"tomate maduro" matches "tomate"', () => {
    const v = tokenSetMatch('tomate maduro', CATALOG)
    expect(v.kind).toBe('noise-stripped')
    if (v.kind === 'noise-stripped') expect(v.catalog.id).toBe('tomate-id')
  })

  it('"pan rallado" matches "pan" because rallado is in the noise list', () => {
    // (Note: in the real catalogue "pan rallado" is its own entry and that
    // would win via exact match. With our stub catalogue lacking it, the
    // noise stripper kicks in. This documents the policy decision.)
    const v = tokenSetMatch('pan rallado', CATALOG)
    expect(v.kind).toBe('noise-stripped')
    if (v.kind === 'noise-stripped') expect(v.catalog.id).toBe('pan-id')
  })
})

describe('tokenSetMatch — no-match (regression guards: NEVER lose info)', () => {
  it('"pechuga de pollo" does NOT collapse to "pollo"', () => {
    // This is the bug that triggered the whole rewrite. Keeping it as
    // the canonical regression test.
    const v = tokenSetMatch('pechuga de pollo', CATALOG)
    expect(v.kind).toBe('no-match')
  })

  it('"muslo de pollo" does NOT collapse to "pollo"', () => {
    const v = tokenSetMatch('muslo de pollo', CATALOG)
    expect(v.kind).toBe('no-match')
  })

  it('"jamón ibérico" does NOT collapse to "jamón"', () => {
    const v = tokenSetMatch('jamón ibérico', CATALOG)
    expect(v.kind).toBe('no-match')
  })

  it('"aceite de girasol" does NOT match "aceite" or "aceite de oliva"', () => {
    const v = tokenSetMatch('aceite de girasol', CATALOG)
    expect(v.kind).toBe('no-match')
  })

  it('"chuletón" does NOT silently collapse to anything (no token overlap with catalogue)', () => {
    // Stage 1 (this matcher) returns no-match; stage 2 (LLM) is expected
    // to resolve "chuletón" → "chuleta de vaca". This test only guards
    // that stage 1 doesn't invent a false collapse.
    const v = tokenSetMatch('chuletón', CATALOG)
    expect(v.kind).toBe('no-match')
  })
})

describe('tokenSetMatch — cooking-state DOES safely collapse', () => {
  // Counterpoint to the no-match section: when the extra token IS in
  // the noise list (state of preparation, not a new ingredient), the
  // collapse is the right answer.
  it('"pollo asado" collapses to "pollo" (asado is cooking state, same meat)', () => {
    const v = tokenSetMatch('pollo asado', CATALOG)
    expect(v.kind).toBe('noise-stripped')
    if (v.kind === 'noise-stripped') expect(v.catalog.id).toBe('pollo-id')
  })

  it('"tomate fresco" collapses to "tomate"', () => {
    const v = tokenSetMatch('tomate fresco', CATALOG)
    expect(v.kind).toBe('noise-stripped')
    if (v.kind === 'noise-stripped') expect(v.catalog.id).toBe('tomate-id')
  })
})

describe('tokenSetMatch — user-generic (catalog more specific than user)', () => {
  it('"sal" matches "sal marina" (only "sal" entry available)', () => {
    const v = tokenSetMatch('sal', CATALOG)
    expect(v.kind).toBe('user-generic')
    if (v.kind === 'user-generic') expect(v.catalog.id).toBe('sal-marina-id')
  })

  it('prefers the shortest catalog match when multiple specifics fit', () => {
    // "aceite" exists AND "aceite de oliva" exists. User typed "aceite".
    // Exact match wins (catalog "aceite") — not user-generic.
    const v = tokenSetMatch('aceite', CATALOG)
    expect(v.kind).toBe('exact')
    if (v.kind === 'exact') expect(v.catalog.id).toBe('aceite-id')
  })

  it('user-generic kicks in only when no exact match exists', () => {
    // "tomate" → exact, not user-generic, even though "tomate frito" also
    // contains "tomate".
    const v = tokenSetMatch('tomate', CATALOG)
    expect(v.kind).toBe('exact')
    if (v.kind === 'exact') expect(v.catalog.id).toBe('tomate-id')
  })
})

describe('tokenSetMatch — empty / degenerate', () => {
  it('empty input returns no-match', () => {
    expect(tokenSetMatch('', CATALOG).kind).toBe('no-match')
    expect(tokenSetMatch('   ', CATALOG).kind).toBe('no-match')
  })

  it('all-stopword input returns no-match', () => {
    expect(tokenSetMatch('de la', CATALOG).kind).toBe('no-match')
  })
})
