/**
 * runToolLoop — the engine's model ↔ tools loop, driven by a fake client.
 * Pins: multi-round tool use, parallel tool_use blocks answered in ONE user
 * message, error results flagged, the forced text round, and which skill's
 * uiHint/data the web card renders.
 */
import { describe, it, expect, vi } from 'vitest'
import { CLAUDE_MODEL } from '../config/models.js'
import { runToolLoop, MAX_TOOL_ROUNDS, ASSISTANT_MODEL, TRUNCATED_NOTE, claimsAction, withLastMessageCached } from '../services/assistant/engine.js'
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
        create: vi.fn(async (args: any, options?: any) => {
          calls.push({ ...structuredClone(args), __options: options })
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

  it('prefers the last visual skill for the web card and says "Hecho." when the model says nothing', async () => {
    const menu = skill('get_todays_menu', 'menu', { day: 0 })
    const nut = skill('nutrition_advice', 'text')
    const f = fakeClient([tools({ id: '1', name: 'get_todays_menu' }), tools({ id: '2', name: 'nutrition_advice' }), { content: [], usage }])
    const r = await runToolLoop(base(f.client, [menu, nut]))
    // An empty final text never leaks a tool summary (they carry notes meant for the model).
    expect(r).toMatchObject({ skillUsed: 'get_todays_menu', uiHint: 'menu', data: { day: 0 }, message: 'Hecho.' })
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

describe('primary skill for the card / app link', () => {
  it('prefers menu/list/recipe over confirmation and text, latest among equals', async () => {
    const swap = skill('swap_meal', 'menu', { day: 3 })
    const mem = skill('update_memory', 'confirmation')
    const f = fakeClient([tools({ id: 'a', name: 'swap_meal' }, { id: 'b', name: 'update_memory' }), text('Hecho.')])
    const r = await runToolLoop(base(f.client, [swap, mem]))
    expect(r).toMatchObject({ skillUsed: 'swap_meal', uiHint: 'menu', data: { day: 3 } })
  })
})

describe('model request (2026-10-12: Sonnet 5.5)', () => {
  it('asks Opus 5.5 (PRO-232) with effort, refusal fallback and a cache breakpoint on the last message', async () => {
    const f = fakeClient([text('hola')])
    await runToolLoop(base(f.client, []))
    const call = f.calls[0]
    expect(call.model).toBe(ASSISTANT_MODEL)
    expect(ASSISTANT_MODEL).toBe(CLAUDE_MODEL)
    expect(call.max_tokens).toBeGreaterThanOrEqual(4096)
    expect(call.output_config).toEqual({ effort: 'medium' })
    expect(call.fallbacks).toBe('default')
    expect(call.__options.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01')
    expect(call.temperature).toBeUndefined()
    expect(call.messages.at(-1).content.at(-1)).toMatchObject({ type: 'text', text: 'hola', cache_control: { type: 'ephemeral' } })
  })

  it('runs another model or effort when asked (scripts/compareMimoModels.ts), the product model at medium otherwise', async () => {
    const f = fakeClient([text('hola')])
    await runToolLoop({ ...base(f.client, []), model: 'claude-haiku-5-5', effort: 'high' })
    expect(f.calls[0].model).toBe('claude-haiku-5-5')
    expect(f.calls[0].output_config).toEqual({ effort: 'high' })
  })

  it('withLastMessageCached marks only the newest block and never mutates history', () => {
    const history: any[] = [
      { role: 'user', content: 'uno' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'x', name: 'n', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
    ]
    const out = withLastMessageCached(history)
    expect(out[2].content[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(history[2].content[0].cache_control).toBeUndefined()
    expect(out[0]).toBe(history[0])
  })
})

describe('no more forced rewrites (2026-10-12)', () => {
  it('still recognises Spanish "I did it" claims', () => {
    expect(claimsAction('Perfecto, listo. Cambiado: hoy cenas pollo con calabacín.')).toBe(true)
    expect(claimsAction('Ya he añadido la leche.')).toBe(true)
    expect(claimsAction('¿Listo para cocinar? Te paso los pasos.')).toBe(false)
    expect(claimsAction('Te sugiero unas lentejas con verduras.')).toBe(false)
  })

  it('flags a claim made without tools for the daily review, without a second round', async () => {
    const f = fakeClient([text('Perfecto, he cambiado la cena de hoy.')])
    const r = await runToolLoop(base(f.client, []))
    expect(f.calls).toHaveLength(1)
    expect(r.message).toBe('Perfecto, he cambiado la cena de hoy.')
    expect(r.corrections).toEqual(['unverified_claim'])
  })

  it('returns an honest "no se puede" as it is (no refusal round)', async () => {
    const f = fakeClient([text('No se puede congelar la mayonesa casera: se corta.')])
    const r = await runToolLoop(base(f.client, []))
    expect(f.calls).toHaveLength(1)
    expect(r.corrections).toEqual([])
  })
})

describe('cut-off and refused responses', () => {
  it('never runs a tool call cut by max_tokens: retries once asking for smaller steps', async () => {
    const create = skill('create_recipe', 'recipe')
    const f = fakeClient([
      { content: [{ type: 'tool_use', id: 'c1', name: 'create_recipe', input: { name: 'Pis' } }], usage, stop_reason: 'max_tokens' },
      tools({ id: 'c2', name: 'create_recipe', input: { name: 'Pisto' } }),
      text('Hecho: receta creada.'),
    ])
    const r = await runToolLoop(base(f.client, [create]))
    expect(create.handler).toHaveBeenCalledOnce()
    expect(create.handler).toHaveBeenCalledWith({ name: 'Pisto' }, expect.anything())
    expect(JSON.stringify(f.calls[1].messages.at(-1))).toContain(TRUNCATED_NOTE.slice(0, 40))
    expect(r.corrections).toContain('truncated')
    expect(r.message).toBe('Hecho: receta creada.')
  })

  it('a second cut-off ends the turn with a plain explanation', async () => {
    const cut = { content: [{ type: 'tool_use', id: 'c', name: 'create_recipe', input: {} }], usage, stop_reason: 'max_tokens' }
    const f = fakeClient([cut, structuredClone(cut)])
    const r = await runToolLoop(base(f.client, [skill('create_recipe', 'recipe')]))
    expect(r.message).toMatch(/muy largo/)
  })

  it('a safety refusal gets a short, friendly reply', async () => {
    const f = fakeClient([{ content: [], usage, stop_reason: 'refusal' }])
    const r = await runToolLoop(base(f.client, []))
    expect(r.message).toMatch(/no te puedo ayudar/)
    expect(r.corrections).toContain('refusal')
  })
})

describe('tool trace', () => {
  it('records each tool input and result (bounded) for history and the daily review', async () => {
    const swap = skill('swap_meal', 'menu')
    const f = fakeClient([tools({ id: 's', name: 'swap_meal', input: { dayIndex: 3, meal: 'dinner', recipeName: 'Hamburguesa' } }), text('Hecho.')])
    const r = await runToolLoop(base(f.client, [swap]))
    expect(r.toolTrace).toEqual([{ name: 'swap_meal', input: '{"dayIndex":3,"meal":"dinner","recipeName":"Hamburguesa"}', summary: 'swap_meal ok' }])
  })

  it('never lets a ⟦hecho: …⟧ history mark reach the user', async () => {
    const f = fakeClient([text('⟦hecho: swap_meal {} → ok⟧\nHoy cenas hamburguesa.')])
    const r = await runToolLoop(base(f.client, []))
    expect(r.message).toBe('Hoy cenas hamburguesa.')
  })
})
