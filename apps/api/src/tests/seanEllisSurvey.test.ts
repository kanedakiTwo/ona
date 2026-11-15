/**
 * PRO-334 · the Sean Ellis survey (specs/feedback.md): who gets it, once
 * per person (WhatsApp line or /menu card), the answer filed as an opinion
 * tagged `sean_ellis`, and `/admin/feedback` (→ data/opiniones) counting it
 * by tag and option without text.
 */
import express, { type RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import { createSeanEllisRouter } from '../routes/seanEllis.js'
import { createFeedbackRouter, type FeedbackRepo, type FeedbackRow } from '../routes/feedback.js'
import { SEAN_ELLIS_ANSWER_LIST, feedbackForAgents } from '../services/agentView.js'
import { appendReplyOffers, type ReplyOfferSteps } from '../services/assistant/engine.js'
import { appSkills } from '../services/assistant/appSkills.js'
import { AppApiError, type AppApi } from '../services/assistant/appApi.js'
import { TOOL_GROUPS } from '../services/assistant/toolGroups.js'
import {
  SEAN_ELLIS_ANSWERS,
  SEAN_ELLIS_QUESTION,
  SEAN_ELLIS_TAG,
  SEAN_ELLIS_WHATSAPP,
  isSeanEllisReply,
  maybeAppendSeanEllis,
  parseSeanEllisAnswer,
  recordSeanEllisReply,
  seanEllisChannel,
  seanEllisDue,
  type SeanEllisSaved,
  type SeanEllisState,
  type SeanEllisStore,
} from '../services/seanEllisSurvey.js'

const NOW = new Date('2026-11-12T10:00:00Z')
const HOUR = 3600_000
const DAY = 24 * HOUR
const RULES = { now: NOW, adminEmails: ['admin@example.org'], testDomains: ['example.com'] }

function state(over: Partial<SeanEllisState> = {}): SeanEllisState {
  return {
    createdAt: new Date(NOW.getTime() - 20 * DAY),
    askedAt: null,
    answered: false,
    child: false,
    housemates: [{ email: 'ana@example.org', role: 'user' }],
    hasMenu: true,
    activeDays: 3,
    lastInboundAt: null,
    ...over,
  }
}

function memoryStore(over: Partial<SeanEllisState> = {}) {
  const s = state(over)
  const answers: SeanEllisSaved[] = []
  const store: SeanEllisStore = {
    async load() {
      return { ...s, answered: answers.length > 0 }
    },
    async claim(_u, now) {
      if (s.askedAt) return false
      s.askedAt = now
      return true
    },
    async saveAnswer(_u, a, now) {
      s.askedAt ??= now
      if (answers.length) return false
      answers.push(a)
      return true
    },
  }
  return { store, state: s, answers }
}

describe('who gets it', () => {
  it('an adult of the beta with 14 days, a menu and 2 active days in the last 14', () => {
    expect(seanEllisDue(state(), RULES)).toBe(true)
    expect(seanEllisDue(state({ createdAt: new Date(NOW.getTime() - 13.9 * DAY) }), RULES)).toBe(false)
    expect(seanEllisDue(state({ hasMenu: false }), RULES)).toBe(false)
    expect(seanEllisDue(state({ activeDays: 1 }), RULES)).toBe(false)
    expect(seanEllisDue(state({ child: true }), RULES)).toBe(false)
  })

  it('never an internal or test household, nor after the beta', () => {
    expect(seanEllisDue(state({ housemates: [{ email: 'ana@example.org', role: 'user' }, { email: 'ADMIN@example.org ', role: 'user' }] }), RULES)).toBe(false)
    expect(seanEllisDue(state({ housemates: [{ email: 'x@example.org', role: 'admin' }] }), RULES)).toBe(false)
    expect(seanEllisDue(state({ housemates: [{ email: 'prueba@example.com', role: 'user' }] }), RULES)).toBe(false)
    expect(seanEllisDue(state(), { ...RULES, now: new Date('2026-12-15T00:00:00Z') })).toBe(false)
  })

  it('once: asked, closed or answered hide it for good', () => {
    expect(seanEllisDue(state({ askedAt: NOW }), RULES)).toBe(false)
    expect(seanEllisDue(state({ answered: true }), RULES)).toBe(false)
  })

  it('WhatsApp when the person wrote to Mimo there in the last 7 days; otherwise the /menu card', () => {
    expect(seanEllisChannel(state({ lastInboundAt: new Date(NOW.getTime() - 6 * DAY) }), RULES)).toBe('whatsapp')
    expect(seanEllisChannel(state({ lastInboundAt: new Date(NOW.getTime() - 8 * DAY) }), RULES)).toBe('web')
    expect(seanEllisChannel(state(), RULES)).toBe('web')
    expect(seanEllisChannel(state({ askedAt: NOW }), RULES)).toBeNull()
  })

  it('the agents’ list of options is the survey’s', () => {
    expect([...SEAN_ELLIS_ANSWER_LIST]).toEqual([...SEAN_ELLIS_ANSWERS])
  })
})

describe('the answer in words', () => {
  it('the number or the words of each option', () => {
    expect(parseSeanEllisAnswer('1')).toBe('muy')
    expect(parseSeanEllisAnswer('2) algo')).toBe('algo')
    expect(parseSeanEllisAnswer('3, la verdad')).toBe('nada')
    expect(parseSeanEllisAnswer('4')).toBe('ya_no')
    expect(parseSeanEllisAnswer('Muy decepcionada, la uso cada día')).toBe('muy')
    expect(parseSeanEllisAnswer('Algo decepcionado')).toBe('algo')
    expect(parseSeanEllisAnswer('Nada decepcionado')).toBe('nada')
    expect(parseSeanEllisAnswer('Ya no la uso')).toBe('ya_no')
    expect(parseSeanEllisAnswer('15 personas')).toBeNull()
    expect(parseSeanEllisAnswer('¿qué cenamos hoy?')).toBeNull()
  })
})

describe('on WhatsApp: once, at the end of a reply', () => {
  const inbound = { lastInboundAt: new Date(NOW.getTime() - HOUR) }

  it('goes once at the end of a reply; never again', async () => {
    const { store, state: s } = memoryStore(inbound)
    expect(await maybeAppendSeanEllis('u1', 'Hecho.', { mode: 'whatsapp', otherOffer: false, store, now: NOW, ...RULES })).toBe(`Hecho.\n\n${SEAN_ELLIS_WHATSAPP}`)
    expect(s.askedAt).toEqual(NOW)
    expect(await maybeAppendSeanEllis('u1', 'Hecho.', { mode: 'whatsapp', otherOffer: false, store, now: NOW, ...RULES })).toBe('Hecho.')
  })

  it('not in the web chat, not with another offer, not outside the 24 h window, not when the card is the channel', async () => {
    for (const opts of [{ mode: 'text', otherOffer: false }, { mode: 'whatsapp', otherOffer: true }]) {
      const { store, state: s } = memoryStore(inbound)
      expect(await maybeAppendSeanEllis('u1', 'Hola', { ...opts, store, now: NOW, ...RULES })).toBe('Hola')
      expect(s.askedAt).toBeNull()
    }
    const late = memoryStore({ lastInboundAt: new Date(NOW.getTime() - 25 * HOUR) })
    expect(await maybeAppendSeanEllis('u1', 'Hola', { mode: 'whatsapp', otherOffer: false, store: late.store, now: NOW, ...RULES })).toBe('Hola')
    expect(late.state.askedAt).toBeNull()
  })

  it('a failing store leaves the reply as it was', async () => {
    const store = { load: async () => { throw new Error('db down') } } as unknown as SeanEllisStore
    expect(await maybeAppendSeanEllis('u1', 'Hola', { mode: 'whatsapp', otherOffer: false, store, now: NOW, ...RULES })).toBe('Hola')
  })

  it('last in the line of offers: only when no other went', async () => {
    const { store } = memoryStore(inbound)
    const steps = (over: Partial<ReplyOfferSteps> = {}): ReplyOfferSteps => ({
      family: async (_u, r) => r,
      invite: async (_u, r) => r,
      leftovers: async (_u, r) => r,
      seanEllis: (u, r, o) => maybeAppendSeanEllis(u, r, { ...o, store, now: NOW, ...RULES }),
      ...over,
    })
    const sobras = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps({ leftovers: async (_u, r) => `${r}\n\nSOBRAS` }))
    expect(sobras).toEqual({ message: 'Hecho.\n\nSOBRAS', offerAdded: true })
    const r = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps())
    expect(r).toEqual({ message: `Hecho.\n\n${SEAN_ELLIS_WHATSAPP}`, offerAdded: true })
  })

  it('the next message is the answer: saved once, verbatim, with its option', async () => {
    const { store, answers } = memoryStore(inbound)
    const asked = [{ role: 'assistant' as const, content: `Hecho.\n\n${SEAN_ELLIS_WHATSAPP}` }]
    expect(isSeanEllisReply('2', asked)).toBe(true)
    expect(await recordSeanEllisReply('u1', ' 2 ', asked, { store, now: NOW })).toBe(true)
    expect(await recordSeanEllisReply('u1', '1', asked, { store, now: NOW })).toBe(false)
    expect(answers).toEqual([{ channel: 'whatsapp', answer: 'algo', text: '2' }])
    expect(await recordSeanEllisReply('u1', '1', [{ role: 'assistant', content: 'Hola' }], { store: memoryStore().store, now: NOW })).toBe(false)
  })
})

