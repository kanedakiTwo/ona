/**
 * Beta feedback box (specs/feedback.md, 2026-10-15): the «Opinión» button
 * (POST /feedback), Mimo's leave_feedback (web chat and WhatsApp) and the
 * admin/agents read (GET /admin/feedback; the agents' token gets counts only).
 */
import express, { type RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import { createFeedbackRouter, type FeedbackRepo, type FeedbackRow } from '../routes/feedback.js'
import { appSkills } from '../services/assistant/appSkills.js'
import type { SkillContext } from '../services/assistant/types.js'

const NOW = new Date('2026-10-20T10:00:00Z')

function memoryRepo(): FeedbackRepo & { rows: Array<FeedbackRow & { userId: string }> } {
  const rows: Array<FeedbackRow & { userId: string }> = []
  return {
    rows,
    async save(userId, f) {
      rows.push({ id: `f${rows.length + 1}`, userId, ...f, createdAt: NOW, username: `user-${userId}`, email: `${userId}@example.com` })
    },
    async list(since, limit) {
      return rows.filter((r) => r.createdAt >= since).slice(0, limit)
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
/** Admin JWT (x-admin) or the agents' read token (x-metrics-token). */
const readAuth: RequestHandler = (req, res, next) => (req.get('x-admin') || req.get('x-metrics-token') === 'ok' ? next() : res.sendStatus(401))

async function app() {
  const repo = memoryRepo()
  const a = express()
  a.use(express.json())
  a.use(createFeedbackRouter({ repo, auth: fakeAuth, readAuth, now: () => NOW }))
  const server = await new Promise<Server>((resolve) => {
    const s = a.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) =>
    fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { repo, call }
}

describe('POST /feedback', () => {
  it('saves what the user wrote, verbatim, with the page and the channel', async () => {
    const { call, repo } = await app()
    expect((await call('POST', '/feedback', {}, { text: 'hola' })).status).toBe(401)
    const r = await call('POST', '/feedback', { 'x-user': 'u1' }, { text: '  Echo de menos poder ordenar la lista por tiendas  ', page: '/shopping' })
    expect(r.status).toBe(201)
    expect(repo.rows[0]).toMatchObject({ userId: 'u1', channel: 'app', text: 'Echo de menos poder ordenar la lista por tiendas', page: '/shopping' })
  })

  it('refuses empty or too long, and unknown channels', async () => {
    const { call } = await app()
    expect((await call('POST', '/feedback', { 'x-user': 'u1' }, { text: ' ' })).status).toBe(400)
    expect((await call('POST', '/feedback', { 'x-user': 'u1' }, { text: 'x'.repeat(2001) })).status).toBe(400)
    expect((await call('POST', '/feedback', { 'x-user': 'u1' }, { text: 'hola', channel: 'email' })).status).toBe(400)
  })
})

describe('GET /admin/feedback', () => {
  it('admin sees the text and who wrote it; the agents token gets counts only', async () => {
    const { call } = await app()
    await call('POST', '/feedback', { 'x-user': 'u1' }, { text: 'Me encanta la lista', channel: 'whatsapp' })
    expect((await call('GET', '/admin/feedback')).status).toBe(401)

    const admin = await (await call('GET', '/admin/feedback', { 'x-admin': '1' })).json()
    expect(admin.items[0]).toMatchObject({ text: 'Me encanta la lista', channel: 'whatsapp', username: 'user-u1', email: 'u1@example.com' })

    const agents = await (await call('GET', '/admin/feedback?days=1', { 'x-metrics-token': 'ok' })).json()
    expect(agents).toEqual({ days: 1, count: 1, byChannel: { whatsapp: 1 }, byPage: { none: 1 }, byTag: {}, possibleAllergies: [] })
    expect(JSON.stringify(agents)).not.toContain('Me encanta la lista')
  })

  it('the agents token never gets the text, not even masked: a possible allergy is a date and a channel; the admin sees it as written', async () => {
    const { call, repo } = await app()
    const raw = 'Soy Lucía, mi hijo es celíaco y la lista no carga. Llamadme al 612 345 678 o a lucia.perez@gmail.com'
    repo.rows.push({ id: 'f2', userId: 'u2', channel: 'app', text: raw, page: '/compra', createdAt: NOW, username: 'lucia_perez', email: 'lucia.perez@gmail.com' })

    const agents = await (await call('GET', '/admin/feedback', { 'x-metrics-token': 'ok' })).json()
    expect(agents).toEqual({ days: 30, count: 1, byChannel: { app: 1 }, byPage: { '/compra': 1 }, byTag: {}, possibleAllergies: [{ date: '2026-10-20', channel: 'app' }] })
    expect(JSON.stringify(agents)).not.toMatch(/Lucía|lucia|celíaco|no carga|612|\[nombre\]|f2/)

    const admin = await (await call('GET', '/admin/feedback', { 'x-admin': '1' })).json()
    expect(admin.items.find((i: any) => i.id === 'f2').text).toBe(raw)
  })
})

describe("Mimo's leave_feedback", () => {
  const skill = appSkills.find((s) => s.name === 'leave_feedback')!
  const ctx = (channel: SkillContext['channel'], calls: unknown[]): SkillContext => ({
    userId: 'u1',
    db: null,
    channel,
    api: (async (method: string, path: string, body?: unknown) => {
      calls.push({ method, path, body })
      return { ok: true }
    }) as any,
  })

  it('is registered and described for suggestions, bugs and complaints', () => {
    expect(skill).toBeDefined()
    expect(skill.description).toMatch(/sugerencia/)
    expect(skill.description).toMatch(/no funciona/)
  })

  it('WhatsApp → channel whatsapp; web chat → channel chat; text verbatim', async () => {
    const calls: any[] = []
    await skill.handler({ text: 'Deberíais poder compartir el menú con mi madre' }, ctx('whatsapp', calls))
    await skill.handler({ text: 'La foto de la receta tarda mucho' }, ctx('text', calls))
    expect(calls).toEqual([
      { method: 'POST', path: '/feedback', body: { text: 'Deberíais poder compartir el menú con mi madre', channel: 'whatsapp' } },
      { method: 'POST', path: '/feedback', body: { text: 'La foto de la receta tarda mucho', channel: 'chat' } },
    ])
  })

  it('without text it asks Mimo to ask, and saves nothing', async () => {
    const calls: any[] = []
    const r = await skill.handler({ text: ' ' }, ctx('whatsapp', calls))
    expect(calls).toEqual([])
    expect(r.summary).toMatch(/preguntale/)
  })
})
