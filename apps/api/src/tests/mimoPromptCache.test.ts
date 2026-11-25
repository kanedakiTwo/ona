/**
 * Mimo's prompt cache across messages (2026-10-16). `cost_events` showed that
 * a message sent less than 5 minutes after the previous one still wrote
 * ~4 700 tokens to the cache: "son las HH:MM" in the context block changed
 * every minute, and that block sits before the history, so the context and
 * the whole history were written again instead of read. The clock now rides
 * on the newest message and the history ends in a cache breakpoint.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { BRAND_NAME } from '@ona/shared'
import { clockNote, todayLine } from '../services/assistant/contextLoader.js'
import { buildChatRequest, buildTurnMessages, runToolLoop } from '../services/assistant/engine.js'
import { buildSystemParts, knowledgeBaseReady, toolInstructions } from '../services/assistant/systemPrompt.js'
import { toolsFor } from '../services/assistant/skills.js'
import type { SkillDefinition } from '../services/assistant/types.js'

// 2026-10-16 is a Friday; Madrid is UTC+2 in October.
const AT_1432 = new Date('2026-10-16T12:32:00Z')
const AT_1436 = new Date('2026-10-16T12:36:00Z')

const stripCache = (v: unknown): unknown => JSON.parse(JSON.stringify(v), (k, x) => (k === 'cache_control' ? undefined : x))
const asBlocks = (content: unknown) => (typeof content === 'string' ? [{ type: 'text', text: content }] : content)

describe('the context block no longer changes every minute', () => {
  it('has the date but not the time', () => {
    expect(todayLine(AT_1432)).toBe('Hoy es viernes 2026-10-16 (dayIndex 4). La hora va al principio del ultimo mensaje del usuario.')
    expect(todayLine(AT_1436)).toBe(todayLine(AT_1432))
    expect(todayLine(AT_1432)).not.toMatch(/\d{2}:\d{2}/)
  })

  it('gives the same system blocks four minutes later', () => {
    const ctx = (now: Date) => `${todayLine(now)}\nHogar: 2 adultos.`
    expect(buildSystemParts(ctx(AT_1436), 'whatsapp')).toEqual(buildSystemParts(ctx(AT_1432), 'whatsapp'))
  })

  it('puts the Madrid clock on the message instead', () => {
    expect(clockNote(AT_1432)).toBe('(Hora de este mensaje: 14:32 en Madrid)')
    expect(clockNote(new Date('2026-10-16T07:05:00Z'))).toBe('(Hora de este mensaje: 09:05 en Madrid)')
  })
})

describe('buildTurnMessages', () => {
  const history = [
    { role: 'user' as const, content: '¿Qué cenamos hoy?' },
    { role: 'assistant' as const, content: 'Hoy toca crema de calabaza.' },
  ]

  it('ends the history in a cache breakpoint without touching the caller’s array', () => {
    const before = JSON.stringify(history)
    const msgs = buildTurnMessages(history, 'Cámbiala por algo con huevo', [], AT_1432)
    expect(msgs[0]).toEqual(history[0])
    expect(msgs[1].content).toEqual([{ type: 'text', text: 'Hoy toca crema de calabaza.', cache_control: { type: 'ephemeral' } }])
    expect(JSON.stringify(history)).toBe(before)
  })

  it('sends the clock first, then the photos, then the text', () => {
    const msgs = buildTurnMessages([], 'mira esto', [{ mediaType: 'image/jpeg', data: 'AAA' }], AT_1432)
    expect(msgs).toHaveLength(1)
    const blocks = msgs[0].content as any[]
    expect(blocks.map((b) => b.type)).toEqual(['text', 'image', 'text'])
    expect(blocks[0].text).toBe('(Hora de este mensaje: 14:32 en Madrid)')
    expect(blocks[2].text).toBe('mira esto')
    expect(buildTurnMessages([], '', [{ mediaType: 'image/jpeg', data: 'AAA' }], AT_1432)[0].content.at(-1)).toMatchObject({ text: '(foto sin texto)' })
    expect(buildTurnMessages([], '', [], AT_1432)[0].content).toHaveLength(1)
  })

  it('lets the next message reuse this one’s cache: same prefix up to the old history end', () => {
    const turn1 = buildTurnMessages(history, 'Cámbiala por algo con huevo', [], AT_1432)
    const nextHistory = [...history, { role: 'user' as const, content: 'Cámbiala por algo con huevo' }, { role: 'assistant' as const, content: 'Hecho: tortilla de patatas.' }]
    const turn2 = buildTurnMessages(nextHistory, 'Y apunta huevos', [], AT_1436)
    // The cache entry written at the end of turn 1's history must be a prefix of turn 2.
    const prefix1 = turn1.slice(0, history.length).map((m) => ({ role: m.role, content: asBlocks(m.content) }))
    const prefix2 = turn2.slice(0, history.length).map((m) => ({ role: m.role, content: asBlocks(m.content) }))
    expect(stripCache(prefix2)).toEqual(stripCache(prefix1))
    // …and no clock or other per-minute text before that point.
    expect(JSON.stringify(prefix2)).not.toContain('Hora de este mensaje')
  })
})

/**
 * PRO-1291 (Ahorro de API): from 2026-11-11 (PRO-392) each turn carried only
 * the tools and rules its words called for, and `more_tools` added more in
 * the middle of a turn. `tools` goes first in the request, so any change
 * there threw away the whole cache: a message less than 5 minutes after the
 * previous one wrote ~44 000 tokens instead of ~3 000 (0,22 € instead of
 * 0,07 €). Now every turn of a channel sends the same tools and instructions.
 */
