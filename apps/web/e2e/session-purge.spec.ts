/**
 * Logging out must wipe what the session left on the device: the service
 * worker's `api-cache` (API responses keyed by URL, not by user) and the
 * offline mutation queue (replayed under whoever logs in next). See
 * lib/pwa/sessionData.ts.
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const QUEUE_KEY = 'ona-offline-queue'

/** idb-keyval's default store, accessed raw so the test doesn't import app code. */
function idb(page: Page, op: 'put' | 'get') {
  return page.evaluate(
    ({ op, key }) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open('keyval-store')
        open.onupgradeneeded = () => open.result.createObjectStore('keyval')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const tx = open.result.transaction('keyval', op === 'put' ? 'readwrite' : 'readonly')
          const store = tx.objectStore('keyval')
          const req =
            op === 'put'
              ? store.put([{ id: 'q1', url: '/user/x/recipes/y/favorite', method: 'POST', timestamp: 1 }], key)
              : store.get(key)
          tx.oncomplete = () => {
            open.result.close()
            resolve(req.result)
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
    { op, key: QUEUE_KEY },
  )
}

test('logout clears the cached API responses and the offline queue', async ({ page }) => {
  await registerFreshUser(page)
  await completeOnboarding(page)

  await page.evaluate(async () => {
    const cache = await caches.open('api-cache')
    await cache.put('https://api.example.test/menu/someone', new Response('{"private":true}'))
  })
  await idb(page, 'put')
  expect(await page.evaluate(() => caches.has('api-cache'))).toBe(true)
  expect(await idb(page, 'get')).toBeTruthy()

  await page.goto('/profile')
  await page.getByRole('button', { name: /salir/i }).click()
  await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 })

  expect(await page.evaluate(() => caches.has('api-cache'))).toBe(false)
  expect(await idb(page, 'get')).toBeUndefined()
})
