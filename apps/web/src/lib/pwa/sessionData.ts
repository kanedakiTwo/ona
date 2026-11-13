import { del } from "idb-keyval"

/** Workbox cache that holds API responses for offline use (next.config.ts). */
export const API_CACHE_NAME = "api-cache"

/** idb-keyval key of the offline mutation queue (offlineQueue.ts). */
export const OFFLINE_QUEUE_KEY = "ona-offline-queue"

/**
 * Run one clean-up step; whatever it throws or rejects with is dropped.
 *
 * Not `step().catch(…)`: idb-keyval opens the database synchronously inside
 * `del()`, so where IndexedDB is missing or blocked (some iPhone in-app
 * browsers, storage turned off) it throws before there is a promise to catch.
 * That throw used to reject `register()` after the account was already made
 * (PRO-354).
 */
async function quietly(step: () => Promise<unknown>): Promise<void> {
  try {
    await step()
  } catch {
    // Nothing of the previous session to forget here.
  }
}

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
    quietly(() => (typeof caches !== "undefined" ? caches.delete(API_CACHE_NAME) : Promise.resolve(false))),
    quietly(() => del(OFFLINE_QUEUE_KEY)),
  ])
}
