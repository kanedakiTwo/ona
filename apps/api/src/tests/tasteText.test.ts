/**
 * PRO-200 (hogares de prueba, 2026-10-17): «No me gusta las lentejas», «el
 * atun», and three «Es muy largo» to fish dishes ending in «¿No coméis
 * pescado?». Pure helpers of the «Afina tu menú» swiper.
 */
import { describe, expect, it } from 'vitest'
import { TASTE_PROTEIN_STREAK } from '@ona/shared'
import { dislikeChipText, nextStreak, swipeStamps, swipeVerdict } from '../../../web/src/lib/tasteText'
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

describe('the swipe on a card: the main direction wins (a beta tester, 2026-10-22)', () => {
  it('up with a thumb that drifts to a side is «Me encanta», not «No para mí»', () => {
    expect(swipeVerdict(-120, -200)).toBe('love')
    expect(swipeVerdict(130, -180)).toBe('love')
    expect(swipeVerdict(0, -120)).toBe('love')
  })
  it('mostly to a side is «Me apetece» or «No para mí»; too short is nothing', () => {
    expect(swipeVerdict(180, -40)).toBe('like')
    expect(swipeVerdict(-180, -60)).toBe('nope')
    expect(swipeVerdict(60, -50)).toBeNull()
    expect(swipeVerdict(-90, 20)).toBeNull()
    expect(swipeVerdict(0, 150)).toBeNull()
  })
  it('while dragging, only the main direction\'s stamp shows', () => {
    expect(swipeStamps(-120, -200)).toEqual({ like: 0, nope: 0, love: 1 })
    expect(swipeStamps(-150, -60)).toEqual({ like: 0, nope: 1, love: 0 })
    expect(swipeStamps(50, -10).like).toBeCloseTo(0.5)
  })
})

