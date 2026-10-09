/**
 * PRO-26: founder pricing signal on the waitlist. The four Van Westendorp
 * answers (€/month, optional), then a founder plan / «Ninguno me encaja» /
 * cancelling. Nothing is charged. `GET /admin/waitlist` gets `pricing`:
 * distributions + reservations by plan, never personal data.
 */
import express from 'express'
import type { RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import {
  FOUNDER_PLANS,
  FOUNDER_FOOTER,
  FOUNDER_FOOTER_BETA,
  PRICE_QUESTIONS,
  waitlistPricingSchema,
  waitlistReservationSchema,
} from '@ona/shared'
import { createWaitlistRouter } from '../routes/waitlist.js'
import { buildPricingReport, priceDistribution, type PricingReportRow } from '../services/waitlistPricing.js'
import { createMemoryWaitlistRepo } from './fixtures/memoryWaitlistRepo.js'

const TOKEN = 'tok_0123456789abcdef'

describe('founder pricing copy (D-021)', () => {
  it('asks the four questions in order', () => {
    expect(PRICE_QUESTIONS.map((q) => q.key)).toEqual(['tooCheap', 'good', 'expensive', 'tooExpensive'])
  })

  it('shows Esencial, Plus anual (featured) and Plus, in that order', () => {
    expect(FOUNDER_PLANS.map((p) => [p.name, p.price, p.featured])).toEqual([
      ['Esencial', '4,99 €/mes', false],
      ['Plus anual', '59,99 €/año', true],
      ['Plus', '8,99 €/mes', false],
    ])
    expect(FOUNDER_PLANS[1].note).toBe('Plus por 5 €/mes')
    for (const p of FOUNDER_PLANS) expect(p.bullets).toHaveLength(3)
  })

  it('beta households get no trial sentence', () => {
    expect(FOUNDER_FOOTER).toMatch(/14 días gratis/)
    expect(FOUNDER_FOOTER_BETA).not.toMatch(/14 días/)
    expect(FOUNDER_FOOTER_BETA).toMatch(/^Tu beta sigue gratis hasta el 12 de enero/)
  })
})

describe('schemas', () => {
  it('price answers are optional euros, 0–500', () => {
    expect(waitlistPricingSchema.parse({ token: TOKEN, good: 4.999 })).toEqual({
      token: TOKEN, tooCheap: null, good: 5, expensive: null, tooExpensive: null,
    })
    expect(waitlistPricingSchema.safeParse({ token: TOKEN, good: -1 }).success).toBe(false)
    expect(waitlistPricingSchema.safeParse({ token: TOKEN, good: 9000 }).success).toBe(false)
  })

  it('a reservation is a plan, «ninguno» with a reason, or anular', () => {
    expect(waitlistReservationSchema.safeParse({ token: TOKEN, choice: 'plus-anual' }).success).toBe(true)
    expect(waitlistReservationSchema.safeParse({ token: TOKEN, choice: 'ninguno', reason: 'caro' }).success).toBe(true)
    expect(waitlistReservationSchema.safeParse({ token: TOKEN, choice: 'ninguno' }).success).toBe(false)
    expect(waitlistReservationSchema.safeParse({ token: TOKEN, choice: 'anular' }).success).toBe(true)
    expect(waitlistReservationSchema.safeParse({ token: TOKEN, choice: 'gratis' }).success).toBe(false)
  })
})

describe('admin report: pricing block', () => {
  const row = (over: Partial<PricingReportRow>): PricingReportRow => ({
    priceTooCheapEur: null, priceGoodEur: null, priceExpensiveEur: null, priceTooExpensiveEur: null,
    priceAnsweredAt: null, reservedPlan: null, reservedPeriod: null, declinedReason: null, ...over,
  })

  it('distribution: quantiles and a histogram rounded to the euro', () => {
    const d = priceDistribution([2, 4, 4.5, 6, null, 10])
    expect(d).toMatchObject({ answers: 5, min: 2, p25: 4, median: 4.5, p75: 6, max: 10 })
    expect(d.histogram).toEqual([{ eur: 2, count: 1 }, { eur: 4, count: 1 }, { eur: 5, count: 1 }, { eur: 6, count: 1 }, { eur: 10, count: 1 }])
  })

  it('counts reservations by plan + period and «ninguno» by reason, no personal data', () => {
    const at = new Date('2026-11-03T10:00:00Z')
    const report = buildPricingReport([
      row({ priceAnsweredAt: at, priceGoodEur: 5, priceTooExpensiveEur: 12, reservedPlan: 'plus', reservedPeriod: 'anual' }),
      row({ priceAnsweredAt: at, priceGoodEur: 4, reservedPlan: 'esencial', reservedPeriod: 'mensual' }),
      row({ reservedPlan: 'plus', reservedPeriod: 'anual' }),
      row({ declinedReason: 'caro' }),
      row({}),
    ])
    expect(report.answeredPriceQuestions).toBe(2)
    expect(report.questions.good).toMatchObject({ answers: 2, median: 4.5 })
    expect(report.questions.tooExpensive.answers).toBe(1)
    expect(report.reservations).toEqual({ total: 3, byPlan: { 'esencial-mensual': 1, 'plus-anual': 2, 'plus-mensual': 0 } })
    expect(report.none).toEqual({ total: 1, byReason: { caro: 1, no_lo_usaria: 0, me_falta_algo: 0, otro: 0 } })
    expect(JSON.stringify(report)).not.toMatch(/@|token/i)
  })
})

describe('POST /waitlist/pricing + /waitlist/reservation', () => {
  const servers: Server[] = []
  afterAll(() => servers.forEach((s) => { s.closeAllConnections(); s.close() }))
  const pass: RequestHandler = (_req, _res, next) => next()

  async function app() {
    const saved: unknown[] = []
    const a = express()
    a.use(express.json())
    a.use(
      createWaitlistRouter({
        repo: createMemoryWaitlistRepo(),
        publicUrl: () => 'https://mimoia.com',
        signupLimiter: pass, readLimiter: pass, unsubscribeLimiter: pass, pricingLimiter: pass,
        savePricing: async (p) => { saved.push(p); return p.token === TOKEN ? 'ok' : 'not_found' },
        saveReservation: async (r) => { saved.push(r); return r.token === TOKEN ? 'ok' : 'not_found' },
      }),
    )
    const server = await new Promise<Server>((resolve) => { const s = a.listen(0, '127.0.0.1', () => resolve(s)) })
    servers.push(server)
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const post = (path: string, body: unknown) =>
      fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { post, saved }
  }

  it('stores the answers and the reservation with the entry token', async () => {
    const { post, saved } = await app()
    expect((await post('/waitlist/pricing', { token: TOKEN, tooCheap: 1, good: 4, expensive: 7, tooExpensive: 12 })).status).toBe(200)
    const r = await post('/waitlist/reservation', { token: TOKEN, choice: 'plus-anual' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, choice: 'plus-anual' })
    expect(saved).toHaveLength(2)
  })

  it('400 on bad input, 404 on an unknown token', async () => {
    const { post } = await app()
    expect((await post('/waitlist/pricing', { token: TOKEN, good: 'mucho' })).status).toBe(400)
    expect((await post('/waitlist/reservation', { token: TOKEN, choice: 'ninguno' })).status).toBe(400)
    expect((await post('/waitlist/reservation', { token: 'tok_unknown_000000', choice: 'esencial-mensual' })).status).toBe(404)
  })
})
