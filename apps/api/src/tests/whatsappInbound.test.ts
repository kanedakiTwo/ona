/**
 * Contract tests for the WhatsApp inbound orchestrator. Every side effect is a
 * fake, so these pin the whole user-visible flow: linking, gating, budget,
 * voice notes, recipe photos and the chat round-trip.
 */
import { describe, it, expect, vi } from 'vitest'
import { processInbound, COPY, type InboundDeps } from '../services/whatsapp/inbound.js'
import type { InboundMessage } from '../services/whatsapp/webhookParser.js'
import type { LinkWithUser } from '../services/whatsapp/store.js'
import type { HistoryRow } from '../services/whatsapp/history.js'
import type { OutboundMessage } from '../services/whatsapp/render.js'
import { EMPTY_USAGE } from '../services/advisorBudget.js'

const NOW = new Date('2026-10-06T12:00:00Z')
const PHONE = '34600111222'
const WEB = 'https://ona.test'

function msg(partial: Partial<InboundMessage> = {}): InboundMessage {
  return {
    wamid: 'wamid.in',
    from: PHONE,
    timestamp: Math.floor(NOW.getTime() / 1000) - 5,
    profileName: 'Miguel',
    kind: 'text',
    text: '¿Qué ceno hoy?',
    mediaId: null,
    mimeType: null,
    replyId: null,
    rawType: 'text',
    ...partial,
  }
}

const LINK: LinkWithUser = {
  userId: 'user-1',
  phone: PHONE,
  notify: true,
  lastInboundAt: null,
  email: 'miguel@example.com',
  username: 'miguel',
  suspendedAt: null,
}

function setup(overrides: {
  link?: LinkWithUser | null
  consume?: (code: string) => { userId: string } | null
  budgetExceeded?: boolean
  history?: HistoryRow[]
  recentLinkHint?: boolean
  allowed?: boolean
  chatReply?: { message: string; uiHint?: string; data?: unknown }
  transcribe?: InboundDeps['transcribe']
  importRecipeFromImage?: InboundDeps['importRecipeFromImage']
  sendFails?: boolean
} = {}) {
  const sent: OutboundMessage[] = []
  const outbound: { kind: string; body: string; status: string }[] = []
  const inboundUpdates: { status: string; body?: string | null; userId?: string | null; errorMessage?: string | null }[] = []
  const chat = vi.fn(async () => ({
    ...(overrides.chatReply ?? { message: 'Hoy toca crema de calabaza.', uiHint: 'menu' }),
    usage: EMPTY_USAGE,
  }))
  const recordUsage = vi.fn(async () => {})

  const deps: InboundDeps = {
    webUrl: WEB,
    now: () => NOW,
    isUserAllowed: () => overrides.allowed ?? true,
    store: {
      getLinkByPhone: async () => (overrides.link === undefined ? LINK : overrides.link),
      consumeLinkCode: async (code) => overrides.consume?.(code) ?? null,
      touchInbound: async () => {},
      updateInbound: async (_wamid, patch) => {
        inboundUpdates.push(patch)
      },
      insertOutbound: async (row) => {
        outbound.push({ kind: row.kind, body: row.body, status: row.status })
      },
      loadHistoryRows: async () => overrides.history ?? [],
      hasRecentOutbound: async () => overrides.recentLinkHint ?? false,
    },
    client: {
      sendMessage: async (_to, m) => {
        if (overrides.sendFails) throw new Error('Graph 500')
        sent.push(m)
        return `wamid.out.${sent.length}`
      },
      markReadWithTyping: async () => {},
      downloadMedia: async () => ({ buffer: Buffer.from('bytes'), mimeType: 'audio/ogg' }),
    },
    chat,
    checkBudget: async () => ({ exceeded: overrides.budgetExceeded ?? false, budgetMicros: 5_000_000 }),
    recordUsage,
    transcribe: overrides.transcribe,
    importRecipeFromImage: overrides.importRecipeFromImage,
  }
  return { deps, sent, outbound, inboundUpdates, chat, recordUsage }
}

describe('processInbound — unlinked numbers', () => {
  it('links the phone when the message carries a valid code', async () => {
    const t = setup({ link: null, consume: (code) => (code === '4F7K2A' ? { userId: 'user-1' } : null) })
    await processInbound(msg({ text: 'Vincular ONA: 4F7K2A' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.linked('Miguel') }])
    expect(t.outbound[0]).toMatchObject({ kind: 'system', status: 'sent' })
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'ignored', userId: 'user-1' })
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('says the code is invalid when it looks like a code but does not match', async () => {
    const t = setup({ link: null })
    await processInbound(msg({ text: 'Vincular ONA: 9ZZZZ9' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.badCode }])
  })

  it('explains how to connect, but only once per day', async () => {
    const first = setup({ link: null })
    await processInbound(msg({ text: 'hola' }), first.deps)
    expect(first.sent).toEqual([{ type: 'text', text: COPY.notLinked(WEB) }])
    expect(first.outbound[0].kind).toBe('link')

    const again = setup({ link: null, recentLinkHint: true })
    await processInbound(msg({ text: 'hola?' }), again.deps)
    expect(again.sent).toEqual([])
  })
})

