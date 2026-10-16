/**
 * Smoke (real API + Postgres) for PRO-148, the web chat kept 90 days:
 *   - the purge deletes a message 91 days old and keeps one 89 days old;
 *   - «Borrar mi cuenta» deletes the user's chat messages.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/chatMessages.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { chatMessages } from '../db/schema.js'
import { purgeOldChatMessages, recordWebChatTurn } from '../services/chatMessages.js'

const tag = `chat${Date.now()}${Math.random().toString(36).slice(2, 6)}`

async function call(method: string, path: string, token?: string, payload?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

async function register(i: number) {
  const u = `${tag}${i}`
  const reg = await call('POST', '/register', undefined, { username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(reg.status, JSON.stringify(reg.body)).toBe(201)
  return { id: reg.body.user.id as string, token: reg.body.token as string }
}

const DAY = 24 * 60 * 60 * 1000
const turn = (userId: string, text: string, daysAgo = 0) =>
  recordWebChatTurn(
    {
      userId,
      userMessage: text,
      response: { message: 'Vale.', toolsUsed: ['get_today_menu'], toolTrace: [{ name: 'get_today_menu', input: '{}', summary: 'ok' }] },
      mode: 'text',
      path: '/menu',
      now: new Date(Date.now() - daysAgo * DAY),
    },
    db,
  )

describe.skipIf(!reachable)('web chat retention (PRO-148)', () => {
  it('purge: 91 days old is deleted, 89 days old is kept', async () => {
    const u = await register(1)
    await turn(u.id, 'viejo', 91)
    await turn(u.id, 'reciente', 89)

    const before = await db.select().from(chatMessages).where(eq(chatMessages.userId, u.id))
    expect(before).toHaveLength(4)
    expect(before.find((r) => r.role === 'user' && r.body === 'reciente')?.householdId).toBeTruthy()

    await purgeOldChatMessages(db)
    const after = await db.select().from(chatMessages).where(eq(chatMessages.userId, u.id))
    expect(after.map((r) => r.body).sort()).toEqual(['Vale.', 'reciente'])
  })

  it('deleting the account deletes its chat messages', async () => {
    const u = await register(2)
    await turn(u.id, 'hola')
    expect(await db.select().from(chatMessages).where(eq(chatMessages.userId, u.id))).toHaveLength(2)

    const del = await call('DELETE', `/user/${u.id}`, u.token, { password: 'e2epass123' })
    expect(del.status, JSON.stringify(del.body)).toBe(200)
    expect(await db.select().from(chatMessages).where(eq(chatMessages.userId, u.id))).toHaveLength(0)
  })
})
