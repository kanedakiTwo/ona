/**
 * «Manos libres» rules (PRO-55, specs/voice-mode.md). Pure, so the API's
 * vitest suite can pin them (apps/api/src/tests/mimoHandsFreeCook.test.ts).
 *
 * Outside cook mode, a silence ends hands-free quietly. In cook mode
 * (`/recipes/<id>/cook`) your hands are busy, so a silence only means
 * "nothing to say yet": Mimo listens again, without sending anything to
 * transcribe. Hands-free ends when you turn it off, tap «Parar» or leave
 * cook mode.
 */

export function isCookPath(pathname: string | null): boolean {
  return !!pathname && /^\/recipes\/[^/]+\/cook(\/|$)/.test(pathname)
}

/**
 * Nobody spoke during a hands-free turn. `micError` is set when the mic
 * itself failed (no permission, no device): then hands-free always stops,
 * or it would loop on the error.
 */
export function handsFreeAfterSilence(pathname: string | null, micError: string | null): 'listen-again' | 'stop' {
  return isCookPath(pathname) && !micError ? 'listen-again' : 'stop'
}

/** Hands-free started in cook mode stops when you leave it. */
export function leavesCookMode(previous: string | null, next: string | null): boolean {
  return isCookPath(previous) && !isCookPath(next)
}

/** Silence after speech that closes your turn when you tap the mic (PRO-87). */
export const TAP_SILENCE_MS = 1300
/** In hands-free (also in cook mode) Mimo waits longer in a pause (PRO-87). */
export const HANDS_FREE_SILENCE_MS = 2500

export function turnSilenceMs(handsFree: boolean): number {
  return handsFree ? HANDS_FREE_SILENCE_MS : TAP_SILENCE_MS
}
