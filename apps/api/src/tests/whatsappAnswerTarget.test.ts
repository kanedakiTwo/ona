/**
 * PRO-1295: each button and each «sí» / «no» answers its own question.
 * The four cases of the task (an old aviso's button, a «No» to a question not
 * seen yet, two questions open, an opinion that is no cooked meal) and two
 * messages that arrive during a turn.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { processInbound, type InboundDeps } from '../services/whatsapp/inbound.js'
import {
  ambiguousAnswer,
  asksSomething,
  bareYesNo,
  clarifyAnswerOf,
  clarifyMessage,
  isOpinion,
  OPINION_BLOCKED_TOOLS,
  openQuestions,
  questionRef,
  questionText,
  refTime,
  splitButtonId,
  tagButtons,
} from '../services/whatsapp/answerTarget.js'
import { createCoalescer } from '../services/whatsapp/coalesce.js'
import { parseWebhookPayload, type InboundMessage } from '../services/whatsapp/webhookParser.js'
import type { HistoryRow } from '../services/whatsapp/history.js'
import type { OutboundMessage } from '../services/whatsapp/render.js'
import type { LinkWithUser } from '../services/whatsapp/store.js'
import { EMPTY_USAGE } from '../services/advisorBudget.js'

const NOW = new Date('2026-11-24T19:00:00Z') // martes 24, 20:00 en Madrid
const PHONE = '34600000073'
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000)

function msg(partial: Partial<InboundMessage> = {}): InboundMessage {
  return {
    wamid: 'wamid.in',
    from: PHONE,
    timestamp: Math.floor(NOW.getTime() / 1000) - 5,
    profileName: 'Ana',
    kind: 'text',
    text: 'No',
    mediaId: null,
    mimeType: null,
    replyId: null,
    rawType: 'text',
    ...partial,
  }
}

const tap = (id: string, title: string, at: Date): InboundMessage =>
  msg({ kind: 'interactive', rawType: 'interactive', text: title, replyId: id, replyRef: questionRef(at) })

const LINK: LinkWithUser = {
  userId: 'user-1',
  phone: PHONE,
  notify: true,
  lastInboundAt: ago(60),
  email: 'ana@example.com',
  username: 'ana',
  suspendedAt: null,
  onboardingDone: true,
}

const inRow = (at: Date, body: string, meta?: unknown): HistoryRow => ({ direction: 'in', kind: 'text', body, status: 'processed', createdAt: at, ...(meta ? { meta } : {}) })
const outRow = (at: Date, body: string, kind = 'reply'): HistoryRow => ({ direction: 'out', kind, body, status: 'sent', createdAt: at })

function setup(history: HistoryRow[], extra: Partial<InboundDeps> = {}) {
  const sent: OutboundMessage[] = []
  const outbound: { kind: string; body: string }[] = []
  const inboundUpdates: { status: string; body?: string | null; meta?: unknown }[] = []
  const chat = vi.fn(async (_u: string, _text: string, _h: unknown, _o: unknown) => ({ message: 'Vale.', usage: EMPTY_USAGE }))
  const deps: InboundDeps = {
    webUrl: 'https://mimoia.test',
    now: () => NOW,
    isUserAllowed: () => true,
    store: {
      getLinkByPhone: async () => LINK,
      consumeLinkCode: async () => null,
      touchInbound: async () => {},
      updateInbound: async (_w, patch) => {
        inboundUpdates.push(patch)
      },
      insertOutbound: async (row) => {
        outbound.push({ kind: row.kind, body: row.body })
      },
      loadHistoryRows: async () => history,
      hasRecentOutbound: async () => false,
      recentOutboundKinds: async () => new Map(),
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
    chat,
    checkBudget: async () => ({ exceeded: false, budgetMicros: 5_000_000 }),
    recordUsage: async () => 0,
    ...extra,
  }
  return { deps, sent, outbound, inboundUpdates, chat }
}

describe('the question goes in the button id', () => {
  it('tags every button with the second it went out and splits it back', () => {
    const at = new Date('2026-11-23T20:30:00Z')
    const tagged = tagButtons({ type: 'buttons', text: '¿Qué tal ha salido hoy la cena?', buttons: [{ id: 'checkin:up', title: '👍' }] }, at)
    expect(tagged.type === 'buttons' && tagged.buttons[0].id).toBe(`checkin:up~${questionRef(at)}`)
    expect(splitButtonId(`checkin:up~${questionRef(at)}`)).toEqual({ base: 'checkin:up', ref: questionRef(at) })
    expect(refTime(questionRef(at))?.getTime()).toBe(at.getTime())
    // Buttons sent before 24-nov: no ref, the id as it was.
    expect(splitButtonId('checkin:up')).toEqual({ base: 'checkin:up', ref: null })
    expect(refTime('xyz')).toBeNull()
    // Texts and pictures go as they are.
    expect(tagButtons({ type: 'text', text: 'hola' }, at)).toEqual({ type: 'text', text: 'hola' })
  })

  it('the parser gives the old id to every reader and the ref apart', () => {
    const ref = questionRef(ago(60 * 48))
    const [m] = parseWebhookPayload({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'w1', from: PHONE, timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: `checkin:no~${ref}`, title: 'No la hice' } } }] } }] }],
    })
    expect(m).toMatchObject({ kind: 'interactive', replyId: 'checkin:no', replyRef: ref, text: 'No la hice' })
  })
})

describe('an old aviso’s button is resolved against that aviso', () => {
  it('a 👍 tapped under Sunday’s check-in records Sunday’s dinner, not the last check-in’s', async () => {
    const sunday = new Date('2026-11-22T21:15:00Z')
    const recordDinnerCheckin = vi.fn(async () => ({ name: 'Lentejas' }))
    const t = setup([], { recordDinnerCheckin })
    await processInbound(tap('checkin:up', '👍', sunday), t.deps)
    expect(recordDinnerCheckin).toHaveBeenCalledWith('user-1', { cooked: true, rating: 4 }, sunday)
    expect(t.chat).not.toHaveBeenCalled()
  })

  it('a check-in button over a week old is not applied to another day: it goes to Mimo', async () => {
    const recordDinnerCheckin = vi.fn(async () => ({ name: 'Lentejas' }))
    const t = setup([], { recordDinnerCheckin })
    await processInbound(tap('checkin:up', '👍', ago(60 * 24 * 9)), t.deps)
    expect(recordDinnerCheckin).not.toHaveBeenCalled()
    expect(t.chat).toHaveBeenCalled()
  })

  it('«Cambia a algo rápido» under yesterday’s reminder does not swap tonight’s dinner', async () => {
    const t = setup([])
    await processInbound(tap('cooking:swap', 'Cambia a algo rápido', new Date('2026-11-23T18:20:00Z')), t.deps)
    expect(t.chat).not.toHaveBeenCalled()
    expect(t.sent[0]).toMatchObject({ type: 'text', text: expect.stringContaining('lunes 23 de noviembre, que ya pasó') })
  })

  it('«Ahora no» under the Sunday menu is answered by code', async () => {
    const t = setup([])
    await processInbound(tap('nudge:no', 'Ahora no', ago(60 * 48)), t.deps)
    expect(t.chat).not.toHaveBeenCalled()
    expect(t.sent[0]).toMatchObject({ text: expect.stringContaining('no lo preparo') })
  })

  it('a tap on an earlier question goes to Mimo with that question', async () => {
    const asked = ago(50)
    const history = [outRow(asked, '¿Tienes horno en casa?\n⟦botones: Sí | No⟧'), inRow(ago(40), 'pon pescado el jueves'), outRow(ago(39), 'Hecho: merluza el jueves.')]
    const t = setup(history)
    await processInbound(tap('opt:1', 'No', asked), t.deps)
    const text = t.chat.mock.calls[0][1]
    expect(text).toContain('«No» contesta a tu mensaje de hoy a las 19:10: «¿Tienes horno en casa?»')
    expect(text.endsWith('No')).toBe(true)
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', body: 'No (a «¿Tienes horno en casa?»)' })
  })

  it('a tap on Mimo’s last message goes as before, with no note', async () => {
    const asked = ago(2)
    const t = setup([inRow(ago(3), '¿lo cambio?'), outRow(asked, '¿Te pongo pescado el jueves?\n⟦botones: Sí | No⟧')])
    await processInbound(tap('opt:0', 'Sí', asked), t.deps)
    expect(t.chat.mock.calls[0][1]).toBe('Sí')
  })
})

describe('a written «sí» / «no» that could answer more than one question', () => {
  it('reads a bare yes or no, and nothing that says more', () => {
    expect(bareYesNo('No')).toBe('no')
    expect(bareYesNo('no, gracias')).toBe('no')
    expect(bareYesNo('Sí!')).toBe('si')
    expect(bareYesNo('sí, vale')).toBe('si')
    expect(bareYesNo('No, ponme pescado')).toBeNull()
    expect(bareYesNo('vale')).toBeNull()
    expect(bareYesNo('sí y no')).toBeNull()
  })

  it('knows what asks: buttons, or a last line with «?» (links and marks aside)', () => {
    expect(asksSomething('Listo.\n¿Cambio algo? Dímelo.\n📖 Recetas: mimoia.com/menu')).toBe(true)
    expect(asksSomething('Hecho: merluza el jueves.')).toBe(false)
    expect(asksSomething('Elige:\n⟦botones: A | B⟧')).toBe(true)
    expect(questionText('Apuntado.\n¿Qué tal ha salido hoy la cena (*Lentejas*)? Así lo apunto.')).toBe('¿Qué tal ha salido hoy la cena (Lentejas)?')
  })

  it('two questions open: Mimo asks which one, a button each, and runs nothing', async () => {
    const history = [
      inRow(ago(20), 'hazme el menú'),
      outRow(ago(19), '⟦imagen enviada: el menú de la semana, día a día⟧\nListo: tu menú hasta el domingo\n¿Cambio algo? Dímelo, p. ej. «el sábado, pescado».'),
      outRow(ago(18), '¿Os sobró algo de la cena de ayer?', 'survey'),
    ]
    const t = setup(history)
    await processInbound(msg({ text: 'No' }), t.deps)
    expect(t.chat).not.toHaveBeenCalled()
    const ask = t.sent[0]
    expect(ask.type).toBe('buttons')
    if (ask.type !== 'buttons') return
    expect(ask.text).toContain('¿a qué contestas «No»?')
    expect(ask.text).toContain('1. ¿Cambio algo?')
    expect(ask.text).toContain('2. ¿Os sobró algo de la cena de ayer?')
    expect(ask.buttons.map((b) => b.id)).toEqual([`cual:no:${questionRef(ago(19))}`, `cual:no:${questionRef(ago(18))}`])
    expect(ask.buttons.every((b) => b.title.length <= 20)).toBe(true)
    expect(t.outbound[0].kind).toBe('clarify')
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', body: 'No', meta: { ambiguous: true } })
  })

  it('the tap on one of them sends the household’s «No» to Mimo with that question', async () => {
    const history = [
      inRow(ago(20), 'hazme el menú'),
      outRow(ago(19), 'Listo: tu menú hasta el domingo\n¿Cambio algo? Dímelo.'),
      outRow(ago(18), '¿Os sobró algo de la cena de ayer?', 'survey'),
      inRow(ago(1), 'No', { ambiguous: true }),
      outRow(ago(1), 'Para no equivocarme: ¿a qué contestas «No»?\n⟦botones: 1. ¿Cambio algo | 2. ¿Os sobró algo…⟧', 'clarify'),
    ]
    const t = setup(history)
    const m = msg({ kind: 'interactive', rawType: 'interactive', text: '2. ¿Os sobró algo…', replyId: `cual:no:${questionRef(ago(18))}`, replyRef: questionRef(ago(1)) })
    await processInbound(m, t.deps)
    const text = t.chat.mock.calls[0][1]
    expect(text).toContain('«No» contesta a tu mensaje de hoy a las 19:42: «¿Os sobró algo de la cena de ayer?»')
    expect(text.endsWith('\n\nNo')).toBe(true)
    expect(t.inboundUpdates.at(-1)).toMatchObject({ status: 'processed', body: 'No (a «¿Os sobró algo de la cena de ayer?»)' })
  })

  it('a «No» written before the question it hadn’t seen yet is not its answer: Mimo asks', async () => {
    // 6-nov: the «No» that stopped the menu came in while Mimo was making it,
    // and the menu’s «¿Cambio algo?» took it as its answer.
    const history = [inRow(ago(3), 'hazme el menú de la semana'), outRow(ago(0.1), 'Listo: tu menú hasta el domingo\n¿Cambio algo? Dímelo.')]
    const t = setup(history)
    await processInbound(msg({ text: 'No', timestamp: Math.floor(ago(1).getTime() / 1000) }), t.deps)
    expect(t.chat).not.toHaveBeenCalled()
    const ask = t.sent[0]
    if (ask.type !== 'buttons') throw new Error('expected buttons')
    expect(ask.text).toContain('Lo que hablábamos antes')
    expect(ask.buttons.at(-1)!.id).toBe(`cual:no:${questionRef(ago(0.1))}:antes`)
    expect(clarifyAnswerOf(ask.buttons.at(-1)!.id)).toEqual({ answer: 'no', ref: questionRef(ago(0.1)), before: true })
  })

  it('«Lo de antes» tells Mimo the «No» does not answer the question it hadn’t seen', async () => {
    const asked = ago(2)
    const history = [inRow(ago(4), 'hazme el menú'), outRow(asked, 'Listo.\n¿Cambio algo? Dímelo.'), inRow(ago(1), 'No', { ambiguous: true }), outRow(ago(1), '…', 'clarify')]
    const t = setup(history)
    await processInbound(msg({ kind: 'interactive', rawType: 'interactive', text: '2. Lo de antes', replyId: `cual:no:${questionRef(asked)}:antes`, replyRef: questionRef(ago(1)) }), t.deps)
    expect(t.chat.mock.calls[0][1]).toContain('lo escribió antes de ver tu mensaje «¿Cambio algo?»: no contesta a eso')
  })

  it('one question, seen: the «No» is its answer, as before', async () => {
    const t = setup([inRow(ago(5), '¿cenamos pescado?'), outRow(ago(4), '¿Te pongo merluza el jueves?')])
    await processInbound(msg({ text: 'No' }), t.deps)
    expect(t.chat.mock.calls[0][1]).toBe('No')
    expect(ambiguousAnswer([outRow(ago(4), '¿Seguro?')], ago(1), NOW)).toBeNull()
  })

  it('a reply in several rows is one question; a question already answered is closed', () => {
    const rows = [
      outRow(ago(30), '¿Te pongo merluza?'),
      inRow(ago(29), 'sí'),
      outRow(new Date(ago(10).getTime()), '⟦imagen enviada: el menú⟧\nTu menú'),
      outRow(new Date(ago(10).getTime() + 2000), '¿Cambio algo?\n⟦botones: Sí | No⟧'),
    ]
    expect(openQuestions(rows, NOW).map((q) => q.text)).toEqual(['¿Cambio algo?'])
  })

  it('in English, the «which one?» in English', () => {
    const m = clarifyMessage('si', { questions: [{ at: ago(3), ref: questionRef(ago(3)), kind: 'reply', text: 'Shall I change it?', buttons: [] }, { at: ago(2), ref: questionRef(ago(2)), kind: 'survey', text: 'Any leftovers?', buttons: [] }], unseen: false }, 'en')
    expect(m.text).toContain('which one does your «Yes» answer?')
  })
})

describe('an opinion is not a cooked meal', () => {
  it('tells an opinion from a report', () => {
    expect(isOpinion('Me gusta!')).toBe(true)
    expect(isOpinion('qué rico')).toBe(true)
    expect(isOpinion('Tiene buena pinta, ponla el jueves')).toBe(true)
    expect(isOpinion('nos gustó mucho')).toBe(false)
    expect(isOpinion('la hice y estaba muy rica')).toBe(false)
    expect(isOpinion('pon lentejas el jueves')).toBe(false)
  })

  it('«me gusta» to a proposal: the turn can’t log a cooked meal', async () => {
    const t = setup([inRow(ago(3), '¿qué hago hoy?'), outRow(ago(2), 'Te propongo *Pollo al curry* para cenar. ¿Te lo pongo?')])
    await processInbound(msg({ text: 'Me gusta' }), t.deps)
    const [, text, , opts] = t.chat.mock.calls[0]
    expect(opts).toMatchObject({ withoutTools: OPINION_BLOCKED_TOOLS })
    expect(OPINION_BLOCKED_TOOLS).toContain('log_cooked')
    expect(text).toContain('no lo apuntes como hecho')
    expect(text.endsWith('Me gusta')).toBe(true)
  })

  it('«qué rico» to the dinner check-in still records the dinner', async () => {
    const t = setup([outRow(ago(30), '¿Qué tal ha salido hoy la cena (*Lentejas*)? Así lo apunto.\n⟦botones: 👍 | 👎 | No la hice⟧', 'dinner_checkin')])
    await processInbound(msg({ text: 'qué rico' }), t.deps)
    expect(t.chat.mock.calls[0][3]).not.toHaveProperty('withoutTools')
  })
})

describe('what arrives during a turn waits for it', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('two texts sent while Mimo answers go after its reply, as one turn, in order', async () => {
    vi.useFakeTimers()
    let busy = true
    const runs: string[] = []
    const c = createCoalescer({ run: async (turn) => void runs.push(turn.text ?? ''), busy: () => busy, windowMs: 5_000 })
    void c.push(msg({ wamid: 'a', text: 'y sin cebolla' }))
    await vi.advanceTimersByTimeAsync(8_000)
    void c.push(msg({ wamid: 'b', text: 'ah, y somos 4' }))
    // Long past the window and the 20 s cap: still waiting for the turn.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(runs).toEqual([])
    busy = false
    c.idle(PHONE)
    await vi.advanceTimersByTimeAsync(0)
    expect(runs).toEqual(['y sin cebolla\nah, y somos 4'])
  })

  it('a text still in its window when the turn ends keeps its own timer', async () => {
    vi.useFakeTimers()
    let busy = true
    const runs: string[] = []
    const c = createCoalescer({ run: async (turn) => void runs.push(turn.text ?? ''), busy: () => busy, windowMs: 5_000 })
    void c.push(msg({ wamid: 'a', text: 'otra cosa' }))
    await vi.advanceTimersByTimeAsync(1_000)
    busy = false
    c.idle(PHONE)
    expect(runs).toEqual([])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(runs).toEqual(['otra cosa'])
  })

  it('a button tapped meanwhile lets the held texts go first, then goes itself', async () => {
    vi.useFakeTimers()
    const runs: string[] = []
    const c = createCoalescer({ run: async (turn) => void runs.push(turn.text ?? ''), busy: () => true, windowMs: 5_000 })
    void c.push(msg({ wamid: 'a', text: 'una cosa' }))
    await vi.advanceTimersByTimeAsync(6_000)
    void c.push(msg({ wamid: 'b', kind: 'interactive', rawType: 'interactive', text: 'Sí', replyId: 'opt:0' }))
    expect(runs).toEqual(['una cosa', 'Sí'])
  })
})
