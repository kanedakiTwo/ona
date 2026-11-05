/**
 * GET /red/status (specs/red-tiendas.md), con el router real
 * en un puerto efímero. La sesión, el interruptor, el hogar y los ajustes son falsos.
 *
 *   apagada   → exactamente { enabled: false, postalCode: null } (sin descuento)
 *   encendida → { enabled: true, postalCode, discountPct } con el % de red_settings
 *
 * Run: pnpm --filter @ona/api test src/tests/redStatusRoute.test.ts
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RED_SETTINGS } from '@ona/shared'

vi.mock('../db/connection.js', () => ({ db: {} }))
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    const userId = req.get('x-test-user')
    if (!userId) return void res.status(401).json({ error: 'No token provided' })
    req.userId = userId
    next()
  },
}))
const h = vi.hoisted(() => ({
  enabled: vi.fn(async (_userId: string) => true),
  household: vi.fn(async (_userId: string) => 'hh-1' as string | null),
  householdRed: vi.fn(async (_hh: string) => ({ postalCode: '28001' as string | null })),
  settings: vi.fn(async () => ({ discountPct: 7 })),
}))
vi.mock('../services/red/flag.js', () => ({ redEnabledFor: h.enabled }))
vi.mock('../services/scopeResolver.js', () => ({ getPrimaryHouseholdId: h.household }))
vi.mock('../services/red/store.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/red/store.js')>()),
  getHouseholdRed: h.householdRed,
  getRedSettings: h.settings,
}))

const { default: redRouter } = await import('../routes/red.js')

let server: Server
let base = ''

beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use(redRouter)
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server?.closeAllConnections()
  server?.close()
})

beforeEach(() => {
  h.enabled.mockReset().mockResolvedValue(true)
  h.household.mockReset().mockResolvedValue('hh-1')
  h.householdRed.mockReset().mockResolvedValue({ postalCode: '28001' })
  h.settings.mockReset().mockResolvedValue({ ...DEFAULT_RED_SETTINGS, discountPct: 7 })
})

const status = () => fetch(`${base}/red/status`, { headers: { 'x-test-user': 'u1' } })

describe('GET /red/status', () => {
  it('apagada: exactamente { enabled: false, postalCode: null }, sin leer el hogar ni los ajustes', async () => {
    h.enabled.mockResolvedValue(false)
    const res = await status()
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ enabled: false, postalCode: null })
    expect(h.household).not.toHaveBeenCalled()
    expect(h.settings).not.toHaveBeenCalled()
  })

  it('encendida: el código postal del hogar y el descuento vivo de red_settings', async () => {
    const res = await status()
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ enabled: true, postalCode: '28001', discountPct: 7 })
  })

  it('encendida sin hogar: postalCode null, con el descuento', async () => {
    h.household.mockResolvedValue(null)
    expect(await (await status()).json()).toStrictEqual({ enabled: true, postalCode: null, discountPct: 7 })
    expect(h.householdRed).not.toHaveBeenCalled()
  })

  it('sin sesión: 401', async () => {
    expect((await fetch(`${base}/red/status`)).status).toBe(401)
  })
})