const servers: Server[] = []
afterAll(() => servers.forEach((s) => { s.closeAllConnections(); s.close() }))

async function listen(a: express.Express) {
  const server = await new Promise<Server>((resolve) => { const s = a.listen(0, '127.0.0.1', () => resolve(s)) })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const fakeAuth: RequestHandler = (req, res, next) => {
  const id = req.get('x-user')
  if (!id) { res.status(401).json({ error: 'No token provided' }); return }
  ;(req as unknown as { userId: string }).userId = id
  next()
}

async function surveyApp(over: Partial<SeanEllisState> = {}) {
  const mem = memoryStore(over)
  const a = express()
  a.use(express.json())
  a.use(createSeanEllisRouter({ store: mem.store, now: () => NOW, auth: fakeAuth, adminEmails: RULES.adminEmails, testDomains: RULES.testDomains }))
  const base = await listen(a)
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', 'x-user': 'u1' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, body: await r.json() }
  }
  return { ...mem, call }
}

describe('the /menu card (routes)', () => {
  it('shows the question and the four options; answering files it once and hides it', async () => {
    const { call, answers } = await surveyApp()
    const g = await call('GET', '/sean-ellis')
    expect(g.body.show).toBe(true)
    expect(g.body.question).toBe(SEAN_ELLIS_QUESTION)
    expect(g.body.options.map((o: { key: string }) => o.key)).toEqual([...SEAN_ELLIS_ANSWERS])
    expect((await call('POST', '/sean-ellis', { answer: 'quizá' })).status).toBe(400)
    expect((await call('POST', '/sean-ellis', { answer: 'muy', why: ' Me ahorra pensar ' })).body).toEqual({ ok: true, saved: true })
    expect((await call('POST', '/sean-ellis', { answer: 'nada' })).body).toEqual({ ok: true, saved: false })
    expect(answers).toEqual([{ channel: 'app', answer: 'muy', text: 'Muy decepcionado/a. Me ahorra pensar' }])
    expect((await call('GET', '/sean-ellis')).body).toEqual({ show: false })
  })

  it('«Ahora no» closes it for good', async () => {
    const { call } = await surveyApp()
    await call('POST', '/sean-ellis/dismiss', {})
    expect((await call('GET', '/sean-ellis')).body).toEqual({ show: false })
  })

  it('not on /menu when Mimo asks it on WhatsApp; Mimo’s tool files the answer from there', async () => {
    const { call, store, answers } = await surveyApp({ lastInboundAt: new Date(NOW.getTime() - HOUR) })
    expect((await call('GET', '/sean-ellis')).body).toEqual({ show: false })
    await store.claim('u1', NOW)
    expect((await call('POST', '/sean-ellis', { answer: 'ya_no', channel: 'whatsapp' })).body.saved).toBe(true)
    expect(answers[0]).toMatchObject({ channel: 'whatsapp', answer: 'ya_no' })
  })

  it('whoever was not asked (too new) can’t file it', async () => {
    const { call, answers } = await surveyApp({ createdAt: new Date(NOW.getTime() - 3 * DAY) })
    expect((await call('GET', '/sean-ellis')).body).toEqual({ show: false })
    expect((await call('POST', '/sean-ellis', { answer: 'muy' })).status).toBe(409)
    expect(answers).toEqual([])
  })
})

