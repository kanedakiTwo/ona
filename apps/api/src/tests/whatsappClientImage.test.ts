/**
 * The week image (2026-10-15) goes out in two Graph calls: upload the JPG to
 * `/{phone-number-id}/media`, then an `image` message with that id and the
 * caption. A failed upload throws, so inbound sends the text instead.
 */
import { afterEach, describe, it, expect, vi } from 'vitest'
import { env } from '../config/env.js'
import { sendMessage, GraphApiError } from '../services/whatsapp/client.js'

const picture = {
  type: 'image' as const,
  text: 'Listo: tu menú hasta el domingo 🍽️',
  image: Buffer.from('jpeg-bytes'),
  mimeType: 'image/jpeg',
  alt: 'el menú de la semana, día a día',
  fallback: [],
}

afterEach(() => vi.unstubAllGlobals())

describe('client.sendMessage — image', () => {
  it('uploads the JPG, then sends an image message with the media id and the caption', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      const body = url.endsWith('/media') ? { id: 'media-123' } : { messages: [{ id: 'wamid.img' }] }
      return new Response(JSON.stringify(body), { status: 200 })
    }))
    const wamid = await sendMessage('34600111222', picture)
    expect(wamid).toBe('wamid.img')
    expect(calls).toHaveLength(2)
    // `/{phone-number-id}/media` (the id is empty in tests).
    expect(calls[0].url).toBe(`${env.WHATSAPP_GRAPH_BASE_URL}/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID ? `${env.WHATSAPP_PHONE_NUMBER_ID}/` : ''}media`)
    expect(calls[1].url.endsWith('/messages')).toBe(true)
    const form = calls[0].init.body as FormData
    expect(form.get('messaging_product')).toBe('whatsapp')
    expect(form.get('type')).toBe('image/jpeg')
    const file = form.get('file') as File
    expect(file.type).toBe('image/jpeg')
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe('jpeg-bytes')
    expect(JSON.parse(calls[1].init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '34600111222',
      type: 'image',
      image: { id: 'media-123', caption: picture.text },
    })
  })

  it('a rejected upload throws and sends nothing', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad media' } }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(sendMessage('34600111222', picture)).rejects.toBeInstanceOf(GraphApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
