/**
 * PRO-285: Mimo asks each beta user with WhatsApp, once, what they did with
 * the leftovers of their last dinner — at the end of a WhatsApp reply (inside
 * the 24 h window), never together with another offer, off from 2026-11-08 —
 * and the answer goes to `user_feedback` tagged `sobras`, which
 * `/admin/feedback` counts.
 */
import express, { type RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('../db/connection.js', () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }))

import {
  LEFTOVERS_QUESTION,
  isLeftoversAnswer,
  maybeAppendLeftoversQuestion,
  recordLeftoversAnswer,
  shouldAskLeftovers,
  type LeftoversQuestionStore,
} from '../services/leftoversQuestion.js'
import { appendReplyOffers, type ReplyOfferSteps } from '../services/assistant/engine.js'
import { createFeedbackRouter, type FeedbackRepo, type FeedbackRow } from '../routes/feedback.js'
import type { ChatMessage } from '../services/assistant/types.js'

// Thursday 2026-10-22 12:00 in Madrid (UTC+2).
const NOW = new Date('2026-10-22T10:00:00Z')
const HOUR = 3_600_000

/** One user's row in memory: users.leftovers_question_at, the WhatsApp link, the tagged opinions. */
function memoryStore(over: { linked?: boolean; lastInboundAt?: Date | null } = {}) {
  const state = {
    askedAt: null as Date | null,
    linked: over.linked ?? true,
    lastInboundAt: over.lastInboundAt === undefined ? new Date(NOW.getTime() - 60_000) : over.lastInboundAt,
    answers: [] as Array<{ userId: string; text: string; tag: string; channel: string }>,
  }
  const store: LeftoversQuestionStore = {
    async load() {
      return { askedAt: state.askedAt, linked: state.linked, lastInboundAt: state.lastInboundAt }
    },
    async claim(_u, now) {
      if (state.askedAt) return false
      state.askedAt = now
      return true
    },
    async saveAnswer(userId, text) {
      if (state.answers.length) return false
      state.answers.push({ userId, text, tag: 'sobras', channel: 'whatsapp' })
      return true
    },
  }
  return { state, store }
}

describe('the question text', () => {
  it('is Miguel’s, word for word', () => {
    expect(LEFTOVERS_QUESTION).toBe(
      'Una pregunta rápida para Mimoia: ¿os sobró algo de la última cena que hicisteis en casa? Y si sobró, ¿qué hicisteis con ello: táper para el día siguiente, al congelador, se lo comió alguien o acabó tirándose? Contesta como te salga: nos ayuda a decidir si te pregunto por las sobras.',
    )
  })
})

describe('shouldAskLeftovers', () => {
  const base = { askedAt: null, linked: true, lastInboundAt: new Date(NOW.getTime() - 60_000), now: NOW }

  it('asks a linked user inside the 24 h window, once', () => {
    expect(shouldAskLeftovers(base)).toBe(true)
    expect(shouldAskLeftovers({ ...base, askedAt: new Date('2026-10-21T10:00:00Z') })).toBe(false)
  })

  it('only inside the 24 h window (with its safety margin), and only with WhatsApp linked', () => {
    expect(shouldAskLeftovers({ ...base, lastInboundAt: new Date(NOW.getTime() - 23 * HOUR) })).toBe(true)
    expect(shouldAskLeftovers({ ...base, lastInboundAt: new Date(NOW.getTime() - 24 * HOUR) })).toBe(false)
    expect(shouldAskLeftovers({ ...base, lastInboundAt: null })).toBe(false)
    expect(shouldAskLeftovers({ ...base, linked: false })).toBe(false)
  })

  it('is off from 2026-11-08 (Madrid)', () => {
    // 2026-11-08 00:00 in Madrid is 2026-11-07 23:00 UTC.
    const at = (iso: string) => ({ ...base, now: new Date(iso), lastInboundAt: new Date(new Date(iso).getTime() - 60_000) })
    expect(shouldAskLeftovers(at('2026-11-07T22:59:00Z'))).toBe(true)
    expect(shouldAskLeftovers(at('2026-11-07T23:00:00Z'))).toBe(false)
    expect(shouldAskLeftovers(at('2026-11-20T10:00:00Z'))).toBe(false)
  })
})

describe('maybeAppendLeftoversQuestion', () => {
  it('goes at the end of a WhatsApp reply, once per user', async () => {
    const { store, state } = memoryStore()
    const first = await maybeAppendLeftoversQuestion('u1', 'Hecho: el jueves cenáis crema de calabaza.', { mode: 'whatsapp', otherOffer: false, store, now: NOW })
    expect(first).toBe(`Hecho: el jueves cenáis crema de calabaza.\n\n${LEFTOVERS_QUESTION}`)
    expect(state.askedAt).toEqual(NOW)
    const second = await maybeAppendLeftoversQuestion('u1', 'Apuntado.', { mode: 'whatsapp', otherOffer: false, store, now: new Date(NOW.getTime() + HOUR) })
    expect(second).toBe('Apuntado.')
  })

  it('never in the web chat, during the first steps, with another offer or outside the window', async () => {
    for (const opts of [
      { mode: 'text', otherOffer: false },
      { mode: 'whatsapp', otherOffer: false, onboarding: true },
      { mode: 'whatsapp', otherOffer: true },
    ]) {
      const { store, state } = memoryStore()
      expect(await maybeAppendLeftoversQuestion('u1', 'Hola', { ...opts, store, now: NOW })).toBe('Hola')
      expect(state.askedAt).toBeNull()
    }
    const late = memoryStore({ lastInboundAt: new Date(NOW.getTime() - 25 * HOUR) })
    expect(await maybeAppendLeftoversQuestion('u1', 'Hola', { mode: 'whatsapp', otherOffer: false, store: late.store, now: NOW })).toBe('Hola')
    expect(late.state.askedAt).toBeNull()
  })

  it('a failing store leaves the reply as it was', async () => {
    const store = { load: async () => { throw new Error('db down') } } as unknown as LeftoversQuestionStore
    expect(await maybeAppendLeftoversQuestion('u1', 'Hola', { mode: 'whatsapp', otherOffer: false, store, now: NOW })).toBe('Hola')
  })
})

