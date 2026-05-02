"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * One running cooking timer. State is recomputed every tick from the
 * absolute timestamp (`endsAt`) instead of an interval-counted variable
 * — so backgrounding the tab and returning later still produces the
 * correct remaining time on the next tick.
 */
export interface StepTimer {
  /** The recipe step the timer belongs to (its index). Stable identifier. */
  stepIndex: number
  /** Total programmed duration in seconds. */
  totalSec: number
  /** Seconds left right now. 0 when expired. */
  remainingSec: number
  /** True while the timer is counting down. */
  running: boolean
  /** True while the timer is paused (manually). */
  paused: boolean
  /**
   * True once the timer has reached 0. Stays true until the user
   * dismisses the alert (the timer entry is then removed).
   */
  expired: boolean
}

interface InternalState {
  totalSec: number
  /** Wall clock at which the timer is supposed to fire (only valid while running). */
  endsAt: number | null
  /** Remaining seconds frozen while paused. */
  pausedRemainingSec: number | null
  /** Has the on-expire callback fired already? */
  firedExpire: boolean
}

interface UseStepTimersOptions {
  /** Called once per timer when it transitions from running → expired. */
  onExpire?: (stepIndex: number) => void
}

/**
 * Manage multiple cooking timers concurrently. State is in-memory only
 * (no persistence — closing the tab discards everything, per the spec).
 */
export function useStepTimers(opts: UseStepTimersOptions = {}) {
  const onExpireRef = useRef(opts.onExpire)
  useEffect(() => {
    onExpireRef.current = opts.onExpire
  }, [opts.onExpire])

  // The mutable internal state — keyed by step index. We keep this on a
  // ref so async callbacks (the tick + expire firing) read the latest.
  const internalRef = useRef(new Map<number, InternalState>())

  // The render-state — derived from `internalRef` on every tick.
  const [snapshot, setSnapshot] = useState<StepTimer[]>([])

  const recompute = useCallback(() => {
    const now = Date.now()
    const out: StepTimer[] = []
    let didFire = false
    internalRef.current.forEach((state, stepIndex) => {
      let remainingSec: number
      let running: boolean
      let paused: boolean
      let expired: boolean

      if (state.pausedRemainingSec != null) {
        remainingSec = state.pausedRemainingSec
        running = false
        paused = true
        expired = false
      } else if (state.endsAt != null) {
        const ms = state.endsAt - now
        remainingSec = Math.max(0, Math.ceil(ms / 1000))
        if (ms <= 0) {
          remainingSec = 0
          running = false
          paused = false
          expired = true
          if (!state.firedExpire) {
            state.firedExpire = true
            didFire = true
            // Defer the callback so we don't run side effects mid-render.
            queueMicrotask(() => onExpireRef.current?.(stepIndex))
          }
        } else {
          running = true
          paused = false
          expired = false
        }
      } else {
        // shouldn't happen, but stay defensive
        remainingSec = state.totalSec
        running = false
        paused = false
        expired = false
      }

      out.push({
        stepIndex,
        totalSec: state.totalSec,
        remainingSec,
        running,
        paused,
        expired,
      })
    })
    out.sort((a, b) => a.stepIndex - b.stepIndex)
    setSnapshot(out)
    void didFire
  }, [])

  // Tick once per second whenever any timer is currently running. We
  // start the interval lazily (no idle wake-ups when nothing's running).
  useEffect(() => {
    const anyRunning = snapshot.some((t) => t.running)
    if (!anyRunning) return
    const id = window.setInterval(recompute, 250)
    return () => window.clearInterval(id)
  }, [snapshot, recompute])

  const start = useCallback(
    (stepIndex: number, durationMin: number) => {
      const totalSec = Math.max(1, Math.round(durationMin * 60))
      internalRef.current.set(stepIndex, {
        totalSec,
        endsAt: Date.now() + totalSec * 1000,
        pausedRemainingSec: null,
        firedExpire: false,
      })
      recompute()
    },
    [recompute],
  )

  const pause = useCallback(
    (stepIndex: number) => {
      const state = internalRef.current.get(stepIndex)
      if (!state) return
      if (state.pausedRemainingSec != null) return // already paused
      if (state.endsAt == null) return
      const remainingSec = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000))
      state.pausedRemainingSec = remainingSec
      state.endsAt = null
      recompute()
    },
    [recompute],
  )

  const resume = useCallback(
    (stepIndex: number) => {
      const state = internalRef.current.get(stepIndex)
      if (!state || state.pausedRemainingSec == null) return
      state.endsAt = Date.now() + state.pausedRemainingSec * 1000
      state.pausedRemainingSec = null
      recompute()
    },
    [recompute],
  )

  const reset = useCallback(
    (stepIndex: number, durationMin: number) => {
      // Reset to the original duration, paused (so the user can press play again).
      const totalSec = Math.max(1, Math.round(durationMin * 60))
      internalRef.current.set(stepIndex, {
        totalSec,
        endsAt: null,
        pausedRemainingSec: totalSec,
        firedExpire: false,
      })
      recompute()
    },
    [recompute],
  )

  const cancel = useCallback(
    (stepIndex: number) => {
      internalRef.current.delete(stepIndex)
      recompute()
    },
    [recompute],
  )

  const get = useCallback(
    (stepIndex: number): StepTimer | undefined => {
      return snapshot.find((t) => t.stepIndex === stepIndex)
    },
    [snapshot],
  )

  return {
    timers: snapshot,
    /** Convenience accessor — undefined when no timer is registered for that step. */
    get,
    /** Begin a fresh timer for `stepIndex` (cancels any prior one). */
    start,
    pause,
    resume,
    /** Resets the timer to its full duration, paused. */
    reset,
    /** Removes the timer entry entirely (used to dismiss the expired banner). */
    cancel,
  }
}
