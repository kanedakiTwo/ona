/**
 * Contract tests for the WhatsApp inbound orchestrator. Every side effect is a
 * fake, so these pin the whole user-visible flow: linking, gating, budget,
 * voice notes, recipe photos and the chat round-trip.
 */
import { describe, it, expect, vi } from 'vitest'
import { processInbound, COPY, ackTextForTools, type InboundDeps } from '../services/whatsapp/inbound.js'
import type { InboundMessage } from '../services/whatsapp/webhookParser.js'
import type { LinkWithUser } from '../services/whatsapp/store.js'
import type { HistoryRow } from '../services/whatsapp/history.js'
import type { OutboundMessage } from '../services/whatsapp/render.js'
import { EMPTY_USAGE } from '../services/advisorBudget.js'
import { AI_DISCLOSURE_FIRST_PERSON } from '@ona/shared'

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
  consume?: (code: string) => { userId: string; onboardingDone?: boolean } | null
  budgetExceeded?: boolean
  history?: HistoryRow[]
  recentLinkHint?: boolean
  allowed?: boolean
  chatReply?: { message: string; uiHint?: string; data?: unknown; toolsUsed?: string[] }
  menuDigest?: InboundDeps['menuDigest']
  transcribe?: InboundDeps['transcribe']
  importRecipeFromImage?: InboundDeps['importRecipeFromImage']
  sendFails?: boolean
  outboundKinds?: Map<string, Date>
  supportEmail?: string
} = {}) {
  const sent: OutboundMessage[] = []
  const outbound: { kind: string; body: string; status: string }[] = []
  const historyUserIds: string[] = []
  const inboundUpdates: { status: string; body?: string | null; userId?: string | null; errorMessage?: string | null }[] = []
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
      consumeLinkCode: async (code) => overrides.consume?.(code) ?? null,
      touchInbound: async () => {},
      updateInbound: async (_wamid, patch) => {
        inboundUpdates.push(patch)
      },
      insertOutbound: async (row) => {
        outbound.push({ kind: row.kind, body: row.body, status: row.status })
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
    menuDigest: overrides.menuDigest,
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

  it('still links a message prefilled before the rename ("Vincular ONA: <code>")', async () => {
    const t = setup({ link: null, consume: (code) => (code === '4F7K2A' ? { userId: 'user-1' } : null) })
    await processInbound(msg({ text: 'Vincular ONA: 4F7K2A' }), t.deps)
    expect(t.sent[0]).toEqual({ type: 'text', text: COPY.linked('Miguel') })
  })

  it('says the code is invalid when it looks like a code but does not match', async () => {
    const t = setup({ link: null })
    await processInbound(msg({ text: 'Vincular Mimoia: 9ZZZZ9' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.badCode }])
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

  it('every text the bot sends on its own says Mimo / Mimoia, never the old name ONA', () => {
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

  it('says so when the photo is not a recipe', async () => {
    const t = setup({
      importRecipeFromImage: async () => {
        throw new Error('No se pudo identificar una receta en la imagen')
      },
    })
    await processInbound(photo(), t.deps)
    expect(t.sent).toEqual([
      { type: 'text', text: COPY.ackPhoto },
      { type: 'text', text: COPY.imageNotRecipe },
    ])
  })

  it('is polite when photo import is not wired', async () => {
    const t = setup()
    await processInbound(photo(), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.imageUnavailable }])
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

  it('ALTA (or the "Sí, avísame" button) turns them back on', async () => {
    const t = setup()
    await processInbound(msg({ kind: 'interactive', text: 'Sí, avísame', rawType: 'interactive' }), t.deps)
    expect(t.setNotify).toHaveBeenCalledWith('user-1', true)
    expect(t.sent[0]).toEqual({ type: 'text', text: COPY.started })
  })

  it('HUMANO gives the support contact without calling the model', async () => {
    const t = setup({ supportEmail: 'hola@ona.test' })
    await processInbound(msg({ text: 'Quiero hablar con una persona' }), t.deps)
    expect(t.chat).not.toHaveBeenCalled()
    expect(t.sent[0].text).toContain('hola@ona.test')
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
  const MENU_TEXT = '*Tu semana del 12 al 18 de octubre* (comida · cena)\n*Lun* Lentejas · Crema'
  const textOf = (sent: OutboundMessage[]) => sent.map((m) => m.text).join('\n')

  it('after generating the week, the digest goes between the model text and the app link', async () => {
    const menuDigest = vi.fn(async () => MENU_TEXT)
    const t = setup({
      chatReply: { message: 'Hecho:\n- Menú de la semana listo', uiHint: 'menu', data: { id: 'm-9', days: [] }, toolsUsed: ['generate_weekly_menu'] },
      menuDigest,
    })
    await processInbound(msg({ text: 'genera el menú de la semana' }), t.deps)
    expect(menuDigest).toHaveBeenCalledWith('user-1', 'm-9')
    const text = textOf(t.sent)
    expect(text.indexOf('Menú de la semana listo')).toBeLessThan(text.indexOf('*Lun* Lentejas'))
    expect(text.indexOf('*Lun* Lentejas')).toBeLessThan(text.indexOf(`${WEB}/menu`))
    // stored in history too, so the next turn can iterate on it
    expect(t.outbound.at(-1)!.body).toContain('*Lun* Lentejas')
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
    expect(textOf(t.sent)).not.toContain('*Lun*')
  })

  it('a failing menu read still sends the reply', async () => {
    const t = setup({
      chatReply: { message: 'Hecho:\n- Menú de la semana listo', uiHint: 'menu', data: { menuId: 'm-9' }, toolsUsed: ['generate_weekly_menu'] },
      menuDigest: async () => { throw new Error('db down') },
    })
    await processInbound(msg({ text: 'genera el menú' }), t.deps)
    expect(textOf(t.sent)).toContain('Menú de la semana listo')
  })
})

describe('processInbound — WhatsApp-first sign-up (2026-10-10)', () => {
  const NEW_LINK: LinkWithUser = { ...LINK, onboardingDone: false }

  it('a new account that links gets the first question in the chat; the opt-in waits', async () => {
    const t = setup({ link: null, consume: () => ({ userId: 'user-1', onboardingDone: false }) })
    await processInbound(msg({ text: 'Vincular Mimoia: 4F7K2A' }), t.deps)
    expect(t.sent).toEqual([{ type: 'text', text: COPY.linkedOnboarding('Miguel') }])
    expect(t.sent[0].text).toContain(AI_DISCLOSURE_FIRST_PERSON)
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
      menuDigest: async (_userId, menuId) => (menuId === 'menu-1' ? '*Tu semana del 6 al 12 de octubre*' : null),
    })
    await processInbound(msg({ text: 'Lentejas, tortilla y pescado al horno' }), t.deps)
    expect(t.outbound.map((o) => o.kind)).toEqual(['reply', 'system', 'optin_prompt'])
    expect(t.sent[0].text).toContain('*Tu semana del 6 al 12 de octubre*')
    expect(t.sent[1]).toEqual({ type: 'text', text: COPY.healthOnWeb(`${WEB}/profile`) })
    expect(t.sent[1].text).toMatch(/no guardo datos de salud/)
    expect(t.sent[2]).toMatchObject({ type: 'buttons', text: COPY.optInPrompt })
  })
})
