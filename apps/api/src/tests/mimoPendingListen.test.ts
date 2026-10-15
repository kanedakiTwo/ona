/**
 * PRO-79: Mimo opens the mic 150 ms after the panel opens
 * (`open({ listen: true })` in MimoProvider). That delayed start must be
 * cancellable, so «Parar», turning hands-free off or closing the panel inside
 * those 150 ms leaves the mic off (apps/web/src/lib/pendingListen.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPendingListen } from '../../../web/src/lib/pendingListen'

describe('createPendingListen', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts listening after the delay', () => {
    const listen = vi.fn()
    const pending = createPendingListen()
    pending.schedule(listen, 150)
    expect(pending.isPending()).toBe(true)
    vi.advanceTimersByTime(149)
    expect(listen).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(listen).toHaveBeenCalledTimes(1)
    expect(pending.isPending()).toBe(false)
  })

  it('«Parar» before 150 ms: the mic never turns on', () => {
    const listen = vi.fn()
    const pending = createPendingListen()
    pending.schedule(listen, 150)
    vi.advanceTimersByTime(50)
    pending.cancel()
    vi.advanceTimersByTime(10_000)
    expect(listen).not.toHaveBeenCalled()
    expect(pending.isPending()).toBe(false)
  })

  it('a new schedule replaces the previous one (one start, not two)', () => {
    const listen = vi.fn()
    const pending = createPendingListen()
    pending.schedule(listen, 150)
    vi.advanceTimersByTime(100)
    pending.schedule(listen, 150)
    vi.advanceTimersByTime(1_000)
    expect(listen).toHaveBeenCalledTimes(1)
  })

  it('cancel with nothing pending is harmless', () => {
    const pending = createPendingListen()
    expect(() => pending.cancel()).not.toThrow()
  })
})
