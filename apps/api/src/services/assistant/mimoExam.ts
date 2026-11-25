/**
 * PRO-1304 · El corrector del examen fijo de Mimo (`MIMO_EXAM_CASES`,
 * mimoExamCases.ts; specs/advisor.md → «Examen fijo de Mimo»). Puro: lo usa
 * `scripts/mimoExam.ts`, que pasa cada caso por el motor de verdad (con las
 * herramientas simuladas) y por un juez, y lo prueban los tests sin modelo.
 *
 * Cada respuesta saca de 0 a 2 en los seis criterios del examen del histórico:
 *   - `rapido`, solo por código: rondas de modelo (y el tiempo, cuando no va
 *     por «Mimo remoto», que mide a la oficina y no a Mimo); lo que debía
 *     contestar el código y pasó por el modelo, 1 como mucho;
 *   - los otros cinco, el juez (por la suscripción, como Mimo), con el tope
 *     que pongan las comprobaciones de código: herramientas esperadas sin
 *     llamar (`hecho_entero`), largo o enlace sin pedir (`corto_sin_relleno`),
 *     «hecho» sin ninguna herramienta que cambie nada (`verdad_comprobada`).
 *   `respeta_la_casa`, `platos_con_sentido` y `verdad_comprobada` pueden no
 *   aplicar (null): no cuentan en la media.
 *
 * El precio: con «Mimo remoto» no hay `usage` (no se paga nada), así que los
 * tokens se estiman de lo que se manda y se recibe (≈3,5 caracteres por token,
 * como `scripts/mimoInputTokens.ts`) con la caché del motor: la primera ronda
 * escribe todo (lo fijo, con la hora de caché), las siguientes leen lo de la
 * anterior y escriben lo nuevo. `precioEur` es con lo fijo frío (tras una
 * pausa) y `precioCalienteEur` con lo fijo ya en caché. Contra la API, los
 * tokens son los que devuelve Anthropic.
 */
import { ASSISTANT_USD_PER_MTOK, EMPTY_USAGE, type TokenUsage } from '../advisorBudget.js'
import { isCourtesyOnly } from '../whatsapp/inbound.js'
import { ONA_STARTED_MARKER } from '../whatsapp/history.js'
import { CHECKIN_BUTTONS } from '../whatsapp/proactive.js'
import { checkinReplyIdOfEmoji } from '../whatsapp/checkinButtons.js'
import { claimsAction, READ_ONLY_TOOLS } from './claims.js'
import { recognizeCodeIntent } from './codeReply.js'
import type { ExamCase, ExamCriterion } from './mimoExamCases.js'

export const EXAM_CRITERIA: readonly ExamCriterion[] = [
  'hecho_entero',
  'respeta_la_casa',
  'platos_con_sentido',
  'corto_sin_relleno',
  'rapido',
  'verdad_comprobada',
]

/** Lo que pone el juez (todos menos `rapido`, que es solo de código). */
export const JUDGED_CRITERIA: readonly ExamCriterion[] = EXAM_CRITERIA.filter((c) => c !== 'rapido')
/** Los que pueden no aplicar a un caso (una cortesía no tiene platos). */
const MAY_NOT_APPLY: ReadonlySet<ExamCriterion> = new Set(['respeta_la_casa', 'platos_con_sentido', 'verdad_comprobada'])

export const CRITERION_LABELS: Record<ExamCriterion, string> = {
  hecho_entero: 'Hecho de verdad y entero, a la primera',
  respeta_la_casa: 'Respeta la casa: nada contradice lo ya dicho y lo nuevo se guarda',
  platos_con_sentido: 'Platos con sentido para esa casa y ese día',
  corto_sin_relleno: 'Corto y sin relleno: el resultado y, como mucho, un paso siguiente',
  rapido: 'Rápido: menos de 15 segundos lo sencillo y menos de un minuto un menú',
  verdad_comprobada: 'Verdad comprobada: lo que afirma lo ha leído, y dice lo que no pudo hacer',
}

