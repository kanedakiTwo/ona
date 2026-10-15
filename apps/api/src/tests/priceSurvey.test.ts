/**
 * Beta price survey (specs/billing.md, 2026-10-15): moved off the waitlist,
 * asked once to beta users from day 7 after sign-up until launch day; and
 * «Hogar fundador» for households created before launch day.
 */
import express, { type RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import { PRICE_QUESTIONS, PRICE_SURVEY_INTRO, isFoundingHousehold, type PriceSurveyAnswers } from '@ona/shared'
import { createPriceSurveyRouter } from '../routes/priceSurvey.js'
import { buildPriceSurveyReport, shouldShowPriceSurvey, type PriceSurveyRepo, type SurveyRecord } from '../services/priceSurvey.js'

const NOW = new Date('2026-11-02T10:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600_000)

describe('when the survey shows', () => {
  it('from day 7 after sign-up, never before', () => {
    expect(shouldShowPriceSurvey({ userCreatedAt: daysAgo(6.9), record: null, now: NOW })).toBe(false)
    expect(shouldShowPriceSurvey({ userCreatedAt: daysAgo(7), record: null, now: NOW })).toBe(true)
    expect(shouldShowPriceSurvey({ userCreatedAt: daysAgo(30), record: null, now: NOW })).toBe(true)
  })

  it('once: answered or «Ahora no» hide it for good', () => {
    expect(shouldShowPriceSurvey({ userCreatedAt: daysAgo(10), record: { answeredAt: NOW, dismissedAt: null }, now: NOW })).toBe(false)
    expect(shouldShowPriceSurvey({ userCreatedAt: daysAgo(10), record: { answeredAt: null, dismissedAt: NOW }, now: NOW })).toBe(false)
  })

  it('only during the beta, and only with a known sign-up date', () => {
    expect(shouldShowPriceSurvey({ userCreatedAt: daysAgo(10), record: null, now: new Date('2027-01-20T10:00:00Z') })).toBe(false)
    expect(shouldShowPriceSurvey({ userCreatedAt: null, record: null, now: NOW })).toBe(false)
  })

  it('the copy is the one Miguel wrote', () => {
    expect(PRICE_SURVEY_INTRO).toBe(
      'Como usuario de la beta y ahora que llevas una semana, me gustaría hacerte unas preguntas sobre el precio. Nos ayudas mucho respondiendo.',
    )
  })
})

describe('Hogar fundador', () => {
  it('every household created before launch day (00:00 Madrid)', () => {
    expect(isFoundingHousehold('2026-10-21T09:00:00Z')).toBe(true)
    expect(isFoundingHousehold(new Date('2027-01-11T22:59:59Z'))).toBe(true)
    expect(isFoundingHousehold(new Date('2027-01-11T23:00:00Z'))).toBe(false)
    expect(isFoundingHousehold('no es una fecha')).toBe(false)
  })
})

function memoryRepo(created: Record<string, Date>): PriceSurveyRepo & { rows: Map<string, SurveyRecord & Partial<PriceSurveyAnswers>> } {
  const rows = new Map<string, SurveyRecord & Partial<PriceSurveyAnswers>>()
  return {
    rows,
    async userCreatedAt(id) {
      return created[id] ?? null
    },
    async get(id) {
      return rows.get(id) ?? null
    },
    async answer(id, a, at) {
      rows.set(id, { ...(rows.get(id) ?? { dismissedAt: null }), ...a, answeredAt: at })
    },
    async dismiss(id, at) {
      rows.set(id, { ...(rows.get(id) ?? { answeredAt: null }), dismissedAt: at })
    },
    async answered() {
      return [...rows.values()]
        .filter((r) => r.answeredAt)
        .map((r) => ({ tooCheap: r.tooCheap ?? null, good: r.good ?? null, expensive: r.expensive ?? null, tooExpensive: r.tooExpensive ?? null }))
    },
  }
}

const servers: Server[] = []
afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

const fakeAuth: RequestHandler = (req, res, next) => {
  const id = req.get('x-user')
  if (!id) {
    res.status(401).json({ error: 'No token provided' })
    return
  }
  ;(req as unknown as { userId: string }).userId = id
  next()
}
const adminOnly: RequestHandler = (req, res, next) => (req.get('x-metrics-token') === 'ok' ? next() : res.sendStatus(401))

async function app() {
  const repo = memoryRepo({ veterana: daysAgo(8), nueva: daysAgo(2) })
  const a = express()
  a.use(express.json())
  a.use(createPriceSurveyRouter({ repo, now: () => NOW, auth: fakeAuth, readAuth: adminOnly }))
  const server = await new Promise<Server>((resolve) => {
    const s = a.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
    fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { repo, call }
}

describe('routes', () => {
  it('GET /price-survey: the copy and the four questions for a week-old user; nothing for a new one', async () => {
    const { call } = await app()
    expect((await call('GET', '/price-survey')).status).toBe(401)
    expect(await (await call('GET', '/price-survey', { 'x-user': 'nueva' })).json()).toEqual({ show: false })
    const r = await (await call('GET', '/price-survey', { 'x-user': 'veterana' })).json()
    expect(r.show).toBe(true)
    expect(r.intro).toBe(PRICE_SURVEY_INTRO)
    expect(r.questions.map((q: { key: string }) => q.key)).toEqual(PRICE_QUESTIONS.map((q) => q.key))
  })

  it('answering saves the euros and hides it; a bad amount is a 400', async () => {
    const { call, repo } = await app()
    expect((await call('POST', '/price-survey', { 'x-user': 'veterana' }, { good: -3 })).status).toBe(400)
    expect((await call('POST', '/price-survey', { 'x-user': 'veterana' }, { tooCheap: 2, good: 4.999, expensive: 8, tooExpensive: null })).status).toBe(200)
    expect(repo.rows.get('veterana')).toMatchObject({ tooCheap: 2, good: 5, expensive: 8, tooExpensive: null })
    expect(await (await call('GET', '/price-survey', { 'x-user': 'veterana' })).json()).toEqual({ show: false })
  })

  it('«Ahora no» hides it for good', async () => {
    const { call } = await app()
    expect((await call('POST', '/price-survey/dismiss', { 'x-user': 'veterana' })).status).toBe(200)
    expect(await (await call('GET', '/price-survey', { 'x-user': 'veterana' })).json()).toEqual({ show: false })
  })

  it('GET /admin/price-survey: distributions only, behind the read token', async () => {
    const { call } = await app()
    await call('POST', '/price-survey', { 'x-user': 'veterana' }, { good: 4, expensive: 7 })
    expect((await call('GET', '/admin/price-survey')).status).toBe(401)
    const report = await (await call('GET', '/admin/price-survey', { 'x-metrics-token': 'ok' })).json()
    expect(report.answers).toBe(1)
    expect(report.good).toMatchObject({ answers: 1, median: 4 })
    expect(JSON.stringify(report)).not.toContain('veterana')
  })

  it('the report of nothing is zeros', () => {
    expect(buildPriceSurveyReport([]).answers).toBe(0)
  })
})
