/**
 * Red de tiendas: test shops never run or get assigned in production
 * (RAILWAY_ENVIRONMENT_NAME=production), while CI, staging and local runs see
 * them; scripts/redTestShops.ts only seeds a local database, or staging with
 * --yes, and never production.
 *
 * Run: pnpm --filter @ona/api test src/tests/redTestShops.test.ts
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { isLocalDbUrl, isProductionEnv, redShopUsable, testShopsDbRefusal } from '../services/red/testShops.js'
import { activeRedShops, isRedShopActive } from '../services/red/store.js'

const PROD = { RAILWAY_ENVIRONMENT_NAME: 'production' }
const STAGING = { RAILWAY_ENVIRONMENT_NAME: 'staging' }
const LOCAL = 'postgresql:///ona_red1a?host=/tmp'

describe('isProductionEnv', () => {
  it('only Railway production', () => {
    expect(isProductionEnv(PROD)).toBe(true)
    expect(isProductionEnv(STAGING)).toBe(false)
    expect(isProductionEnv({})).toBe(false)
    // NODE_ENV alone isn't Railway's production (CI, a local build).
    expect(isProductionEnv({ NODE_ENV: 'production' })).toBe(false)
  })
})

describe('isLocalDbUrl', () => {
  it('localhost, 127.0.0.1, ::1 and the /tmp socket are local', () => {
    expect(isLocalDbUrl('postgresql://postgres:postgres@localhost:5432/onatest')).toBe(true)
    expect(isLocalDbUrl('postgresql://postgres:postgres@127.0.0.1:5433/onatest')).toBe(true)
    expect(isLocalDbUrl('postgresql://postgres@[::1]:5432/onatest')).toBe(true)
    expect(isLocalDbUrl(LOCAL)).toBe(true)
  })
  it('anything else is not', () => {
    expect(isLocalDbUrl('postgresql://u:p@db.example.com:5432/ona')).toBe(false)
    // A name that only contains «localhost» is someone else's host.
    expect(isLocalDbUrl('postgresql://u:p@localhost.example.com/ona')).toBe(false)
    expect(isLocalDbUrl('postgresql://u:p@db.example.com/ona?note=localhost')).toBe(false)
    // A real host wins over a host= in the query.
    expect(isLocalDbUrl('postgresql://u:p@db.example.com/ona?host=/tmp')).toBe(false)
    expect(isLocalDbUrl('postgresql:///ona?host=/var/run/elsewhere')).toBe(false)
    expect(isLocalDbUrl('')).toBe(false)
    expect(isLocalDbUrl('not a url')).toBe(false)
  })
})

describe('testShopsDbRefusal', () => {
  it('local database: seeds', () => {
    expect(testShopsDbRefusal(LOCAL, {}, false)).toBeNull()
  })
  it('remote database: only with --yes (staging)', () => {
    expect(testShopsDbRefusal('postgresql://u:p@db.example.com/ona', STAGING, false)).toMatch(/no es local/)
    expect(testShopsDbRefusal('postgresql://u:p@db.example.com/ona', STAGING, true)).toBeNull()
  })
  it('production: never, not even with --yes or a local-looking URL', () => {
    expect(testShopsDbRefusal('postgresql://u:p@db.example.com/ona', PROD, true)).toMatch(/producción/)
    expect(testShopsDbRefusal(LOCAL, PROD, true)).toMatch(/producción/)
  })
})

describe('redShopUsable', () => {
  it('a real active shop: everywhere', () => {
    expect(redShopUsable({ status: 'activa', isTest: false }, PROD)).toBe(true)
    expect(redShopUsable({ status: 'activa', isTest: false }, {})).toBe(true)
  })
  it('a test shop: CI, local and staging, never production', () => {
    expect(redShopUsable({ status: 'activa', isTest: true }, {})).toBe(true)
    expect(redShopUsable({ status: 'activa', isTest: true }, STAGING)).toBe(true)
    expect(redShopUsable({ status: 'activa', isTest: true }, PROD)).toBe(false)
  })
  it('a paused shop: nowhere', () => {
    expect(redShopUsable({ status: 'pausada', isTest: false }, {})).toBe(false)
  })
})

describe('the store uses it', () => {
  const rows = [
    { id: 'real', status: 'activa', isTest: false },
    { id: 'test', status: 'activa', isTest: true },
  ]
  /** Just enough of drizzle's select chain: every select returns `out`. */
  const fakeDb = (out: unknown[]) => {
    const chain: any = { from: () => chain, where: () => chain, limit: async () => out, then: (ok: any, ko: any) => Promise.resolve(out).then(ok, ko) }
    return { select: () => chain } as any
  }
  afterEach(() => vi.unstubAllEnvs())

  it('activeRedShops leaves test shops out in production only', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production')
    expect((await activeRedShops(fakeDb(rows))).map((r) => r.id)).toEqual(['real'])
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'staging')
    expect((await activeRedShops(fakeDb(rows))).map((r) => r.id)).toEqual(['real', 'test'])
  })
  it('isRedShopActive: a test shop takes no orders in production', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production')
    expect(await isRedShopActive('test', fakeDb([{ status: 'activa', isTest: true }]))).toBe(false)
    expect(await isRedShopActive('real', fakeDb([{ status: 'activa', isTest: false }]))).toBe(true)
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', '')
    expect(await isRedShopActive('test', fakeDb([{ status: 'activa', isTest: true }]))).toBe(true)
  })
})
