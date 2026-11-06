/**
 * PRO-1022: `mimo_skill_used {skill, canal}` — one per Mimo tool that returned
 * data, with where the conversation was (web, WhatsApp, Telegram, voice); a
 * tool that fails or finds nothing leaves none. `/admin/usage` counts it by
 * skill (`mimoSkills`). Never text.
 */
import { describe, it, expect, vi } from 'vitest'

const recorded: Array<{ name: string; props?: Record<string, unknown> }> = []
vi.mock('../services/usageEvents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/usageEvents.js')>()
  return {
    ...actual,
    // The real runner writes with trackEvent (skipped under vitest): collect what it would write.
    recordSkillUsage: (name: string, ctx: { channel?: string; surface?: string }, result: any, input?: unknown) => {
      recorded.push(...actual.skillUsageEvents(name, result, actual.channelOfMode(ctx.channel), input, ctx.surface))
    },
  }
})

import { runToolLoop } from '../services/assistant/engine.js'
import { skills } from '../services/assistant/skills.js'
import type { SkillDefinition } from '../services/assistant/types.js'
import { USAGE_EVENTS, skillUsageEvents } from '../services/usageEvents.js'
import { buildMimoSkills, USAGE_DEFINITIONS } from '../services/usageReport.js'

const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

function fakeClient(responses: any[]) {
  return { messages: { create: vi.fn(async () => responses.shift()) } }
}

function skill(name: string, handler: SkillDefinition['handler']): SkillDefinition {
  return { name, description: name, parameters: { type: 'object', properties: {} }, handler }
}

async function turn(ctx: { channel?: any; surface?: any }) {
  recorded.length = 0
  const ok = skill('get_pantry', async () => ({ data: { items: [] }, summary: 'despensa' }))
  const broken = skill('get_recipe_details', async () => {
    throw new Error('boom')
  })
  const empty = skill('search_recipes', async () => ({ data: null, summary: 'nada' }))
  const client = fakeClient([
    {
      content: [
        { type: 'tool_use', id: 't1', name: 'get_pantry', input: {} },
        { type: 'tool_use', id: 't2', name: 'get_recipe_details', input: {} },
        { type: 'tool_use', id: 't3', name: 'search_recipes', input: {} },
      ],
      usage,
      stop_reason: 'tool_use',
    },
    { content: [{ type: 'text', text: 'Aquí lo tienes.' }], usage, stop_reason: 'end_turn' },
  ])
  await runToolLoop({
    client,
    system: 'sys',
    tools: [],
    messages: [{ role: 'user', content: 'hola' }],
    skills: [ok, broken, empty],
    ctx: { userId: 'u1', db: null, ...ctx },
  })
  return recorded.filter((e) => e.name === 'mimo_skill_used')
}

describe('mimo_skill_used (PRO-1022)', () => {
  it('is in the event catalogue', () => {
    expect(USAGE_EVENTS).toContain('mimo_skill_used')
  })

  it('a tool that returns data leaves one event with its skill and canal; a failing or empty one leaves none', async () => {
    expect(await turn({ channel: 'text' })).toEqual([{ name: 'mimo_skill_used', props: { skill: 'get_pantry', canal: 'web' } }])
    expect(await turn({ channel: 'whatsapp' })).toEqual([{ name: 'mimo_skill_used', props: { skill: 'get_pantry', canal: 'whatsapp' } }])
    expect(await turn({ channel: 'whatsapp', surface: 'telegram' })).toEqual([{ name: 'mimo_skill_used', props: { skill: 'get_pantry', canal: 'telegram' } }])
    expect(await turn({ channel: 'voice' })).toEqual([{ name: 'mimo_skill_used', props: { skill: 'get_pantry', canal: 'voice' } }])
  })

  it('also goes with the tools that have their own event', () => {
    expect(skillUsageEvents('generate_weekly_menu', { data: {} }, 'web')).toEqual([
      { name: 'menu_generated' },
      { name: 'mimo_skill_used', props: { skill: 'generate_weekly_menu', canal: 'web' } },
    ])
    expect(skillUsageEvents('generate_weekly_menu', { data: null }, 'web')).toEqual([])
  })

  it('skill is only ever a tool name: a name that is not a slug is not recorded', () => {
    expect(skillUsageEvents('Hola, ¿qué tal?', { data: {} }, 'web')).toEqual([])
  })

  it("every one of Mimo's tools has a name that passes the closed list (PROP_VALUE_RE)", () => {
    expect(skills.length).toBeGreaterThan(50)
    for (const s of skills) {
      expect(skillUsageEvents(s.name, { data: {} }, 'web').find((e) => e.name === 'mimo_skill_used')?.props?.skill).toBe(s.name)
    }
  })
})

describe('/admin/usage mimoSkills (PRO-1022)', () => {
  it('counts by skill, split by canal, most used first', () => {
    expect(
      buildMimoSkills([
        { skill: 'get_pantry', canal: 'web', count: 2 },
        { skill: 'get_pantry', canal: 'telegram', count: 1 },
        { skill: 'swap_meal', canal: 'whatsapp', count: 5 },
        { skill: 'add_pantry_item', canal: null, count: 3 },
      ]),
    ).toEqual([
      { skill: 'swap_meal', total: 5, web: 0, whatsapp: 5, telegram: 0, voice: 0 },
      { skill: 'add_pantry_item', total: 3, web: 0, whatsapp: 0, telegram: 0, voice: 0 },
      { skill: 'get_pantry', total: 3, web: 2, whatsapp: 0, telegram: 1, voice: 0 },
    ])
    expect(buildMimoSkills([])).toEqual([])
  })

  it('is defined for the agents', () => {
    expect(USAGE_DEFINITIONS.mimoSkills).toMatch(/mimo_skill_used/)
  })
})
