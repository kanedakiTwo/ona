/**
 * PRO-392 (D-168): Mimo gets, on each turn, only the tools it needs, chosen
 * without AI (words of the message and of Mimo's last reply, tools of the
 * last turns, the page), with a core that always goes and `more_tools` to
 * load a group the choice missed. The battery (`MIMO_EVAL_CASES`,
 * `CLAIM_EVAL_CASES`, `HEALTH_EVAL_CASES`) must keep getting every tool it
 * needs.
 */
import { describe, expect, it } from 'vitest'
import { skills, getToolDefinitions } from '../services/assistant/skills.js'
import {
  CORE_TOOLS,
  TOOL_GROUPS,
  MORE_TOOLS_NAME,
  selectToolGroups,
  tracedTools,
  type ToolGroupId,
} from '../services/assistant/toolGroups.js'
import { MIMO_EVAL_CASES } from '../services/assistant/mimoEvalCases.js'
import { CLAIM_EVAL_CASES } from '../services/assistant/mimoClaimEvalCases.js'
import { HEALTH_EVAL_CASES } from '../services/assistant/healthGuard.js'
import { buildSystemParts, TOOL_INSTRUCTIONS } from '../services/assistant/systemPrompt.js'
import { runToolLoop, withLastToolCached } from '../services/assistant/engine.js'

const select = (message: string, extra: Partial<Parameters<typeof selectToolGroups>[0]> = {}) =>
  selectToolGroups({ message, mode: 'whatsapp', ...extra })

describe('the groups cover the registry', () => {
  const grouped = new Set<string>([...CORE_TOOLS, ...Object.values(TOOL_GROUPS).flatMap((g) => g.tools)])

  it('puts every tool (but the sign-up one) in the core or in a group', () => {
    const missing = skills.map((s) => s.name).filter((n) => n !== 'complete_onboarding' && !grouped.has(n))
    expect(missing).toEqual([])
  })

  it('names only tools that exist', () => {
    const names = new Set(skills.map((s) => s.name))
    expect([...grouped].filter((n) => n !== MORE_TOOLS_NAME && !names.has(n))).toEqual([])
  })

  it('keeps more_tools out of the full list (scripts, the «before» run) and in every selection', () => {
    expect(getToolDefinitions({ mode: 'whatsapp' }).some((t) => t.name === MORE_TOOLS_NAME)).toBe(false)
    expect(getToolDefinitions({ mode: 'whatsapp', only: select('hola').tools }).some((t) => t.name === MORE_TOOLS_NAME)).toBe(true)
  })
})

/** Tools a case needs beyond what it simulates (`toolResults`) or demands (`mustCallOneOf`). */
const EXTRA_NEEDS: Record<string, string[]> = {
  'comensales-turno-anterior': ['set_meal_servings'],
  'nata-alergia-leche': ['suggest_substitution'],
  'menu-para-dos-hogar-de-4': ['generate_weekly_menu', 'update_weekly_template'],
  'receta-merluza-sin-minutos': ['create_recipe'],
  'cilantro-butter-chicken': ['edit_recipe', 'update_recipe_notes', 'update_memory'],
}

describe('every case of the battery gets the tools it needs (whatsapp and web)', () => {
  const cases = [...MIMO_EVAL_CASES, ...CLAIM_EVAL_CASES, ...HEALTH_EVAL_CASES] as {
    id: string
    message: string
    history: { role: 'user' | 'assistant'; content: string }[]
    toolResults?: Record<string, string>
    mustCallOneOf?: string[]
  }[]
  for (const mode of ['whatsapp', 'text'] as const) {
    for (const c of cases) {
      it(`${mode} · ${c.id}`, () => {
        const needs = new Set([...Object.keys(c.toolResults ?? {}), ...(c.mustCallOneOf ?? []), ...(EXTRA_NEEDS[c.id] ?? [])])
        const got = selectToolGroups({ message: c.message, history: c.history, mode }).tools
        expect([...needs].filter((n) => !got.has(n))).toEqual([])
      })
    }
  }

  it('sends, on average, at least 30 % fewer bytes of tools and instructions than with every tool', () => {
    let before = 0
    let after = 0
    for (const c of cases) {
      const sel = selectToolGroups({ message: c.message, history: c.history, mode: 'whatsapp' })
      before += JSON.stringify(getToolDefinitions({ mode: 'whatsapp' })).length + buildSystemParts('', 'whatsapp').instructions.length
      after += JSON.stringify(getToolDefinitions({ mode: 'whatsapp', only: sel.tools })).length
        + buildSystemParts('', 'whatsapp', { tools: sel.tools, about: sel.about }).instructions.length
    }
    expect(after / before).toBeLessThan(0.7)
  })
})

