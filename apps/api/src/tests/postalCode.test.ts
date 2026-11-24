/**
 * PRO-1124 (D-179): the household's postal code. Pure parts and Mimo's side
 * against a fake AppApi:
 *   - only Spanish codes (5 digits, province 01–52);
 *   - the count never shows a postal code × shop kind under 3 households,
 *     nor an «otros» under 3 (D-094, LEG-506);
 *   - prepare_shop_orders asks Legal's question only when the API says it's
 *     the household's turn; set_postal_code saves, deletes and skips.
 * The real database side (asked once, skip, Perfil, children, the count) is
 * in postalCode.smoke.ts.
 *
 * Run: pnpm --filter @ona/api test src/tests/postalCode.test.ts
 */
import { describe, it, expect } from 'vitest'
import { POSTAL_CODE_QUESTION, POSTAL_CODE_WHY, normalizePostalCode } from '@ona/shared'
import { groupPostalDemand } from '../services/postalCode.js'
import { shopOrderSkills } from '../services/assistant/shopOrderSkills.js'
import { AppApiError, type AppApi } from '../services/assistant/appApi.js'

const get = (name: string) => {
  const s = shopOrderSkills.find((x) => x.name === name)
  if (!s) throw new Error(`skill ${name} missing`)
  return s
}

function fakeApi(routes: Record<string, unknown | ((body: any) => unknown)> = {}) {
  const calls: { method: string; path: string; body?: any }[] = []
  const api: AppApi = async (method, path, body) => {
    calls.push({ method, path, body })
    const value = routes[`${method} ${path}`]
    return (typeof value === 'function' ? (value as any)(body) : value ?? {}) as any
  }
  return { api, calls }
}
const ctx = (api: AppApi) => ({ userId: 'u1', db: null, api })

describe('normalizePostalCode', () => {
  it('keeps Spanish codes, with or without spaces', () => {
    expect(normalizePostalCode('28012')).toBe('28012')
    expect(normalizePostalCode(' 08 001 ')).toBe('08001')
    expect(normalizePostalCode('52001')).toBe('52001')
  })

  it('refuses anything else: other lengths, letters, provinces outside 01–52, a street', () => {
    for (const bad of ['2801', '280123', '00123', '53000', '99999', 'calle Mayor 3', '', null, undefined]) {
      expect(normalizePostalCode(bad)).toBeNull()
    }
  })
})

describe('groupPostalDemand (D-094, LEG-506)', () => {
  it('shows postal code × kind only from 3 households; the smaller ones go to «others» by kind', () => {
    const { zones, others } = groupPostalDemand([
      { postalCode: '28012', kind: 'fruteria', households: 5 },
      { postalCode: '28012', kind: 'carniceria', households: 3 },
      { postalCode: '28012', kind: 'pescaderia', households: 2 },
      { postalCode: '41001', kind: 'pescaderia', households: 1 },
      { postalCode: '41001', kind: 'fruteria', households: 1 },
      { postalCode: '46001', kind: 'fruteria', households: 2 },
    ])
    expect(zones).toEqual([
      { postalCode: '28012', kind: 'fruteria', households: 5 },
      { postalCode: '28012', kind: 'carniceria', households: 3 },
    ])
    expect(others).toEqual({ fruteria: 3, carniceria: null, pescaderia: 3 })
    expect(zones.every((z) => z.households >= 3)).toBe(true)
  })

  it('an «others» under 3 is not shown either (it could be one household)', () => {
    const { zones, others } = groupPostalDemand([
      { postalCode: '28012', kind: 'fruteria', households: 1 },
      { postalCode: '41001', kind: 'carniceria', households: 2 },
    ])
    expect(zones).toEqual([])
    expect(others).toEqual({ fruteria: null, carniceria: null, pescaderia: null })
  })
})

const prepared = (askPostalCode: boolean) => ({ orders: [], unassigned: [], skipped: [], hasShops: true, askPostalCode })

describe('prepare_shop_orders asks the postal code once', () => {
  it('with askPostalCode: Legal’s words, word for word, and set_postal_code to save it', async () => {
    const { api } = fakeApi({ 'POST /shop-orders/prepare': prepared(true) })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.summary).toContain(`${POSTAL_CODE_QUESTION} ${POSTAL_CODE_WHY}`)
    expect(r.summary).toContain('¿Cuál es tu código postal? Lo usamos para buscarte tiendas de barrio cerca. Puedes saltarlo.')
    expect(r.summary).toMatch(/set_postal_code/)
    expect(r.summary).toMatch(/nunca la calle/)
  })

  it('without it (already asked, or a postal code saved): not a word about it', async () => {
    const { api } = fakeApi({ 'POST /shop-orders/prepare': prepared(false) })
    const r = await get('prepare_shop_orders').handler({}, ctx(api))
    expect(r.summary).not.toMatch(/código postal/)
  })
})

describe('set_postal_code', () => {
  it('saves it with PUT /households/me/postal-code', async () => {
    const { api, calls } = fakeApi({ 'PUT /households/me/postal-code': { postalCode: '28012', asked: true } })
    const r = await get('set_postal_code').handler({ postal_code: '28 012' }, ctx(api))
    expect(calls).toEqual([{ method: 'PUT', path: '/households/me/postal-code', body: { postalCode: '28 012' } }])
    expect(r.summary).toMatch(/28012/)
    expect(r.summary).toMatch(/Perfil → Tu casa/)
  })

  it('«ahora no»: skip, and nothing saved', async () => {
    const { api, calls } = fakeApi()
    const r = await get('set_postal_code').handler({ skip: true }, ctx(api))
    expect(calls).toEqual([{ method: 'POST', path: '/households/me/postal-code/skip', body: {} }])
    expect(r.summary).toMatch(/no se lo vuelvo a preguntar/)
  })

  it('a code that is not Spanish: the API’s message goes back to Mimo', async () => {
    const api: AppApi = async () => {
      throw new AppApiError(400, 'Escribe un código postal de España: 5 cifras, como 28012.')
    }
    const r = await get('set_postal_code').handler({ postal_code: '1234' }, ctx(api))
    expect(r.summary).toMatch(/5 cifras/)
  })
})
