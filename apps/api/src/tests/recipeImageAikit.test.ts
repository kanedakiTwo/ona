/**
 * PRO-265 (D-090, Miguel 2026-10-19): recipe photos come from gpt-image-2
 * through AiKit's OpenAI-compatible inference API. The old Imagen-fal route
 * answers 403 to every key since 2026-10-08, so every photo was falling back
 * to OpenAI gpt-image-1 (0,063 $ each). In 'auto', OpenAI stays the reserve
 * when AiKit refuses (403), is rate-limited / over budget (429) or breaks (5xx).
 *
 * fetch is simulated: these tests never reach AiKit or OpenAI.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import sharp from 'sharp'

const recordCost = vi.fn()
vi.mock('../services/costLedger.js', () => ({ recordCost: (...a: unknown[]) => recordCost(...a) }))

import { env } from '../config/env.js'
import { generateRecipeImage, AIKIT_IMAGES_URL, AIKIT_SIZE } from '../services/recipeImageGenerator.js'
import { PRICES, computeCostMicros } from '../config/pricing.js'

async function pngB64(width: number, height: number): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 180, b: 150 } } }).png().toBuffer()
  return buf.toString('base64')
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const saved = {
  AIKIT_API_KEY: env.AIKIT_API_KEY,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  RECIPE_IMAGE_PROVIDER: env.RECIPE_IMAGE_PROVIDER,
  AIKIT_IMAGE_MODEL: env.AIKIT_IMAGE_MODEL,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  env.AIKIT_API_KEY = 'aikit-test-key'
  env.OPENAI_API_KEY = 'openai-test-key'
  env.RECIPE_IMAGE_PROVIDER = 'auto'
  env.AIKIT_IMAGE_MODEL = 'gpt-image-2'
  recordCost.mockReset()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  Object.assign(env, saved)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AiKit inference request (gpt-image-2)', () => {
  it('posts JSON to the inference route with model, prompt, n and the 4:3 size', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: await pngB64(1024, 768) }] }))
    const out = await generateRecipeImage('Lentejas con chorizo.', '4:3')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://cms.aikit.es/api/inference/images/generations')
    expect(url).toBe(AIKIT_IMAGES_URL)
    expect(url).not.toMatch(/free-form-tools|imagen-fal/)
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer aikit-test-key')
    expect(headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gpt-image-2',
      prompt: 'Lentejas con chorizo.',
      n: 1,
      size: '1536x1024',
    })

    const meta = await sharp(out).metadata()
    expect(meta.width! / meta.height!).toBeCloseTo(4 / 3, 2)
    expect(recordCost).toHaveBeenCalledWith({ feature: 'recipe_image', provider: 'aikit', model: 'gpt-image-2', units: { images: 1 } })
  })

  it('maps each format to its size', () => {
    expect(AIKIT_SIZE).toEqual({ '4:3': '1536x1024', '1:1': '1024x1024', '3:4': '1024x1536' })
  })

  it.each([
    ['1:1', '1024x1024', 1024, 1024],
    ['3:4', '1024x1536', 1024, 1536],
  ] as const)('format %s asks for %s and returns that ratio', async (ratio, size, w, h) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: await pngB64(w, h) }] }))
    const out = await generateRecipeImage('Tortilla.', ratio)
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.size).toBe(size)
    const meta = await sharp(out).metadata()
    const want = ratio === '1:1' ? 1 : 3 / 4
    expect(meta.width! / meta.height!).toBeCloseTo(want, 2)
  })

  it('uses AIKIT_IMAGE_MODEL when set', async () => {
    env.AIKIT_IMAGE_MODEL = 'gpt-image-2-mini'
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: await pngB64(1024, 768) }] }))
    await generateRecipeImage('Gazpacho.')
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).model).toBe('gpt-image-2-mini')
    expect(recordCost).toHaveBeenCalledWith(expect.objectContaining({ provider: 'aikit', model: 'gpt-image-2-mini' }))
  })

  it('crops a 3:2 answer to the 4:3 asked for', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: await pngB64(1536, 1024) }] }))
    const meta = await sharp(await generateRecipeImage('Paella.', '4:3')).metadata()
    expect(meta.width! / meta.height!).toBeCloseTo(4 / 3, 2)
  })
})

describe("'auto' falls back to OpenAI", () => {
  it.each([
    [403, { error: { code: 'API_KEY_ROUTE_NOT_ALLOWED' } }],
    [429, { error: { code: 'rate_limit_exceeded' } }],
    [429, { error: { code: 'ORG_BUDGET_EXCEEDED' } }],
    [429, { error: { code: 'MONTHLY_CAP_EXCEEDED' } }],
    [500, { error: 'internal' }],
    [503, { error: 'unavailable' }],
  ])('AiKit %i → OpenAI gpt-image', async (status, body) => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(status, body))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: await pngB64(1536, 1024) }] }))
    const out = await generateRecipeImage('Croquetas.', '4:3')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][0]).toBe(AIKIT_IMAGES_URL)
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.openai.com/v1/images/generations')
    const meta = await sharp(out).metadata()
    expect(meta.width! / meta.height!).toBeCloseTo(4 / 3, 2)
    expect(recordCost).toHaveBeenCalledTimes(1)
    expect(recordCost).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai' }))
  })

  it('an empty AiKit answer also falls back', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [{ b64_json: await pngB64(1536, 1024) }] }))
    await generateRecipeImage('Croquetas.')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(recordCost).toHaveBeenCalledWith(expect.objectContaining({ provider: 'openai' }))
  })

  it("'aikit' pins AiKit: a 403 is thrown, no OpenAI call", async () => {
    env.RECIPE_IMAGE_PROVIDER = 'aikit'
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'no' }))
    await expect(generateRecipeImage('Croquetas.')).rejects.toMatchObject({ status: 403 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(recordCost).not.toHaveBeenCalled()
  })
})

describe('price of an AiKit gpt-image-2 photo', () => {
  it('is 0,0044 € per photo, in euros (what AiKit charges)', () => {
    expect(PRICES['aikit/gpt-image-2']).toEqual({ currency: 'EUR', perImage: 0.0044 })
    expect(computeCostMicros('aikit', 'gpt-image-2', { images: 1 }, { eurPerUsd: 0.9, table: PRICES })).toBe(4400)
  })
})