describe('selectToolGroups', () => {
  const has = (sel: { groups: ToolGroupId[] }, g: ToolGroupId) => sel.groups.includes(g)

  it('always carries the core', () => {
    const sel = select('gracias')
    for (const t of CORE_TOOLS) expect(sel.tools.has(t)).toBe(true)
  })

  it('falls back to the menu group when nothing points anywhere', () => {
    expect(select('vale').groups).toEqual(['menu'])
  })

  it('picks groups by the words of the message, with or without accents', () => {
    expect(has(select('hazme el pedido a la frutería'), 'tiendas')).toBe(true)
    expect(has(select('¿qué tengo en la despensa?'), 'despensa')).toBe(true)
    expect(has(select('guárdame esta receta https://youtube.com/watch?v=x'), 'recetas')).toBe(true)
    expect(has(select('pon un temporizador de 10 minutos'), 'cocina')).toBe(true)
    expect(has(select('¿qué tal vamos de verdura esta semana?'), 'salud')).toBe(true)
    expect(has(select('olvida que no tenemos horno'), 'ficha')).toBe(true)
    expect(has(select('apaga los avisos de la mañana'), 'hogar')).toBe(true)
    expect(has(select('de patatas pon 2 kilos en la lista'), 'compra')).toBe(true)
    expect(has(select('todos los días desayuno yogur con cereales'), 'fijas')).toBe(true)
    expect(has(select('me sobró cocido, ponlo el jueves'), 'sobras')).toBe(true)
    expect(has(select('¿qué cenamos hoy?'), 'tiendas')).toBe(false)
  })

  it('reads a short answer in the light of Mimo’s last question', () => {
    const history = [
      { role: 'user' as const, content: '(Mimo me ha escrito primero)' },
      { role: 'assistant' as const, content: 'En el congelador tienes: albóndigas (desde el 3 de octubre). ¿Lo meto en el menú de estas semanas?' },
    ]
    expect(select('Sí, mételo', { history }).tools.has('plan_freezer_items')).toBe(true)
  })

  it('keeps the groups of the tools used in the last two turns', () => {
    const history = [
      { role: 'user' as const, content: 'prepárame los pedidos' },
      { role: 'assistant' as const, content: '⟦hecho: prepare_shop_orders {} → Pedido preparado · get_shop_orders {} → 1 abierto⟧Hecho: - Pedido a la frutería listo' },
    ]
    expect(tracedTools(history[1].content)).toEqual(['prepare_shop_orders', 'get_shop_orders'])
    expect(select('y quita los plátanos', { history }).tools.has('edit_shop_order')).toBe(true)
  })

  it('adds the groups of the page the web companion writes from', () => {
    expect(selectToolGroups({ message: 'quita esto', mode: 'text', page: 'shopping' }).tools.has('remove_shopping_items')).toBe(true)
    expect(selectToolGroups({ message: 'siguiente', mode: 'text', page: 'cooking' }).tools.has('cooking_step')).toBe(true)
  })

  it('gives the voice onboarding only update_memory, and the WhatsApp sign-up complete_onboarding', () => {
    expect([...selectToolGroups({ message: 'treinta y cinco', mode: 'onboarding' }).tools]).toEqual(['update_memory'])
    expect(select('somos 3', { onboarding: true }).tools.has('complete_onboarding')).toBe(true)
    expect(select('somos 3').tools.has('complete_onboarding')).toBe(false)
  })

  it('loads «Sobre Mimoia» only when the turn asks about the app', () => {
    expect(select('¿cuánto cuesta el plan Plus?').about).toBe(true)
    expect(select('¿qué es Mimoia?').about).toBe(true)
    expect(select('¿cómo protegéis mis datos?').about).toBe(true)
    expect(select('¿qué cenamos hoy?').about).toBe(false)
    expect(select('somos 3', { onboarding: true }).about).toBe(true)
  })
})

