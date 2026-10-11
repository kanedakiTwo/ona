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
