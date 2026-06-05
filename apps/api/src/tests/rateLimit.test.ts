/**
 * Pure-logic tests for the fixed-window rate limiter that guards the auth
 * endpoints. The Express wiring is thin; the load-bearing piece is the
 * counting + window-reset logic, so we test it directly with an injectable
 * clock (no timers, no server). A bug here either lets brute-force through or
 * locks out legitimate users.
 */
import { describe, expect, it } from 'vitest'
import { FixedWindowCounter } from '../middleware/rateLimit.js'

describe('FixedWindowCounter', () => {
  it('allows up to `max` hits within the window, then blocks', () => {
    const c = new FixedWindowCounter(3, 1000)
    expect(c.hit('ip', 0).allowed).toBe(true) // 1
    expect(c.hit('ip', 100).allowed).toBe(true) // 2
    expect(c.hit('ip', 200).allowed).toBe(true) // 3
    const fourth = c.hit('ip', 300)
    expect(fourth.allowed).toBe(false) // 4 → over
    expect(fourth.remaining).toBe(0)
  })

  it('reports remaining hits accurately', () => {
    const c = new FixedWindowCounter(2, 1000)
    expect(c.hit('ip', 0).remaining).toBe(1)
    expect(c.hit('ip', 1).remaining).toBe(0)
  })

  it('resets once the window elapses', () => {
    const c = new FixedWindowCounter(2, 1000)
    c.hit('ip', 0)
    c.hit('ip', 1)
    expect(c.hit('ip', 2).allowed).toBe(false) // blocked inside window
    // At/after resetAt (0 + 1000) the bucket starts fresh.
    expect(c.hit('ip', 1000).allowed).toBe(true)
    expect(c.hit('ip', 1001).allowed).toBe(true)
  })

  it('keys are independent — one IP hitting the cap does not block another', () => {
    const c = new FixedWindowCounter(1, 1000)
    expect(c.hit('a', 0).allowed).toBe(true)
    expect(c.hit('a', 1).allowed).toBe(false)
    expect(c.hit('b', 1).allowed).toBe(true) // different key, own budget
  })

  it('prune() drops only elapsed buckets', () => {
    const c = new FixedWindowCounter(5, 1000)
    c.hit('old', 0)
    c.hit('fresh', 900)
    c.prune(1000) // 'old' window (0+1000) is up; 'fresh' (900+1000) is not
    expect(c.size()).toBe(1)
  })
})