describe('the prompt follows the selection', () => {
  it('drops the tool lines whose tools are not there, keeps the general ones', () => {
    const all = buildSystemParts('', 'whatsapp').instructions
    const few = buildSystemParts('', 'whatsapp', { tools: new Set(CORE_TOOLS) }).instructions
    for (const l of TOOL_INSTRUCTIONS) {
      expect(all).toContain(l.text)
      if (!l.tools) expect(few).toContain(l.text)
      else if (!l.tools.some((t) => (CORE_TOOLS as readonly string[]).includes(t))) expect(few).not.toContain(l.text)
    }
    expect(few).toContain('Nunca propongas margarina')
  })

  it('leaves «Sobre Mimoia» out unless asked, with the contact always', () => {
    const without = buildSystemParts('', 'whatsapp', { about: false }).instructions
    const withIt = buildSystemParts('', 'whatsapp', { about: true }).instructions
    expect(withIt).toContain('Planes y precios')
    expect(without).not.toContain('Planes y precios')
    expect(without).toContain('Contacto con una persona del equipo')
    expect(without).toContain('mimoia.com/precios')
  })
})

describe('more_tools in the engine', () => {
  it('adds the asked group for the next round of the same turn, cache breakpoint on the last tool', async () => {
    const requests: any[] = []
    const replies = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: MORE_TOOLS_NAME, input: { groups: ['tiendas'] } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tus pedidos están en camino.' }] },
    ]
    const client = { messages: { create: async (args: any) => { requests.push(JSON.parse(JSON.stringify(args))); return { ...replies.shift(), usage: {} } } } }
    const only = select('hola').tools
    const res = await runToolLoop({
      client,
      system: 'x',
      tools: withLastToolCached(getToolDefinitions({ mode: 'whatsapp', only })),
      messages: [{ role: 'user', content: '¿cómo van mis pedidos?' }],
      skills,
      ctx: { userId: 'u', db: null, channel: 'whatsapp' },
      moreTools: (groups) => getToolDefinitions({ mode: 'whatsapp', only: new Set(groups.flatMap((g) => TOOL_GROUPS[g].tools)) }),
    })
    const names = (r: any) => r.tools.map((t: any) => t.name)
    expect(names(requests[0])).not.toContain('get_shop_orders')
    expect(names(requests[1])).toContain('get_shop_orders')
    expect(requests[1].tools.filter((t: any) => t.cache_control).map((t: any) => t.name)).toEqual([requests[1].tools.at(-1).name])
    const result = requests[1].messages.at(-1).content[0]
    expect(result.content).toMatch(/^Ya tienes las herramientas de tiendas/)
    expect(res.message).toBe('Tus pedidos están en camino.')
  })

  it('answers an unknown group with an error and the list of groups', async () => {
    const replies = [
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: MORE_TOOLS_NAME, input: { groups: ['magia'] } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Vale.' }] },
    ]
    const requests: any[] = []
    const client = { messages: { create: async (args: any) => { requests.push(JSON.parse(JSON.stringify(args))); return { ...replies.shift(), usage: {} } } } }
    await runToolLoop({
      client, system: 'x', tools: [], messages: [{ role: 'user', content: 'x' }], skills,
      ctx: { userId: 'u', db: null }, moreTools: () => [],
    })
    expect(requests[1].messages.at(-1).content[0]).toMatchObject({ is_error: true })
  })
})

describe('«Sobre Mimoia» and Mimo’s own greeting', () => {
  it('does not load the block because Mimo introduced itself as «Mimo, de Mimoia»', () => {
    const history = [
      { role: 'user' as const, content: 'hola!' },
      { role: 'assistant' as const, content: 'Hola, soy Mimo, de Mimoia. ¿En qué te ayudo?' },
    ]
    expect(select('como le preparo la merluza a leo?', { history }).about).toBe(false)
  })
})
