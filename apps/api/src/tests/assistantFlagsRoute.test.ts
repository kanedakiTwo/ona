/**
 * GET /admin/assistant-reviews/flags (specs/whatsapp.md, specs/metrics.md
 * constraints): with the read token, categories and severity only — never
 * Mimo's reply or the reviewer's note; the admin view keeps both. The guard is
 * replaced by one that lets everything through (metricsAuth has its own tests),
 * and the loader is a stub.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: { execute: async () => ({ rows: [] }) } }))
vi.mock('../middleware/metricsAuth.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../middleware/metricsAuth.js')>()),
  metricsAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}))
vi.mock('../services/assistantFlags.js', () => ({
  loadAssistantFlags: async ({ days }: { days: number }) => ({
    windowDays: days,
    channels: ['whatsapp'],
    counts: { byCategory: { health_talk: 1 }, reviewerByCategory: { proactividad: 1 }, reviewerBySeverity: { alta: 1 } },
    items: [
      { date: '2026-10-20', channel: 'whatsapp', category: 'health_talk', source: 'both', reviewerCategory: 'proactividad', severity: 'alta', reply: 'Para Lucía, sin gluten…', note: 'Su hijo es celíaco' },
    ],
    hallazgos: [
      {
        date: '2026-10-20', canal: 'whatsapp', clave: 'aviso.salud', gravedad: 'alta', categoria: 'proactividad', tipo: 'arreglo', dias: 2, regresion: false,
        patron: 'El aviso para Lucía (600 111 222) dice «sin gluten, que es celíaco»', donde: 'guia_aviso:daily_brief',
        arreglo: 'La guía del resumen prohíbe hablar de salud', prueba: 'Un test de la guía con una alergia en la ficha',
      },
    ],
  }),
}))

const { default: metricsRouter } = await import('../routes/metrics.js')

let server: Server
let base = ''

beforeAll(async () => {
  const app = express()
  app.use(metricsRouter)
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
})

describe('GET /admin/assistant-reviews/flags', () => {
  it('with the read token: no reply and no note, counts by their enums', async () => {
    const res = await fetch(`${base}/admin/assistant-reviews/flags?days=1`, { headers: { 'x-metrics-token': 'any' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.counts).toEqual({ byCategory: { health_talk: 1 }, reviewerByCategory: { proactividad: 1 }, reviewerBySeverity: { alta: 1 } })
    expect(body.items).toEqual([
      { date: '2026-10-20', channel: 'whatsapp', category: 'health_talk', source: 'both', reviewerCategory: 'proactividad', severity: 'alta' },
    ])
    expect(JSON.stringify(body)).not.toMatch(/Lucía|celíaco|gluten|600 111 222/)
    // D-189: the reviewer's patterns do reach the agents, without the user text.
    expect(body.hallazgos).toEqual([
      expect.objectContaining({ clave: 'aviso.salud', donde: 'guia_aviso:daily_brief', tipo: 'arreglo', gravedad: 'alta', dias: 2, arreglo: 'La guía del resumen prohíbe hablar de salud' }),
    ])
  })

  it('the admin view (no token header) still gets the reply and the note', async () => {
    const body = await (await fetch(`${base}/admin/assistant-reviews/flags?days=1`)).json()
    expect(body.items[0]).toMatchObject({ reply: 'Para Lucía, sin gluten…', note: 'Su hijo es celíaco' })
  })
})
