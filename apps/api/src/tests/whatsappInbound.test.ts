/**
 * Contract tests for the WhatsApp inbound orchestrator. Every side effect is a
 * fake, so these pin the whole user-visible flow: linking, gating, budget,
 * voice notes, recipe photos and the chat round-trip.
 */
import { describe, it, expect, vi } from 'vitest'
import { processInbound, COPY, ackTextForTools, photoIntent, withoutMenuReadyLines, WEEK_IMAGE_ALT, type InboundDeps } from '../services/whatsapp/inbound.js'
import { weekMenuCaption, weekMenuDigest } from '../services/menuText.js'
import { buildChatHistory } from '../services/whatsapp/history.js'
import type { InboundMessage } from '../services/whatsapp/webhookParser.js'
import type { LinkWithUser } from '../services/whatsapp/store.js'
import type { HistoryRow } from '../services/whatsapp/history.js'
import type { OutboundMessage } from '../services/whatsapp/render.js'
import { EMPTY_USAGE } from '../services/advisorBudget.js'
import { AI_DISCLOSURE_FIRST_PERSON, BRAND_SUPPORT_EMAIL } from '@ona/shared'

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
  onboardingDone: true,
}

function setup(overrides: {
  link?: LinkWithUser | null
  consume?: (code: string, currentUserId?: string | null) => { userId: string; onboardingDone?: boolean; sameUser?: boolean } | null
  budgetExceeded?: boolean
  history?: HistoryRow[]
  recentLinkHint?: boolean
  allowed?: boolean
  chatReply?: { message: string; uiHint?: string; data?: unknown; toolsUsed?: string[] }
  menuDigest?: InboundDeps['menuDigest']
  menuImage?: InboundDeps['menuImage']
  /** Only picture messages fail (e.g. the media upload). */
  imageSendFails?: boolean
  transcribe?: InboundDeps['transcribe']
  importRecipeFromImage?: InboundDeps['importRecipeFromImage']
  setRecipeSource?: InboundDeps['setRecipeSource']
  sendFails?: boolean
  outboundKinds?: Map<string, Date>
  supportEmail?: string
  guided?: InboundDeps['guided']
  paused?: boolean
} = {}) {
  const sent: OutboundMessage[] = []
  const outbound: { kind: string; body: string; status: string; meta?: unknown }[] = []
  const historyUserIds: string[] = []
  const inboundUpdates: { status: string; body?: string | null; userId?: string | null; errorMessage?: string | null; meta?: unknown }[] = []
  const chat = vi.fn(async () => ({
    ...(overrides.chatReply ?? { message: 'Hoy toca crema de calabaza.', uiHint: 'menu' }),
    usage: EMPTY_USAGE,
  }))
  const recordUsage = vi.fn(async () => {})
  const setNotify = vi.fn(async () => true)
  const checkBudget = vi.fn(async () => ({ exceeded: overrides.budgetExceeded ?? false, budgetMicros: 5_000_000 }))

  const deps: InboundDeps = {
    webUrl: WEB,
    now: () => NOW,
    isUserAllowed: () => overrides.allowed ?? true,
    store: {
      getLinkByPhone: async () => (overrides.link === undefined ? LINK : overrides.link),
      consumeLinkCode: async (code, _phone, _name, currentUserId) => overrides.consume?.(code, currentUserId) ?? null,
      touchInbound: async () => {},
      updateInbound: async (_wamid, patch) => {
        inboundUpdates.push(patch)
      },
      insertOutbound: async (row) => {
        outbound.push({ kind: row.kind, body: row.body, status: row.status, ...(row.meta ? { meta: row.meta } : {}) })
      },
      loadHistoryRows: async (_phone, _since, userId) => {
        historyUserIds.push(userId)
        return overrides.history ?? []
      },
      hasRecentOutbound: async () => overrides.recentLinkHint ?? false,
      recentOutboundKinds: async () => overrides.outboundKinds ?? new Map(),
      setNotify,
    },
    supportEmail: overrides.supportEmail,
    client: {
      sendMessage: async (_to, m) => {
        if (overrides.sendFails) throw new Error('Graph 500')
        if (overrides.imageSendFails && m.type === 'image') throw new Error('Graph media 400')
        sent.push(m)
        return `wamid.out.${sent.length}`
      },
      markReadWithTyping: async () => {},
      downloadMedia: async () => ({ buffer: Buffer.from('bytes'), mimeType: 'audio/ogg' }),
    },
    chat,
    checkBudget,
    recordUsage,
    transcribe: overrides.transcribe,
    importRecipeFromImage: overrides.importRecipeFromImage,
    setRecipeSource: overrides.setRecipeSource,
    menuDigest: overrides.menuDigest,
    menuImage: overrides.menuImage,
    guided: overrides.guided,
    ...(overrides.paused !== undefined ? { isPaused: async () => overrides.paused! } : {}),
  }
  return { deps, sent, outbound, inboundUpdates, chat, recordUsage, historyUserIds, setNotify, checkBudget }
}

describe('processInbound — unlinked numbers', () => {
  it('links the phone when the message carries a valid code', async () => {
    const t = setup({ link: null, consume: (code) => (code === '4F7K2A' ? { userId: 'user-1' } : null) })
    await processInbound(msg({ text: 'Vincular Mimoia: 4F7K2A' }), t.deps)
    expect(t.sent[0]).toEqual({ type: 'text', text: COPY.linked('Miguel') })
    // Proactive messages are opt-in: the link is followed by the question.
    expect(t.sent[1]).toMatchObject({ type: 'buttons', text: COPY.optInPrompt })
    expect((t.sent[1] as any).buttons.map((b: any) => b.title)).toEqual(['Sí, avísame', 'No, gracias'])
    expect(t.outbound[1]).toMatchObject({ kind: 'optin_prompt' })
    expect(t.outbound[0]).toMatchObject({ kind: 'system', status: 'sent' })
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'ignored', userId: 'user-1' })
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('still links a message prefilled before the rename (old brand name before the code)', async () => {
    const t = setup({ link: null, consume: (code) => (code === '4F7K2A' ? { userId: 'user-1' } : null) })
    await processInbound(msg({ text: 'Vincular ONA: 4F7K2A' }), t.deps)
    expect(t.sent[0]).toEqual({ type: 'text', text: COPY.linked('Miguel') })
  })

  it('says the code is invalid when it looks like a code but does not match', async () => {
    const t = setup({ link: null })
    await processInbound(msg({ text: 'Vincular Mimoia: 9ZZZZ9' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.badCode }])
  })

  it("the first message of the WhatsApp sign-up (Miguel's text, 2026-10-15): AI disclosure, voice notes, two questions", () => {
    const m = COPY.linkedOnboarding('Ana')
    // AI Act art. 50: AI, can be wrong, not a health professional.
    expect(m).toMatch(/asistente de inteligencia artificial \(IA\)/)
    expect(m).toMatch(/puedo equivocarme y no sustituyo a un profesional sanitario/)
    expect(m).toMatch(/Puedes escribirme o mandarme notas de voz/)
    expect(m).toMatch(/\*1\.\* ¿Cuántos sois en casa\?/)
    expect(m).toMatch(/\*2\.\* ¿Cuánto cocináis en casa/)
    // PRO-245 / D-064: no favourite dishes in the sign-up any more.
    expect(m).not.toMatch(/platos/)
  })

  it('the opt-in question says it can be changed just by asking (Mimo has the tool)', () => {
    expect(COPY.optInPrompt).toMatch(/simplemente pidiéndomelo/)
  })

  it('points an unknown number to the connect page (no token in the link)', async () => {
    const first = setup({ link: null })
    await processInbound(msg({ text: 'hola' }), first.deps)
    expect(first.sent).toEqual([{ type: 'text', text: COPY.connect(`${WEB}/whatsapp/conectar`) }])
    expect(first.sent[0].text).not.toMatch(/[?&]t=/)
    expect(first.outbound[0].kind).toBe('link')
    expect(first.chat).not.toHaveBeenCalled()
  })

  it('discloses that Mimo is an AI in the first message of either path (AI Act art. 50)', async () => {
    const unknown = setup({ link: null })
    await processInbound(msg({ text: 'hola' }), unknown.deps)
    expect(unknown.sent[0].text).toContain(AI_DISCLOSURE_FIRST_PERSON)
    expect(unknown.sent[0].text).toMatch(/^Hola, soy Mimo, el asistente de cocina de Mimoia\./)

    const linking = setup({ link: null, consume: () => ({ userId: 'user-1' }) })
    await processInbound(msg({ text: 'Vincular Mimoia: 4F7K2A' }), linking.deps)
    expect(linking.sent[0].text).toContain(AI_DISCLOSURE_FIRST_PERSON)
    expect(linking.sent[0].text).toContain('conectado con Mimoia')
  })

  it('every text the bot sends on its own says Mimo / Mimoia, never the old name', () => {
    const texts = Object.values(COPY).flatMap((v) =>
      typeof v === 'function' ? [(v as (x?: string) => string)('x'), (v as (x?: string) => string)()] : [v],
    )
    for (const text of texts) expect(text).not.toMatch(/\b(ONA|Ona)\b/)
  })

  it('sends the connect hint at most once an hour', async () => {
    const again = setup({ link: null, recentLinkHint: true })
    await processInbound(msg({ text: 'hola?' }), again.deps)
    expect(again.sent).toEqual([])
  })
})

