/**
 * «Mimo remoto» en staging (PRO-1102, D-157): with the mode on, Mimo's rounds
 * wait for the office instead of going to Anthropic. Pins: the request saved
 * as is, a `tool_use` answer runs the tool and asks for another round, no
 * answer in 120 s → `caducado`, the office's routes (token, 404 when off), and
 * that the API doesn't boot with the mode on in production.
 * The same flow against Postgres, from a WhatsApp message: mimoRemoto.smoke.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import type { AddressInfo } from 'node:net'

vi.mock('../db/connection.js', () => ({ db: {} }))

import { resolveMimoRemoto } from '../config/mimoRemoto.js'
import {
  MimoRemotoTimeoutError,
  REMOTE_TURN_TIMEOUT_MS,
  parseRemoteAnswer,
  remoteMessagesClient,
  type RemoteAnswer,
  type RemoteTurnStore,
} from '../services/assistant/mimoRemoto.js'
import { runToolLoop } from '../services/assistant/engine.js'
import { createMimoRemotoRouter } from '../routes/mimoRemoto.js'
import type { SkillDefinition } from '../services/assistant/types.js'

/** The table, in memory; `office` answers each new round. */
function memoryStore(office?: (peticion: any, round: number) => RemoteAnswer | null) {
  const rows: { id: string; estado: string; peticion: any; respuesta: RemoteAnswer | null }[] = []
  const store: RemoteTurnStore = {
    async create(peticion) {
      const id = `t${rows.length + 1}`
      const row = { id, estado: 'pendiente', peticion: structuredClone(peticion), respuesta: null as RemoteAnswer | null }
      rows.push(row)
      const answer = office?.(row.peticion, rows.length - 1) ?? null
      if (answer) Object.assign(row, { estado: 'respondido', respuesta: answer })
      return id
    },
    async answerOf(id) {
      const row = rows.find((r) => r.id === id)
      return row?.estado === 'respondido' ? row.respuesta : null
    },
    async expire(id) {
      const row = rows.find((r) => r.id === id)
      if (!row || (row.estado !== 'pendiente' && row.estado !== 'cogido')) return false
      row.estado = 'caducado'
      return true
    },
  }
  return { rows, store }
}

describe('resolveMimoRemoto', () => {
  it('is off unless MIMO_REMOTO=1', () => {
    expect(resolveMimoRemoto({})).toBe(false)
    expect(resolveMimoRemoto({ MIMO_REMOTO: '0' })).toBe(false)
    expect(resolveMimoRemoto({ MIMO_REMOTO: '1' })).toBe(true)
    expect(resolveMimoRemoto({ MIMO_REMOTO: '1', RAILWAY_ENVIRONMENT: 'staging', RAILWAY_ENVIRONMENT_NAME: 'staging' })).toBe(true)
  })

  it('refuses the mode in production', () => {
    expect(() => resolveMimoRemoto({ MIMO_REMOTO: '1', NODE_ENV: 'production' })).toThrow(/MIMO_REMOTO/)
    expect(() => resolveMimoRemoto({ MIMO_REMOTO: '1', RAILWAY_ENVIRONMENT: 'production' })).toThrow(/MIMO_REMOTO/)
    expect(() => resolveMimoRemoto({ MIMO_REMOTO: '1', RAILWAY_ENVIRONMENT_NAME: 'production' })).toThrow(/MIMO_REMOTO/)
    // Off, production is fine.
    expect(resolveMimoRemoto({ NODE_ENV: 'production' })).toBe(false)
  })
})

