/**
 * One monthly € cap on all paid AI work, read from the cost ledger. Before
 * 2026-10-07 only the text chat had a cap: imports, transcription,
 * nutrition estimates, images and voice could be called without limit.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { spendCapStatus } from '../services/spendCap.js'
import { requireSpendCapacity } from '../middleware/spendCap.js'

const spent = (eur: number) => async () => eur

describe('spendCapStatus', () => {
  it('is exceeded once the month reaches the cap', async () => {
    expect((await spendCapStatus('u', { capEur: 10, spent: spent(9.99) })).exceeded).toBe(false)
    expect((await spendCapStatus('u', { capEur: 10, spent: spent(10) })).exceeded).toBe(true)
  })

  it('cap 0 disables it; a ledger error fails open', async () => {
    expect((await spendCapStatus('u', { capEur: 0, spent: spent(999) })).exceeded).toBe(false)
    const boom = async () => { throw new Error('db down') }
    expect((await spendCapStatus('u', { capEur: 10, spent: boom })).exceeded).toBe(false)
  })
})

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined }
  res.status = (c: number) => ((res.statusCode = c), res)
  res.json = (b: unknown) => ((res.body = b), res)
  return res
}

describe('requireSpendCapacity', () => {
  const over = async () => ({ exceeded: true, spentEur: 10.4, capEur: 10 })

  it('answers 429 SPEND_CAP_EXCEEDED and stops the request', async () => {
    const res = fakeRes()
    const next = vi.fn()
    await requireSpendCapacity(over)({ userId: 'u', user: { role: 'user' } } as any, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(429)
    expect(res.body).toMatchObject({ code: 'SPEND_CAP_EXCEEDED', capEur: 10 })
    expect(res.body.error).toMatch(/límite de uso de la IA/)
  })

  it('lets admins and users under the cap through', async () => {
    const next = vi.fn()
    await requireSpendCapacity(over)({ userId: 'a', user: { role: 'admin' } } as any, fakeRes(), next)
    await requireSpendCapacity(async () => ({ exceeded: false, spentEur: 1, capEur: 10 }))({ userId: 'u', user: { role: 'user' } } as any, fakeRes(), next)
    expect(next).toHaveBeenCalledTimes(2)
  })
})

describe('every route that pays a provider checks the cap', () => {
  const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'routes')
  const read = (f: string) => readFileSync(join(SRC, f), 'utf8')
  it.each([
    ['recipes.ts', "'/recipes/extract-from-image'"],
    ['recipes.ts', "'/recipes/extract-from-url'"],
    ['recipes.ts', "'/recipes/:id/regenerate-image'"],
    ['ingredients.ts', "'/ingredients/auto-create'"],
    ['ingredients.ts', "'/ingredients/estimate-nutrition'"],
    ['assistant.ts', "'/assistant/:userId/chat'"],
    ['stt.ts', "'/stt'"],
    ['tts.ts', "'/tts'"],
    ['shopOrders.ts', "'/shop-orders/:id/quote'"],
  ])('%s %s', (file, route) => {
    const src = read(file)
    const at = src.indexOf(route)
    expect(at, `${route} not found`).toBeGreaterThan(-1)
    // The middleware list sits between the path and the handler.
    const decl = src.slice(at, src.indexOf('async (req', at))
    expect(decl).toContain('requireSpendCapacity()')
  })
})