describe('/admin/feedback → data/opiniones counts it by tag and option, never the text', () => {
  it('byTag { sean_ellis } and seanEllis by option', async () => {
    const rows: FeedbackRow[] = [
      { id: 'f1', channel: 'app', text: 'Muy decepcionado/a. Me ahorra pensar', page: null, tag: SEAN_ELLIS_TAG, answer: 'muy', createdAt: NOW },
      { id: 'f2', channel: 'whatsapp', text: '1', page: null, tag: SEAN_ELLIS_TAG, answer: 'muy', createdAt: NOW },
      { id: 'f3', channel: 'whatsapp', text: 'pues no sé', page: null, tag: SEAN_ELLIS_TAG, answer: null, createdAt: NOW },
      { id: 'f4', channel: 'app', text: 'Algo decepcionado/a', page: null, tag: SEAN_ELLIS_TAG, answer: 'algo', createdAt: NOW },
      { id: 'f5', channel: 'app', text: 'Me encanta la lista', page: '/shopping', tag: null, createdAt: NOW },
    ]
    const repo: FeedbackRepo = { save: async () => {}, list: async () => rows }
    const readAuth: RequestHandler = (req, res, next) => (req.get('x-admin') || req.get('x-metrics-token') === 'ok' ? next() : res.sendStatus(401))
    const a = express()
    a.use(createFeedbackRouter({ repo, auth: (_q, _s, n) => n(), readAuth, now: () => NOW }))
    const base = await listen(a)
    const agents = await (await fetch(`${base}/admin/feedback`, { headers: { 'x-metrics-token': 'ok' } })).json()
    expect(agents.byTag).toEqual({ sean_ellis: 4 })
    expect(agents.seanEllis).toEqual({ muy: 2, sin_opcion: 1, algo: 1 })
    expect(JSON.stringify(agents)).not.toMatch(/ahorra|no sé|decepcionado/)
    const admin = await (await fetch(`${base}/admin/feedback`, { headers: { 'x-admin': '1' } })).json()
    expect(admin.seanEllis).toEqual({ muy: 2, sin_opcion: 1, algo: 1 })
    expect(feedbackForAgents(1, rows).seanEllis).toEqual({ muy: 2, sin_opcion: 1, algo: 1 })
  })
})

