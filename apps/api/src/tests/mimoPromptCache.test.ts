/**
 * Mimo's prompt cache across messages (2026-10-16). `cost_events` showed that
 * a message sent less than 5 minutes after the previous one still wrote
 * ~4 700 tokens to the cache: "son las HH:MM" in the context block changed
 * every minute, and that block sits before the history, so the context and
 * the whole history were written again instead of read. The clock now rides
 * on the newest message and the history ends in a cache breakpoint.
 */
import { describe, expect, it } from 'vitest'
import { clockNote, todayLine } from '../services/assistant/contextLoader.js'
import { buildTurnMessages } from '../services/assistant/engine.js'
import { buildSystemParts } from '../services/assistant/systemPrompt.js'

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
