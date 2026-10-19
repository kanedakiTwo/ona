/**
 * PRO-200 (hogares de prueba, 2026-10-17): «No me gusta las lentejas», «el
 * atun», and three «Es muy largo» to fish dishes ending in «¿No coméis
 * pescado?». Pure helpers of the «Afina tu menú» swiper.
 */
import { describe, expect, it } from 'vitest'
import { TASTE_PROTEIN_STREAK } from '@ona/shared'
import { dislikeChipText, nextStreak } from '../../../web/src/lib/tasteText'
import { withArticle } from '../services/tasteDeck.js'

describe('«¿Qué es lo que no?» chips', () => {
  it('agree in number and restore accents', () => {
    expect(dislikeChipText(withArticle('lentejas'))).toBe('No me gustan las lentejas')
    expect(dislikeChipText(withArticle('garbanzos'))).toBe('No me gustan los garbanzos')
    expect(dislikeChipText(withArticle('atun'))).toBe('No me gusta el atún')
    expect(dislikeChipText(withArticle('calabacin'))).toBe('No me gusta el calabacín')
    expect(dislikeChipText(withArticle('coliflor'))).toBe('No me gusta la coliflor')
  })
})

describe('meat/fish streak', () => {
  it('«Es muy largo» never adds to «¿No coméis pescado?»', () => {
    let s = 0
    for (let i = 0; i < 5; i++) s = nextStreak(s, 'nope', 'long')
    expect(s).toBe(0)
    expect(s).toBeLessThan(TASTE_PROTEIN_STREAK)
  })

  it('other «No para mí» add up, a yes resets, «No la conozco» leaves it', () => {
    let s = nextStreak(0, 'nope', 'dish')
    s = nextStreak(s, 'nope', null)
    s = nextStreak(s, 'skip')
    expect(s).toBe(2)
    s = nextStreak(s, 'nope', 'ingredient')
    expect(s).toBe(TASTE_PROTEIN_STREAK)
    expect(nextStreak(s, 'like')).toBe(0)
    expect(nextStreak(2, 'love')).toBe(0)
  })
})
