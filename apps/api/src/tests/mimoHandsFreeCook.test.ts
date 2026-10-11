/**
 * PRO-55 «Mimo, manos libres» in cook mode (apps/web/src/lib/mimoHandsFree.ts):
 * in `/recipes/<id>/cook` a silence does not end hands-free — Mimo listens
 * again — while everywhere else it still ends quietly. A broken mic always
 * stops it, and leaving cook mode turns it off.
 */
import { describe, expect, it } from 'vitest'
import { handsFreeAfterSilence, isCookPath, leavesCookMode } from '../../../web/src/lib/mimoHandsFree'

const COOK = '/recipes/0b7c3a52-1111-4222-8333-944455556666/cook'

describe('handsFreeAfterSilence', () => {
  it('in cook mode a silence means listen again', () => {
    expect(handsFreeAfterSilence(COOK, null)).toBe('listen-again')
    expect(handsFreeAfterSilence(`${COOK}/`, null)).toBe('listen-again')
  })

  it('outside cook mode a silence still ends hands-free', () => {
    for (const path of ['/menu', '/recipes', '/recipes/abc', '/shopping', '/profile', null]) {
      expect(handsFreeAfterSilence(path, null)).toBe('stop')
    }
  })

  it('a mic error stops it even in cook mode (no endless retry)', () => {
    expect(handsFreeAfterSilence(COOK, 'No encuentro ningún micrófono.')).toBe('stop')
  })
})

describe('leavesCookMode', () => {
  it('is true only when going from cook mode to somewhere else', () => {
    expect(leavesCookMode(COOK, '/recipes/abc')).toBe(true)
    expect(leavesCookMode(COOK, '/menu')).toBe(true)
    expect(leavesCookMode(COOK, COOK)).toBe(false)
    expect(leavesCookMode('/menu', COOK)).toBe(false)
    expect(leavesCookMode('/menu', '/recipes')).toBe(false)
  })
})

describe('isCookPath', () => {
  it('matches the cook route only', () => {
    expect(isCookPath(COOK)).toBe(true)
    expect(isCookPath('/recipes/new')).toBe(false)
    expect(isCookPath('/recipes/abc/edit')).toBe(false)
    expect(isCookPath('/recipes/abc/cooked')).toBe(false)
  })
})