describe('processInbound — gates', () => {
  it('a paused account (PRO-135) gets only the notice to choose a plan: no Mimo, no budget check', async () => {
    const t = setup({ paused: true })
    await processInbound(msg(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.paused(`${WEB}/profile/suscripcion`) }])
    expect(t.outbound[0]).toMatchObject({ kind: 'paused' })
    expect(t.chat).not.toHaveBeenCalled()
    expect(t.checkBudget).not.toHaveBeenCalled()
    expect(COPY.paused('x')).toMatch(/No se ha borrado nada/)
  })

  it('an account that is not paused talks to Mimo as always', async () => {
    const t = setup({ paused: false })
    await processInbound(msg(), t.deps)
    expect(t.chat).toHaveBeenCalledOnce()
  })

  it('refuses suspended accounts', async () => {
    const t = setup({ link: { ...LINK, suspendedAt: new Date() } })
    await processInbound(msg(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.suspended(undefined) }])
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

  it('checks the budget before paying for transcription or photo extraction', async () => {
    const transcribe = vi.fn(async () => 'hola')
    const importRecipeFromImage = vi.fn(async () => ({ recipeId: 'r', name: 'x', warnings: [] }))
    const t = setup({ budgetExceeded: true, transcribe, importRecipeFromImage })
    await processInbound(msg({ kind: 'audio', text: null, mediaId: 'M', mimeType: 'audio/ogg' }), t.deps)
    await processInbound(msg({ kind: 'image', text: null, mediaId: 'M2', mimeType: 'image/jpeg' }), t.deps)
    expect(transcribe).not.toHaveBeenCalled()
    expect(importRecipeFromImage).not.toHaveBeenCalled()
  })

  it("loads history for this phone AND this user (a moved phone doesn't leak the previous owner's chat)", async () => {
    const t = setup()
    await processInbound(msg(), t.deps)
    expect(t.historyUserIds).toEqual(['user-1'])
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
      expect.objectContaining({ mode: 'whatsapp' }),
    )
    expect(t.sent).toEqual([{ type: 'text', text: `Hoy toca crema de calabaza.\n\nVer menú: ${WEB}/menu` }])
    expect(t.recordUsage).toHaveBeenCalledOnce()
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', body: '¿Qué ceno hoy?' })
    expect(t.outbound).toEqual([{ kind: 'reply', body: `Hoy toca crema de calabaza.\n\nVer menú: ${WEB}/menu`, status: 'sent' }])
  })

  it('treats a tapped button as the user typing its title', async () => {
    const t = setup()
    await processInbound(msg({ kind: 'interactive', text: 'Sí', replyId: 'opt:0' }), t.deps)
    expect(t.chat).toHaveBeenCalledWith('user-1', 'Sí', [], expect.objectContaining({ mode: 'whatsapp' }))
  })

  it('renders [[opciones]] as reply buttons', async () => {
    const t = setup({ chatReply: { message: '¿Genero el menú?\n[[opciones: Sí | No]]' } })
    await processInbound(msg(), t.deps)
    expect(t.sent).toEqual([
      { type: 'buttons', text: '¿Genero el menú?', buttons: [{ id: 'opt:0', title: 'Sí' }, { id: 'opt:1', title: 'No' }] },
    ])
  })

  it('PRO-141: a reply that repeats the buttons Mimo just sent goes out without them', async () => {
    const asked = new Date(NOW.getTime() - 60_000)
    const t = setup({
      history: [
        { direction: 'out', kind: 'reply', body: '¿Cuánto cocináis en casa?\n⟦botones: Casi a diario | 3-4 días | Poco⟧', status: 'sent', createdAt: asked },
        { direction: 'in', body: 'Casi a diario', status: 'processed', createdAt: new Date(asked.getTime() + 20_000) },
      ],
      chatReply: { message: 'Dime tres platos que os gusten mucho.\n[[opciones: Casi a diario | 3-4 días | Poco]]' },
    })
    await processInbound(msg({ text: 'Casi a diario' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: 'Dime tres platos que os gusten mucho.' }])
  })

  it('PRO-141: new buttons still go out, and the stored body records them for next time', async () => {
    const t = setup({
      history: [{ direction: 'out', kind: 'reply', body: 'Hola\n⟦botones: Sí | No⟧', status: 'sent', createdAt: new Date(NOW.getTime() - 60_000) }],
      chatReply: { message: '¿Cuánto cocináis?\n[[opciones: Casi a diario | 3-4 días | Poco]]' },
    })
    await processInbound(msg(), t.deps)
    expect(t.sent[0]).toMatchObject({ type: 'buttons', text: '¿Cuánto cocináis?' })
    expect(t.outbound.at(-1)?.body).toBe('¿Cuánto cocináis?\n⟦botones: Casi a diario | 3-4 días | Poco⟧')
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
    expect(t.chat).toHaveBeenCalledWith('user-1', 'ponme lentejas el jueves', [], expect.objectContaining({ mode: 'whatsapp' }))
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
    expect(t.sent).toHaveLength(2) // "Recibida la foto…" + the result
    expect(t.sent[1].text).toContain('*Tortilla de patatas*')
    expect(t.sent[1].text).toContain(`Ver receta: ${WEB}/recipes/r9`)
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', body: '[Foto de una receta: la de mi abuela]' })
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('mentions unmatched ingredients so the user reviews them', async () => {
    const t = setup({ importRecipeFromImage: async () => ({ recipeId: 'r9', name: 'X', warnings: ['1 ingrediente(s) no encontrado(s)'] }) })
    await processInbound(photo(), t.deps)
    expect(t.sent.at(-1)!.text).toContain('Revisa los ingredientes')
  })

  it('a photo that is not a recipe goes to Mimo, who sees it and answers', async () => {
    const t = setup({
      importRecipeFromImage: async () => {
        throw new Error('No se pudo identificar una receta en la imagen')
      },
    })
    t.chat.mockImplementationOnce(async () => ({ message: 'Es una plancha de hierro: precaliéntala bien.', usage: EMPTY_USAGE }))
    await processInbound(photo(), t.deps)
    expect(t.chat).toHaveBeenCalledOnce()
    const opts = t.chat.mock.calls[0][3] as any
    expect(opts.images).toEqual([{ mediaType: 'image/jpeg', data: Buffer.from('bytes').toString('base64') }])
    expect(t.sent.map((m) => m.text)).toEqual([COPY.ackPhoto, 'Es una plancha de hierro: precaliéntala bien.'])
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', body: '[Foto] la de mi abuela', meta: expect.objectContaining({ photo: true }) })
  })

  it('a photo with a question goes straight to Mimo (2026-10-11: «¿cómo cambia la receta?» got «no hay receta»)', async () => {
    const importRecipeFromImage = vi.fn()
    const t = setup({ importRecipeFromImage })
    t.chat.mockImplementationOnce(async () => ({ message: 'En plancha, piel abajo y fuego medio.', usage: EMPTY_USAGE }))
    await processInbound(msg({ kind: 'image', text: 'Lo hago hoy en esta plancha. Como cambia la receta?', mediaId: 'M3', mimeType: 'image/jpeg' }), t.deps)
    expect(importRecipeFromImage).not.toHaveBeenCalled()
    expect(t.chat.mock.calls[0][1]).toBe('Lo hago hoy en esta plancha. Como cambia la receta?')
    expect((t.chat.mock.calls[0][3] as any).images).toHaveLength(1)
    expect(t.sent.map((m) => m.text)).toEqual(['En plancha, piel abajo y fuego medio.'])
  })

  it('without photo import wired, Mimo still looks at the photo', async () => {
    const t = setup()
    t.chat.mockImplementationOnce(async () => ({ message: 'Qué buena pinta.', usage: EMPTY_USAGE }))
    await processInbound(photo(), t.deps)
    expect((t.chat.mock.calls[0][3] as any).images).toHaveLength(1)
    expect(t.sent.map((m) => m.text)).toEqual(['Qué buena pinta.'])
  })

  it('photoIntent: questions go to Mimo, everything else is a recipe to import', () => {
    expect(photoIntent('')).toBe('import')
    expect(photoIntent('la de mi abuela')).toBe('import')
    expect(photoIntent('guárdala')).toBe('import')
    expect(photoIntent('¿Puedo usar esta sartén?')).toBe('ask')
    expect(photoIntent('Como cambia la receta?')).toBe('ask')
    expect(photoIntent('cómo lo hago en la barbacoa')).toBe('ask')
  })
})

describe('processInbound — the link to the original of a screenshot (PRO-66)', () => {
  const photo = () => msg({ kind: 'image', text: '', mediaId: 'MEDIA5', mimeType: 'image/png' })
  const IG = 'https://www.instagram.com/reel/abc123/'
  const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000)
  /** The inbound row of «guárdame <IG>» that got «mándame una captura». */
  const unreadLinkRow = (at: Date): HistoryRow => ({
    direction: 'in',
    kind: 'text',
    body: `guárdame ${IG}`,
    status: 'processed',
    createdAt: at,
    meta: {
      toolTrace: [{
        name: 'import_recipe_from_url',
        input: JSON.stringify({ url: IG }),
        summary: 'No se ha guardado nada. Responde al usuario exactamente: «No he podido leer la receta de este vídeo; mándame una captura».',
      }],
    },
  })
  /** The inbound row of a screenshot after which Mimo asked for the link. */
  const askedRow = (at: Date): HistoryRow => ({
    direction: 'in',
    kind: 'image',
    body: '[Foto de una receta]',
    status: 'processed',
    createdAt: at,
    meta: { photo: true, photoRecipeId: 'r7', photoRecipeName: 'Pasta cremosa', sourceAsked: true },
  })

  it('an unread link + a screenshot within 30 min: the recipe keeps that link, no question', async () => {
    const importRecipeFromImage = vi.fn(async () => ({ recipeId: 'r7', name: 'Pasta cremosa', warnings: [], looksLikeScreenshot: true }))
    const t = setup({ importRecipeFromImage, history: [unreadLinkRow(minutesAgo(10))] })
    await processInbound(photo(), t.deps)
    expect(importRecipeFromImage).toHaveBeenCalledWith(Buffer.from('bytes'), 'image/png', 'user-1', { sourceUrl: IG })
    const reply = t.sent.at(-1)!.text
    expect(reply).toContain('*Pasta cremosa*')
    expect(reply).toContain('fuente')
    expect(reply).not.toContain('¿Tienes el enlace del original?')
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', meta: expect.objectContaining({ photoRecipeId: 'r7', photoSourceUrl: IG }) })
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('an unread link older than 30 min is not used', async () => {
    const importRecipeFromImage = vi.fn(async () => ({ recipeId: 'r7', name: 'Pasta cremosa', warnings: [], looksLikeScreenshot: true }))
    const t = setup({ importRecipeFromImage, setRecipeSource: async () => true, history: [unreadLinkRow(minutesAgo(45))] })
    await processInbound(photo(), t.deps)
    expect(importRecipeFromImage).toHaveBeenCalledWith(Buffer.from('bytes'), 'image/png', 'user-1')
    expect(t.sent.at(-1)!.text).toContain('¿Tienes el enlace del original?')
  })

  it('a screenshot with no recent link: Mimo asks for the original', async () => {
    const t = setup({
      importRecipeFromImage: async () => ({ recipeId: 'r7', name: 'Pasta cremosa', warnings: [], looksLikeScreenshot: true }),
      setRecipeSource: async () => true,
    })
    await processInbound(photo(), t.deps)
    expect(t.sent.at(-1)!.text).toContain('¿Tienes el enlace del original? Así lo guardo como fuente.')
    expect(t.inboundUpdates.at(-1)).toMatchObject({
      status: 'processed',
      meta: expect.objectContaining({ photoRecipeId: 'r7', photoRecipeName: 'Pasta cremosa', sourceAsked: true }),
    })
  })

  it('a cookbook page or a handwritten note: no question', async () => {
    const t = setup({
      importRecipeFromImage: async () => ({ recipeId: 'r8', name: 'Lentejas', warnings: [], looksLikeScreenshot: false }),
      setRecipeSource: async () => true,
    })
    await processInbound(photo(), t.deps)
    expect(t.sent.at(-1)!.text).not.toContain('enlace del original')
    expect(t.sent.at(-1)!.text).toContain('¿Quieres que la ponga en el menú')
  })

  it('the link that answers the question becomes the source of that recipe, not a new recipe', async () => {
    const setRecipeSource = vi.fn(async () => true)
    const t = setup({ setRecipeSource, history: [askedRow(minutesAgo(5))] })
    await processInbound(msg({ text: `toma ${IG}` }), t.deps)
    expect(setRecipeSource).toHaveBeenCalledWith('user-1', 'r7', IG)
    expect(t.chat).not.toHaveBeenCalled() // no import_recipe_from_url, no second recipe
    const reply = t.sent.at(-1)!.text
    expect(reply).toContain('*Pasta cremosa*')
    expect(reply).toContain(`${WEB}/recipes/r7`)
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', meta: expect.objectContaining({ sourceAttachedTo: 'r7' }) })
  })

  it('a link after the 30 minutes goes to Mimo as usual', async () => {
    const setRecipeSource = vi.fn(async () => true)
    const t = setup({ setRecipeSource, history: [askedRow(minutesAgo(31))] })
    await processInbound(msg({ text: IG }), t.deps)
    expect(setRecipeSource).not.toHaveBeenCalled()
    expect(t.chat).toHaveBeenCalledOnce()
  })

  it('a question already answered is not answered twice', async () => {
    const setRecipeSource = vi.fn(async () => true)
    const answered: HistoryRow = { direction: 'in', kind: 'text', body: IG, status: 'processed', createdAt: minutesAgo(3), meta: { sourceAttachedTo: 'r7' } }
    const t = setup({ setRecipeSource, history: [askedRow(minutesAgo(5)), answered] })
    await processInbound(msg({ text: 'https://otra.receta.es/croquetas' }), t.deps)
    expect(setRecipeSource).not.toHaveBeenCalled()
    expect(t.chat).toHaveBeenCalledOnce()
  })
})

describe('processInbound — "me pongo con ello" acks', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  it('sends the generic ack when the turn stays silent past the delay, before the reply', async () => {
    const t = setup()
    t.chat.mockImplementationOnce(async () => {
      await wait(40)
      return { message: 'Hoy toca lentejas.', usage: EMPTY_USAGE }
    })
    await processInbound(msg(), { ...t.deps, ackAfterMs: 5 })
    expect(t.sent.map((m) => m.text)).toEqual([COPY.working, 'Hoy toca lentejas.'])
    expect(t.outbound.map((o) => o.kind)).toEqual(['ack', 'reply'])
  })

  it('stays quiet when the answer is fast, and never acks after the reply', async () => {
    const t = setup()
    await processInbound(msg(), { ...t.deps, ackAfterMs: 20 })
    await wait(40)
    expect(t.outbound.map((o) => o.kind)).toEqual(['reply'])
  })

  it('acks immediately with a specific text when a slow skill starts, and only once', async () => {
    const t = setup()
    t.chat.mockImplementationOnce(async (_u, _m, _h, opts: any) => {
      opts.onToolStart(['generate_weekly_menu'])
      await wait(40) // the generic timer (5 ms) must not add a second ack
      opts.onToolStart(['get_shopping_list'])
      return { message: 'Menú listo.', uiHint: 'menu', usage: EMPTY_USAGE }
    })
    await processInbound(msg({ text: 'Genera el menú de la semana' }), { ...t.deps, ackAfterMs: 5 })
    expect(t.sent[0].text).toBe(ackTextForTools(['generate_weekly_menu']))
    expect(t.outbound.map((o) => o.kind)).toEqual(['ack', 'reply'])
  })

  it('acks a recipe photo right away', async () => {
    const t = setup({ importRecipeFromImage: async () => ({ recipeId: 'r9', name: 'Tortilla', warnings: [] }) })
    await processInbound(msg({ kind: 'image', text: null, mediaId: 'M', mimeType: 'image/jpeg' }), { ...t.deps, ackAfterMs: 60_000 })
    expect(t.sent[0].text).toBe(COPY.ackPhoto)
    expect(t.outbound.map((o) => o.kind)).toEqual(['ack', 'reply'])
  })

  it('maps only slow skills to an ack', () => {
    expect(ackTextForTools(['get_todays_menu'])).toBeNull()
    expect(ackTextForTools(['get_todays_menu', 'import_recipe_from_url'])).toMatch(/receta/)
  })
})

describe('processInbound — control words (BAJA / ALTA / HUMANO)', () => {
  it('BAJA turns proactive messages off before any other gate (even over budget)', async () => {
    const t = setup({ budgetExceeded: true })
    await processInbound(msg({ text: 'BAJA' }), t.deps)
    expect(t.setNotify).toHaveBeenCalledWith('user-1', false)
    expect(t.checkBudget).not.toHaveBeenCalled()
    expect(t.chat).not.toHaveBeenCalled()
    expect(t.sent).toEqual([{ type: 'text', text: COPY.stopped }])
    expect(t.outbound[0]).toMatchObject({ kind: 'optout' })
  })

  it('honours a late STOP that would otherwise be dropped as stale', async () => {
    const t = setup()
    await processInbound(msg({ text: 'stop', timestamp: Math.floor(NOW.getTime() / 1000) - 5 * 60 * 60 }), t.deps)
    expect(t.setNotify).toHaveBeenCalledWith('user-1', false)
  })

  it('also works for a suspended or not-allowed account', async () => {
    const t = setup({ allowed: false, link: { ...LINK, suspendedAt: new Date() } })
    await processInbound(msg({ text: 'Darme de baja' }), t.deps)
    expect(t.setNotify).toHaveBeenCalledWith('user-1', false)
    expect(t.sent[0]).toEqual({ type: 'text', text: COPY.stopped })
  })

  it('ALTA (or the "Sí, avísame" button) turns them on: «te enviaré» the first time (PRO-248)', async () => {
    const t = setup()
    await processInbound(msg({ kind: 'interactive', text: 'Sí, avísame', rawType: 'interactive' }), t.deps)
    expect(t.setNotify).toHaveBeenCalledWith('user-1', true)
    expect(t.sent[0]).toEqual({ type: 'text', text: COPY.startedFirst })
    expect(COPY.startedFirst).toMatch(/te enviaré avisos/)
    expect(COPY.startedFirst).not.toMatch(/vuelvo/)
  })

  it('ALTA after a BAJA (or a previous yes) turns them back on: «vuelvo a enviarte»', async () => {
    const t = setup({ outboundKinds: new Map([['optout', new Date(NOW.getTime() - 86_400_000)]]) })
    await processInbound(msg({ text: 'ALTA' }), t.deps)
    expect(t.sent[0]).toEqual({ type: 'text', text: COPY.started })
  })

  it('PRO-248: BAJA records the «no» so the avisos are never offered again', async () => {
    const t = setup()
    const markDeclined = vi.fn(async () => undefined)
    t.deps.optIn = { markDeclined, claimReoffer: vi.fn(async () => false) }
    await processInbound(msg({ text: 'BAJA' }), t.deps)
    expect(markDeclined).toHaveBeenCalledWith('user-1')
  })

  it('HUMANO gives the support contact without calling the model', async () => {
    const t = setup({ supportEmail: 'hola@ona.test' })
    await processInbound(msg({ text: 'Quiero hablar con una persona' }), t.deps)
    expect(t.chat).not.toHaveBeenCalled()
    expect(t.sent[0].text).toContain('hola@ona.test')
  })

  it('PRO-179: without SUPPORT_EMAIL, HUMANO and the suspended notice give hola@mimoia.com', async () => {
    const t = setup()
    await processInbound(msg({ text: 'Quiero hablar con una persona' }), t.deps)
    expect(t.sent[0].text).toContain(BRAND_SUPPORT_EMAIL)
    expect(t.sent[0].text).not.toContain('te invitó')
    expect(COPY.suspended(undefined)).toContain(BRAND_SUPPORT_EMAIL)
    expect(COPY.suspended('')).toContain(BRAND_SUPPORT_EMAIL)
    expect(COPY.suspended(undefined)).not.toContain('te invitó')
  })

  it('"para la cena pon lentejas" is a request, not an opt-out', async () => {
    const t = setup()
    await processInbound(msg({ text: 'para la cena pon lentejas' }), t.deps)
    expect(t.setNotify).not.toHaveBeenCalled()
    expect(t.chat).toHaveBeenCalled()
  })

  it('an unlinked number that wrote BAJA never gets the connect hint again', async () => {
    const first = setup({ link: null })
    await processInbound(msg({ text: 'BAJA' }), first.deps)
    expect(first.sent).toEqual([{ type: 'text', text: COPY.stoppedUnlinked }])
    const later = setup({ link: null, outboundKinds: new Map([['optout', new Date(NOW.getTime() - 60_000)]]) })
    await processInbound(msg({ text: 'hola' }), later.deps)
    expect(later.sent).toEqual([])
  })

  it('"No, gracias" right after the opt-in question is answered without the model', async () => {
    const t = setup({ outboundKinds: new Map([['system', new Date(NOW.getTime() - 120_000)], ['optin_prompt', new Date(NOW.getTime() - 60_000)]]) })
    await processInbound(msg({ kind: 'interactive', text: 'No, gracias', rawType: 'interactive' }), t.deps)
    expect(t.chat).not.toHaveBeenCalled()
    expect(t.sent[0]).toEqual({ type: 'text', text: COPY.optInDeclined })
  })

  it('"No, gracias" to anything else goes to the model', async () => {
    const t = setup({ outboundKinds: new Map([['optin_prompt', new Date(NOW.getTime() - 120_000)], ['weekly_nudge', new Date(NOW.getTime() - 60_000)]]) })
    await processInbound(msg({ text: 'No, gracias' }), t.deps)
    expect(t.chat).toHaveBeenCalled()
  })
})


describe('processInbound — the reply carries the menu / list, not just a link (2026-10-08)', () => {
  // The real digest (Thursday 15 Oct, week 12–18), as wiring.ts builds it.
  const MENU_TEXT = weekMenuDigest(
    { weekStart: '2026-10-12', days: [{}, {}, {}, { lunch: { dishes: [{ kind: 'recipe', recipeId: 'r1', recipeName: 'Lentejas' }] }, dinner: { dishes: [{ kind: 'recipe', recipeId: 'r2', recipeName: 'Crema' }] } }] },
    { today: '2026-10-15', webUrl: WEB },
  )
  const textOf = (sent: OutboundMessage[]) => sent.map((m) => m.text).join('\n')

  it('after generating the week, the reply is the digest alone: no "Hecho / menú listo" on top, no second menu link', async () => {
    const menuDigest = vi.fn(async () => MENU_TEXT)
    const t = setup({
      chatReply: { message: 'Hecho:\n- Menú de la semana listo', uiHint: 'menu', data: { id: 'm-9', days: [] }, toolsUsed: ['generate_weekly_menu'] },
      menuDigest,
    })
    await processInbound(msg({ text: 'genera el menú de la semana' }), t.deps)
    expect(menuDigest).toHaveBeenCalledWith('user-1', 'm-9', 'generated')
    expect(t.sent).toEqual([{ type: 'text', text: MENU_TEXT }])
    const text = textOf(t.sent)
    expect(text.startsWith('Listo: tu menú hasta el domingo 🍽️')).toBe(true)
    expect(text).not.toMatch(/Hecho|men[uú] de la semana listo/i)
    expect(text).not.toContain('Ver menú')
    expect(text.match(/\/menu/g)).toHaveLength(1)
    expect(text).not.toContain('/recipes/')
    // stored in history too, so the next turn can iterate on it
    expect(t.outbound.at(-1)!.body).toContain('*Jueves 15 · hoy*\n☀️ Lentejas\n🌙 Crema')
  })

  it('what the model says besides "menú listo" (another change, a warning) stays above the digest', async () => {
    const t = setup({
      chatReply: {
        message: 'Hecho:\n- Menú de la semana listo\n- Sábado 17, cena: comemos fuera\n\nNo había dorada; he puesto lubina.',
        uiHint: 'menu',
        data: { id: 'm-9', days: [] },
        toolsUsed: ['generate_weekly_menu', 'set_meal_note'],
      },
      menuDigest: async () => MENU_TEXT,
    })
    await processInbound(msg({ text: 'genera el menú, el sábado cenamos fuera' }), t.deps)
    const text = textOf(t.sent)
    expect(text).toBe(`Hecho:\n- Sábado 17, cena: comemos fuera\n\nNo había dorada; he puesto lubina.\n\n${MENU_TEXT}`)
  })

  it('withoutMenuReadyLines drops only the "menú listo" line and a bare ack', () => {
    expect(withoutMenuReadyLines('Hecho:\n- Tu primer menú de la semana listo')).toBe('')
    expect(withoutMenuReadyLines('Hecho: menú de la semana listo.')).toBe('')
    expect(withoutMenuReadyLines('Tu menú de la semana está listo.')).toBe('')
    expect(withoutMenuReadyLines('Hecho:\n- Menu de la semana listo\n- Jueves 15, comida: Entrecot')).toBe('Hecho:\n- Jueves 15, comida: Entrecot')
    expect(withoutMenuReadyLines('Ojo: no queda pescado en el catálogo para el viernes.')).toBe('Ojo: no queda pescado en el catálogo para el viernes.')
  })

  it('asking for the shopping list returns the list itself', async () => {
    const items = [
      { id: 'a', ingredientId: null, name: 'Cebolla', quantity: 300, unit: 'g', aisle: 'produce', checked: false, inStock: false },
      { id: 'b', ingredientId: null, name: 'Leche', quantity: 1, unit: 'u', aisle: 'lacteos', checked: true, inStock: false },
    ]
    const t = setup({ chatReply: { message: 'Esta es tu lista:', uiHint: 'shopping_list', data: items, toolsUsed: ['get_shopping_list'] } })
    await processInbound(msg({ text: 'dame la lista de la compra' }), t.deps)
    const text = textOf(t.sent)
    expect(text).toContain('*Frutas y verduras:* Cebolla (300 g)')
    expect(text).not.toContain('Leche')
    expect(text).toContain(`${WEB}/shopping`)
  })

  it('other turns are untouched and never read the menu', async () => {
    const menuDigest = vi.fn(async () => MENU_TEXT)
    const t = setup({ chatReply: { message: 'Hoy toca crema de calabaza.', uiHint: 'menu', toolsUsed: ['get_todays_menu'] }, menuDigest })
    await processInbound(msg(), t.deps)
    expect(menuDigest).not.toHaveBeenCalled()
    expect(textOf(t.sent)).not.toContain('*Jueves 15')
  })

  it('a failing menu read still sends the reply (the model text and the app link, untouched)', async () => {
    const t = setup({
      chatReply: { message: 'Hecho:\n- Menú de la semana listo', uiHint: 'menu', data: { menuId: 'm-9' }, toolsUsed: ['generate_weekly_menu'] },
      menuDigest: async () => { throw new Error('db down') },
    })
    await processInbound(msg({ text: 'genera el menú' }), t.deps)
    expect(textOf(t.sent)).toContain('Menú de la semana listo')
    expect(textOf(t.sent)).toContain(`Ver menú: ${WEB}/menu`)
  })
})

describe('processInbound — the generated week goes out as ONE picture with a short caption (2026-10-15)', () => {
  const WEEK = {
    weekStart: '2026-10-12',
    days: [{}, {}, {}, { lunch: { dishes: [{ kind: 'recipe' as const, recipeId: 'r1', recipeName: 'Lentejas' }] }, dinner: { dishes: [{ kind: 'recipe' as const, recipeId: 'r2', recipeName: 'Crema' }] } }],
  }
  const OPTS = { today: '2026-10-15', webUrl: WEB }
  const MENU_TEXT = weekMenuDigest(WEEK, OPTS)
  const CAPTION = weekMenuCaption(WEEK, OPTS)
  const JPEG = Buffer.from('fake-jpeg')
  const generated = (message = 'Hecho:\n- Menú de la semana listo', extra: Record<string, unknown> = {}) => ({
    message,
    uiHint: 'menu',
    data: { id: 'm-9', days: [] },
    toolsUsed: ['generate_weekly_menu'],
    ...extra,
  })

  it('sends one image message whose caption is the opener, the menu link and the invite', async () => {
    const menuImage = vi.fn(async () => ({ jpeg: JPEG, caption: CAPTION }))
    const t = setup({ chatReply: generated(), menuDigest: async () => MENU_TEXT, menuImage })
    await processInbound(msg({ text: 'genera el menú de la semana' }), t.deps)
    expect(menuImage).toHaveBeenCalledWith('user-1', 'm-9', 'generated')
    expect(t.sent).toHaveLength(1)
    const m = t.sent[0]
    expect(m).toMatchObject({ type: 'image', mimeType: 'image/jpeg', image: JPEG })
    expect(m.text).toBe(
      'Listo: tu menú hasta el domingo 🍽️\n📖 Recetas y lista de la compra: ona.test/menu\n¿Cambio algo? Dímelo, p. ej. «hoy, pescado».',
    )
    // No day blocks in the caption: the picture has them.
    expect(m.text).not.toContain('*Jueves')
    expect(m.text).not.toMatch(/Hecho|Ver menú/)
  })

  it('history keeps the caption plus a mark saying a picture of the week was sent', async () => {
    const t = setup({ chatReply: generated(), menuDigest: async () => MENU_TEXT, menuImage: async () => ({ jpeg: JPEG, caption: CAPTION }) })
    await processInbound(msg({ text: 'genera el menú' }), t.deps)
    expect(t.outbound).toHaveLength(1)
    expect(t.outbound[0]).toMatchObject({ kind: 'reply', status: 'sent' })
    expect(t.outbound[0].body).toBe(`⟦imagen enviada: ${WEEK_IMAGE_ALT}⟧\n${CAPTION}`)
    const history = buildChatHistory(
      [
        { direction: 'in', body: 'genera el menú', status: 'processed', createdAt: new Date(NOW.getTime() - 2000) },
        { direction: 'out', kind: 'reply', body: t.outbound[0].body, status: 'sent', createdAt: new Date(NOW.getTime() - 1000) },
      ],
      NOW,
    )
    expect(history.at(-1)!.content).toContain('⟦imagen enviada: el menú de la semana, día a día⟧')
    expect(history.at(-1)!.content).toContain('Listo: tu menú hasta el domingo')
  })

  it("the model's other words go in the caption, above the opener (an empty «Hecho:» goes)", async () => {
    const t = setup({
      chatReply: generated('Hecho:\n- Menú de la semana listo\n\nNo había dorada; he puesto lubina.'),
      menuDigest: async () => MENU_TEXT,
      menuImage: async () => ({ jpeg: JPEG, caption: CAPTION }),
    })
    await processInbound(msg({ text: 'genera el menú' }), t.deps)
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0].text).toBe(`No había dorada; he puesto lubina.\n\n${CAPTION}`)
  })

  it('buttons from the model go after the picture, without a second menu link', async () => {
    const t = setup({
      chatReply: generated('Menú de la semana listo.\n\n¿Te preparo la lista de la compra?\n[[opciones: Sí | No]]'),
      menuDigest: async () => MENU_TEXT,
      menuImage: async () => ({ jpeg: JPEG, caption: CAPTION }),
    })
    await processInbound(msg({ text: 'genera el menú' }), t.deps)
    expect(t.sent.map((m) => m.type)).toEqual(['image', 'buttons'])
    expect(t.sent[0].text).toBe(CAPTION)
    expect(t.sent[1].text).toBe('¿Te preparo la lista de la compra?')
    expect(t.sent.map((m) => m.text).join('\n')).not.toContain('Ver menú')
  })

  it('drawing the picture fails → exactly the text digest of before', async () => {
    const t = setup({
      chatReply: generated(),
      menuDigest: async () => MENU_TEXT,
      menuImage: async () => { throw new Error('satori exploded') },
    })
    await processInbound(msg({ text: 'genera el menú' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: MENU_TEXT }])
    expect(t.outbound).toEqual([{ kind: 'reply', body: MENU_TEXT, status: 'sent' }])
  })

  it('nothing to draw (null) → the text digest', async () => {
    const t = setup({ chatReply: generated(), menuDigest: async () => MENU_TEXT, menuImage: async () => null })
    await processInbound(msg({ text: 'genera el menú' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: MENU_TEXT }])
  })

  it('the upload/send of the picture fails → the text digest goes out instead; the failed picture stays out of history', async () => {
    const t = setup({
      chatReply: generated(),
      menuDigest: async () => MENU_TEXT,
      menuImage: async () => ({ jpeg: JPEG, caption: CAPTION }),
      imageSendFails: true,
    })
    await processInbound(msg({ text: 'genera el menú' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: MENU_TEXT }])
    expect(t.outbound.map((o) => [o.kind, o.status])).toEqual([['image_failed', 'failed'], ['reply', 'sent']])
    const history = buildChatHistory(
      t.outbound.map((o, i) => ({ direction: 'out', kind: o.kind, body: o.body, status: o.status, createdAt: new Date(NOW.getTime() - 1000 + i) })),
      NOW,
    )
    expect(history.map((h) => h.content).join('\n')).not.toContain('⟦imagen enviada')
  })

  it("one-day messages stay text: today's menu never draws the week", async () => {
    const menuImage = vi.fn(async () => ({ jpeg: JPEG, caption: CAPTION }))
    const t = setup({ chatReply: { message: 'Hoy toca crema de calabaza.', uiHint: 'menu', toolsUsed: ['get_todays_menu'] }, menuImage })
    await processInbound(msg(), t.deps)
    expect(menuImage).not.toHaveBeenCalled()
    expect(t.sent.every((m) => m.type !== 'image')).toBe(true)
  })

  it('«dame el menú de la semana» (get_weekly_menu) → the same picture with a «Tu menú» caption, not the model\'s list', async () => {
    const VIEW_CAPTION = weekMenuCaption(WEEK, { ...OPTS, view: 'viewing' })
    const menuImage = vi.fn(async () => ({ jpeg: JPEG, caption: VIEW_CAPTION }))
    const t = setup({
      chatReply: {
        message: 'Tu menú de esta semana:\n*Jueves 15*\n- Comida: Lentejas\n- Cena: Crema',
        uiHint: 'menu',
        data: { menuId: 'm-1', weekStart: '2026-10-12', days: WEEK.days, skippedDays: [] },
        toolsUsed: ['get_weekly_menu'],
      },
      menuDigest: async () => weekMenuDigest(WEEK, { ...OPTS, view: 'viewing' }),
      menuImage,
    })
    await processInbound(msg({ text: 'dame el menú de la semana' }), t.deps)
    expect(menuImage).toHaveBeenCalledWith('user-1', 'm-1', 'viewing')
    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toMatchObject({ type: 'image', text: VIEW_CAPTION })
    expect(VIEW_CAPTION.startsWith('Tu menú de esta semana 🍽️\n')).toBe(true)
    expect(t.outbound[0].body).toBe(`⟦imagen enviada: ${WEEK_IMAGE_ALT}⟧\n${VIEW_CAPTION}`)
  })

  it('the first menu of the WhatsApp sign-up is a picture too, then the health link and the opt-in', async () => {
    const t = setup({
      link: { ...LINK, onboardingDone: false },
      chatReply: { message: 'Hecho:\n- Tu primer menú de la semana listo', toolsUsed: ['complete_onboarding'], data: { id: 'menu-1', days: [] } },
      menuDigest: async () => MENU_TEXT,
      menuImage: async () => ({ jpeg: JPEG, caption: CAPTION }),
    })
    await processInbound(msg({ text: 'Lentejas, tortilla y pescado al horno' }), t.deps)
    expect(t.sent.map((m) => m.type)).toEqual(['image', 'text', 'buttons'])
    expect(t.sent[0].text).toBe(CAPTION)
    expect(t.outbound.map((o) => o.kind)).toEqual(['reply', 'system', 'optin_prompt'])
  })
})

