/**
 * GET /admin/assistant-reviews/flags with the agents' read token
 * (specs/whatsapp.md, specs/metrics.md constraints): categories and severity
 * only — never Mimo's reply or the reviewer's note. The loader is a stub.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: { execute: async () => ({ rows: [] }) } }))
vi.mock('../services/assistantFlags.js', () => ({
  loadAssistantFlags: async ({ days }: { days: number }) => ({
    days,
    counts: { health_talk: 1 },
    items: [
      { date: '2026-10-20', channel: 'whatsapp', category: 'health_talk', source: 'both', reviewerCategory: 'salud', severity: 'alta', reply: 'Para Lucía, sin gluten…', note: 'Su hijo es celíaco' },
    ],
  }),
}))

const { env } = await import('../config/env.js')
const { default: metricsRouter } = await import('../routes/metrics.js')

let server: Server
let base = ''
const previousToken = env.METRICS_READ_TOKEN

beforeAll(async () => {
  env.METRICS_READ_TOKEN = 'flags-test-token'
  const app = express()
  app.use(metricsRouter)
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  env.METRICS_READ_TOKEN = previousToken
  server.closeAllConnections()
  server.close()
})

describe('GET /admin/assistant-reviews/flags', () => {
  it('with the read token: no reply and no note, counts untouched', async () => {
    const res = await fetch(`${base}/admin/assistant-reviews/flags?days=1`, { headers: { 'x-metrics-token': 'flags-test-token' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counts).toEqual({ health_talk: 1 })
    expect(body.items).toEqual([
      { date: '2026-10-20', channel: 'whatsapp', category: 'health_talk', source: 'both', reviewerCategory: 'salud', severity: 'alta' },
    ])
    expect(JSON.stringify(body)).not.toMatch(/Lucía|celíaco|gluten/)
  })
})
