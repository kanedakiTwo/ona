import { describe, expect, it } from 'vitest'
import { catalogCacheIsUsable } from '../services/recipePersistence.js'

const TTL = 60_000

describe('catalogCacheIsUsable — a just-created ingredient is never missing from the save', () => {
  const cache = { loadedAt: 1_000, ids: new Set(['aceite', 'sal']) }

  it('reuses a fresh cache that has every ingredient of the recipe', () => {
    expect(catalogCacheIsUsable(cache, 2_000, ['aceite', 'sal'])).toBe(true)
  })

  it('reloads when the recipe uses an ingredient created after the cache was loaded', () => {
    // The import creates «pasta lazos» and saves the recipe a few seconds
    // later: with the stale cache, the reviewer didn't know its words and the
    // recipe's allergens and nutrition left it out.
    expect(catalogCacheIsUsable(cache, 2_000, ['aceite', 'pasta-lazos'])).toBe(false)
  })

  it('reloads when the cache has expired or was never loaded', () => {
    expect(catalogCacheIsUsable(cache, 1_000 + TTL, ['aceite'])).toBe(false)
    expect(catalogCacheIsUsable(null, 2_000, [])).toBe(false)
  })
})
