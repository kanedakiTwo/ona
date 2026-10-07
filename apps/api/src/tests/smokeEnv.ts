/**
 * Shared environment for the route smoke tests (`*.smoke.ts` files that hit a
 * running API over HTTP).
 *
 * Reachability is probed ONCE, at module load, with top-level await — so the
 * answer exists when vitest *collects* the tests and evaluates `it.skipIf(…)`.
 * The previous per-file pattern
 *
 *   let reachable = false
 *   beforeAll(async () => { reachable = await isApiReachable() })
 *   it.skipIf(!reachable)(…)
 *
 * evaluated `skipIf(!reachable)` at collection time, before `beforeAll` ran,
 * so every route smoke test was always skipped — including in CI, where the
 * API was up and the suite reported green without executing anything.
 *
 * Locally (no API running) the smoke files still skip cleanly. When
 * `SMOKE_REQUIRED=true` (set by the CI smoke job and `scripts/test-smoke.sh`)
 * a missing API, token or user id is a hard failure instead of a silent skip.
 */

export const API_URL = process.env.API_URL ?? 'http://localhost:8000'
export const TOKEN = process.env.SMOKE_USER_TOKEN ?? ''
export const USER_ID = process.env.SMOKE_USER_ID ?? ''
export const SMOKE_REQUIRED = process.env.SMOKE_REQUIRED === 'true'

export async function isApiReachable(baseUrl: string = API_URL): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 1500)
  try {
    const r = await fetch(`${baseUrl}/health`, { signal: ctrl.signal })
    return r.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

/** True when `${API_URL}/health` answered 2xx at module load. */
export const reachable: boolean = await isApiReachable()

if (SMOKE_REQUIRED) {
  const problems: string[] = []
  if (!reachable) problems.push(`API not reachable at ${API_URL}/health`)
  if (!TOKEN) problems.push('SMOKE_USER_TOKEN is empty')
  if (!USER_ID) problems.push('SMOKE_USER_ID is empty')
  if (problems.length > 0) {
    throw new Error(
      `SMOKE_REQUIRED=true but the smoke environment is incomplete: ${problems.join('; ')}`,
    )
  }
}

/** JSON + bearer headers for the smoke user. */
export const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
})
