/**
 * One-shot probe: call Claude with ONA's actual system prompt + tools, log
 * the token usage Anthropic returns. Compares the no-cache baseline vs
 * the prompt-cached variant we now use in `engine.ts`, so the savings are
 * concrete and measurable.
 *
 * Run: cd apps/api && tsx scripts/measure-tokens.ts
 */

import Anthropic from '@anthropic-ai/sdk'
import { env } from '../src/config/env.js'
import { buildSystemPrompt } from '../src/services/assistant/systemPrompt.js'
import { getToolDefinitions } from '../src/services/assistant/skills.js'

const PROMPTS = [
  'Hola',
  'que toca cocinar hoy?',
  'el zumo de naranja es saludable?',
  'no tengo nata, que uso?',
]

// Anthropic pricing reference (per 1M tokens, USD).
//   - input: regular input tokens
//   - cacheWrite: 25% premium over input on first write (Anthropic docs)
//   - cacheRead: 10% of input price on every cache hit
//   - output: completion tokens
const PRICING = {
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
} as const

const USER_CONTEXT = 'Usuario: tester, 30 anos, 75kg, 175cm, actividad moderada'

interface RunResult {
  totalIn: number
  totalOut: number
  totalCacheRead: number
  totalCacheCreate: number
  totalCost: number
}

async function runMode(
  anthropic: Anthropic,
  model: keyof typeof PRICING,
  systemPrompt: string,
  tools: ReturnType<typeof getToolDefinitions>,
  enableCaching: boolean,
): Promise<RunResult> {
  const price = PRICING[model]
  const result: RunResult = {
    totalIn: 0,
    totalOut: 0,
    totalCacheRead: 0,
    totalCacheCreate: 0,
    totalCost: 0,
  }

  const cachedSystem = enableCaching
    ? [{ type: 'text' as const, text: systemPrompt, cache_control: { type: 'ephemeral' as const } }]
    : (systemPrompt as any)

  const cachedTools = enableCaching
    ? tools.map((t, i) =>
        i === tools.length - 1
          ? { ...t, cache_control: { type: 'ephemeral' as const } }
          : t,
      )
    : tools

  for (const prompt of PROMPTS) {
    const r = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: cachedSystem,
      messages: [{ role: 'user', content: prompt }],
      tools: cachedTools as any,
    })

    const u = r.usage as any
    const inT = u.input_tokens as number
    const outT = u.output_tokens as number
    const cacheRead = (u.cache_read_input_tokens ?? 0) as number
    const cacheCreate = (u.cache_creation_input_tokens ?? 0) as number

    const cost =
      (inT / 1_000_000) * price.input +
      (cacheRead / 1_000_000) * price.cacheRead +
      (cacheCreate / 1_000_000) * price.cacheWrite +
      (outT / 1_000_000) * price.output

    result.totalIn += inT
    result.totalOut += outT
    result.totalCacheRead += cacheRead
    result.totalCacheCreate += cacheCreate
    result.totalCost += cost

    console.log(
      `  "${prompt}" → in=${inT} cache_read=${cacheRead} cache_create=${cacheCreate} out=${outT} cost=$${cost.toFixed(5)}`,
    )
  }
  return result
}

async function main() {
  if (!env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY in .env first.')
    process.exit(1)
  }
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const systemPrompt = buildSystemPrompt(USER_CONTEXT)
  const tools = getToolDefinitions()

  console.log('───────────────────────────────────────────────────────────────')
  console.log(`System prompt size: ${systemPrompt.length} chars`)
  console.log(`Tool definitions: ${tools.length}`)
  console.log('───────────────────────────────────────────────────────────────')

  for (const model of ['claude-haiku-4-5-20251001', 'claude-sonnet-4-5-20250929'] as const) {
    console.log(`\n## ${model}`)

    console.log('\n  ── No caching (baseline) ──')
    const baseline = await runMode(anthropic, model, systemPrompt, tools, false)

    console.log('\n  ── With prompt caching ──')
    const cached = await runMode(anthropic, model, systemPrompt, tools, true)

    const savings = baseline.totalCost - cached.totalCost
    const savingsPct = (savings / baseline.totalCost) * 100
    console.log(
      `\n  ── Summary ──\n  baseline avg/turn:  $${(baseline.totalCost / PROMPTS.length).toFixed(5)}\n  cached avg/turn:    $${(cached.totalCost / PROMPTS.length).toFixed(5)}\n  savings:            ${savingsPct.toFixed(1)}%`,
    )
  }
  console.log('───────────────────────────────────────────────────────────────')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
