/**
 * Client-side helpers for Web Push.
 *
 * Three concerns split out from the React hook so they're testable and
 * reusable:
 *
 *   - `isWebPushSupported()` — feature-detection (Service Worker +
 *     PushManager + Notification API). iOS Safari only ships these
 *     when the PWA has been installed to the home screen, so it's
 *     normal for them to be absent until then.
 *
 *   - `urlBase64ToUint8Array()` — RFC 8292 requires the VAPID public
 *     key in a Uint8Array, but the API ships it as a URL-safe base64
 *     string; this helper does the conversion `pushManager.subscribe`
 *     expects.
 *
 *   - `getOrCreatePushSubscription()` — idempotent: returns the
 *     existing subscription if present, otherwise prompts the user
 *     for permission and creates one.
 */

export function isWebPushSupported(): boolean {
  if (typeof window === "undefined") return false
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  // Allocate an ArrayBuffer explicitly so `applicationServerKey` (typed
  // `BufferSource`) accepts the result — strict TS 5.7 won't widen
  // `Uint8Array<ArrayBufferLike>` automatically.
  const buf = new ArrayBuffer(rawData.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < rawData.length; i += 1) out[i] = rawData.charCodeAt(i)
  return out
}

/**
 * Returns an active PushSubscription, prompting the user for permission
 * if they haven't granted it yet. Caller is responsible for sending the
 * resulting object to the API via `POST /push/subscribe`.
 *
 * Throws when:
 *   - the browser doesn't support push (call `isWebPushSupported()` first),
 *   - the user denies permission,
 *   - the service worker isn't registered.
 */
export async function getOrCreatePushSubscription(
  vapidPublicKey: string,
): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready
  const existing = await reg.pushManager.getSubscription()
  if (existing) return existing

  if (Notification.permission === "default") {
    const perm = await Notification.requestPermission()
    if (perm !== "granted") {
      throw new Error("notifications-denied")
    }
  } else if (Notification.permission === "denied") {
    throw new Error("notifications-denied")
  }

  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    // TS 5.7 narrowed BufferSource to `ArrayBufferView<ArrayBuffer>`, but
    // `Uint8Array` is typed as `Uint8Array<ArrayBufferLike>`. The runtime
    // is identical so we cast explicitly at the boundary.
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
  })
}
