import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUsdaClient } from '../services/nutrition/usdaClient.js'

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
