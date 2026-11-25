/**
 * PRO-1036: is the device really without network?
 *
 * `navigator.onLine` false alone is not enough: a headless Chromium with no
 * network interface of its own (it reaches the web through a proxy, like the
 * test households' tool) says `false` while every page loads and saves — and
 * the app showed «Sin conexión» everywhere, over the menu's week arrows, and
 * queued changes that never replayed. So `onLine` true is trusted at once and
 * `onLine` false is checked with a request to the API's `/health` (no cache,
 * no service-worker route): offline only when that request fails by network.
 * A 4xx/5xx answer, or one that takes longer than the timeout, is not «sin
 * conexión».
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "")
const PROBE_TIMEOUT_MS = 8_000
/** A burst of mutations (ticking several items) asks the network once. */
const REUSE_MS = 3_000

let last: { at: number; offline: boolean } | null = null
let inFlight: Promise<boolean> | null = null

async function probeFailsByNetwork(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    await fetch(`${API_URL}/health`, { cache: "no-store", signal: controller.signal })
    return false
  } catch (err) {
    // Slow is not offline: only a fetch rejected by the network counts.
    return !(err instanceof DOMException && err.name === "AbortError")
  } finally {
    clearTimeout(timer)
  }
}

/** True only when the browser has no network: `onLine` false *and* the API can't be reached. */
export async function isOffline(): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.onLine) return false
  if (last && Date.now() - last.at < REUSE_MS) return last.offline
  inFlight ??= probeFailsByNetwork()
    .then((offline) => {
      last = { at: Date.now(), offline }
      return offline
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/** Forget the last answer (the `online` / `offline` events: the network changed). */
export function forgetNetworkCheck(): void {
  last = null
}
