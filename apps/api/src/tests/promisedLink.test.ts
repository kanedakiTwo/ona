/**
 * PRO-1301: when Mimo says it sends a link to the app, the code adds it to
 * the message; it doesn't depend on the model writing it. 2026-11 history:
 * «¿Me mandas el enlace de la app y lo miro yo?» got «te paso el enlace» and
 * no link. specs/advisor.md.
 */
import { describe, expect, it, vi } from 'vitest'
import { appPathFor, promisesAppLink, withPromisedAppLink } from '../services/assistant/promisedLink.js'
import { runToolLoop } from '../services/assistant/engine.js'
import { env } from '../config/env.js'
import type { SkillDefinition } from '../services/assistant/types.js'

const WEB = 'https://www.mimoia.com'

describe('withPromisedAppLink (pure)', () => {
  it('adds the menu link when the reply announces it and has none', () => {
    const r = withPromisedAppLink('El aviso salió porque hoy en el menú tocan albóndigas. Te paso el enlace del menú:', WEB)
    expect(r).toBe('El aviso salió porque hoy en el menú tocan albóndigas. Te paso el enlace del menú: mimoia.com/menu')
  })
  it('on its own line when the sentence doesn\'t end in «:»', () => {
    expect(withPromisedAppLink('Aquí tienes el enlace a tu lista de la compra.', WEB)).toBe('Aquí tienes el enlace a tu lista de la compra.\n\nmimoia.com/shopping')
  })
  it('picks the page the reply talks about', () => {
    expect(appPathFor('te dejo el enlace a tus avisos')).toBe('/profile/avisos')
    expect(appPathFor('te paso el enlace de la receta', 'r9')).toBe('/recipes/r9')
    expect(appPathFor('te paso el enlace')).toBe('/menu')
  })
  it('leaves it alone when the link is already there (full or short)', () => {
    for (const t of ['Te paso el enlace: https://www.mimoia.com/menu', 'Te paso el enlace: mimoia.com/menu']) {
      expect(promisesAppLink(t)).toBe(false)
      expect(withPromisedAppLink(t, WEB)).toBe(t)
    }
  })
  it('doesn\'t touch replies that don\'t promise one, or promise a link that isn\'t to the app', () => {
    expect(promisesAppLink('Hoy cenáis tortilla. ¿Te cambio algo?')).toBe(false)
    expect(promisesAppLink('Si quieres, pégame el enlace del vídeo y la guardo.')).toBe(false)
    expect(promisesAppLink('Te paso el enlace del vídeo original de la receta.')).toBe(false)
    expect(promisesAppLink('Te dejo el enlace para invitar a tu hermana.')).toBe(false)
  })
})

describe('runToolLoop: the reply carries the link it announces', () => {
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const client = (responses: any[]) => ({ messages: { create: vi.fn(async () => responses.shift()) } })
  const base = (c: any, skills: SkillDefinition[] = []) => ({
    client: c,
    system: 'sys',
    tools: [],
    messages: [{ role: 'user' as const, content: '¿Me mandas el enlace de la app y lo miro yo?' }],
    skills,
    ctx: { userId: 'u1', db: null },
  })
  const short = (path: string) => `${env.WEB_PUBLIC_URL.replace(/^https?:\/\//, '').replace(/^www\./, '')}${path}`

  it('no tool: «te paso el enlace del menú» → the menu link at the end, flagged', async () => {
    const c = client([{ content: [{ type: 'text', text: 'Es lo que había puesto para hoy. Te paso el enlace del menú para que lo mires.' }], usage, stop_reason: 'end_turn' }])
    const r = await runToolLoop(base(c))
    expect(r.message).toBe(`Es lo que había puesto para hoy. Te paso el enlace del menú para que lo mires.\n\n${short('/menu')}`)
    expect(r.corrections).toContain('app_link_added')
  })

  it('after reading a recipe: «el enlace de la receta» → that recipe', async () => {
    const getRecipe: SkillDefinition = {
      name: 'get_recipe_details',
      description: 'x',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ data: { id: 'rec-7', name: 'Costillas' }, summary: 'ok', uiHint: 'recipe' }),
    }
    const c = client([
      { content: [{ type: 'tool_use', id: 't1', name: 'get_recipe_details', input: {} }], usage, stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'Aquí tienes el enlace a la receta:' }], usage, stop_reason: 'end_turn' },
    ])
    const r = await runToolLoop(base(c, [getRecipe]))
    expect(r.message).toBe(`Aquí tienes el enlace a la receta: ${short('/recipes/rec-7')}`)
  })

  it('a reply without that promise goes as it is', async () => {
    const c = client([{ content: [{ type: 'text', text: 'Hoy cenáis albóndigas.' }], usage, stop_reason: 'end_turn' }])
    const r = await runToolLoop(base(c))
    expect(r.message).toBe('Hoy cenáis albóndigas.')
    expect(r.corrections ?? []).not.toContain('app_link_added')
  })
})