describe('processInbound — WhatsApp-first sign-up (2026-10-10)', () => {
  const NEW_LINK: LinkWithUser = { ...LINK, onboardingDone: false }

  it('a new account that links gets the first question in the chat; the opt-in waits', async () => {
    const t = setup({ link: null, consume: () => ({ userId: 'user-1', onboardingDone: false }) })
    await processInbound(msg({ text: 'Vincular Mimoia: 4F7K2A' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.linkedOnboarding('Miguel') }])
    // Miguel's wording (2026-10-15) keeps the disclosure's three parts (AI Act art. 50).
    expect(t.sent[0].text).toMatch(/asistente de inteligencia artificial \(IA\)[\s\S]*puedo equivocarme y no sustituyo a un profesional sanitario/)
    expect(t.sent[0].text).toMatch(/¿Cuántos sois en casa\?/)
    expect(t.outbound.map((o) => o.kind)).toEqual(['onboarding'])
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('an account that already did the first steps links as before (opt-in right away)', async () => {
    const t = setup({ link: null, consume: () => ({ userId: 'user-1', onboardingDone: true }) })
    await processInbound(msg({ text: 'Vincular Mimoia: 4F7K2A' }), t.deps)
    expect(t.sent[0]).toEqual({ type: 'text', text: COPY.linked('Miguel') })
    expect(t.outbound.map((o) => o.kind)).toEqual(['system', 'optin_prompt'])
  })

  it('until the first steps are done, the chat runs in onboarding mode', async () => {
    const pending = setup({ link: NEW_LINK })
    await processInbound(msg({ text: 'Somos 2 adultos y un niño de 6' }), pending.deps)
    expect(pending.chat).toHaveBeenCalledWith('user-1', 'Somos 2 adultos y un niño de 6', [], expect.objectContaining({ mode: 'whatsapp', onboarding: true }))

    const done = setup()
    await processInbound(msg(), done.deps)
    expect(done.chat).toHaveBeenCalledWith('user-1', '¿Qué ceno hoy?', [], expect.objectContaining({ onboarding: false }))
  })

  it('complete_onboarding → the first menu in the chat, the web link for health data, then the opt-in', async () => {
    const t = setup({
      link: NEW_LINK,
      chatReply: { message: 'Hecho:\n- Tu primer menú de la semana listo', toolsUsed: ['complete_onboarding'], data: { id: 'menu-1', days: [] } },
      menuDigest: async (_userId, menuId) => (menuId === 'menu-1' ? 'Listo: tu menú hasta el domingo 🍽️\n\n*Martes 6 · hoy*\n☀️ Lentejas' : null),
    })
    await processInbound(msg({ text: 'Lentejas, tortilla y pescado al horno' }), t.deps)
    expect(t.outbound.map((o) => o.kind)).toEqual(['reply', 'system', 'optin_prompt'])
    // The digest alone: the model's "Hecho: - Tu primer menú…" isn't stacked on top (2026-10-15).
    expect(t.sent[0].text).toBe(`Listo: tu menú hasta el domingo 🍽️\n\n*Martes 6 · hoy*\n☀️ Lentejas`)
    expect(t.sent[1]).toEqual({ type: 'text', text: COPY.healthOnWeb(`${WEB}/profile`) })
    expect(t.sent[1].text).toMatch(/no me dejan guardar datos de salud/)
    expect(t.sent[2]).toMatchObject({ type: 'buttons', text: COPY.optInPrompt })
  })

  // PRO-07: the sign-up ends with three suggestions, once, after the opt-in answer.
  describe('the three suggestions after the opt-in (PRO-07)', () => {
    const at = (msAgo: number) => new Date(NOW.getTime() - msAgo)
    const afterSignup = () =>
      new Map([['onboarding', at(600_000)], ['reply', at(180_000)], ['system', at(120_000)], ['optin_prompt', at(60_000)]])

    it('"Sí, avísame" → avisos on, the confirmation (PRO-248: always, «te enviaré») and the suggestions', async () => {
      const t = setup({ outboundKinds: afterSignup() })
      await processInbound(msg({ kind: 'interactive', text: 'Sí, avísame', rawType: 'interactive' }), t.deps)
      expect(t.setNotify).toHaveBeenCalledWith('user-1', true)
      expect(t.outbound.map((o) => o.kind)).toEqual(['optin', 'first_steps'])
      expect(t.sent[0]).toEqual({ type: 'text', text: COPY.startedFirst })
      expect(t.sent[1]).toEqual({ type: 'text', text: COPY.firstSteps(`${WEB}/menu`) })
      expect(COPY.firstSteps('x')).toMatch(/foto o un enlace de una receta/)
      expect(COPY.firstSteps('x')).toMatch(/¿Qué cenamos hoy\?/)
      expect(COPY.firstSteps('x')).toMatch(/Hazme la lista de la compra/)
      // 2026-10-15: the WhatsApp sign-up ends sending them back to the web.
      expect(COPY.firstSteps(`${WEB}/menu`)).toMatch(new RegExp(`vuelve a Mimoia en la web[\\s\\S]*${WEB}/menu$`))
      expect(t.chat).not.toHaveBeenCalled()
    })

    // PRO-156: written from its guide when the writer is there; the fixed text otherwise.
    it('the suggestions come from their guide (PRO-156), with the fixed text as the safety net', async () => {
      const written = `¡Ya está! Prueba a pedirme:\n📸 una foto de una receta\n🍽️ «¿Qué cenamos hoy?»\n🛒 «Hazme la lista de la compra»\n\nTu menú, en la web: ${WEB}/menu`
      const guided = vi.fn(async (_u: string, _p: string, spec: any, fallback: string) => {
        expect(spec).toMatchObject({ kind: 'first_steps', required: expect.arrayContaining([`${WEB}/menu`, '¿Qué cenamos hoy?']) })
        expect(fallback).toBe(COPY.firstSteps(`${WEB}/menu`))
        return { text: written, source: 'guide' as const }
      })
      const t = setup({ outboundKinds: afterSignup(), guided })
      await processInbound(msg({ kind: 'interactive', text: 'Sí, avísame', rawType: 'interactive' }), t.deps)
      expect(guided).toHaveBeenCalledWith('user-1', PHONE, expect.anything(), expect.any(String))
      expect(t.sent[1]).toEqual({ type: 'text', text: written })
      expect(t.outbound[1]).toMatchObject({ kind: 'first_steps', meta: { guided: 'guide' } })

      const fixed = setup({ outboundKinds: afterSignup(), guided: async (_u, _p, _s, fallback) => ({ text: fallback, source: 'fallback', reason: 'over_budget' }) })
      await processInbound(msg({ kind: 'interactive', text: 'Sí, avísame', rawType: 'interactive' }), fixed.deps)
      expect(fixed.sent[1]).toEqual({ type: 'text', text: COPY.firstSteps(`${WEB}/menu`) })
      expect(fixed.outbound[1]).toMatchObject({ meta: { guided: 'fallback', guidedReason: 'over_budget' } })
    })

    it('"No, gracias" → the confirmation (PRO-248: always), the «no» recorded, then the suggestions', async () => {
      const t = setup({ outboundKinds: afterSignup() })
      const markDeclined = vi.fn(async () => undefined)
      t.deps.optIn = { markDeclined, claimReoffer: vi.fn(async () => false) }
      await processInbound(msg({ kind: 'interactive', text: 'No, gracias', rawType: 'interactive' }), t.deps)
      expect(t.outbound.map((o) => o.kind)).toEqual(['system', 'first_steps'])
      expect(t.sent[0]).toEqual({ type: 'text', text: COPY.optInDeclined })
      expect(t.sent[1]).toEqual({ type: 'text', text: COPY.firstSteps(`${WEB}/menu`) })
      expect(markDeclined).toHaveBeenCalledWith('user-1')
    })

    it('only once: not again on a later ALTA', async () => {
      const kinds = afterSignup()
      kinds.set('first_steps', at(30_000))
      const t = setup({ outboundKinds: kinds })
      await processInbound(msg({ text: 'ALTA' }), t.deps)
      expect(t.outbound.map((o) => o.kind)).toEqual(['optin'])
    })

    it('not for an account that did the first steps on the web (no onboarding in the chat)', async () => {
      const t = setup({ outboundKinds: new Map([['system', at(120_000)], ['optin_prompt', at(60_000)]]) })
      await processInbound(msg({ kind: 'interactive', text: 'Sí, avísame', rawType: 'interactive' }), t.deps)
      expect(t.outbound.map((o) => o.kind)).toEqual(['optin'])
    })

    it('not before the opt-in question (complete_onboarding turn ends with the question)', async () => {
      const t = setup({
        link: NEW_LINK,
        chatReply: { message: 'Hecho:\n- Tu primer menú de la semana listo', toolsUsed: ['complete_onboarding'] },
        outboundKinds: new Map([['onboarding', at(600_000)]]),
      })
      await processInbound(msg({ text: 'Lentejas y tortilla' }), t.deps)
      expect(t.outbound.map((o) => o.kind)).not.toContain('first_steps')
      expect(t.outbound.at(-1)?.kind).toBe('optin_prompt')
    })
  })

  describe('the one extra offer of the avisos (PRO-248)', () => {
    it('when due, it goes after the reply, in one line, with the same two buttons', async () => {
      const t = setup({ chatReply: { message: 'Hoy toca lentejas.' } })
      const claimReoffer = vi.fn(async () => true)
      t.deps.optIn = { markDeclined: vi.fn(async () => undefined), claimReoffer }
      await processInbound(msg({ text: '¿Qué comemos hoy?' }), t.deps)
      expect(claimReoffer).toHaveBeenCalledWith('user-1', NOW)
      expect(t.outbound.map((o) => o.kind)).toEqual(['reply', 'optin_prompt'])
      const offer = t.sent.at(-1) as any
      expect(offer.type).toBe('buttons')
      expect(offer.text).toBe(COPY.optInReoffer)
      expect(offer.text.split('\n')).toHaveLength(1)
      expect(offer.buttons.map((b: any) => b.title)).toEqual(['Sí, avísame', 'No, gracias'])
    })

    it('not when it is not due (said no, already offered, avisos on, too soon: claimReoffer decides)', async () => {
      const t = setup({ chatReply: { message: 'Hoy toca lentejas.' } })
      t.deps.optIn = { markDeclined: vi.fn(async () => undefined), claimReoffer: vi.fn(async () => false) }
      await processInbound(msg({ text: '¿Qué comemos hoy?' }), t.deps)
      expect(t.outbound.map((o) => o.kind)).toEqual(['reply'])
    })

    it('never during the WhatsApp sign-up', async () => {
      const t = setup({ link: NEW_LINK, chatReply: { message: '¿Cuántos sois?' } })
      const claimReoffer = vi.fn(async () => true)
      t.deps.optIn = { markDeclined: vi.fn(async () => undefined), claimReoffer }
      await processInbound(msg({ text: 'hola' }), t.deps)
      expect(claimReoffer).not.toHaveBeenCalled()
    })
  })
})

// 2026-10-15: Miguel tried the WhatsApp sign-up of a new account from his
// already linked phone; «Vincular Mimoia: QUPTV7» went to Mimo, who answered
// «No puedo vincular cuentas desde el chat».
describe('processInbound — a linked number sends a link code', () => {
  it("its own account's code: nothing changes, no model call", async () => {
    const t = setup({ consume: (code, current) => (code === '4F7K2A' ? { userId: current!, sameUser: true } : null) })
    await processInbound(msg({ text: 'Vincular Mimoia: 4F7K2A' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.alreadyLinked }])
    expect(t.chat).not.toHaveBeenCalled()
  })

  it("another account's code: the number moves there and that account's sign-up starts", async () => {
    const t = setup({ consume: (code) => (code === 'QUPTV7' ? { userId: 'user-new', onboardingDone: false } : null) })
    await processInbound(msg({ text: 'Vincular Mimoia: QUPTV7' }), t.deps)
    expect(t.sent).toEqual([
      { type: 'text', text: COPY.movedAccount },
      { type: 'text', text: COPY.linkedOnboarding('Miguel') },
    ])
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'ignored', userId: 'user-new' })
    expect(t.chat).not.toHaveBeenCalled()
  })

  it("another account's code for an account already set up: linked + the opt-in question", async () => {
    const t = setup({ consume: () => ({ userId: 'user-2', onboardingDone: true }) })
    await processInbound(msg({ text: 'Vincular Mimoia: QUPTV7' }), t.deps)
    expect(t.sent[0]).toEqual({ type: 'text', text: COPY.movedAccount })
    expect(t.sent[1]).toEqual({ type: 'text', text: COPY.linked('Miguel') })
    expect(t.sent[2]).toMatchObject({ type: 'buttons', text: COPY.optInPrompt })
  })

  it('an expired or wrong code: says so, keeps the link, no model call', async () => {
    const t = setup()
    await processInbound(msg({ text: 'Vincular Mimoia: 9ZZZZ9' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.badCodeLinked }])
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('a normal message that happens to contain a code-like word still goes to Mimo', async () => {
    const t = setup({ consume: () => ({ userId: 'user-2' }) })
    await processInbound(msg({ text: 'Ponme el plato 2 del menú, el de la receta ABC2DE que vi ayer' }), t.deps)
    expect(t.chat).toHaveBeenCalled()
  })
})

describe('processInbound — late answer to «¿hiciste la cena?» (PRO-250)', () => {
  const checkin: HistoryRow = { direction: 'out', kind: 'dinner_checkin', body: '¿Hiciste hoy la cena (*Hummus casero*)? Así lo apunto.', status: 'sent', createdAt: new Date('2026-10-16T21:10:00Z') }

  it('at 00:30 Mimo is told the reply is about Friday 16; history keeps the user words only', async () => {
    const t = setup({ history: [checkin] })
    t.deps.now = () => new Date('2026-10-16T22:30:00Z')
    await processInbound(msg({ kind: 'interactive', text: 'Sí, la hice', replyId: 'checkin:yes', timestamp: Math.floor(new Date('2026-10-16T22:30:00Z').getTime() / 1000) }), t.deps)
    const sentText = (t.chat.mock.calls[0] as unknown[])[1] as string
    expect(sentText).toContain('contesta al aviso de la cena del viernes 16 de octubre')
    expect(sentText.endsWith('Sí, la hice')).toBe(true)
    expect(t.inboundUpdates.find((u) => u.status === 'processed')?.body).toBe('Sí, la hice')
  })

  it('during the day nothing is added', async () => {
    const t = setup({ history: [checkin] })
    await processInbound(msg({ text: 'Sí, la hice' }), t.deps)
    expect((t.chat.mock.calls[0] as unknown[])[1]).toBe('Sí, la hice')
  })
})
