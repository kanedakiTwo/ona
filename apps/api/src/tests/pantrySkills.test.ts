/**
 * The assistant's "¿qué tengo en casa?" reads the real pantry (pantry_items,
 * what /pantry shows) plus the list's "ya lo tengo" flags; "tengo X" / "se me
 * acabó X" write both. Before 2026-10-07 it only saw the list flags.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const pantry: any[] = []
vi.mock('../services/pantryStore.js', () => ({
  NoHouseholdError: class NoHouseholdError extends Error {},
  listPantryForUser: vi.fn(async () => pantry),
  addPantryForUser: vi.fn(async (_u: string, input: any) => {
    const row = { id: `p-${pantry.length + 1}`, quantity: 0, unit: 'u', expiresAt: null, ...input }
    pantry.push(row)
    return row
  }),
  deletePantryForUser: vi.fn(async (_u: string, id: string) => {
    const i = pantry.findIndex((p) => p.id === id)
    if (i >= 0) pantry.splice(i, 1)
    return i >= 0
  }),
}))
vi.mock('../services/scopeResolver.js', () => ({
  resolveScope: vi.fn(async (userId: string) => ({ kind: 'user', value: userId })),
  scopeWhere: vi.fn(() => ({})),
  getPrimaryHouseholdId: vi.fn(async () => 'h-1'),
}))

import { skills } from '../services/assistant/skills.js'
import { addPantryForUser, deletePantryForUser } from '../services/pantryStore.js'

const get = (n: string) => skills.find((s) => s.name === n)!
/** Chainable fake db: every awaited query returns the next queued value. */
function makeDb(...responses: any[]) {
  const queue = [...responses]
  const node: any = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res: any) => Promise.resolve(queue.shift()).then(res)
      return () => node
    },
  })
  return node
}
const ctx = (db: any) => ({ userId: 'u-1', db })

describe('get_pantry_stock', () => {
  beforeEach(() => {
    pantry.length = 0
  })

  it('combines the pantry (quantities, expiry) with the list flags, without duplicates', async () => {
    pantry.push({ id: 'p-1', name: 'Arroz', quantity: 1, unit: 'kg', expiresAt: '2026-11-20' })
    const list = { id: 'sl-1', items: [{ name: 'arroz', inStock: true }, { name: 'leche', inStock: true }, { name: 'huevos', inStock: false }] }
    const r = await get('get_pantry_stock').handler({}, ctx(makeDb([list])))
    expect(r.summary).toBe('Tienes en casa: Arroz 1 kg (caduca 2026-11-20), leche.')
  })

  it('works with no shopping list at all', async () => {
    pantry.push({ id: 'p-1', name: 'Aceite', quantity: 0, unit: 'u', expiresAt: null })
    const r = await get('get_pantry_stock').handler({}, ctx(makeDb([])))
    expect(r.summary).toBe('Tienes en casa: Aceite.')
  })
})

describe('mark_in_stock', () => {
  beforeEach(() => {
    pantry.length = 0
    vi.mocked(addPantryForUser).mockClear()
    vi.mocked(deletePantryForUser).mockClear()
  })

  it('"tengo garbanzos" with no list → straight into the pantry', async () => {
    const r = await get('mark_in_stock').handler({ ingredient: 'garbanzos', inStock: true }, ctx(makeDb([])))
    expect(addPantryForUser).toHaveBeenCalledWith('u-1', { name: 'garbanzos' }, expect.anything())
    expect(r.summary).toContain('marcado como en casa')
  })

  it('"se me acabó el aceite" → off the list and out of the pantry', async () => {
    pantry.push({ id: 'p-9', name: 'Aceite de oliva', quantity: 1, unit: 'l', expiresAt: null })
    const item = { name: 'aceite de oliva', inStock: true }
    const r = await get('mark_in_stock').handler({ ingredient: 'aceite de oliva', inStock: false }, ctx(makeDb([{ id: 'sl-1', items: [item] }], undefined)))
    expect(item.inStock).toBe(false)
    expect(deletePantryForUser).toHaveBeenCalledWith('u-1', 'p-9', expect.anything())
    expect(r.summary).toContain('eliminado de la despensa')
  })
})
