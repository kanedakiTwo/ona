/**
 * PRO-87: in hands-free (also in cook mode) Mimo waits longer in a pause
 * before closing your turn — 2.5 s of silence instead of 1.3 s. Tapping the
 * mic by hand keeps 1.3 s (apps/web/src/lib/mimoHandsFree.ts → turnSilenceMs,
 * used by MimoProvider for every `recorder.start`).
 */
import { describe, expect, it } from 'vitest'
import { HANDS_FREE_SILENCE_MS, TAP_SILENCE_MS, turnSilenceMs } from '../../../web/src/lib/mimoHandsFree'

describe('turnSilenceMs', () => {
  it('hands-free: 2.5 s of silence closes the turn', () => {
    expect(turnSilenceMs(true)).toBe(2500)
    expect(HANDS_FREE_SILENCE_MS).toBe(2500)
  })

  it('mic tapped by hand: still 1.3 s', () => {
    expect(turnSilenceMs(false)).toBe(1300)
    expect(TAP_SILENCE_MS).toBe(1300)
  })
})
