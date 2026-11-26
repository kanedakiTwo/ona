/**
 * PRO-1304 · Una pasada del examen fijo de Mimo: cada caso por el motor de
 * ahora (`runToolLoop` con el bloque fijo del canal y las herramientas
 * simuladas), el juez y el corrector de `mimoExam.ts`. Lo llama
 * `scripts/mimoExam.ts` con «Mimo remoto» (o la API) y los tests con un
 * cliente falso.
 */
import { CLAUDE_MODEL } from '../../config/models.js'
import { addAnthropicUsage, EMPTY_USAGE, type TokenUsage } from '../advisorBudget.js'
import { buildFixedBlock, runToolLoop } from './engine.js'
import {
  EXAM_CRITERIA,
  JUDGE_SYSTEM,
  caseMean,
  codeAnswerOf,
  codeAnsweredScores,
  codeChecks,
  combineScores,
  estimateTurnUsage,
  examContext,
  examHistory,
  examMode,
  examOnboarding,
  judgePrompt,
  parseJudge,
  simulatedToolSummary,
  speedScore,
  summarizeExam,
  usageEur,
  type CaseResult,
  type RecordedRound,
  type TurnRun,
} from './mimoExam.js'
import type { ExamCase } from './mimoExamCases.js'
import { buildSystemParts } from './systemPrompt.js'
import { toolsFor } from './skills.js'
import type { SkillDefinition, ToolTrace } from './types.js'

export interface MessagesLike {
  messages: { create(args: any, opts?: any): Promise<any> }
}

export interface ExamRunOptions {
  /** Contesta las rondas de Mimo y al juez («Mimo remoto» o la API). */
  client: MessagesLike
  /** Con «Mimo remoto»: sin tiempo (mide a la oficina) y tokens estimados. */
  remote: boolean
  eurPerUsd: number
  concurrency?: number
  onCase?: (r: CaseResult) => void
}

/** El cliente de un caso: el mismo, guardando cada ronda (para los tokens). */
function recording(base: MessagesLike) {
  const rounds: RecordedRound[] = []
  const client: MessagesLike = {
    messages: {
      async create(args: any, opts?: any) {
        const response = await base.messages.create(args, opts)
        rounds.push({ request: args, response })
        return response
      },
    },
  }
  return { rounds, client }
}

const simulated = (c: ExamCase, mode: 'whatsapp' | 'text'): SkillDefinition[] =>
  toolsFor({ mode }).map((s) => ({
    ...s,
    handler: async (input: unknown) => ({ data: null, summary: simulatedToolSummary(c, s.name, input), uiHint: 'text' as const }),
  }))

async function judge(client: MessagesLike, c: ExamCase, run: TurnRun, trace: readonly ToolTrace[]) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: JUDGE_SYSTEM,
      messages: [{ role: 'user', content: judgePrompt(c, run, [...trace]) }],
    })
    const text = (Array.isArray(res?.content) ? res.content : [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
    const verdict = parseJudge(text)
    if (verdict) return verdict
  }
  throw new Error('el juez no contestó con el JSON pedido')
}

const tokensOf = (u: TokenUsage) => ({
  entrada: u.inputTokens,
  cacheEscrita: u.cacheWriteTokens,
  cacheEscrita1h: u.cacheWrite1hTokens ?? 0,
  cacheLeida: u.cacheReadTokens,
  salida: u.outputTokens,
})

export async function runExamCase(c: ExamCase, opts: ExamRunOptions): Promise<CaseResult> {
  const head = { id: c.id, tipo: c.tipo, dificultad: c.dificultad, criterio_principal: c.criterio_principal, sin_modelo: c.sin_modelo, mensaje: c.mensaje }
  const zero = { tokens: tokensOf(EMPTY_USAGE), precioEur: 0, precioCalienteEur: 0 }
  const porCodigo = codeAnswerOf(c)
  if (porCodigo) {
    const notas = codeAnsweredScores()
    return { ...head, porCodigo, respuesta: '', herramientas: [], rondas: 0, ms: 0, notas, nota: caseMean(notas), porque: { rapido: `lo contesta el código (${porCodigo})` }, comprobaciones: [], ...zero }
  }
  const mode = examMode(c)
  const onboarding = examOnboarding(c)
  const fixed = buildFixedBlock({ mode, onboarding })
  const { context } = buildSystemParts(examContext(c), mode, { onboarding })
  const rec = recording(opts.client)
  const t0 = Date.now()
  try {
    const r = await runToolLoop({
      client: rec.client as never,
      system: [fixed.instructions, { type: 'text', text: context }],
      tools: fixed.tools,
      skills: simulated(c, mode),
      messages: [...examHistory(c), { role: 'user' as const, content: c.mensaje }],
      ctx: { userId: 'mimo-examen', db: null, channel: mode },
    })
    const run: TurnRun = {
      porCodigo: null,
      reply: r.message,
      tools: r.toolsUsed ?? [],
      rondas: rec.rounds.length,
      ms: opts.remote ? null : Date.now() - t0,
      flags: r.corrections ?? [],
    }
    const verdict = await judge(opts.client, c, run, r.toolTrace ?? [])
    const checks = codeChecks(c, run)
    const speed = speedScore(c, run)
    const notas = combineScores(verdict.scores, checks, speed.score)
    // Con «Mimo remoto» no hay usage: se estima; contra la API, el de Anthropic.
    const real = !opts.remote && rec.rounds.every((x) => x.response?.usage)
    const usage = real
      ? rec.rounds.reduce<TokenUsage>((u, x) => addAnthropicUsage(u, x.response.usage as never), { ...EMPTY_USAGE })
      : estimateTurnUsage(rec.rounds, { warm: false })
    return {
      ...head,
      porCodigo: null,
      respuesta: r.message,
      herramientas: run.tools,
      rondas: run.rondas,
      ms: run.ms,
      notas,
      nota: caseMean(notas),
      porque: { ...verdict.why, rapido: speed.why },
      comprobaciones: checks.map((ch) => `${ch.criterion} ≤ ${ch.cap}: ${ch.why}`),
      tokens: tokensOf(usage),
      precioEur: usageEur(usage, opts.eurPerUsd),
      precioCalienteEur: real ? null : usageEur(estimateTurnUsage(rec.rounds, { warm: true }), opts.eurPerUsd),
    }
  } catch (err: any) {
    const empty = Object.fromEntries(EXAM_CRITERIA.map((k) => [k, null])) as CaseResult['notas']
    return { ...head, porCodigo: null, respuesta: '', herramientas: [], rondas: rec.rounds.length, ms: null, notas: empty, nota: 0, porque: {}, comprobaciones: [], ...zero, error: String(err?.message ?? err) }
  }
}

/** Todos los casos, `concurrency` a la vez (la oficina contesta dos rondas a la vez), en su orden. */
export async function runExam(cases: readonly ExamCase[], opts: ExamRunOptions) {
  const results: CaseResult[] = new Array(cases.length)
  let next = 0
  const workers = Math.max(1, Math.min(opts.concurrency ?? 2, cases.length))
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let i = next++; i < cases.length; i = next++) {
        results[i] = await runExamCase(cases[i], opts)
        opts.onCase?.(results[i])
      }
    }),
  )
  return { resumen: summarizeExam(results), casos: results }
}
