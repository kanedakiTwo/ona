/**
 * Keeping the installed app on the latest version (2026-10-21). The app
 * installed on a desktop (PWA, its own window) has no reload button and stays
 * open for days: next-pwa activates a new service worker at once
 * (`skipWaiting`), but the open window keeps running the old JavaScript until
 * it reloads. So:
 *
 *   - when a new worker takes control (`controllerchange`) of a page that was
 *     already controlled, reload — once, and on the next move inside the app
 *     (the page has just changed, so nothing half-typed is lost): never on the
 *     first install (a page with no worker yet) and never twice in a row (no
 *     loops);
 *   - when the app comes back to the screen (`visibilitychange` → visible), ask
 *     the browser to check for a new worker, at most once a minute.
 *
 * Pure decisions here (tested in apps/api/src/tests/swUpdate.test.ts); the
 * wiring lives in components/pwa/ServiceWorkerRegistration.tsx.
 */

/** sessionStorage key: when this tab last reloaded for a new worker (ms). */
export const SW_RELOAD_KEY = "ona.sw.reloadedAt"
/** A second new worker within this window doesn't reload again (no loops). */
export const SW_RELOAD_COOLDOWN_MS = 30_000
/** At most one update check per this interval when the app comes back. */
export const SW_UPDATE_CHECK_MS = 60_000

export interface ReloadState {
  /** The page had a controlling worker when it loaded (false = first install). */
  hadController: boolean
  /** Already reloading in this page. */
  reloading: boolean
  /** Last reload for a new worker in this tab (ms), from sessionStorage. */
  lastReloadAt: number | null
  now: number
}

/** Should a `controllerchange` reload the page (on the next move inside the app)? */
export function shouldReloadOnControllerChange(s: ReloadState): boolean {
  if (!s.hadController || s.reloading) return false
  if (s.lastReloadAt != null && s.now - s.lastReloadAt >= 0 && s.now - s.lastReloadAt < SW_RELOAD_COOLDOWN_MS) return false
  return true
}

/** Should coming back to the app ask for an update now? */
export function shouldCheckForUpdate(visibility: string, now: number, lastCheckAt: number | null): boolean {
  if (visibility !== "visible") return false
  return lastCheckAt == null || now - lastCheckAt >= SW_UPDATE_CHECK_MS
}

/** Reads the last reload time, tolerating blocked or empty storage. */
export function readLastReload(storage: Pick<Storage, "getItem"> | null | undefined): number | null {
  try {
    const raw = storage?.getItem(SW_RELOAD_KEY)
    const n = raw == null ? NaN : Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/**
 * Reload now? Only once a new version is waiting and the person has moved to
 * another page of the app: reloading the page they are on could throw away a
 * recipe half written or an answer half typed.
 */
export function shouldReloadOnNavigation(s: { updatePending: boolean; reloading: boolean; fromPath: string | null; toPath: string }): boolean {
  return s.updatePending && !s.reloading && s.fromPath != null && s.fromPath !== s.toPath
}
