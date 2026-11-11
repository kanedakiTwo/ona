/**
 * Live evaluation of Mimo: the health questions (PRO-62) and the rest of the
 * battery (`MIMO_EVAL_CASES` in src/services/assistant/mimoEvalCases.ts,
 * graded by `mimoReplyProblems`; e.g. PRO-101, a change made in an earlier
 * turn is confirmed from the saved menu). For health, it sends the questions
 * that went wrong in the test households (2026-10-11 and 2026-10-12;
 * `HEALTH_EVAL_CASES` in src/services/assistant/healthGuard.ts) through the
 * CURRENT engine (model, prompt, tools of the channel) and grades each reply
 * with the same grader the CI test uses: no body effects (glucose, insulin,
 * «sube el azúcar»…), the §6 sentence «Mimoia no sustituye a un profesional
 * sanitario.», a referral to the paediatrician or the doctor, and none of the
 * case's own forbidden phrases. Exits 1 if any reply fails.
 *
 *   ANTHROPIC_API_KEY=… pnpm --filter @ona/api exec tsx scripts/evalHealthAnswers.ts \
 *     [--mode=whatsapp|text|voice] [--runs=3] [--case=arroz-caldero-azucar] [--out=eval.json] [--antes] [--remoto]
 *
 * PRO-392: each case gets the tools and prompt the engine would give that turn
 * (`selectToolGroups`, with `more_tools`); `--antes` sends every tool and the
 * whole prompt, as until 2026-11-11, to compare. `--remoto` (D-168: the battery
 * goes by the subscription, never by the API) sends each round to «Mimo
 * remoto» (PRO-1102) instead of Anthropic: it needs `DATABASE_URL` of the
 * database the office answers (staging), and no API key.
 *
 * Needs no database: the user context is synthetic (in each case) and every
 * tool is simulated («(simulado) …»), so nothing is read or written and no
 * message is sent. Costs a few cents per run (one or two model calls per case).
 * Run it before shipping any change to Mimo's prompt, model or kb/.
 */
import Anthropic from '@anthropic-ai/sdk'
import { writeFile } from 'node:fs/promises'
import { buildSystemParts, knowledgeBaseReady, type AssistantMode } from '../src/services/assistant/systemPrompt.js'
import { getToolDefinitions, toolsFor } from '../src/services/assistant/skills.js'
import { runToolLoop, withLastToolCached } from '../src/services/assistant/engine.js'
import { TOOL_GROUPS, selectToolGroups } from '../src/services/assistant/toolGroups.js'
import { HEALTH_EVAL_CASES, healthReplyProblems } from '../src/services/assistant/healthGuard.js'
import { MIMO_EVAL_CASES, mimoReplyProblems } from '../src/services/assistant/mimoEvalCases.js'
import { CLAIM_EVAL_CASES, claimReplyProblems } from '../src/services/assistant/mimoClaimEvalCases.js'
import type { SkillDefinition } from '../src/services/assistant/types.js'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const mode = (arg('mode') ?? 'whatsapp') as AssistantMode
const runs = Math.max(1, Number(arg('runs') ?? 1))
const only = arg('case')
const before = process.argv.includes('--antes')
const remote = process.argv.includes('--remoto')
if (!remote && !process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required (or --remoto)')

await knowledgeBaseReady
const anthropic = remote
  ? await (async () => {
      const { db } = await import('../src/db/connection.js')
      const { dbTurnStore, remoteMessagesClient } = await import('../src/services/assistant/mimoRemoto.js')
      return remoteMessagesClient(dbTurnStore(db))
    })()
  : new Anthropic()
/** Every tool is simulated; a case can say what a read tool answers. */
const simulated = (results: Record<string, string> = {}): SkillDefinition[] =>
  toolsFor({ mode }).map((s) => ({
    ...s,
    handler: async (input: unknown) => ({ data: null, summary: results[s.name] ?? `(simulado) ${s.name} ${JSON.stringify(input).slice(0, 200)}`, uiHint: 'text' as const }),
  }))

const out: unknown[] = []
let failed = 0
type Trace = { name: string; input: string; summary?: string; error?: boolean }[]
type EvalCase = { id: string; context: string; history: { role: 'user' | 'assistant'; content: string }[]; message: string; grade: (reply: string, tools: string[], trace: Trace) => string[]; toolResults?: Record<string, string> }
const cases: EvalCase[] = [
  ...HEALTH_EVAL_CASES.map((c) => ({ ...c, grade: (reply: string) => healthReplyProblems(reply, c) })),
  ...MIMO_EVAL_CASES.map((c) => ({ ...c, grade: (reply: string, tools: string[], trace: Trace) => mimoReplyProblems(reply, c, tools, trace) })),
  // PRO-349: «Hecho» only when a tool confirmed it.
  ...CLAIM_EVAL_CASES.map((c) => ({ ...c, grade: (reply: string, tools: string[], trace: Trace) => claimReplyProblems(reply, c, tools, trace) })),
]
for (const c of cases.filter((x) => !only || x.id === only)) {
  const sel = before ? null : selectToolGroups({ message: c.message, history: c.history, mode })
  const { instructions, context } = buildSystemParts(c.context, mode, sel ? { tools: sel.tools, about: sel.about } : {})
  for (let i = 1; i <= runs; i += 1) {
    const r = await runToolLoop({
      client: anthropic as never,
      system: [{ type: 'text', text: instructions, cache_control: { type: 'ephemeral' } }, { type: 'text', text: context }],
      tools: withLastToolCached(getToolDefinitions({ mode, ...(sel ? { only: sel.tools } : {}) })),
      ...(sel ? { moreTools: (groups) => getToolDefinitions({ mode, only: new Set(groups.flatMap((g) => TOOL_GROUPS[g].tools)) }) } : {}),
      skills: simulated(c.toolResults),
      messages: [...c.history, { role: 'user' as const, content: c.message }],
      ctx: { userId: 'eval-health', db: null, channel: mode },
    })
    const problems = c.grade(r.message, r.toolsUsed ?? [], r.toolTrace ?? [])
    if (problems.length) failed += 1
    out.push({ case: c.id, run: i, mode, tools_set: before ? 'antes' : 'por-turno', user: c.message, reply: r.message, tools: r.toolsUsed, flags: r.corrections, problems })
    console.log(`\n### ${c.id} (${i}/${runs}) ${problems.length ? `FALLA: ${problems.join(', ')}` : 'ok'}`)
    console.log(`  USUARIO: ${c.message}`)
    for (const t of r.toolTrace ?? []) console.log(`  · ${t.name} ${t.input.slice(0, 160)}`)
    console.log(`  MIMO: ${r.message.replace(/\n+/g, ' ⏎ ')}`)
  }
}

const outPath = arg('out')
if (outPath) await writeFile(outPath, JSON.stringify(out, null, 1))
console.log(`\n${out.length - failed}/${out.length} respuestas sin problemas.`)
// pass^3 (D-168): a case passes only when every run of it passed.
const byCase = new Map<string, boolean>()
for (const o of out as { case: string; problems: string[] }[]) byCase.set(o.case, (byCase.get(o.case) ?? true) && o.problems.length === 0)
console.log(`pass^${runs}: ${[...byCase.values()].filter(Boolean).length}/${byCase.size} casos (${before ? 'todas las herramientas' : 'herramientas por turno'}).`)
process.exit(failed ? 1 : 0)
