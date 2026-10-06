/**
 * runToolLoop — the engine's model ↔ tools loop, driven by a fake client.
 * Pins: multi-round tool use, parallel tool_use blocks answered in ONE user
 * message, error results flagged, the forced text round, and which skill's
 * uiHint/data the web card renders.
 */
import { describe, it, expect, vi } from 'vitest'
import { runToolLoop, MAX_TOOL_ROUNDS } from '../services/assistant/engine.js'
import type { SkillDefinition } from '../services/assistant/types.js'

const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const text = (t: string) => ({ content: [{ type: 'text', text: t }], usage, stop_reason: 'end_turn' })
const tools = (...calls: { id: string; name: string; input?: unknown }[]) => ({
  content: calls.map((c) => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input ?? {} })),
  usage,
  stop_reason: 'tool_use',
})

function skill(name: string, uiHint: any, data: unknown = { name }): SkillDefinition {
  return {
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    handler: vi.fn(async () => ({ data, summary: `${name} ok`, uiHint })),
  }
}

function fakeClient(responses: any[]) {
  const calls: any[] = []
  return {
    calls,
    client: {
      messages: {
        create: vi.fn(async (args: any) => {
          calls.push(structuredClone(args))
          const next = responses.shift()
          if (!next) throw new Error('no more fake responses')
          return next
        }),
      },
    },
  }
}

const base = (client: any, skills: SkillDefinition[]) => ({
  client,
  system: 'sys',
  tools: [],
  messages: [{ role: 'user' as const, content: 'hola' }],
  skills,
  ctx: { userId: 'u1', db: null },
})

describe('runToolLoop', () => {
  it('returns plain text when the model uses no tools', async () => {
    const f = fakeClient([text('¡Hola!')])
    const r = await runToolLoop(base(f.client, []))
    expect(r).toMatchObject({ message: '¡Hola!', actionTaken: false })
    expect(r.usage.inputTokens + r.usage.outputTokens).toBeGreaterThan(0)
  })

  it('chains tool rounds: generate the menu, then read the shopping list', async () => {
    const gen = skill('generate_weekly_menu', 'menu')
    const list = skill('get_shopping_list', 'shopping_list')
    const f = fakeClient([
      tools({ id: 't1', name: 'generate_weekly_menu' }),
      tools({ id: 't2', name: 'get_shopping_list' }),
      text('Menú listo y aquí tienes la lista.'),
    ])
    const r = await runToolLoop(base(f.client, [gen, list]))
    expect(gen.handler).toHaveBeenCalledOnce()
    expect(list.handler).toHaveBeenCalledOnce()
    expect(r).toMatchObject({ message: 'Menú listo y aquí tienes la lista.', skillUsed: 'get_shopping_list', uiHint: 'shopping_list', actionTaken: true })
    // Third call carries both rounds of history.
    expect(f.calls[2].messages).toHaveLength(5)
  })

  it('answers parallel tool_use blocks in a single user message', async () => {
    const a = skill('get_todays_menu', 'menu')
    const b = skill('get_pantry_stock', 'text')
    const f = fakeClient([tools({ id: 'a', name: 'get_todays_menu' }, { id: 'b', name: 'get_pantry_stock' }), text('ok')])
    await runToolLoop(base(f.client, [a, b]))
    const followUp = f.calls[1].messages
    const last = followUp[followUp.length - 1]
    expect(last.role).toBe('user')
    expect(last.content.map((c: any) => [c.type, c.tool_use_id])).toEqual([
      ['tool_result', 'a'],
      ['tool_result', 'b'],
    ])
  })

  it('flags unknown tools and throwing skills as is_error and lets the model recover', async () => {
    const boom: SkillDefinition = { ...skill('swap_meal', 'menu'), handler: vi.fn(async () => { throw new Error('sin menú') }) }
    const f = fakeClient([tools({ id: 'x', name: 'nope' }, { id: 'y', name: 'swap_meal' }), text('No tienes menú esta semana.')])
    const r = await runToolLoop(base(f.client, [boom]))
    const results = f.calls[1].messages.at(-1).content
    expect(results.every((c: any) => c.is_error === true)).toBe(true)
    expect(results[1].content).toContain('sin menú')
    expect(r.message).toBe('No tienes menú esta semana.')
  })

  it('forces a text answer after MAX_TOOL_ROUNDS', async () => {
    const s = skill('search_recipes', 'recipe')
    const responses = Array.from({ length: MAX_TOOL_ROUNDS }, (_, i) => tools({ id: `t${i}`, name: 'search_recipes' }))
    const f = fakeClient([...responses, text('Esto es lo que he encontrado.')])
    const r = await runToolLoop(base(f.client, [s]))
    expect(s.handler).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS)
    expect(f.calls.at(-1).tool_choice).toEqual({ type: 'none' })
    expect(f.calls.slice(0, -1).every((c: any) => c.tool_choice === undefined)).toBe(true)
    expect(r.message).toBe('Esto es lo que he encontrado.')
  })

  it('prefers the last visual skill for the web card and falls back to its summary when the model says nothing', async () => {
    const menu = skill('get_todays_menu', 'menu', { day: 0 })
    const nut = skill('nutrition_advice', 'text')
    const f = fakeClient([tools({ id: '1', name: 'get_todays_menu' }), tools({ id: '2', name: 'nutrition_advice' }), { content: [], usage }])
    const r = await runToolLoop(base(f.client, [menu, nut]))
    expect(r).toMatchObject({ skillUsed: 'get_todays_menu', uiHint: 'menu', data: { day: 0 }, message: 'get_todays_menu ok' })
  })
})