describe('two turns in a row about different things send the same tools and instructions', () => {
  const household = (menu: string) => `${todayLine(AT_1432)}\nHogar: 2 adultos.\nJue: comida: ${menu}`
  const requests: { tools: unknown; system: unknown[] }[] = []
  const client = (replies: any[]) => ({
    messages: {
      create: vi.fn(async (args: any) => {
        requests.push({ tools: args.tools, system: args.system })
        return replies.shift()
      }),
    },
  })
  const simulated: SkillDefinition[] = toolsFor({ mode: 'whatsapp' }).map((s) => ({ ...s, handler: async () => ({ data: null, summary: `${s.name} ok`, uiHint: 'text' as const }) }))
  const text = (t: string) => ({ stop_reason: 'end_turn', usage: {}, content: [{ type: 'text', text: t }] })
  const tool = (id: string, name: string, input: unknown) => ({ stop_reason: 'tool_use', usage: {}, content: [{ type: 'tool_use', id, name, input }] })

  beforeAll(async () => {
    await knowledgeBaseReady
    // Turn 1, the menu: «cambia la cena del jueves por algo con huevo».
    const menu = buildChatRequest({ mode: 'whatsapp', userContext: household('Lentejas'), history: [], message: 'Cambia la cena del jueves por algo con huevo', images: [], now: AT_1432 })
    await runToolLoop({ client: client([tool('t1', 'swap_meal', { day: 'jueves' }), text('Hecho: tortilla.')]), ...menu, skills: simulated, ctx: { userId: 'u1', db: null, channel: 'whatsapp' } })
    // Turn 2, four minutes later, the shopping list, with `more_tools` in the middle.
    const shopping = buildChatRequest({
      mode: 'whatsapp',
      userContext: household('Tortilla de patatas'),
      history: [
        { role: 'user', content: 'Cambia la cena del jueves por algo con huevo' },
        { role: 'assistant', content: '⟦hecho: swap_meal⟧ Hecho: tortilla.' },
      ],
      message: 'Quita la leche de la lista de la compra',
      images: [],
      now: AT_1436,
    })
    await runToolLoop({
      client: client([tool('t2', 'more_tools', { groups: ['compra'] }), tool('t3', 'remove_shopping_items', { items: ['leche'] }), text('Quitada.')]),
      ...shopping,
      skills: simulated,
      ctx: { userId: 'u1', db: null, channel: 'whatsapp' },
    })
  })

  it('every round of both turns sends the very same tools, byte for byte', () => {
    expect(requests).toHaveLength(5)
    const first = JSON.stringify(requests[0].tools)
    for (const r of requests) expect(JSON.stringify(r.tools)).toBe(first)
    // All of them: those of the menu and those of the list, and no `more_tools`.
    const names = (requests[0].tools as { name: string }[]).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['swap_meal', 'generate_weekly_menu', 'remove_shopping_items', 'check_shopping_item', 'get_ficha']))
    expect(names).not.toContain('more_tools')
  })

  it('and the very same instructions block, with every tool line and «Sobre Mimoia»', () => {
    const first = JSON.stringify(requests[0].system[0])
    for (const r of requests) expect(JSON.stringify(r.system[0])).toBe(first)
    expect(first).toContain(`Sobre ${BRAND_NAME}. Si te preguntan`)
    expect((requests[0].system[0] as { text: string }).text).toContain(toolInstructions())
    // The household's data goes after it and does change.
    expect(JSON.stringify(requests[4].system[1])).not.toBe(JSON.stringify(requests[0].system[1]))
  })

  it('keeps the breakpoint at the end of the tools and of the instructions', () => {
    expect((requests[0].tools as any[]).at(-1).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
    expect((requests[0].system[0] as any).cache_control).toEqual({ type: 'ephemeral', ttl: '1h' })
  })
})