describe('processInbound — gates', () => {
  it('refuses suspended accounts', async () => {
    const t = setup({ link: { ...LINK, suspendedAt: new Date() } })
    await processInbound(msg(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.suspended }])
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('refuses accounts outside WHATSAPP_ALLOWED_EMAILS', async () => {
    const t = setup({ allowed: false })
    await processInbound(msg(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.notAllowed }])
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('stops at the monthly budget without calling the model', async () => {
    const t = setup({ budgetExceeded: true })
    await processInbound(msg(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.budget('5') }])
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('drops stale messages Meta re-delivers hours later', async () => {
    const t = setup()
    await processInbound(msg({ timestamp: Math.floor(NOW.getTime() / 1000) - 3 * 3600 }), t.deps)
    expect(t.sent).toEqual([])
    expect(t.inboundUpdates).toEqual([{ status: 'ignored', errorMessage: 'stale' }])
  })
})

describe('processInbound — chat round-trip', () => {
  it('passes text + rebuilt history to chat in whatsapp mode and replies with a deep link', async () => {
    const t = setup({
      history: [
        { direction: 'in', body: 'hola', status: 'processed', createdAt: new Date(NOW.getTime() - 60_000) },
        { direction: 'out', kind: 'reply', body: '¡Hola!', status: 'sent', createdAt: new Date(NOW.getTime() - 50_000) },
      ],
    })
    await processInbound(msg(), t.deps)
    expect(t.chat).toHaveBeenCalledWith(
      'user-1',
      '¿Qué ceno hoy?',
      [
        { role: 'user', content: 'hola' },
        { role: 'assistant', content: '¡Hola!' },
      ],
      { mode: 'whatsapp' },
    )
    expect(t.sent).toEqual([{ type: 'text', text: `Hoy toca crema de calabaza.\n\nVer menú: ${WEB}/menu` }])
    expect(t.recordUsage).toHaveBeenCalledOnce()
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', body: '¿Qué ceno hoy?' })
    expect(t.outbound).toEqual([{ kind: 'reply', body: `Hoy toca crema de calabaza.\n\nVer menú: ${WEB}/menu`, status: 'sent' }])
  })

  it('treats a tapped button as the user typing its title', async () => {
    const t = setup()
    await processInbound(msg({ kind: 'interactive', text: 'Sí', replyId: 'opt:0' }), t.deps)
    expect(t.chat).toHaveBeenCalledWith('user-1', 'Sí', [], { mode: 'whatsapp' })
  })

  it('renders [[opciones]] as reply buttons', async () => {
    const t = setup({ chatReply: { message: '¿Genero el menú?\n[[opciones: Sí | No]]' } })
    await processInbound(msg(), t.deps)
    expect(t.sent).toEqual([
      { type: 'buttons', text: '¿Genero el menú?', buttons: [{ id: 'opt:0', title: 'Sí' }, { id: 'opt:1', title: 'No' }] },
    ])
  })

  it('apologises and marks the message failed when chat throws', async () => {
    const t = setup()
    t.chat.mockRejectedValueOnce(new Error('Anthropic down'))
    await processInbound(msg(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.error }])
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'failed', errorMessage: 'Anthropic down' })
  })

  it('logs a failed send instead of throwing', async () => {
    const t = setup({ sendFails: true })
    await expect(processInbound(msg(), t.deps)).resolves.toBeUndefined()
    expect(t.outbound[0]).toMatchObject({ kind: 'reply', status: 'failed' })
  })

  it('answers unsupported message types politely', async () => {
    const t = setup()
    await processInbound(msg({ kind: 'unsupported', text: null, rawType: 'sticker' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.unsupported }])
  })
})

describe('processInbound — voice notes', () => {
  const audio = () => msg({ kind: 'audio', text: null, mediaId: 'MEDIA1', mimeType: 'audio/ogg; codecs=opus' })

  it('transcribes and chats with the transcript', async () => {
    const transcribe = vi.fn(async () => 'ponme lentejas el jueves')
    const t = setup({ transcribe })
    await processInbound(audio(), t.deps)
    expect(transcribe).toHaveBeenCalledWith(Buffer.from('bytes'), 'audio/ogg; codecs=opus')
    expect(t.chat).toHaveBeenCalledWith('user-1', 'ponme lentejas el jueves', [], { mode: 'whatsapp' })
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', body: 'ponme lentejas el jueves' })
  })

  it('asks to repeat when transcription fails or is empty', async () => {
    const t = setup({ transcribe: async () => '   ' })
    await processInbound(audio(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.audioFailed }])
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('asks to type when speech-to-text is not configured', async () => {
    const t = setup()
    await processInbound(audio(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.audioUnavailable }])
  })
})

describe('processInbound — recipe photos', () => {
  const photo = () => msg({ kind: 'image', text: 'la de mi abuela', mediaId: 'MEDIA2', mimeType: 'image/jpeg' })

  it('imports the recipe and links to it', async () => {
    const importRecipeFromImage = vi.fn(async () => ({ recipeId: 'r9', name: 'Tortilla de patatas', warnings: [] }))
    const t = setup({ importRecipeFromImage })
    await processInbound(photo(), t.deps)
    expect(importRecipeFromImage).toHaveBeenCalledWith(Buffer.from('bytes'), 'image/jpeg', 'user-1')
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0].text).toContain('*Tortilla de patatas*')
    expect(t.sent[0].text).toContain(`Ver receta: ${WEB}/recipes/r9`)
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', body: '[Foto de una receta: la de mi abuela]' })
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('mentions unmatched ingredients so the user reviews them', async () => {
    const t = setup({ importRecipeFromImage: async () => ({ recipeId: 'r9', name: 'X', warnings: ['1 ingrediente(s) no encontrado(s)'] }) })
    await processInbound(photo(), t.deps)
    expect(t.sent[0].text).toContain('Revisa los ingredientes')
  })

  it('says so when the photo is not a recipe', async () => {
    const t = setup({
      importRecipeFromImage: async () => {
        throw new Error('No se pudo identificar una receta en la imagen')
      },
    })
    await processInbound(photo(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.imageNotRecipe }])
  })

  it('is polite when photo import is not wired', async () => {
    const t = setup()
    await processInbound(photo(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.imageUnavailable }])
  })
})
