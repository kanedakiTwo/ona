/// <reference lib="webworker" />
/**
 * Custom Service Worker code injected by `next-pwa` into the build's
 * generated SW (see `apps/web/next.config.ts`).
 *
 * Responsible for two browser events that the auto-generated PWA SW
 * does not handle:
 *
 *   - `push`               — runtime arrival of a Web Push payload from
 *                            the API (via `web-push.sendNotification`).
 *                            Render it as a system notification with
 *                            cream-on-ink styling controlled by the
 *                            icon path and tag.
 *
 *   - `notificationclick`  — user taps the notification. Bring an open
 *                            ONA tab to the front if possible, else
 *                            open the URL embedded in the payload.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

declare const self: ServiceWorkerGlobalScope

interface PushPayload {
  title: string
  body: string
  url?: string
  icon?: string
  tag?: string
}

self.addEventListener("push", (event: any) => {
  if (!event.data) return
  let payload: PushPayload
  try {
    payload = event.data.json() as PushPayload
  } catch {
    // Defensive — if the API ever sends a non-JSON payload, still surface
    // *something* rather than swallow the wakeup.
    payload = { title: "ONA", body: event.data.text() }
  }

  const url = payload.url ?? "/menu"
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon ?? "/icons/icon-192.png",
      badge: "/icons/icon-192-maskable.png",
      data: { url },
      tag: payload.tag,
    })
  )
})

self.addEventListener("notificationclick", (event: any) => {
  event.notification.close()
  const url = (event.notification.data as { url?: string })?.url ?? "/"
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList: readonly WindowClient[]) => {
      for (const client of clientList) {
        if (client.url.endsWith(url) && "focus" in client) {
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})

export {}