export type Score = 0 | 1 | 2
export type Scores = Record<ExamCriterion, Score | null>

// ─── El hogar de partida ─────────────────────────────────

/** `app` → el chat de la web; `whatsapp`, el suyo. */
export function examMode(c: ExamCase): 'whatsapp' | 'text' {
  return c.canal === 'app' ? 'text' : 'whatsapp'
}

/** El alta por WhatsApp que tiene que cerrar con `complete_onboarding` lleva su bloque del prompt. */
export function examOnboarding(c: ExamCase): boolean {
  return c.tipo === 'alta' && c.herramientas.includes('complete_onboarding')
}

/** El contexto del hogar, como el que da `loadUserContext` (inventado: el caso). */
export function examContext(c: ExamCase): string {
  return [
    'Hogar (caso del examen fijo, datos inventados):',
    c.hogar,
    '',
    'Situación ahora (menú, catálogo y lo último que ha pasado):',
    c.situacion,
  ].join('\n')
}

/**
 * El historial como lo monta el motor (`buildChatHistory`): turnos seguidos
 * del mismo lado juntos, «(Mimo me ha escrito primero)» si abre Mimo, y sin
 * un mensaje del hogar al final que no tuvo respuesta.
 */
export function examHistory(c: ExamCase): { role: 'user' | 'assistant'; content: string }[] {
  const merged: { role: 'user' | 'assistant'; content: string }[] = []
  for (const h of c.historial) {
    const role = h.de === 'mimo' ? 'assistant' : 'user'
    const last = merged[merged.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n\n${h.texto}`
    else merged.push({ role, content: h.texto })
  }
  if (merged[0]?.role === 'assistant') merged.unshift({ role: 'user', content: ONA_STARTED_MARKER })
  while (merged.length > 0 && merged[merged.length - 1].role === 'user') merged.pop()
  return merged
}

/** Lo que contesta una herramienta simulada: las de leer, la situación del caso; las demás, «Hecho». */
export function simulatedToolSummary(c: ExamCase, name: string, input: unknown): string {
  const args = JSON.stringify(input ?? {}).slice(0, 300)
  if (READ_ONLY_TOOLS.has(name)) return `(simulado) ${name} ${args}. Lo que hay en la cuenta ahora: ${c.situacion}`
  return `Hecho (simulado): ${name} ${args}`
}

/** Los botones del aviso de la cena: los de ahora y el «Sí, la hice» del anterior (`checkin:yes`, que sigue valiendo). */
const CHECKIN_TITLES: ReadonlySet<string> = new Set([...CHECKIN_BUTTONS.map((b) => b.title as string), 'Sí, la hice'])

/**
 * El código que contestaría este mensaje sin el modelo, o null (→ modelo):
 * «ver el menú» y los pasos del modo cocina (`recognizeCodeIntent`), una
 * cortesía sin pregunta pendiente (`isCourtesyOnly`) y los botones del aviso
 * de la cena (sin mirar si llega a tiempo). Los demás botones van todavía
 * al modelo.
 */
export function codeAnswerOf(c: ExamCase): string | null {
  const message = c.mensaje.trim()
  const lastMimo = [...c.historial].reverse().find((h) => h.de === 'mimo')?.texto ?? ''
  const intent = recognizeCodeIntent(message, { cooking: c.tipo === 'receta_pasos' && c.canal === 'app' })
  if (intent) return intent.kind
  if (isCourtesyOnly(message) && !/\?\s*(\[[^\]]*\])?\s*$/.test(lastMimo)) return 'cortesia'
  const button = message.match(/^\[botón\]\s*(.+)$/)?.[1]?.trim() ?? null
  const answersCheckin = /cena|la hab[eé]is hecho|la hiciste|cay[oó]/i.test(lastMimo)
  if (button && answersCheckin && CHECKIN_TITLES.has(button)) return 'aviso_cena'
  if (checkinReplyIdOfEmoji(message) && answersCheckin) return 'aviso_cena'
  return null
}

// ─── Comprobaciones de código ────────────────────────────

/** Herramientas que hacen lo mismo que la esperada (el examen avisa de dos casos así). */
const EQUIVALENT_TOOLS: Record<string, string[]> = {
  get_todays_menu: ['get_weekly_menu'],
  get_weekly_menu: ['get_todays_menu'],
  search_recipes: ['suggest_recipes', 'get_my_recipes'],
  suggest_recipes: ['search_recipes', 'cook_with_what_i_have'],
  cook_with_what_i_have: ['suggest_recipes', 'search_recipes'],
  log_cooked: ['mark_meal_eaten'],
  mark_meal_eaten: ['log_cooked'],
  swap_meal: ['add_dish'],
  add_dish: ['swap_meal'],
  set_meal_note: ['add_freezer_dish', 'set_day_skipped'],
  note_ficha_fact: ['update_memory'],
  update_memory: ['note_ficha_fact'],
}

/** Cuántas de las herramientas esperadas se llamaron (ella o una equivalente). */
export function expectedToolsCalled(expected: readonly string[], called: readonly string[]): number {
  const set = new Set(called)
  return expected.filter((t) => set.has(t) || (EQUIVALENT_TOOLS[t] ?? []).some((e) => set.has(e))).length
}

/** Caracteres de una respuesta que da 2 y que da 1, por dificultad. */
export const LENGTH_LIMITS: Record<ExamCase['dificultad'], [number, number]> = {
  trivial: [400, 800],
  normal: [800, 1400],
  dificil: [1400, 2400],
}

const URL_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|es)\/\S+/i
const LINK_ASKED_RE = /enlace|link|url|web|p[aá]gina/i
const MENU_TYPES = new Set(['generar_menu', 'alta'])

/** Lo que pasó en el turno, lo que necesitan las comprobaciones de código. */
export interface TurnRun {
  /** El código contestó sin modelo (`codeAnswerOf`). */
  porCodigo: string | null
  reply: string
  /** Herramientas llamadas, en orden. */
  tools: string[]
  /** Rondas de modelo del turno. */
  rondas: number
  /** Milisegundos del turno; null con «Mimo remoto» (mide a la oficina). */
  ms: number | null
  /** Marcas del motor (`unverified_claim`, `partial_claim`, `truncated`…). */
  flags: string[]
}

export interface CodeCheck {
  criterion: ExamCriterion
  /** La nota más alta que puede sacar ese criterio. */
  cap: Score
  why: string
}

/** `rapido`, solo por código. */
export function speedScore(c: ExamCase, run: TurnRun): { score: Score; why: string } {
  if (run.porCodigo) return { score: 2, why: `lo contesta el código (${run.porCodigo}), sin modelo` }
  const limit = MENU_TYPES.has(c.tipo) ? 4 : 2
  let score: Score = run.rondas <= limit ? 2 : run.rondas <= limit + 2 ? 1 : 0
  let why = `${run.rondas} rondas de modelo (2 si son ${limit} o menos)`
  if (run.ms !== null) {
    const [ok, slow] = MENU_TYPES.has(c.tipo) ? [60_000, 120_000] : [15_000, 30_000]
    const byTime: Score = run.ms <= ok ? 2 : run.ms <= slow ? 1 : 0
    if (byTime < score) {
      score = byTime
      why = `${Math.round(run.ms / 1000)} s (2 si son ${ok / 1000} s o menos)`
    }
  }
  if (c.sin_modelo && score > 1) {
    score = 1
    why = `${why}; lo tenía que contestar el código y pasó por el modelo`
  }
  return { score, why }
}

/** Los topes que ponen las comprobaciones de código a los criterios del juez. */
export function codeChecks(c: ExamCase, run: TurnRun): CodeCheck[] {
  const checks: CodeCheck[] = []
  if (c.herramientas.length > 0 && !run.porCodigo) {
    const hit = expectedToolsCalled(c.herramientas, run.tools)
    if (hit === 0) checks.push({ criterion: 'hecho_entero', cap: 0, why: `no llamó ninguna de las herramientas esperadas (${c.herramientas.join(', ')})` })
    else if (hit / c.herramientas.length < 0.5) checks.push({ criterion: 'hecho_entero', cap: 1, why: `llamó ${hit} de ${c.herramientas.length} herramientas esperadas (${c.herramientas.join(', ')})` })
  }
  const [two, one] = LENGTH_LIMITS[c.dificultad]
  const len = run.reply.length
  if (len > one) checks.push({ criterion: 'corto_sin_relleno', cap: 0, why: `${len} caracteres (más de ${one})` })
  else if (len > two) checks.push({ criterion: 'corto_sin_relleno', cap: 1, why: `${len} caracteres (más de ${two})` })
  if (URL_RE.test(run.reply) && !LINK_ASKED_RE.test(c.mensaje)) checks.push({ criterion: 'corto_sin_relleno', cap: 1, why: 'un enlace que nadie pidió' })
  const changed = run.tools.some((t) => !READ_ONLY_TOOLS.has(t))
  if (!run.porCodigo && claimsAction(run.reply) && !changed) checks.push({ criterion: 'verdad_comprobada', cap: 0, why: 'dice que lo ha hecho sin ninguna herramienta que cambie nada' })
  else if (run.flags.includes('unverified_claim') || run.flags.includes('partial_claim')) checks.push({ criterion: 'verdad_comprobada', cap: 1, why: 'el motor marcó un «hecho» sin confirmar' })
  return checks
}

// ─── El juez ─────────────────────────────────────────────

export const JUDGE_SYSTEM = `Eres el corrector del examen fijo de Mimo, el asistente de cocina de Mimoia. Recibes un caso (el hogar, la situación, el mensaje, lo que una respuesta correcta debe hacer y lo que no) y lo que hizo Mimo: las herramientas que llamó (simuladas: «Hecho (simulado)» cuenta como hecho de verdad) y su respuesta.

Pon a la respuesta una nota de 0 a 2 en cada criterio:
- hecho_entero: ${CRITERION_LABELS.hecho_entero}.
- respeta_la_casa: ${CRITERION_LABELS.respeta_la_casa}.
- platos_con_sentido: ${CRITERION_LABELS.platos_con_sentido}.
- corto_sin_relleno: ${CRITERION_LABELS.corto_sin_relleno}.
- verdad_comprobada: ${CRITERION_LABELS.verdad_comprobada}.

Cómo se pone la nota:
- 2: cumple en ese criterio todo lo de «debe» y nada de «no debe».
- 1: un fallo menor (le falta un detalle, una frase de más, una duda razonable).
- 0: falla en lo principal de ese criterio o hace algo de «no debe».
- null: el criterio no aplica a este caso (solo respeta_la_casa, platos_con_sentido y verdad_comprobada; por ejemplo, una cortesía no tiene platos).
Juzga solo con lo que ves: si dice que algo está hecho y no hay una herramienta que lo haga, no está hecho. No premies lo que no se pidió. Sé igual de estricto en todos los casos.

Contesta solo con un objeto JSON, sin nada antes ni después:
{"hecho_entero":{"nota":2,"porque":"…"},"respeta_la_casa":{"nota":2,"porque":"…"},"platos_con_sentido":{"nota":null,"porque":"…"},"corto_sin_relleno":{"nota":1,"porque":"…"},"verdad_comprobada":{"nota":2,"porque":"…"}}
Cada «porque», una frase corta.`

/** Lo que lee el juez de un caso. */
export function judgePrompt(c: ExamCase, run: TurnRun, trace: { name: string; input: string; summary?: string }[]): string {
  const lines = [
    `Caso ${c.id} (${c.tipo}, ${c.dificultad}, por ${c.canal === 'app' ? 'la app' : 'WhatsApp'}). Criterio principal: ${c.criterio_principal}.`,
    '',
    `Hogar: ${c.hogar}`,
    `Situación: ${c.situacion}`,
  ]
  if (c.historial.length > 0) {
    lines.push('', 'Conversación justo antes:')
    for (const h of c.historial) lines.push(`- ${h.de === 'mimo' ? 'Mimo' : 'Hogar'}: ${h.texto}`)
  }
  lines.push('', `Mensaje del hogar: ${c.mensaje}`, '', 'Una respuesta correcta debe:')
  for (const d of c.debe) lines.push(`- ${d}`)
  lines.push('', 'Y no debe:')
  for (const d of c.no_debe) lines.push(`- ${d}`)
  lines.push('', `Herramientas que se esperaban: ${c.herramientas.length ? c.herramientas.join(', ') : 'ninguna'}.`)
  if (c.sin_modelo) lines.push('Lo correcto era que lo contestase el código, sin el modelo; aquí lo contestó el modelo.')
  lines.push('', `Lo que hizo Mimo (${run.rondas} rondas de modelo):`)
  if (trace.length === 0) lines.push('- No llamó ninguna herramienta.')
  for (const t of trace) lines.push(`- ${t.name} ${t.input.slice(0, 400)}${t.summary ? ` → ${String(t.summary).slice(0, 200)}` : ''}`)
  lines.push('', 'Su respuesta:', run.reply || '(vacía)')
  return lines.join('\n')
}

export interface JudgeVerdict {
  scores: Record<Exclude<ExamCriterion, 'rapido'>, Score | null>
  why: Partial<Record<ExamCriterion, string>>
}

/** El JSON del juez, o null si no se entiende (el script lo vuelve a pedir una vez). */
export function parseJudge(text: string): JudgeVerdict | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let raw: any
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  const scores = {} as JudgeVerdict['scores']
  const why: JudgeVerdict['why'] = {}
  for (const k of JUDGED_CRITERIA as Exclude<ExamCriterion, 'rapido'>[]) {
    const v = raw?.[k]
    const nota = v && typeof v === 'object' ? v.nota : v
    if (nota === null || nota === undefined) {
      if (!MAY_NOT_APPLY.has(k)) return null
      scores[k] = null
    } else if (nota === 0 || nota === 1 || nota === 2) {
      scores[k] = nota
    } else {
      return null
    }
    if (v && typeof v.porque === 'string') why[k] = v.porque
  }
  return { scores, why }
}

/** Las notas del caso: el juez con los topes del código y `rapido` del código. */
export function combineScores(judge: JudgeVerdict['scores'], checks: readonly CodeCheck[], speed: Score): Scores {
  const out = { ...judge, rapido: speed } as Scores
  for (const ch of checks) {
    const v = out[ch.criterion]
    if (v !== null && ch.cap < v) out[ch.criterion] = ch.cap
  }
  return out
}

/** Lo que contestó el código no lo ve el juez: sus pruebas lo cubren. */
export function codeAnsweredScores(): Scores {
  return { hecho_entero: 2, respeta_la_casa: null, platos_con_sentido: null, corto_sin_relleno: 2, rapido: 2, verdad_comprobada: 2 }
}

/** La nota del caso: la media de los criterios que aplican. */
export function caseMean(scores: Scores): number {
  const vals = EXAM_CRITERIA.map((k) => scores[k]).filter((v): v is Score => v !== null)
  return vals.length ? round2(vals.reduce<number>((a, b) => a + b, 0) / vals.length) : 0
}

// ─── Tokens y precio ─────────────────────────────────────

export const CHARS_PER_TOKEN = 3.5
const tok = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)

export interface RecordedRound {
  request: { system?: unknown; tools?: unknown; messages?: unknown }
  response: { content?: unknown; usage?: unknown }
}

const blocks = (x: unknown): any[] => (Array.isArray(x) ? x : typeof x === 'string' ? [{ type: 'text', text: x }] : [])
const textOf = (b: any) => (typeof b?.text === 'string' ? b.text : '')

/** Lo fijo de una petición (las herramientas y el bloque de sistema con la hora de caché) y su total, en caracteres. */
export function requestChars(request: RecordedRound['request']): { fixed: number; total: number } {
  const tools = Array.isArray(request.tools) ? JSON.stringify(request.tools).length : 0
  const system = blocks(request.system)
  const fixedSystem = system.filter((b) => b?.cache_control?.ttl === '1h').reduce((n, b) => n + textOf(b).length, 0)
  const allSystem = system.reduce((n, b) => n + textOf(b).length, 0)
  const messages = JSON.stringify(request.messages ?? []).length
  return { fixed: tools + fixedSystem, total: tools + allSystem + messages }
}

/** Caracteres que escribe el modelo: el texto y las llamadas (nombre y entrada). */
export function responseChars(response: RecordedRound['response']): number {
  return blocks(response.content).reduce((n, b) => {
    if (b?.type === 'text') return n + textOf(b).length
    if (b?.type === 'tool_use') return n + String(b.name ?? '').length + JSON.stringify(b.input ?? {}).length
    return n
  }, 0)
}

/**
 * Pure: los tokens de un turno estimados de sus rondas, con la caché del
 * motor. `warm`: lo fijo ya estaba en caché (otro mensaje hace menos de una hora).
 */
export function estimateTurnUsage(rounds: readonly RecordedRound[], opts: { warm: boolean }): TokenUsage {
  const usage: TokenUsage = { ...EMPTY_USAGE }
  let prev = 0
  rounds.forEach((r, i) => {
    const { fixed, total } = requestChars(r.request)
    const T = tok(total)
    const F = tok(fixed)
    if (i === 0) {
      if (opts.warm) {
        usage.cacheReadTokens += F
        usage.cacheWriteTokens += Math.max(0, T - F)
      } else {
        usage.cacheWriteTokens += T
        usage.cacheWrite1hTokens = (usage.cacheWrite1hTokens ?? 0) + F
      }
    } else {
      usage.cacheReadTokens += prev
      usage.cacheWriteTokens += Math.max(0, T - prev)
    }
    usage.outputTokens += tok(responseChars(r.response))
    prev = T
  })
  return usage
}

/** Pure: el precio de unos tokens con la tarifa del modelo de Mimo (config/pricing.ts), en euros. */
export function usageEur(usage: TokenUsage, eurPerUsd: number): number {
  const write1h = Math.min(usage.cacheWrite1hTokens ?? 0, usage.cacheWriteTokens)
  const usd =
    (usage.inputTokens * ASSISTANT_USD_PER_MTOK.input +
      usage.outputTokens * ASSISTANT_USD_PER_MTOK.output +
      (usage.cacheWriteTokens - write1h) * ASSISTANT_USD_PER_MTOK.cacheWrite +
      write1h * ASSISTANT_USD_PER_MTOK.cacheWrite1h +
      usage.cacheReadTokens * ASSISTANT_USD_PER_MTOK.cacheRead) /
    1_000_000
  return Math.round(usd * eurPerUsd * 10_000) / 10_000
}

// ─── El informe ──────────────────────────────────────────

export interface CaseResult {
  id: string
  tipo: string
  dificultad: ExamCase['dificultad']
  criterio_principal: ExamCriterion
  sin_modelo: boolean
  porCodigo: string | null
  mensaje: string
  respuesta: string
  herramientas: string[]
  rondas: number
  ms: number | null
  notas: Scores
  nota: number
  porque: Partial<Record<ExamCriterion, string>>
  comprobaciones: string[]
  tokens: { entrada: number; cacheEscrita: number; cacheEscrita1h: number; cacheLeida: number; salida: number }
  precioEur: number
  /** Con lo fijo ya en caché; null cuando los tokens son los de Anthropic. */
  precioCalienteEur: number | null
  /** El caso no se pudo pasar (la oficina no contestó, el juez no se entendió…): no cuenta en las medias. */
  error?: string
}

const round2 = (x: number) => Math.round(x * 100) / 100
const round4 = (x: number) => Math.round(x * 10_000) / 10_000

function criterionMeans(results: readonly CaseResult[]): Record<ExamCriterion, number | null> {
  const out = {} as Record<ExamCriterion, number | null>
  for (const k of EXAM_CRITERIA) {
    const vals = results.map((r) => r.notas[k]).filter((v): v is Score => v !== null && v !== undefined)
    out[k] = vals.length ? round2(vals.reduce<number>((a, b) => a + b, 0) / vals.length) : null
  }
  return out
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Pure: el resumen de una pasada: la nota media, por criterio y por tipo, y el coste. */
export function summarizeExam(results: readonly CaseResult[]) {
  const ok = results.filter((r) => !r.error)
  const porTipo: Record<string, { casos: number; nota: number; porCriterio: Record<ExamCriterion, number | null>; precioMedioEur: number }> = {}
  for (const tipo of [...new Set(ok.map((r) => r.tipo))].sort()) {
    const rs = ok.filter((r) => r.tipo === tipo)
    porTipo[tipo] = { casos: rs.length, nota: round2(mean(rs.map((r) => r.nota))), porCriterio: criterionMeans(rs), precioMedioEur: round4(mean(rs.map((r) => r.precioEur))) }
  }
  const sum = (f: (r: CaseResult) => number) => ok.reduce((n, r) => n + f(r), 0)
  const warm = ok.filter((r) => r.precioCalienteEur !== null)
  return {
    casos: results.length,
    corregidos: ok.length,
    conError: results.length - ok.length,
    nota: round2(mean(ok.map((r) => r.nota))),
    porCriterio: criterionMeans(ok),
    porTipo,
    porCodigo: ok.filter((r) => r.porCodigo).length,
    sinModeloQuePasaronPorElModelo: ok.filter((r) => r.sin_modelo && !r.porCodigo).length,
    coste: {
      tokens: {
        entrada: sum((r) => r.tokens.entrada),
        cacheEscrita: sum((r) => r.tokens.cacheEscrita),
        cacheLeida: sum((r) => r.tokens.cacheLeida),
        salida: sum((r) => r.tokens.salida),
      },
      precioEur: round4(sum((r) => r.precioEur)),
      precioMedioEur: round4(mean(ok.map((r) => r.precioEur))),
      precioMedioCalienteEur: warm.length ? round4(mean(warm.map((r) => r.precioCalienteEur!))) : null,
    },
  }
}

export type ExamSummary = ReturnType<typeof summarizeExam>

/**
 * Pure: cuánto difieren dos pasadas (el «Hecho cuando» de PRO-1304: menos de
 * 0,2 puntos de media sobre la misma versión), por criterio y los casos cuya
 * nota cambió más de un punto.
 */
export function compareExams(a: { resumen: ExamSummary; casos: CaseResult[] }, b: { resumen: ExamSummary; casos: CaseResult[] }) {
  const porCriterio = {} as Record<ExamCriterion, number | null>
  for (const k of EXAM_CRITERIA) {
    const x = a.resumen.porCriterio[k]
    const y = b.resumen.porCriterio[k]
    porCriterio[k] = x === null || y === null ? null : round2(y - x)
  }
  const byId = new Map(a.casos.filter((r) => !r.error).map((r) => [r.id, r]))
  const casosQueCambian = b.casos
    .filter((r) => !r.error && byId.has(r.id) && Math.abs(r.nota - byId.get(r.id)!.nota) > 1)
    .map((r) => ({ id: r.id, antes: byId.get(r.id)!.nota, ahora: r.nota }))
  const diferencia = round2(b.resumen.nota - a.resumen.nota)
  return { diferencia, estable: Math.abs(diferencia) < 0.2, porCriterio, casosQueCambian }
}
