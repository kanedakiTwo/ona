/**
 * Smoke (real Postgres) for «Mimo remoto» en staging (PRO-1102, D-157): with
 * the mode on, a test WhatsApp message leaves a pending round in
 * `mimo_turnos_remotos`; the office takes it, answers with a `tool_use`, the
 * tool runs and a second round is asked for; its text answer is the reply.
 * Nothing goes to `cost_events`. A round nobody answers expires at 120 s.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/mimoRemoto.smoke.ts
 *
 * The mode is switched on inside this process only (the booted API keeps it
 * off); the routes themselves are pinned in mimoRemoto.test.ts.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { costEvents, mimoTurnosRemotos } from '../db/schema.js'
import { buildInboundDeps } from '../services/whatsapp/wiring.js'
import { processInbound, type InboundDeps } from '../services/whatsapp/inbound.js'
import {
  MimoRemotoTimeoutError,
  answerTurn,
  dbTurnStore,
  remoteMessagesClient,
  takeNextTurn,
} from '../services/assistant/mimoRemoto.js'

async function register(tag: string) {
  const name = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, email: `${name}@test.local`, password: 'e2epass123', ageConfirmed: true }),
  })
  expect(r.status).toBeLessThan(300)
  const json: any = await r.json()
  return { id: json.user.id as string, email: `${name}@test.local`, name }
}

/** The round whose last user message carries `marker`, once it exists. */
async function waitForRound(match: (peticion: any) => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const rows = await db.select().from(mimoTurnosRemotos).where(eq(mimoTurnosRemotos.estado, 'pendiente'))
    const row = rows.find((r) => match(r.peticion))
    if (row) return row
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('no pending round arrived')
}

const wasOn = env.MIMO_REMOTO

