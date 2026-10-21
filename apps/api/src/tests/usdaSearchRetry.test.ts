import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUsdaClient, parseProfile } from '../services/nutrition/usdaClient.js'

const ok = (foods: unknown[]) => new Response(JSON.stringify({ foods }), { status: 200 })
const bad = () => new Response('<html>400 Bad Request</html>', { status: 400 })
const TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)']

describe('USDA search — the API rejects «Survey (FNDDS)» about half the time (2026-10-21)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('retries the same search once after a 400', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(bad()).mockResolvedValueOnce(ok([{ fdcId: 1, description: 'Olive oil', dataType: 'SR Legacy' }]))
    vi.stubGlobal('fetch', fetchMock)
    const r = await createUsdaClient({ apiKey: 'k' }).searchByName('olive oil', { preferDataTypes: TYPES })
    expect(r.map((x) => x.fdcId)).toEqual([1])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('then searches without the survey type, so an ingredient is never saved with no nutrition for this', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(bad()).mockResolvedValueOnce(bad()).mockResolvedValueOnce(ok([{ fdcId: 2, description: 'Oil, olive', dataType: 'Foundation' }]))
    vi.stubGlobal('fetch', fetchMock)
    const r = await createUsdaClient({ apiKey: 'k' }).searchByName('olive oil', { preferDataTypes: TYPES })
    expect(r.map((x) => x.fdcId)).toEqual([2])
    const lastUrl = String(fetchMock.mock.calls[2][0])
    expect(lastUrl).toContain('dataType=Foundation')
    expect(lastUrl).not.toContain('FNDDS')
  })

  it('still fails when every attempt fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => bad()))
    await expect(createUsdaClient({ apiKey: 'k' }).searchByName('olive oil', { preferDataTypes: TYPES })).rejects.toThrow(/status=400/)
  })
})

describe('parseProfile — Foundation entries report energy as Atwater, not 1008 (2026-10-21)', () => {
  const food = (nutrients: Array<[number, number]>) => ({
    dataType: 'Foundation',
    description: 'Chicken, wing, meat and skin, raw',
    foodNutrients: nutrients.map(([id, amount]) => ({ nutrient: { id }, amount })),
  })

  it('reads Atwater General energy when 1008 is missing', () => {
    expect(parseProfile(food([[2047, 191], [1003, 18.4], [1004, 10.6], [1005, -0.46]]), 1).per100g.kcal).toBe(191)
  })

  it('reads Atwater Specific energy when General is missing too', () => {
    expect(parseProfile(food([[2048, 185], [1003, 18.4]]), 1).per100g.kcal).toBe(185)
  })

  it('computes 4·P + 4·HC + 9·G when no energy is reported, and never keeps a negative carb', () => {
    const p = parseProfile(food([[1003, 18.4], [1004, 10.6], [1005, -0.46]]), 1).per100g
    expect(p.carbsG).toBe(0)
    expect(p.kcal).toBe(Math.round(18.4 * 4 + 10.6 * 9))
  })

  it('keeps 1008 when it is there', () => {
    expect(parseProfile(food([[1008, 900], [1004, 100]]), 1).per100g.kcal).toBe(900)
  })
})

describe('USDA cache — read back through the current parser', () => {
  it('a profile cached before a parser fix gets the fixed values', async () => {
    const { mkdtemp, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'usda-'))
    const raw = { dataType: 'Foundation', description: 'Chicken wing', foodNutrients: [{ nutrient: { id: 2047 }, amount: 191 }] }
    await writeFile(join(dir, '7.json'), JSON.stringify({
      fetchedAt: '2026-10-21T00:00:00Z',
      profile: { fdcId: 7, description: 'Chicken wing', per100g: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, saltG: 0 }, raw },
    }))
    vi.stubGlobal('fetch', vi.fn())
    const p = await createUsdaClient({ apiKey: 'k', cacheDir: dir }).fetchByFdcId(7)
    expect(p.per100g.kcal).toBe(191)
    vi.unstubAllGlobals()
  })
})
