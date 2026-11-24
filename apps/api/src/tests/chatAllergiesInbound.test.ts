/**
 * PRO-1305 · The WhatsApp inbound and the allergies said in the chat: the
 * permission's buttons are answered by the code (no model), a typed «sí» to
 * the question gets the buttons again, and every turn reads the person's
 * words first and sends the code's notices after Mimo's reply.
 */
import { describe, expect, it, vi } from 'vitest'
import { processInbound, type ChatAllergiesDeps, type InboundDeps } from '../services/whatsapp/inbound.js'
import type { InboundMessage } from '../services/whatsapp/webhookParser.js'
import type { OutboundMessage } from '../services/whatsapp/render.js'
import { EMPTY_USAGE } from '../services/advisorBudget.js'
import { consentButtonId, currentOutbox } from '../services/chatAllergies.js'

const NOW = new Date('2026-11-24T12:00:00Z')
const PHONE = '34600000073'
const Q = '0b7f6a1e-3c2d-4e5f-8a9b-1c2d3e4f5a6b'

function msg(partial: Partial<InboundMessage> = {}): InboundMessage {
  return { wamid: 'wamid.in', from: PHONE, timestamp: Math.floor(NOW.getTime() / 1000) - 5, profileName: 'Ana', kind: 'text', text: 'Soy alérgica al marisco', mediaId: null, mimeType: null, replyId: null, rawType: 'text', ...partial }
}

function setup(opts: { kinds?: Map<string, Date>; onboardingDone?: boolean; ca?: Partial<ChatAllergiesDeps> } = {}) {
  const sent: OutboundMessage[] = []
  const outbound: { kind: string; status: string }[] = []
  const order: string[] = []
  const ca: ChatAllergiesDeps = {
    beforeTurn: vi.fn(async () => {
      order.push('beforeTurn')
    }),
    answerButton: vi.fn(async (_u, _b, _t, send) => {
      await send({ kind: 'health_saved', text: 'Apuntado en la ficha de tu casa: marisco.' })
      return { tools: ['update_profile'] }
    }),
    repeatButtons: vi.fn(async () => ({ kind: 'health_ask', text: 'Para guardarlo necesito que pulses uno de los dos botones: así queda constancia de tu permiso.', buttons: [{ id: consentButtonId('ask', 'yes', Q), title: 'Sí, doy mi permiso' }, { id: consentButtonId('ask', 'no', Q), title: 'No, gracias' }] })),
    finishTurn: vi.fn(async (outbox, _lang, send) => {
      order.push(`finishTurn:${outbox.quiet}`)
      await send({ kind: 'health_saved', text: 'Apuntado en la ficha de tu casa: marisco.' })
    }),
    ...opts.ca,
  }
  const chat = vi.fn(async (userId: string) => {
    order.push(`chat:${currentOutbox(userId) ? 'outbox' : 'none'}`)
    return { message: 'Hecho, lo tengo en cuenta en el menú.', usage: EMPTY_USAGE }
  })
  const updates: { status: string; meta?: any }[] = []
  const deps: InboundDeps = {
    webUrl: 'https://mimoia.test',
    now: () => NOW,
    isUserAllowed: () => true,
    store: {
      getLinkByPhone: async () => ({ userId: 'user-1', phone: PHONE, notify: true, lastInboundAt: NOW, email: 'ana', username: 'ana', suspendedAt: null, onboardingDone: opts.onboardingDone ?? true }),
      consumeLinkCode: async () => null,
      touchInbound: async () => {},
      updateInbound: async (_w, patch) => {
        updates.push(patch as any)
      },
      insertOutbound: async (row) => {
        outbound.push({ kind: row.kind, status: row.status })
      },
      loadHistoryRows: async () => [],
      hasRecentOutbound: async () => false,
      recentOutboundKinds: async () => opts.kinds ?? new Map(),
      setNotify: async () => true,
    },
    client: {
      sendMessage: async (_to, m) => {
        sent.push(m)
        return `wamid.out.${sent.length}`
      },
      markReadWithTyping: async () => {},
      downloadMedia: async () => ({ buffer: Buffer.from(''), mimeType: 'audio/ogg' }),
    },
    chat: chat as any,
    checkBudget: async () => ({ exceeded: false, budgetMicros: 5_000_000 }),
    recordUsage: async () => 0,
    chatAllergies: ca,
  }
  return { deps, sent, outbound, order, ca, chat, updates }
}

describe('WhatsApp inbound · allergies said in the chat (PRO-1305)', () => {
  it('a turn: the code reads the words first, inside the turn’s outbox, and its notice goes after Mimo’s reply', async () => {
    const t = setup()
    await processInbound(msg(), t.deps)
    expect(t.order).toEqual(['beforeTurn', 'chat:outbox', 'finishTurn:false'])
    expect(t.ca.beforeTurn).toHaveBeenCalledWith('user-1', 'Soy alérgica al marisco')
    expect(t.sent.map((m) => (m as any).text)).toEqual(['Hecho, lo tengo en cuenta en el menú.', 'Apuntado en la ficha de tu casa: marisco.'])
    expect(t.outbound.map((o) => o.kind)).toEqual(['reply', 'health_saved'])
  })

  it('in the WhatsApp sign-up nothing is asked now (quiet): the follow-up asks after the first menu', async () => {
    const t = setup({ onboardingDone: false })
    await processInbound(msg(), t.deps)
    expect(t.order).toContain('finishTurn:true')
  })

  it('«Sí, doy mi permiso» tapped: answered by the code, no model, with the tap’s id', async () => {
    const t = setup()
    const replyId = consentButtonId('ask', 'yes', Q)
    await processInbound(msg({ kind: 'interactive', text: 'Sí, doy mi permiso', replyId, rawType: 'interactive' }), t.deps)
    expect(t.chat).not.toHaveBeenCalled()
    expect(t.ca.answerButton).toHaveBeenCalledWith('user-1', { kind: 'ask', answer: 'yes', questionId: Q }, { wamid: 'wamid.in', title: 'Sí, doy mi permiso', lang: 'es' }, expect.any(Function))
    expect(t.sent).toEqual([{ type: 'text', text: 'Apuntado en la ficha de tu casa: marisco.' }])
    expect(t.updates.at(-1)).toMatchObject({ status: 'processed', meta: { tools: ['update_profile'] } })
  })

  it('a typed «sí» right after the question: the buttons again (only the tap counts), no model', async () => {
    const t = setup({ kinds: new Map([['reply', new Date(NOW.getTime() - 120_000)], ['health_ask', new Date(NOW.getTime() - 60_000)]]) })
    await processInbound(msg({ text: 'Sí' }), t.deps)
    expect(t.chat).not.toHaveBeenCalled()
    expect(t.sent[0]).toMatchObject({ type: 'buttons', text: 'Para guardarlo necesito que pulses uno de los dos botones: así queda constancia de tu permiso.' })
    expect((t.sent[0] as any).buttons.map((b: any) => b.title)).toEqual(['Sí, doy mi permiso', 'No, gracias'])
  })

  it('a «sí» to something else Mimo asked later goes to Mimo', async () => {
    const t = setup({ kinds: new Map([['health_ask', new Date(NOW.getTime() - 120_000)], ['reply', new Date(NOW.getTime() - 60_000)]]) })
    await processInbound(msg({ text: 'Sí' }), t.deps)
    expect(t.ca.repeatButtons).not.toHaveBeenCalled()
    expect(t.chat).toHaveBeenCalled()
  })
})