describe('appendReplyOffers: one offer per reply', () => {
  const steps = (store: LeftoversQuestionStore, over: Partial<ReplyOfferSteps> = {}): ReplyOfferSteps => ({
    family: async (_u, reply) => reply,
    invite: async (_u, reply) => reply,
    leftovers: (u, reply, opts) => maybeAppendLeftoversQuestion(u, reply, { ...opts, store, now: NOW }),
    ...over,
  })

  it('with no other offer due, the leftovers question goes (WhatsApp) and counts as the turn’s offer', async () => {
    const { store } = memoryStore()
    const r = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps(store))
    expect(r).toEqual({ message: `Hecho.\n\n${LEFTOVERS_QUESTION}`, offerAdded: true })
  })

  it('never together with the family offer or the invite to another household; it waits for a later reply', async () => {
    const { store, state } = memoryStore()
    const family = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps(store, { family: async (_u, r) => `${r}\n\nFAMILIA` }))
    expect(family).toEqual({ message: 'Hecho.\n\nFAMILIA', offerAdded: true })
    const invite = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps(store, { invite: async (_u, r) => `${r}\n\nINVITA` }))
    expect(invite).toEqual({ message: 'Hecho.\n\nINVITA', offerAdded: true })
    expect(state.askedAt).toBeNull()
    const later = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps(store))
    expect(later.message).toContain(LEFTOVERS_QUESTION)
    expect(later.message).not.toContain('FAMILIA')
  })

  it('in the web chat nothing is added', async () => {
    const { store } = memoryStore()
    expect(await appendReplyOffers('u1', 'Hecho.', { mode: 'text', invite: true }, steps(store))).toEqual({ message: 'Hecho.', offerAdded: false })
  })
})

describe('the answer', () => {
  const asked: ChatMessage[] = [
    { role: 'user', content: '¿Qué cenamos?' },
    { role: 'assistant', content: `Crema de calabaza.\n\n${LEFTOVERS_QUESTION}` },
  ]

  it('the message right after the question is saved verbatim, tagged sobras, once', async () => {
    const { store, state } = memoryStore()
    expect(isLeftoversAnswer('Sobró arroz y lo congelamos', asked)).toBe(true)
    expect(await recordLeftoversAnswer('u1', '  Sobró arroz y lo congelamos  ', asked, { store })).toBe(true)
    expect(state.answers).toEqual([{ userId: 'u1', text: 'Sobró arroz y lo congelamos', tag: 'sobras', channel: 'whatsapp' }])
    expect(await recordLeftoversAnswer('u1', 'Otra cosa', asked, { store })).toBe(false)
    expect(state.answers).toHaveLength(1)
  })

  it('a message that doesn’t follow the question is not an answer', async () => {
    const { store, state } = memoryStore()
    const other: ChatMessage[] = [{ role: 'assistant', content: 'Hecho.' }, { role: 'user', content: 'gracias' }, { role: 'assistant', content: 'De nada.' }]
    expect(await recordLeftoversAnswer('u1', 'Sobró arroz', other, { store })).toBe(false)
    expect(await recordLeftoversAnswer('u1', 'Sobró arroz', [], { store })).toBe(false)
    expect(state.answers).toEqual([])
  })
})

describe('/admin/feedback counts the answers (byTag)', () => {
  const servers: Server[] = []
  afterAll(() => servers.forEach((s) => { s.closeAllConnections(); s.close() }))

  it('admin and the agents token both get { sobras: n }; the agents never the text', async () => {
    const rows: FeedbackRow[] = [
      { id: 'f1', channel: 'whatsapp', text: 'Sobró arroz y lo congelamos', page: null, tag: 'sobras', createdAt: NOW },
      { id: 'f2', channel: 'whatsapp', text: 'No sobró nada', page: null, tag: 'sobras', createdAt: NOW },
      { id: 'f3', channel: 'app', text: 'Me encanta la lista', page: '/shopping', tag: null, createdAt: NOW },
    ]
    const repo: FeedbackRepo = { save: async () => {}, list: async () => rows }
    const readAuth: RequestHandler = (req, res, next) => (req.get('x-admin') || req.get('x-metrics-token') === 'ok' ? next() : res.sendStatus(401))
    const a = express()
    a.use(createFeedbackRouter({ repo, auth: (_q, _s, n) => n(), readAuth, now: () => NOW }))
    const server = await new Promise<Server>((resolve) => { const s = a.listen(0, '127.0.0.1', () => resolve(s)) })
    servers.push(server)
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const admin = await (await fetch(`${base}/admin/feedback`, { headers: { 'x-admin': '1' } })).json()
    expect(admin.byTag).toEqual({ sobras: 2 })
    expect(admin.items[0]).toMatchObject({ tag: 'sobras', text: 'Sobró arroz y lo congelamos' })
    const agents = await (await fetch(`${base}/admin/feedback`, { headers: { 'x-metrics-token': 'ok' } })).json()
    expect(agents.byTag).toEqual({ sobras: 2 })
    expect(JSON.stringify(agents)).not.toContain('arroz')
  })
})
