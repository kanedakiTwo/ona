/**
 * PRO-232: how long the calls with a time limit take on the product model
 * (`CLAUDE_MODEL`, Opus 5.5), against their limit. Past the limit the caller
 * falls back to the version without AI, silently, so a limit that is too
 * tight means «Afina tu menú» or the menu fit line quietly stop using Claude.
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @ona/api exec tsx scripts/measureClaudeLatency.ts [--runs=5]
 *
 * Needs no database and sends nothing to anyone; synthetic inputs only.
 * Costs a few cents (low effort, short answers). Prints p50 / max seconds per
 * call and fails (exit 1) if any run went past its limit. The guided
 * WhatsApp texts are measured by `scripts/replayGuidedBrief.ts`, and Mimo's
 * seconds per turn by `scripts/replayWhatsAppTurns.ts` (`secs` per turn).
 */
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODEL } from '../src/config/models.js'
import { setCostSinkForTests } from '../src/services/costLedger.js'
import { analyseTasteReason, pickNextWithClaude, TASTE_AI_TIMEOUT_MS } from '../src/services/tasteAI.js'
import type { TasteRecipe } from '../src/services/tasteDeck.js'

if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required')
const runs = Math.max(1, Number(process.argv.find((a) => a.startsWith('--runs='))?.slice(7) ?? 5))
setCostSinkForTests(async () => {}) // no DB: the cost row is not stored

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
let last = 0
const timed = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
  const t0 = Date.now()
  const res = await client.messages.create(p)
  last = (Date.now() - t0) / 1000
  return res
}

const DISHES = ['Lentejas estofadas', 'Pollo al horno con patatas', 'Merluza en salsa verde', 'Crema de calabacín', 'Arroz a la cubana', 'Tortilla de patatas', 'Garbanzos con espinacas', 'Salmón a la plancha', 'Macarrones con tomate', 'Ensalada de quinoa']
const recipe = (name: string, i: number): TasteRecipe => ({
  id: `r-${i}`,
  name,
  imageUrl: null,
  prepTime: 15,
  totalTime: 30 + i,
  tags: [],
  equipment: [],
  course: 'main',
  ingredients: [{ ingredientName: name.split(' ')[0].toLowerCase(), quantity: 200, unit: 'g' }],
})
const candidates = Array.from({ length: 60 }, (_, i) => recipe(`${DISHES[i % DISHES.length]} ${Math.floor(i / DISHES.length) + 1}`, i))

const cases: Array<{ name: string; limitMs: number; run: () => Promise<unknown> }> = [
  {
    name: 'Afina tu menú · siguiente tanda (taste_next)',
    limitMs: TASTE_AI_TIMEOUT_MS,
    run: () => pickNextWithClaude({ candidates, answered: candidates.slice(0, 8).map((r, i) => ({ recipe: r, verdict: i % 2 ? 'like' : 'dislike' })), limit: 10 }, { create: timed, timeoutMs: 120_000 }),
  },
  {
    name: 'Afina tu menú · motivo (taste_reason)',
    limitMs: TASTE_AI_TIMEOUT_MS,
    run: () => analyseTasteReason('no tengo horno y a mediodía comemos fuera', 'Pollo al horno', { create: timed, timeoutMs: 120_000 }),
  },
]

let over = false
console.log(`Modelo: ${CLAUDE_MODEL} · ${runs} vueltas por llamada`)
for (const c of cases) {
  const secs: number[] = []
  for (let i = 0; i < runs; i++) {
    await c.run()
    secs.push(last)
  }
  secs.sort((a, b) => a - b)
  const p50 = secs[Math.floor(secs.length / 2)]
  const max = secs[secs.length - 1]
  const bad = max * 1000 > c.limitMs
  over ||= bad
  console.log(`${bad ? '✗' : '✓'} ${c.name}: p50 ${p50.toFixed(1)} s · máx ${max.toFixed(1)} s · límite ${(c.limitMs / 1000).toFixed(0)} s`)
}
process.exit(over ? 1 : 0)
