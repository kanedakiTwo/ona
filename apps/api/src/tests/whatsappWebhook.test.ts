import { describe, it, expect } from 'vitest'
import { verifySignature, signBody } from '../services/whatsapp/signature.js'
import { parseWebhookPayload } from '../services/whatsapp/webhookParser.js'
import { isUserAllowed } from '../services/whatsapp/config.js'

const SECRET = 'app-secret'

function payload(messages: unknown[], extra: Record<string, unknown> = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'PNID' },
              contacts: [{ wa_id: '34600111222', profile: { name: 'Miguel' } }],
              messages,
              ...extra,
            },
          },
        ],
      },
    ],
  }
}

describe('verifySignature', () => {
  const body = Buffer.from(JSON.stringify({ hello: 'world' }))

  it('accepts the HMAC Meta would send', () => {
    expect(verifySignature(body, signBody(body, SECRET), SECRET)).toBe(true)
  })

  it('rejects a body that was tampered with', () => {
    const header = signBody(body, SECRET)
    expect(verifySignature(Buffer.from('{"hello":"mundo"}'), header, SECRET)).toBe(false)
  })

  it('rejects a wrong secret, missing header, malformed header and empty secret', () => {
    expect(verifySignature(body, signBody(body, 'other'), SECRET)).toBe(false)
    expect(verifySignature(body, undefined, SECRET)).toBe(false)
    expect(verifySignature(body, 'sha1=abc', SECRET)).toBe(false)
    expect(verifySignature(body, signBody(body, SECRET), '')).toBe(false)
  })
})

describe('parseWebhookPayload', () => {
  it('parses a text message with the contact profile name', () => {
    const [m] = parseWebhookPayload(
      payload([{ from: '34600111222', id: 'wamid.1', timestamp: '1700000000', type: 'text', text: { body: '¿Qué ceno hoy?' } }]),
    )
    expect(m).toMatchObject({
      wamid: 'wamid.1',
      from: '34600111222',
      timestamp: 1700000000,
      profileName: 'Miguel',
      kind: 'text',
      text: '¿Qué ceno hoy?',
    })
  })

  it('parses voice notes and images (with caption) as media', () => {
    const msgs = parseWebhookPayload(
      payload([
        { from: '34600111222', id: 'a', timestamp: '1', type: 'audio', audio: { id: 'MEDIA1', mime_type: 'audio/ogg; codecs=opus', voice: true } },
        { from: '34600111222', id: 'b', timestamp: '2', type: 'image', image: { id: 'MEDIA2', mime_type: 'image/jpeg', caption: 'receta de mi abuela' } },
      ]),
    )
    expect(msgs[0]).toMatchObject({ kind: 'audio', mediaId: 'MEDIA1', mimeType: 'audio/ogg; codecs=opus' })
    expect(msgs[1]).toMatchObject({ kind: 'image', mediaId: 'MEDIA2', text: 'receta de mi abuela' })
  })

  it('turns button and list replies (and template quick replies) into interactive text', () => {
    const msgs = parseWebhookPayload(
      payload([
        { from: '34600111222', id: 'a', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'opt:0', title: 'Sí' } } },
        { from: '34600111222', id: 'b', timestamp: '1', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'row1', title: 'Lunes' } } },
        { from: '34600111222', id: 'c', timestamp: '1', type: 'button', button: { text: 'Prepáralo', payload: 'p' } },
      ]),
    )
    expect(msgs.map((m) => [m.kind, m.text, m.replyId])).toEqual([
      ['interactive', 'Sí', 'opt:0'],
      ['interactive', 'Lunes', 'row1'],
      ['interactive', 'Prepáralo', 'p'],
    ])
  })

  it('keeps unknown types as unsupported so we can answer politely', () => {
    const [m] = parseWebhookPayload(payload([{ from: '34600111222', id: 'x', timestamp: '1', type: 'sticker', sticker: { id: 's' } }]))
    expect(m).toMatchObject({ kind: 'unsupported', rawType: 'sticker' })
  })

  it('ignores status-only callbacks, other fields and garbage', () => {
    expect(parseWebhookPayload(payload([], { statuses: [{ id: 'wamid.1', status: 'read' }] }))).toEqual([])
    expect(parseWebhookPayload({ object: 'page', entry: [] })).toEqual([])
    expect(parseWebhookPayload(null)).toEqual([])
    expect(parseWebhookPayload({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'account_update', value: {} }] }] })).toEqual([])
    expect(parseWebhookPayload(payload([{ id: 'no-from' }]))).toEqual([])
  })
})

describe('isUserAllowed', () => {
  it('lets everyone in when the allowlist is empty', () => {
    expect(isUserAllowed('a@b.com', [])).toBe(true)
  })
  it('matches case-insensitively and rejects others', () => {
    expect(isUserAllowed(' Miguel@Example.com ', ['miguel@example.com'])).toBe(true)
    expect(isUserAllowed('otro@example.com', ['miguel@example.com'])).toBe(false)
    expect(isUserAllowed(null, ['miguel@example.com'])).toBe(false)
  })
})

describe('audioFileName (speech-to-text)', () => {
  it('maps WhatsApp audio MIME types to an extension OpenAI accepts', async () => {
    const { audioFileName } = await import('../services/stt.js')
    expect(audioFileName('audio/ogg; codecs=opus')).toBe('nota-de-voz.ogg')
    expect(audioFileName('audio/mpeg')).toBe('nota-de-voz.mp3')
    expect(audioFileName('audio/aac')).toBe('nota-de-voz.m4a')
    expect(audioFileName('application/octet-stream')).toBe('nota-de-voz.ogg')
  })
})
