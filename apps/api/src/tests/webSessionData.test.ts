/**
 * PRO-354: `clearSessionData` (apps/web/src/lib/pwa/sessionData.ts) runs inside
 * `register()` and `login()`, after the API has answered and before the token
 * is saved. It must never throw: where IndexedDB is missing or blocked
 * (iPhone in-app browsers, storage turned off) idb-keyval throws synchronously,
 * and that used to turn a created account into an error on /register.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { clearSessionData } from '../../../web/src/lib/pwa/sessionData'

const g = globalThis as Record<string, unknown>
const KEYS = ['window', 'indexedDB', 'caches'] as const
const saved = Object.fromEntries(KEYS.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)]))

function browser(globals: Partial<Record<(typeof KEYS)[number], unknown>>) {
  g.window = {}
  for (const k of ['indexedDB', 'caches'] as const) {
    if (k in globals) g[k] = globals[k]
    else delete g[k]
  }
}

afterEach(() => {
  for (const k of KEYS) {
    const d = saved[k]
    if (d) Object.defineProperty(g, k, d)
    else delete g[k]
  }
})

describe('clearSessionData', () => {
  it('resolves when IndexedDB does not exist (ReferenceError inside idb-keyval)', async () => {
    browser({})
    await expect(clearSessionData()).resolves.toBeUndefined()
  })

  it('resolves when IndexedDB is null or its open() throws (TypeError, SecurityError)', async () => {
    browser({ indexedDB: null })
    await expect(clearSessionData()).resolves.toBeUndefined()
    browser({
      indexedDB: {
        open() {
          throw new DOMException('The operation is insecure.', 'SecurityError')
        },
      },
    })
    await expect(clearSessionData()).resolves.toBeUndefined()
  })

  it('resolves when the Cache API throws instead of rejecting', async () => {
    browser({
      caches: {
        delete() {
          throw new TypeError("undefined is not an object (evaluating 'caches.delete')")
        },
      },
    })
    await expect(clearSessionData()).resolves.toBeUndefined()
  })

  it('still deletes the API cache when it can', async () => {
    const deleted: string[] = []
    browser({ caches: { delete: async (name: string) => (deleted.push(name), true) } })
    await clearSessionData()
    expect(deleted).toEqual(['api-cache'])
  })
})