describe('Mimo: answer_sean_ellis (D-051, the same POST /sean-ellis as the card)', () => {
  const skill = appSkills.find((t) => t.name === 'answer_sean_ellis')!
  const ctx = (api: AppApi, channel?: string) => ({ userId: 'u1', db: null, api, channel }) as any

  it('files the answer with its channel and why; in the hogar group', async () => {
    expect(TOOL_GROUPS.hogar.tools).toContain('answer_sean_ellis')
    expect(TOOL_GROUPS.hogar.words.test('me sentiria muy decepcionada')).toBe(true)
    const calls: unknown[] = []
    const api = (async (method: string, path: string, body?: unknown) => { calls.push({ method, path, body }); return { ok: true, saved: true } }) as AppApi
    const r = await skill.handler({ answer: 'algo', why: ' me ayuda con la compra ' }, ctx(api, 'whatsapp'))
    expect(calls).toEqual([{ method: 'POST', path: '/sean-ellis', body: { answer: 'algo', channel: 'whatsapp', why: 'me ayuda con la compra' } }])
    expect(r.summary).toMatch(/^Hecho/)
    await skill.handler({ answer: 'muy' }, ctx(api))
    expect(calls[1]).toEqual({ method: 'POST', path: '/sean-ellis', body: { answer: 'muy', channel: 'chat' } })
  })

  it('not asked: nothing filed, and Mimo is told so', async () => {
    const api = (async () => { throw new AppApiError(409, 'NOT_ASKED') }) as AppApi
    expect((await skill.handler({ answer: 'muy' }, ctx(api))).summary).toMatch(/^No guardada/)
  })
})
