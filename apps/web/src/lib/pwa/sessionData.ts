import { del } from "idb-keyval"

/** Workbox cache that holds API responses for offline use (next.config.ts). */
export const API_CACHE_NAME = "api-cache"

/** idb-keyval key of the offline mutation queue (offlineQueue.ts). */
export const OFFLINE_QUEUE_KEY = "ona-offline-queue"

/**
 * Forget what the previous session left on this device: the service worker's
 * cached API responses (keyed by URL, not by user, so the next person to log
 * in on this phone could read them offline) and offline mutations queued
 * under that user's token. Runs on login, register, logout and when the API
 * rejects the stored token. Never throws.
 */
export async function clearSessionData(): Promise<void> {
  if (typeof window === "undefined") return
  await Promise.all([
    typeof caches !== "undefined" ? caches.delete(API_CACHE_NAME).catch(() => false) : false,
    del(OFFLINE_QUEUE_KEY).catch(() => undefined),
  ])
}
