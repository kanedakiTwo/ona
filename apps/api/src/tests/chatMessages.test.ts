/**
 * PRO-148 · the web chat is kept server-side for 90 days.
 *   - buildWebTurnRows: one web turn → 2 rows (user, assistant) with the trace;
 *   - POST /assistant/:userId/chat writes those 2 rows (engine, budget and DB faked);
 *   - a failing write never fails the chat.
 * The purge (91 days gone, 89 kept) and account deletion run against a real
 * Postgres in chatMessages.smoke.ts.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const inserted: any[][] = []
let failInsert = false
const fakeDb = {
  select: () => ({
    from: () => ({
      where: () => ({ limit: async () => [{ householdId: 'h-1', name: 'x', authorId: null }] }),
    }),
  }),
  insert: () => ({
    values: async (rows: any[]) => {
      if (failInsert) throw new Error('db down')
      inserted.push(rows)
    },
  }),
  execute: async () => ({ rowCount: 0 }),
}

vi.mock('../db/connection.js', () => ({ db: fakeDb, pool: {} }))
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 'u-1'
    next()
  },
}))
vi.mock('../middleware/spendCap.js', () => ({ requireSpendCapacity: () => (_req: any, _res: any, next: any) => next() }))
vi.mock('../services/advisorBudget.js', () => ({
  checkAdvisorBudget: async () => ({ exceeded: false, budgetMicros: 5_000_000 }),
  recordAdvisorUsage: async () => {},
}))
const trace = [{ name: 'get_today_menu', input: '{}', summary: 'Hoy: lentejas' }]
const chatMock = vi.fn(async () => ({
  message: 'Hoy tienes lentejas.',
  toolsUsed: ['get_today_menu'],
  corrections: [],
  toolTrace: trace,
  usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
}))
vi.mock('../services/assistant/engine.js', () => ({ chat: chatMock }))

const { buildWebTurnRows, CHAT_RETENTION_DAYS } = await import('../services/chatMessages.js')
const { default: assistantRouter } = await import('../routes/assistant.js')

describe('buildWebTurnRows', () => {
  it('a web turn is two rows: what the user said and what Mimo answered, with what it did', () => {
    const now = new Date('2026-10-17T08:00:00Z')
    const rows = buildWebTurnRows({
      userId: 'u-1',
      householdId: 'h-1',
      userMessage: '¿Qué ceno hoy?',
      response: { message: 'Lentejas.', toolsUsed: ['get_today_menu'], corrections: ['truncated'], toolTrace: trace },
      mode: 'text',
      path: '/menu',
      ms: 1200,
      now,
    })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ userId: 'u-1', householdId: 'h-1', channel: 'web', role: 'user', body: '¿Qué ceno hoy?', meta: { mode: 'text', path: '/menu' } })
    expect(rows[1]).toMatchObject({
      role: 'assistant',
      channel: 'web',
      body: 'Lentejas.',
      meta: { mode: 'text', tools: ['get_today_menu'], corrections: ['truncated'], toolTrace: trace, ms: 1200 },
    })
    // The assistant row sorts after the user row.
    expect((rows[1].createdAt as Date).getTime()).toBeGreaterThan((rows[0].createdAt as Date).getTime())
  })

  it('a turn without tools stores no empty trace', () => {
    const [, a] = buildWebTurnRows({ userId: 'u', householdId: null, userMessage: 'hola', response: { message: '¡Hola!' }, mode: 'voice', path: null })
    expect(a.meta).toEqual({ mode: 'voice' })
  })

  it('keeps chats 90 days', () => {
    expect(CHAT_RETENTION_DAYS).toBe(90)
  })
})

describe('POST /assistant/:userId/chat stores the web turn', () => {
  let server: Server
  let base: string

  beforeAll(async () => {
    const app = express()
    app.use(express.json())
    app.use(assistantRouter)
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })
  beforeEach(() => {
    inserted.length = 0
    failInsert = false
  })

  const send = (body: unknown) =>
    fetch(`${base}/assistant/u-1/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  it('one web turn leaves 2 rows with the tool trace (and the user text without the page note)', async () => {
    const res = await send({ message: '¿Qué ceno hoy?', history: [], context: { path: '/menu' } })
    expect(res.status).toBe(200)
    expect((await res.json()).message).toBe('Hoy tienes lentejas.')
    expect(inserted).toHaveLength(1)
    const rows = inserted[0]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ userId: 'u-1', householdId: 'h-1', channel: 'web', role: 'user', body: '¿Qué ceno hoy?', meta: { mode: 'text', path: '/menu' } })
    expect(rows[1]).toMatchObject({ role: 'assistant', body: 'Hoy tienes lentejas.', meta: { tools: ['get_today_menu'], toolTrace: trace } })
  })

  it('a failed write does not fail the chat', async () => {
    failInsert = true
    const res = await send({ message: 'hola' })
    expect(res.status).toBe(200)
    expect(inserted).toHaveLength(0)
  })

  it('a rejected request (no message) stores nothing', async () => {
    const res = await send({})
    expect(res.status).toBe(400)
    expect(inserted).toHaveLength(0)
  })
})