describe('hallucinated-action guard', () => {
  it('detects Spanish "I did it" claims but not questions or plain advice', async () => {
    const { claimsAction } = await import('../services/assistant/engine.js')
    // The exact reply from the 2026-10-06 E2E run where no swap_meal happened.
    expect(claimsAction('Perfecto, listo. Cambiado: hoy cenas pollo con calabacín.')).toBe(true)
    expect(claimsAction('He cambiado la cena de hoy.')).toBe(true)
    expect(claimsAction('Listo. Hoy cenas pollo con calabacín.')).toBe(true)
    expect(claimsAction('Hecho, ya lo tienes en la lista.')).toBe(true)
    expect(claimsAction('Ya he añadido la leche.')).toBe(true)
    expect(claimsAction('He añadido la leche a la lista.')).toBe(true)
    expect(claimsAction('¿Listo para cocinar? Te paso los pasos.')).toBe(false)
    expect(claimsAction('Te sugiero unas lentejas con verduras.')).toBe(false)
  })

  it('gives the model one corrective round when it claims a change without calling a tool', async () => {
    const swap = skill('swap_meal', 'menu')
    const f = fakeClient([
      text('Perfecto, he cambiado la cena de hoy.'),
      tools({ id: 's1', name: 'swap_meal', input: { dayIndex: 1, meal: 'dinner' } }),
      text('Hecho: esta noche cenas crema de calabaza.'),
    ])
    const r = await runToolLoop(base(f.client, [swap]))
    expect(swap.handler).toHaveBeenCalledOnce()
    expect(f.calls[1].messages.at(-1).content).toContain('Nota del sistema')
    expect(r).toMatchObject({ message: 'Hecho: esta noche cenas crema de calabaza.', skillUsed: 'swap_meal', actionTaken: true })
  })

  it('accepts the truthful answer after the correction and does not loop again', async () => {
    const f = fakeClient([text('Listo, cambiado.'), text('Listo... en realidad esa receta no existe en tu catálogo. ¿Busco otra?')])
    const r = await runToolLoop(base(f.client, []))
    expect(f.calls).toHaveLength(2)
    expect(r.message).toContain('no existe')
  })

  it('does not second-guess a claim backed by a tool call', async () => {
    const swap = skill('swap_meal', 'menu')
    const f = fakeClient([tools({ id: 's1', name: 'swap_meal' }), text('He cambiado la cena.')])
    await runToolLoop(base(f.client, [swap]))
    expect(f.calls).toHaveLength(2)
  })
})

describe('onToolStart hook', () => {
  it('fires with the tool names of each round before they run, and survives a throwing callback', async () => {
    const order: string[] = []
    const gen: SkillDefinition = {
      ...skill('generate_weekly_menu', 'menu'),
      handler: vi.fn(async () => {
        order.push('run:generate_weekly_menu')
        return { data: null, summary: 'ok', uiHint: 'menu' as const }
      }),
    }
    const f = fakeClient([tools({ id: '1', name: 'generate_weekly_menu' }), text('Hecho.')])
    await runToolLoop({
      ...base(f.client, [gen]),
      onToolStart: (names) => {
        order.push(`start:${names.join(',')}`)
        throw new Error('boom')
      },
    })
    expect(order).toEqual(['start:generate_weekly_menu', 'run:generate_weekly_menu'])
  })
})