describe.skipIf(!reachable)('Mimo remoto en staging (PRO-1102)', () => {
  afterAll(() => {
    env.MIMO_REMOTO = wasOn
  })

  it('a WhatsApp message → pending round → tool_use runs the tool → another round → the reply, nothing in cost_events', async () => {
    env.MIMO_REMOTO = true
    // Rounds left over by an earlier local run would be taken first.
    await db.execute(sql`UPDATE mimo_turnos_remotos SET estado = 'caducado' WHERE estado IN ('pendiente', 'cogido')`)
    const user = await register('mremoto')
    const phone = `34600${String(Date.now()).slice(-6)}`
    const marker = `¿Qué recetas mías tengo? ${user.name}`
    const sent: string[] = []
    const updates: any[] = []
    const real = buildInboundDeps()
    const deps: InboundDeps = {
      ...real,
      isUserAllowed: () => true,
      isPaused: async () => false,
      checkBudget: async () => ({ exceeded: false, budgetMicros: 5_000_000 }),
      optIn: undefined,
      menuDigest: undefined,
      menuImage: undefined,
      guided: undefined,
      ackAfterMs: 60_000,
      store: {
        getLinkByPhone: async () => ({
          userId: user.id, phone, notify: false, prefs: {}, lastInboundAt: null,
          email: user.email, username: user.name, suspendedAt: null, onboardingDone: true,
        }),
        consumeLinkCode: async () => null,
        touchInbound: async () => {},
        updateInbound: async (_wamid, patch) => { updates.push(patch) },
        insertOutbound: async () => {},
        loadHistoryRows: async () => [],
        hasRecentOutbound: async () => false,
        recentOutboundKinds: async () => new Map(),
        setNotify: async () => true,
      },
      client: {
        sendMessage: async (_to, m: any) => {
          sent.push(m.text ?? m.body ?? JSON.stringify(m))
          return 'wamid.out'
        },
        markReadWithTyping: async () => {},
        downloadMedia: async () => { throw new Error('no media') },
      },
    }

    const turn = processInbound(
      {
        wamid: `wamid.mremoto.${Date.now()}`, from: phone, timestamp: Math.floor(Date.now() / 1000), profileName: 'Prueba',
        kind: 'text', text: marker, mediaId: null, mimeType: null, replyId: null, rawType: 'text',
      },
      deps,
    )

    const lastText = (p: any) => {
      const content = p?.messages?.at(-1)?.content
      return Array.isArray(content) ? content.map((b: any) => b.text ?? '').join(' ') : String(content ?? '')
    }
    // 1. The message left a pending round with the whole request.
    const first = await waitForRound((p) => lastText(p).includes(marker))
    expect(first.peticion).toMatchObject({ model: expect.any(String), system: expect.any(Array), tools: expect.any(Array) })
    expect((first.peticion as any).tools.some((t: any) => t.name === 'get_my_recipes')).toBe(true)

    // 2. The office takes it (oldest pending first) and answers with a tool_use.
    const taken = await takeNextTurn(db, { waitMs: 0 })
    expect(taken?.id).toBe(first.id)
    const [cogido] = await db.select().from(mimoTurnosRemotos).where(eq(mimoTurnosRemotos.id, first.id))
    expect(cogido.estado).toBe('cogido')
    expect(await answerTurn(db, first.id, {
      content: [{ type: 'tool_use', id: 'toolu_remoto_1', name: 'get_my_recipes', input: {} }],
      stop_reason: 'tool_use',
    })).toEqual({ ok: true })

    // 3. The tool ran and a second round asks with its result.
    const second = await waitForRound((p) => {
      const content = p?.messages?.at(-1)?.content
      return Array.isArray(content) && content.some((b: any) => b.type === 'tool_result' && b.tool_use_id === 'toolu_remoto_1')
    })
    const result = (second.peticion as any).messages.at(-1).content.find((b: any) => b.type === 'tool_result')
    expect(result.content).toMatch(/recetas propias/)
    expect(await answerTurn(db, second.id, { content: [{ type: 'text', text: 'Aún no tienes recetas tuyas guardadas.' }], stop_reason: 'end_turn' })).toEqual({ ok: true })

    // 4. The reply goes out as if Anthropic had written it.
    await turn
    expect(sent.join('\n')).toContain('Aún no tienes recetas tuyas guardadas.')
    const processed = updates.find((u) => u.status === 'processed')
    expect(processed?.meta?.tools).toEqual(['get_my_recipes'])
    // An answered round can't be answered again.
    expect(await answerTurn(db, second.id, { content: [], stop_reason: 'end_turn' })).toEqual({ ok: false, estado: 'respondido' })

    // 5. Nothing in the cost ledger for this turn (fire-and-forget writes: give them a moment).
    await new Promise((r) => setTimeout(r, 500))
    const costs = await db.select().from(costEvents).where(eq(costEvents.userId, user.id))
    expect(costs.filter((c) => c.provider === 'anthropic')).toHaveLength(0)
  }, 60_000)

  it('a round nobody answers expires at 120 s and can no longer be answered', async () => {
    let clock = 0
    const client = remoteMessagesClient(dbTurnStore(db), { now: () => clock, sleep: async (ms) => { clock += ms } })
    const marker = `nadie contesta ${Date.now()}`
    await expect(client.messages.create({ model: 'm', messages: [{ role: 'user', content: marker }] })).rejects.toBeInstanceOf(MimoRemotoTimeoutError)
    expect(clock).toBe(120_000)
    const rows = await db.select().from(mimoTurnosRemotos).where(sql`peticion->'messages'->0->>'content' = ${marker}`)
    expect(rows).toHaveLength(1)
    expect(rows[0].estado).toBe('caducado')
    expect(await answerTurn(db, rows[0].id, { content: [{ type: 'text', text: 'tarde' }], stop_reason: 'end_turn' })).toEqual({ ok: false, estado: 'caducado' })
    // Nothing pending to take.
    expect(await takeNextTurn(db, { waitMs: 0 })).toBeNull()
  })
})