describe('remote rounds through the tool loop', () => {
  it('saves the request as is; a tool_use answer runs the tool and asks for another round', async () => {
    const handler = vi.fn(async () => ({ data: [], summary: 'Aun no has guardado recetas propias.', uiHint: 'text' as const }))
    const skill: SkillDefinition = { name: 'get_my_recipes', description: 'mis recetas', parameters: { type: 'object', properties: {} }, handler }
    const { rows, store } = memoryStore((_p, round) =>
      round === 0
        ? { content: [{ type: 'text', text: 'Miro.' }, { type: 'tool_use', id: 'toolu_1', name: 'get_my_recipes', input: {} }], stop_reason: 'tool_use' }
        : { content: [{ type: 'text', text: 'Aún no tienes recetas tuyas.' }], stop_reason: 'end_turn' },
    )
    const tools = [{ name: 'get_my_recipes', description: 'mis recetas', input_schema: { type: 'object', properties: {} } }]
    const r = await runToolLoop({
      client: remoteMessagesClient(store),
      system: [{ type: 'text', text: 'Eres Mimo.' }],
      tools,
      messages: [{ role: 'user', content: '¿Qué recetas tengo?' }],
      skills: [skill],
      ctx: { userId: 'u1', db: null, channel: 'whatsapp' },
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ message: 'Aún no tienes recetas tuyas.', actionTaken: true, toolsUsed: ['get_my_recipes'] })
    // Nothing paid: no usage at all.
    expect(r.usage).toEqual({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0 })

    // Two rounds, each saved with system, messages, tools and model.
    expect(rows).toHaveLength(2)
    expect(rows[0].peticion).toMatchObject({ system: [{ text: 'Eres Mimo.' }], tools, model: expect.any(String) })
    expect(rows[0].peticion.messages.at(-1).content[0].text).toBe('¿Qué recetas tengo?')
    const second = rows[1].peticion.messages
    expect(second.at(-2)).toMatchObject({ role: 'assistant', content: [{ type: 'text' }, { type: 'tool_use', id: 'toolu_1' }] })
    expect(second.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Aun no has guardado recetas propias.' })
  })

  it('without an answer the round expires at 120 s with an error', async () => {
    const { rows, store } = memoryStore()
    let clock = 1_000_000
    const client = remoteMessagesClient(store, { now: () => clock, sleep: async (ms) => { clock += ms } })
    const started = clock
    await expect(client.messages.create({ model: 'm', messages: [] })).rejects.toBeInstanceOf(MimoRemotoTimeoutError)
    expect(REMOTE_TURN_TIMEOUT_MS).toBe(120_000)
    expect(clock - started).toBe(120_000)
    expect(rows[0].estado).toBe('caducado')
  })

  it('an answer that lands while it expires is used', async () => {
    const { rows, store } = memoryStore()
    // The office answers between the last read and the expiry.
    const racing: RemoteTurnStore = {
      ...store,
      expire: async () => {
        Object.assign(rows[0], { estado: 'respondido', respuesta: { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } })
        return false
      },
    }
    let clock = 0
    const client = remoteMessagesClient(racing, { now: () => clock, sleep: async (ms) => { clock += ms } })
    await expect(client.messages.create({})).resolves.toMatchObject({ content: [{ text: 'ok' }], stop_reason: 'end_turn' })
  })
})

describe('parseRemoteAnswer', () => {
  it('takes text and tool_use blocks with a stop_reason', () => {
    const ok = parseRemoteAnswer({ content: [{ type: 'text', text: 'Hola' }, { type: 'tool_use', id: 'a', name: 'x', input: {}, extra: 1 }], stop_reason: 'tool_use' })
    expect(ok).toEqual({ ok: true, answer: { content: [{ type: 'text', text: 'Hola' }, { type: 'tool_use', id: 'a', name: 'x', input: {} }], stop_reason: 'tool_use' } })
  })

  it('refuses anything else', () => {
    expect(parseRemoteAnswer(null).ok).toBe(false)
    expect(parseRemoteAnswer({ content: 'hola', stop_reason: 'end_turn' }).ok).toBe(false)
    expect(parseRemoteAnswer({ content: [], stop_reason: 'whatever' }).ok).toBe(false)
    expect(parseRemoteAnswer({ content: [{ type: 'tool_use', name: 'x', input: {} }], stop_reason: 'tool_use' }).ok).toBe(false)
    expect(parseRemoteAnswer({ content: [{ type: 'image' }], stop_reason: 'end_turn' }).ok).toBe(false)
  })
})

describe('the office routes', () => {
  async function serve(enabled: boolean, token: string, db: any = {}) {
    const app = express()
    app.use(express.json())
    app.use(createMimoRemotoRouter({ enabled: () => enabled, token: () => token, db, nextWaitMs: 0 }))
    const server = app.listen(0)
    await new Promise((r) => server.once('listening', r))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const post = (p: string, auth?: string, body: unknown = {}) =>
      fetch(`${url}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
        body: JSON.stringify(body),
      })
    return { post, close: () => new Promise((r) => server.close(r)) }
  }

  it('do not exist with the mode off or no token', async () => {
    for (const [enabled, token] of [[false, 'tok'], [true, '']] as const) {
      const s = await serve(enabled, token)
      expect((await s.post('/agent/mimo-remoto/siguiente', 'tok')).status).toBe(404)
      await s.close()
    }
  })

  it('want the token; with nothing pending, 204', async () => {
    const db = { execute: vi.fn(async () => ({ rows: [] })) }
    const s = await serve(true, 'tok', db)
    expect((await s.post('/agent/mimo-remoto/siguiente')).status).toBe(401)
    expect((await s.post('/agent/mimo-remoto/siguiente', 'otro')).status).toBe(401)
    expect((await s.post('/agent/mimo-remoto/siguiente', 'tok')).status).toBe(204)
    expect(db.execute).toHaveBeenCalled()
    // A bad answer or id never reaches the table.
    expect((await s.post('/agent/mimo-remoto/no-es-un-id/respuesta', 'tok', { content: [], stop_reason: 'end_turn' })).status).toBe(404)
    const id = '00000000-0000-4000-8000-000000000000'
    expect((await s.post(`/agent/mimo-remoto/${id}/respuesta`, 'tok', { content: 'x' })).status).toBe(400)
    await s.close()
  })
})

describe('boot', () => {
  it('the API does not start with the mode on and NODE_ENV=production', async () => {
    const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: apiDir,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'production',
        MIMO_REMOTO: '1',
        JWT_SECRET: 'x'.repeat(48),
        API_PORT: '0',
        DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/none',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (c) => (output += c))
    child.stderr.on('data', (c) => (output += c))
    const killer = setTimeout(() => child.kill('SIGKILL'), 40_000)
    const code = await new Promise<number | null>((r) => child.once('exit', (c) => r(c)))
    clearTimeout(killer)
    expect(output).not.toMatch(/API running/)
    expect(code).not.toBe(0)
    expect(code).not.toBeNull()
    expect(output).toMatch(/MIMO_REMOTO solo es para staging/)
  }, 60_000)
})
