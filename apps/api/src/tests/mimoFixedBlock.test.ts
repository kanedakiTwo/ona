/**
 * PRO-393 (Ahorro de API, D-164): Mimo's fixed block — the tools and the
 * instructions, ~38 000 tokens — is the same, byte for byte, on every turn of
 * a household (and of every household of a channel), and it is cached for an
 * hour. Each reply cost 0,20 € the week of 2026-10-26 (E-45): with the
 * 5-minute cache, a reply more than 5 minutes after the previous one wrote
 * the whole block again.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { FIXED_BLOCK_CACHE, buildChatRequest, buildFixedBlock, runToolLoop } from '../services/assistant/engine.js'
import { knowledgeBaseReady } from '../services/assistant/systemPrompt.js'
import { todayLine } from '../services/assistant/contextLoader.js'
import { noticesContextBlock } from '../services/afinaNotice.js'
import { addAnthropicUsage, EMPTY_USAGE, usageCostUsd } from '../services/advisorBudget.js'
import { computeCostMicros, PRICES } from '../config/pricing.js'
import { cacheState, summarizeTurnCosts, turnKind } from '../services/mimoTurnCost.js'
import type { SkillDefinition } from '../services/assistant/types.js'

beforeAll(async () => {
  await knowledgeBaseReady
})

// 2026-11-05 is a Thursday; Madrid is UTC+1 in November.
const AT_2010 = new Date('2026-11-05T19:10:00Z')
const AT_2014 = new Date('2026-11-05T19:14:00Z')
const NEXT_DAY = new Date('2026-11-06T08:02:00Z')

const household = (now: Date, menu: string) =>
  `${todayLine(now)}\nUsuario: martaprueba393\nHogar: 2 adultos + 1 niño (2–10 años)\nMenu de esta semana (2026-11-02):\n  Jue (dayIndex 3): comida: ${menu}\nLe disgustan: cilantro.`

const firstTurn = (mode: 'text' | 'whatsapp') =>
  buildChatRequest({
    mode,
    userContext: household(AT_2010, 'Guisoprueba393'),
    history: [],
    message: '¿Qué comemos hoy?',
    images: [],
    now: AT_2010,
  })

// Four minutes later, after Mimo changed the dish: the context and the history changed.
const secondTurn = (mode: 'text' | 'whatsapp', now = AT_2014) =>
  buildChatRequest({
    mode,
    userContext: household(now, 'Tortilla de patatas'),
    history: [
      { role: 'user', content: '¿Qué comemos hoy?' },
      { role: 'assistant', content: 'Hoy tocan lentejas estofadas.' },
      { role: 'user', content: 'Cámbialas por algo con huevo' },
      { role: 'assistant', content: '⟦hecho: swap_meal⟧ Hecho:\n- Jueves 5, comida: Tortilla de patatas' },
    ],
    message: 'Y apunta huevos',
    images: [{ mediaType: 'image/jpeg', data: 'AAA' }],
    now,
  })

const fixedBytes = (req: { tools: unknown; system: unknown[] }) => JSON.stringify({ tools: req.tools, instructions: req.system[0] })

describe('the fixed block is identical byte for byte between two turns of a household', () => {
  for (const mode of ['text', 'whatsapp'] as const) {
    it(`${mode}: same tools and instructions four minutes later and the next morning`, () => {
      const one = fixedBytes(firstTurn(mode))
      expect(fixedBytes(secondTurn(mode))).toBe(one)
      expect(fixedBytes(secondTurn(mode, NEXT_DAY))).toBe(one)
      // …and it is the one buildFixedBlock gives, with nothing of the household.
      const fixed = buildFixedBlock({ mode })
      expect(JSON.stringify({ tools: fixed.tools, instructions: fixed.instructions })).toBe(one)
      expect(one.includes('martaprueba393')).toBe(false)
      expect(one.includes('Guisoprueba393')).toBe(false)
      expect(/2026-11-0[56]/.test(one)).toBe(false)
    })
  }

  it('the household goes in the second system block, after the breakpoint', () => {
    const req = secondTurn('whatsapp')
    expect(req.system).toHaveLength(2)
    expect(req.system[1]).toEqual({ type: 'text', text: `Datos del usuario:\n${household(AT_2014, 'Tortilla de patatas')}` })
  })

  it('caches tools and instructions for an hour, before the 5-minute breakpoints, 4 at most', () => {
    const req = secondTurn('whatsapp')
    expect(FIXED_BLOCK_CACHE).toEqual({ type: 'ephemeral', ttl: '1h' })
    const marked = req.tools.filter((t: any) => t.cache_control)
    expect(marked).toHaveLength(1)
    expect(req.tools.at(-1)).toMatchObject({ cache_control: { type: 'ephemeral', ttl: '1h' } })
    expect(req.system[0]).toMatchObject({ cache_control: { type: 'ephemeral', ttl: '1h' } })
    expect((req.system[1] as any).cache_control).toBeUndefined()
    // The messages only carry 5-minute breakpoints (the history end), plus the
    // newest block runToolLoop marks: tools + instructions + 2 = the API's 4.
    const ttls: string[] = []
    JSON.stringify(req.messages, (k, v) => {
      if (k === 'cache_control') ttls.push(v.ttl ?? '5m')
      return v
    })
    expect(ttls).toEqual(['5m'])
  })

  it('every household of a channel shares the same entry', () => {
    const other = buildChatRequest({ mode: 'whatsapp', userContext: 'Usuario: jorge\nHogar: 1 adulto', history: [], message: 'hola', images: [], now: NEXT_DAY })
    expect(fixedBytes(other)).toBe(fixedBytes(firstTurn('whatsapp')))
  })
})

describe('the household context keeps its order', () => {
  it('lists the notices by key whatever order the database returns them in', () => {
    const now = new Date('2026-11-05T12:00:00Z')
    const row = (key: string, day: string) => ({ key, userId: 'u1', createdAt: new Date(`${day}T09:00:00Z`), whatsappSentAt: new Date(`${day}T09:00:00Z`), appSince: null, dismissedAt: null })
    const a = row('afina', '2026-11-02')
    const b = row('sin_datos_salud', '2026-11-03')
    expect(noticesContextBlock([b, a] as any, now)).toBe(noticesContextBlock([a, b] as any, now))
  })
})

describe('what a turn records', () => {
  const usage = { input_tokens: 300, output_tokens: 50, cache_creation_input_tokens: 38_000, cache_read_input_tokens: 0, cache_creation: { ephemeral_1h_input_tokens: 37_000, ephemeral_5m_input_tokens: 1_000 } }
  const skill = (name: string): SkillDefinition => ({ name, description: name, parameters: { type: 'object', properties: {} }, handler: vi.fn(async () => ({ data: null, summary: `${name} ok`, uiHint: 'text' as const })) })

  it('counts model calls and tools, and the 1-hour writes', async () => {
    const responses: any[] = [
      { stop_reason: 'tool_use', usage, content: [{ type: 'tool_use', id: 't1', name: 'get_todays_menu', input: {} }, { type: 'tool_use', id: 't2', name: 'get_shopping_list', input: {} }] },
      { stop_reason: 'end_turn', usage: { input_tokens: 200, output_tokens: 80, cache_creation_input_tokens: 500, cache_read_input_tokens: 38_000 }, content: [{ type: 'text', text: 'Hoy toca tortilla.' }] },
    ]
    const client = { messages: { create: vi.fn(async () => responses.shift()) } }
    const r = await runToolLoop({ client, system: 'sys', tools: [], messages: [{ role: 'user', content: 'hola' }], skills: [skill('get_todays_menu'), skill('get_shopping_list')], ctx: { userId: 'u1', db: null } })
    expect(r.usage).toEqual({ inputTokens: 500, outputTokens: 130, cacheWriteTokens: 38_500, cacheWrite1hTokens: 37_000, cacheReadTokens: 38_000, rounds: 2, toolCalls: 2 })
  })

  it('prices 1-hour writes at 2× input (8 $/MTok on Opus 5.5) and the rest of the writes at 5', () => {
    const u = addAnthropicUsage(EMPTY_USAGE, usage)
    // 300×4 + 50×20 + 1 000×5 + 37 000×8 = 1 200 + 1 000 + 5 000 + 296 000 micro-USD
    expect(usageCostUsd(u)).toBeCloseTo(0.3032, 6)
    const table = { 'anthropic/claude-opus-5-5': PRICES['anthropic/claude-opus-5-5'] }
    expect(computeCostMicros('anthropic', 'claude-opus-5-5', u, { eurPerUsd: 1, table })).toBe(303_200)
    // A model without its own 1-hour price: 2× input.
    expect(computeCostMicros('anthropic', 'claude-x', { cacheWriteTokens: 1_000_000, cacheWrite1hTokens: 1_000_000 }, { eurPerUsd: 1, table: { 'anthropic/claude-x': { currency: 'USD', inputPerMTok: 3, cacheWritePerMTok: 3.75 } } })).toBe(6_000_000)
    // Rows from before PRO-393 (no 1-hour field) cost what they cost.
    expect(computeCostMicros('anthropic', 'claude-opus-5-5', { cacheWriteTokens: 38_000 }, { eurPerUsd: 1, table })).toBe(190_000)
  })
})

describe('mimoTurnCost: the average reply by kind of turn', () => {
  it('sorts turns by tool rounds and by whether they wrote the fixed block', () => {
    expect(turnKind(null)).toBe('sin_dato')
    expect(turnKind({ inputTokens: 1 })).toBe('sin_dato')
    expect(turnKind({ rounds: 1, toolCalls: 0 })).toBe('sin_herramientas')
    expect(turnKind({ rounds: 2, toolCalls: 0 })).toBe('sin_herramientas')
    expect(turnKind({ rounds: 2, toolCalls: 3 })).toBe('una_ronda')
    expect(turnKind({ rounds: 4, toolCalls: 3 })).toBe('varias_rondas')
    expect(cacheState({ cacheWriteTokens: 38_000 })).toBe('escribe_bloque_fijo')
    expect(cacheState({ cacheWriteTokens: 4_000, cacheReadTokens: 38_000 })).toBe('lee_bloque_fijo')
  })

  it('averages per Madrid week, channel and group', () => {
    const groups = summarizeTurnCosts([
      { feature: 'whatsapp_chat', units: { cacheWriteTokens: 38_000, outputTokens: 600 }, costMicros: 200_000, createdAt: new Date('2026-10-27T10:00:00Z') },
      { feature: 'whatsapp_chat', units: { cacheWriteTokens: 38_000, outputTokens: 400 }, costMicros: 180_000, createdAt: new Date('2026-11-01T22:30:00Z') },
      // Sunday 23:30 UTC is already Monday in Madrid: next week.
      { feature: 'whatsapp_chat', units: { cacheReadTokens: 76_000, cacheWriteTokens: 3_000, rounds: 2, toolCalls: 1 }, costMicros: 60_000, createdAt: new Date('2026-11-01T23:30:00Z') },
    ])
    const get = (week: string, group: string) => groups.find((g) => g.week === week && g.group === group)
    expect(get('2026-10-26', 'total')).toMatchObject({ turns: 2, avgCostEur: 0.19, avgOutputTokens: 500, avgRounds: null })
    expect(get('2026-10-26', 'kind:sin_dato')).toMatchObject({ turns: 2 })
    expect(get('2026-10-26', 'cache:escribe_bloque_fijo')).toMatchObject({ turns: 2, avgCacheWriteTokens: 38_000 })
    expect(get('2026-11-02', 'kind:una_ronda')).toMatchObject({ turns: 1, avgCostEur: 0.06, avgRounds: 2 })
    expect(get('2026-11-02', 'cache:lee_bloque_fijo')).toMatchObject({ turns: 1, avgCacheReadTokens: 76_000 })
  })
})
