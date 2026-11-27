import Anthropic from '@anthropic-ai/sdk'
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { assistantReviews, chatMessages, users, whatsappLinks, whatsappMessages } from '../../db/schema.js'
import { addDays, madridMidnightUtc, madridParts } from '../madridTime.js'
import { isWhatsAppConfigured } from './config.js'
import { sendProactive } from './outbound.js'
import { recordAnthropicCost } from '../costLedger.js'
import { detectFlags, replyFlags } from '../assistantFlags.js'
import { CLAUDE_MODEL } from '../../config/models.js'
import { annotateFindings, formatMemory, MEMORY_DAYS, priorFindings, type ReviewChannel, type StructuredFields } from '../reviewFindings.js'
import { aiJobsWithoutUserAllowed, anthropicClient } from '../anthropicClient.js'

/**
 * Conversation reviewer agent. Once a day (01:00 Madrid, from the scheduler
 * tick) it reads yesterday's conversations with Mimo — WhatsApp
 * (`whatsapp_messages`) and the app (`chat_messages`) —, computes objective
 * signals (slow turns, failures, engine corrective rounds, frustration cues,
 * closing questions), and asks Claude to judge every turn against Mimoia's
 * product rules, with its own findings of the last 14 days as memory. The
 * report is stored in `assistant_reviews` and exposed at
 * GET /admin/assistant-reviews; the structured part of each finding (key,
 * pattern, where, one fix, its test — no user data, D-189) reaches the HQ
 * agents through GET /admin/assistant-reviews/flags. The WhatsApp summary to
 * the review recipients only goes out on a manual run with `notify`.
 *
 * Findings are for the developers: what to change in the prompt, a skill, or
 * which capability is missing. The reviewer never changes user data.
 */

export const REVIEW_MODEL = CLAUDE_MODEL
/**
 * Run after 01:00 Madrid (D-189): done before the HQ data snapshot of the
 * night (`data/mimo`), so the agents read yesterday's review the same night.
 */
export const REVIEW_HOUR = 1
export const SLOW_TURN_MS = 20_000

export interface ReviewRow {
  /** Where the turn happened; WhatsApp when absent. App rows come from `chat_messages` (`appTurnRows`). */
  channel?: ReviewChannel
  phone: string
  userId: string | null
  username: string | null
  direction: string
  kind: string
  body: string | null
  status: string
  errorMessage: string | null
  meta: {
    tools?: string[]
    corrections?: string[]
    ms?: number
    toolTrace?: import('../assistant/types.js').ToolTrace[]
    photo?: boolean
    /** Outbound, PRO-156: written from its guide, or the fixed text (and why). */
    guided?: 'guide' | 'fallback'
    guidedReason?: string
  } | null
  createdAt: Date
}

const FRUSTRATION_RE =
  /\b(no (?:es eso|era eso|te he dicho|lo has hecho|funciona)|otra vez|ya te (?:he )?dicho|est[aá] mal|no me entiendes|eso no|que no\b|no, )/i

export interface ReviewStats {
  conversations: number
  turns: number
  failedTurns: number
  slowTurns: number
  corrections: number
  frustrationCues: number
  questionEndings: number
  proactiveSent: number
  sendFailures: number
  /** Deterministic detectors (assistantFlags.ts), since 2026-10-13: replies talking about body effects. */
  healthTalk: number
  /** Replies using a constitution §6 guard-list health claim. */
  healthClaims: number
  /** "Hecho:" / "he cambiado…" with no tool that changed anything in the turn's trace. */
  unverifiedDone: number
  /** PRO-156: messages Mimo sent by itself written from their guide / sent as the fixed text instead. */
  guidedWritten: number
  guidedFallback: number
  /** Of `turns`, the ones in the app (Mimo's chat on the web), from `chat_messages`. */
  appTurns: number
}

/** Pure: counts of objective signals for the day. */
export function computeStats(rows: readonly ReviewRow[]): ReviewStats {
  const inbound = rows.filter((r) => r.direction === 'in')
  const replies = rows.filter((r) => r.direction === 'out' && r.kind === 'reply')
  return {
    conversations: new Set(inbound.map((r) => r.userId ?? r.phone)).size,
    turns: inbound.length,
    failedTurns: inbound.filter((r) => r.status === 'failed').length,
    slowTurns: inbound.filter((r) => (r.meta?.ms ?? 0) > SLOW_TURN_MS).length,
    corrections: inbound.reduce((n, r) => n + (r.meta?.corrections?.length ?? 0), 0),
    frustrationCues: inbound.filter((r) => r.body && FRUSTRATION_RE.test(r.body)).length,
    questionEndings: replies.filter((r) => /\?\s*(?:\n\nVer [^\n]*)?$/.test((r.body ?? '').trim())).length,
    proactiveSent: rows.filter(
      (r) => r.direction === 'out' && ['daily_brief', 'weekly_nudge', 'alert', 'cooking_reminder', 'dinner_checkin', 'shopping_reminder'].includes(r.kind),
    ).length,
    sendFailures: rows.filter((r) => r.direction === 'out' && r.status === 'failed').length,
    guidedWritten: rows.filter((r) => r.direction === 'out' && r.meta?.guided === 'guide').length,
    guidedFallback: rows.filter((r) => r.direction === 'out' && r.meta?.guided === 'fallback').length,
    appTurns: inbound.filter((r) => r.channel === 'app').length,
    ...detectorCounts(rows),
  }
}

function detectorCounts(rows: readonly ReviewRow[]): Pick<ReviewStats, 'healthTalk' | 'healthClaims' | 'unverifiedDone'> {
  const { flags } = detectFlags(rows)
  const n = (c: string) => flags.filter((f) => f.category === c).length
  return { healthTalk: n('health_talk'), healthClaims: n('health_claim'), unverifiedDone: n('unverified_done') }
}

const SIGNAL_LABEL: Record<string, string> = {
  health_talk: 'habla de efectos en el cuerpo (regla de salud)',
  health_claim: 'reclamo de salud prohibido (§6)',
  unverified_done: 'dice "hecho" pero ninguna herramienta cambió nada',
  error_refusal: 'rechazo o respuesta cortada',
}

const hhmm = (d: Date) => {
  const p = madridParts(d)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** Pure: one readable transcript per user, with the engine's trace per turn. */
export function buildTranscripts(rows: readonly ReviewRow[]): string[] {
  const byUser = new Map<string, ReviewRow[]>()
  for (const r of rows) {
    const key = `${r.channel ?? 'whatsapp'}:${r.userId ?? `tel:${r.phone.slice(-3)}`}`
    byUser.set(key, [...(byUser.get(key) ?? []), r])
  }
  const out: string[] = []
  let n = 0
  for (const convo of byUser.values()) {
    n += 1
    const label = convo.find((r) => r.username)?.username ?? `usuario ${n}`
    const canal = convo[0].channel === 'app' ? 'app' : 'whatsapp'
    const lines = [`=== Conversación ${n} (${label}) · canal ${canal} ===`]
    let turnMeta: ReviewRow['meta'] = null
    let answered = true
    for (const r of [...convo].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const body = (r.body ?? '').replace(/\s+\n/g, '\n').trim()
      if (r.direction === 'in') {
        turnMeta = r.meta
        answered = false
        lines.push(`[${hhmm(r.createdAt)}] USUARIO (${r.kind}${r.status !== 'processed' ? `, ${r.status}` : ''}): ${body}`)
        const t = r.meta
        const trace = [
          !t ? 'herramientas: sin registro' : t.tools?.length ? `herramientas: ${t.tools.join(', ')}` : 'herramientas: ninguna',
          t?.corrections?.length ? `correcciones del motor: ${t.corrections.join(', ')}` : null,
          typeof t?.ms === 'number' ? `${(t.ms / 1000).toFixed(1)} s` : null,
          r.errorMessage ? `error: ${r.errorMessage}` : null,
        ].filter(Boolean)
        if (r.status === 'processed' || r.errorMessage) lines.push(`   ↳ ${trace.join(' · ')}`)
        // Since 2026-10-12: what each tool got and returned, so "dijo Hecho
        // pero no cambió nada" can be judged from facts, not guessed.
        for (const step of Array.isArray(t?.toolTrace) ? t.toolTrace : []) {
          lines.push(`      · ${step.name} ${step.input ?? ''} → ${step.error ? 'ERROR: ' : ''}${step.summary ?? ''}`.slice(0, 600))
        }
        if (t?.photo) lines.push('      · (con foto: Mimo la ha visto)')
      } else {
        // PRO-156: say how a message Mimo sent by itself was made, so the reviewer judges the guide too.
        const guided =
          r.meta?.guided === 'guide' ? ', redactado con guía' : r.meta?.guided === 'fallback' ? `, texto fijo${r.meta.guidedReason ? `: ${r.meta.guidedReason}` : ''}` : ''
        lines.push(`[${hhmm(r.createdAt)}] MIMO (${r.kind}${guided}${r.status !== 'sent' ? `, ${r.status}` : ''}): ${body}`)
        if (r.meta?.guided === 'guide') {
          const { categories, claimWords } = replyFlags(r.body ?? '', null)
          const labels = categories.map((c) => (c === 'health_claim' ? `${SIGNAL_LABEL[c]}: ${claimWords.join(', ')}` : SIGNAL_LABEL[c]))
          if (labels.length) lines.push(`   ⚑ señales automáticas: ${labels.join(' · ')}`)
        }
        // Deterministic detectors (assistantFlags.ts): facts for the reviewer, not verdicts.
        if (r.kind === 'reply' && !answered) {
          answered = true
          const { categories, claimWords } = replyFlags(r.body ?? '', turnMeta)
          const labels = categories.map((c) => (c === 'health_claim' ? `${SIGNAL_LABEL[c]}: ${claimWords.join(', ')}` : SIGNAL_LABEL[c]))
          if (labels.length) lines.push(`   ⚑ señales automáticas: ${labels.join(' · ')}`)
        }
      }
    }
    out.push(lines.join('\n'))
  }
  return out
}

/**
 * One finding. The first seven fields are the text for Admin (they can quote
 * the conversation); the structured ones (D-189) are written without user data
 * and are what the HQ agents read: `clave`, `patron`, `donde`, `arreglo`,
 * `prueba`, `tipo` from the model, `dias` and `regresion` computed from the
 * earlier reviews (`annotateFindings`).
 */
export interface ReviewFinding extends Partial<StructuredFields> {
  severity: 'alta' | 'media' | 'baja'
  category: string
  when: string
  userMessage: string
  whatHappened: string
  expected: string
  suggestedFix: string
}

const STRUCTURED_REQUIRED = ['canal', 'clave', 'patron', 'donde', 'arreglo', 'prueba', 'tipo'] as const

export const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'findings'],
  properties: {
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['severity', 'category', 'when', 'userMessage', 'whatHappened', 'expected', 'suggestedFix', ...STRUCTURED_REQUIRED],
        properties: {
          severity: { type: 'string', enum: ['alta', 'media', 'baja'] },
          category: {
            type: 'string',
            enum: [
              'accion_no_hecha',
              'afirmacion_falsa',
              'cambio_no_pedido',
              'pregunta_innecesaria',
              'promesa_incumplida',
              'herramienta_incorrecta',
              'falta_herramienta',
              'lentitud',
              'error_tecnico',
              'transcripcion',
              'respuesta_larga',
              'respuesta_poco_util',
              'rechazo_indebido',
              'proactividad',
              'otro',
            ],
          },
          when: { type: 'string' },
          userMessage: { type: 'string' },
          whatHappened: { type: 'string' },
          expected: { type: 'string' },
          suggestedFix: { type: 'string' },
          canal: { type: 'string', enum: ['whatsapp', 'app'] },
          clave: { type: 'string' },
          patron: { type: 'string' },
          donde: { type: 'string' },
          arreglo: { type: 'string' },
          prueba: { type: 'string' },
          tipo: { type: 'string', enum: ['arreglo', 'decision'] },
        },
      },
    },
  },
} as const

export function reviewerSystemPrompt(toolNames: string[]): string {
  return `Eres el revisor de calidad de Mimoia, una app de menús semanales cuyo asistente, Mimo, funciona por WhatsApp y dentro de la app. Revisas las conversaciones de un dia entre usuarios y Mimo (MIMO en la transcripcion) para encontrar lo que hay que corregir en el producto. Cada conversacion dice su canal: "whatsapp" o "app" (el chat de Mimo en la web: alli no hay avisos ni plantillas, y la pagina en la que estaba el usuario no sale en la transcripcion). Antes de octubre de 2026 el asistente y la app tenian otro nombre: que un mensaje antiguo lo use no es un hallazgo.

Reglas del producto (contra ellas evaluas cada turno):
1. Resolutivo: hace TODO lo que pide el mensaje en el mismo turno. Si pidio varias cosas, todas.
2. Veraz: nunca afirma haber hecho algo que ninguna herramienta hizo (comprueba la linea "herramientas" de cada turno y, debajo, lo que recibio y devolvio cada herramienta; si pone "sin registro" es un mensaje anterior al registro de herramientas y NO puedes juzgarlo por eso). Nunca promete hacerlo "luego": no puede actuar despues de responder.
3. Transparente: si cambia algo que no se pidio literalmente (p. ej. pone la receta mas parecida), lo dice.
4. Breve sin ser seco: si hizo cambios, "Hecho:" y una linea por cambio. Solo pregunta si es imprescindible.
4b. Util e inteligente: contesta de verdad a lo que se pregunta. Una pregunta de cocina (como se hace algo, tiempos, trucos, utensilios, el enlace de una receta) se responde con conocimiento, no con una busqueda que no lleva a nada ni con la frase de "solo te puedo ayudar con tu comida" (eso solo vale para temas que no son de comida: si no, es "rechazo_indebido"). Una respuesta correcta pero que no ayuda, evasiva o que pregunta lo obvio es "respuesta_poco_util".
5. Lo que el usuario pide explicitamente manda sobre lo guardado (gustos, disgustos), salvo alergias.
6. Rapido: mas de 20 s sin respuesta es lento (salvo importar recetas o generar menus, que llevan un aviso "me pongo con ello").
7. Proactividad util: los avisos (resumen, cocinar, ¿hiciste la cena?, compra, menu del domingo) aportan y no molestan. Desde PRO-156 los escribe un redactor con una guia por tipo (marcados "redactado con guia"; "texto fijo: motivo" cuando salio el texto de respaldo). Revisa tambien esos mensajes: que suenen naturales y distintos de un dia a otro, que encajen con lo que paso en la conversacion, que no inventen nada, que no hablen de salud y que no repitan siempre lo mismo (categoria "proactividad"). Muchos "texto fijo" seguidos tambien son un hallazgo.
8. Las notas de voz llegan transcritas: si la transcripcion parece erronea, es un hallazgo de "transcripcion".

Debajo de algunas respuestas veras "⚑ señales automaticas": las ponen detectores automaticos (hablar de efectos en el cuerpo, reclamos de salud prohibidos, decir "hecho" sin que ninguna herramienta cambiara nada). Son pistas, no veredictos: compruebalas con la conversacion y la traza; si son reales, crea el hallazgo; si no, ignoralas.

Herramientas que Mimo tiene disponibles: ${toolNames.join(', ')}.

Reglas de la empresa (no propongas lo contrario):
- Modelo: Mimo y todo el producto van como minimo en Opus 5.5 (D-070). Nunca propongas un modelo mas barato (Haiku, Sonnet) como arreglo.
- El tope de gasto de cada hogar es una decision de negocio de Miguel: si un hogar lo toca, no propongas subirlo, bajarlo ni quitarlo como arreglo; si crees que hay que cambiarlo, es "tipo": "decision".
- Por WhatsApp, fuera de las 24 h desde el ultimo mensaje del usuario, Meta solo deja enviar plantillas aprobadas: los avisos salen por plantilla y sus botones llegan como texto. Que un aviso fuera de 24 h no lleve botones o use el texto de la plantilla no es un hallazgo.

Para cada problema REAL crea un hallazgo. Severidad alta = el usuario se queda sin lo que pidio o recibe informacion falsa; media = friccion clara; baja = pulido. No inventes problemas ni repitas el mismo dos veces en el dia: si todo fue bien, findings vacio. "summary": 2-3 frases en español sobre como fue el dia. Todo en español.

Cada hallazgo tiene dos partes:
- Para Admin (pueden citar la conversacion): "when" (hora), "userMessage", "whatHappened", "expected", "suggestedFix".
- Para los agentes que convierten el hallazgo en una tarea, SIN NINGUN DATO DE USUARIOS: sin nombres, sin citas ni comillas, sin telefonos, correos ni enlaces, sin datos de salud o alergias de nadie, sin platos o frases que identifiquen a un hogar. Describe lo que hace Mimo, no a la persona:
  - "canal": "whatsapp" o "app", el de la conversacion.
  - "clave": etiqueta estable en minusculas, sin tildes, con puntos y guiones bajos (p. ej. "checkin.varias_preguntas", "menu.cambio_no_pedido", "herramienta.swap_meal.dia_equivocado"). Si el problema esta en tu memoria (abajo, en el mensaje), usa EXACTAMENTE su clave; si es nuevo, crea una que sirva para reconocerlo otro dia.
  - "patron": una frase sobre lo que hace Mimo mal, en general (p. ej. "Mimo hace dos preguntas seguidas en el aviso de la cena").
  - "donde": donde se arregla, uno de: "prompt", "guia_aviso:<tipo de aviso>" (p. ej. "guia_aviso:dinner_checkin"), "herramienta:<nombre de la herramienta>", "generador" (el que hace los menus), "webhook", "plantilla", "tope", "otro".
  - "arreglo": UN solo arreglo concreto, el que recomiendas (no varias alternativas ni "o bien").
  - "prueba": el test que fallaria si el problema vuelve (p. ej. "un test del prompt de WhatsApp que compruebe que el aviso de la cena lleva una sola pregunta").
  - "tipo": "arreglo" si se puede hacer sin preguntar a nadie; "decision" si necesita que Miguel decida algo de negocio (precio, tope, plantillas, un cambio de reglas); entonces "arreglo" es la opcion que recomiendas.`
}

let client: Anthropic | null = null
const getClient = () => (client ??= anthropicClient())

export type ReviewerLLM = (system: string, transcript: string) => Promise<{ summary: string; findings: ReviewFinding[] }>

/** Claude call with a JSON-schema output. */
export const claudeReviewer: ReviewerLLM = async (system, transcript) => {
  const res: any = await getClient().messages.create({
    model: REVIEW_MODEL,
    max_tokens: 16_000,
    system,
    messages: [{ role: 'user', content: transcript }],
    output_config: { effort: 'high', format: { type: 'json_schema', schema: REVIEW_SCHEMA as any } },
  } as any)
  // System job: billed to nobody (overhead), even when an admin triggers a re-run.
  recordAnthropicCost('whatsapp_review', REVIEW_MODEL, res.usage, null)
  if (res.stop_reason === 'refusal') throw new Error('El modelo rechazó la revisión')
  if (res.stop_reason === 'max_tokens') throw new Error('Revisión truncada (max_tokens)')
  const text = (res.content ?? []).find((b: any) => b.type === 'text')?.text
  if (!text) throw new Error('Revisión sin texto')
  const parsed = JSON.parse(text)
  return { summary: String(parsed.summary ?? ''), findings: Array.isArray(parsed.findings) ? parsed.findings : [] }
}

export interface AppChatRow {
  userId: string
  username: string | null
  role: string
  body: string
  meta: { tools?: string[]; corrections?: string[]; toolTrace?: import('../assistant/types.js').ToolTrace[]; ms?: number } | null
  createdAt: Date
}

/**
 * Pure: the app's chat rows (`chat_messages`, user + assistant per turn) in the
 * reviewer's shape. What Mimo did is on the assistant row there; here it goes
 * on the user's row, as WhatsApp keeps it. Only answered turns are stored.
 */
export function appTurnRows(rows: readonly AppChatRow[]): ReviewRow[] {
  const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const out: ReviewRow[] = []
  const openTurn = new Map<string, ReviewRow>()
  for (const r of sorted) {
    const base = { channel: 'app' as const, phone: `app:${r.userId}`, userId: r.userId, username: r.username, body: r.body, errorMessage: null, createdAt: r.createdAt }
    if (r.role === 'user') {
      const row: ReviewRow = { ...base, direction: 'in', kind: 'text', status: 'processed', meta: null }
      openTurn.set(r.userId, row)
      out.push(row)
    } else {
      const turn = openTurn.get(r.userId)
      if (turn && r.meta) turn.meta = { tools: r.meta.tools ?? [], corrections: r.meta.corrections, toolTrace: r.meta.toolTrace, ms: r.meta.ms }
      openTurn.delete(r.userId)
      out.push({ ...base, direction: 'out', kind: 'reply', status: 'sent', meta: null })
    }
  }
  return out
}

async function loadDayRows(day: string): Promise<ReviewRow[]> {
  const from = madridMidnightUtc(day)
  const to = madridMidnightUtc(addDays(day, 1))
  const app = (await db
    .select({
      userId: chatMessages.userId,
      username: users.username,
      role: chatMessages.role,
      body: chatMessages.body,
      meta: chatMessages.meta,
      createdAt: chatMessages.createdAt,
    })
    .from(chatMessages)
    .leftJoin(users, eq(users.id, chatMessages.userId))
    .where(and(gte(chatMessages.createdAt, from), lt(chatMessages.createdAt, to)))
    .orderBy(asc(chatMessages.createdAt))) as AppChatRow[]
  const whatsapp = (await db
    .select({
      phone: whatsappMessages.phone,
      userId: whatsappMessages.userId,
      username: users.username,
      direction: whatsappMessages.direction,
      kind: whatsappMessages.kind,
      body: whatsappMessages.body,
      status: whatsappMessages.status,
      errorMessage: whatsappMessages.errorMessage,
      meta: whatsappMessages.meta,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .leftJoin(users, eq(users.id, whatsappMessages.userId))
    .where(and(gte(whatsappMessages.createdAt, from), lt(whatsappMessages.createdAt, to)))
    .orderBy(asc(whatsappMessages.createdAt))) as ReviewRow[]
  return [...whatsapp, ...appTurnRows(app)]
}

/** The keyed findings of the MEMORY_DAYS before `day` (the reviewer's memory). */
async function loadPriorReviews(day: string): Promise<Array<{ day: string; findings: unknown }>> {
  return db
    .select({ day: assistantReviews.day, findings: assistantReviews.findings })
    .from(assistantReviews)
    .where(and(gte(assistantReviews.day, addDays(day, -MEMORY_DAYS)), lt(assistantReviews.day, day), eq(assistantReviews.status, 'ok')))
}

const SEVERITY_ORDER: Record<string, number> = { alta: 0, media: 1, baja: 2 }

/** Pure: the WhatsApp summary sent to the review recipients. */
export function formatReviewMessage(day: string, stats: ReviewStats, summary: string, findings: ReviewFinding[]): string {
  const top = [...findings].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)).slice(0, 4)
  const lines = [
    `*Revisión de conversaciones del ${day}*`,
    `${stats.turns} mensajes en ${stats.conversations} conversación(es) · ${findings.length} hallazgo(s).`,
    summary,
  ]
  if (top.length) {
    lines.push('', ...top.map((f) => `- [${f.severity}] ${f.whatHappened} → ${f.suggestedFix}`))
  }
  if (findings.length > top.length) lines.push(`…y ${findings.length - top.length} más.`)
  lines.push('', 'Detalle: GET /admin/assistant-reviews')
  return lines.join('\n')
}

export interface ReviewResult {
  day: string
  status: 'ok' | 'empty' | 'failed'
  stats: ReviewStats
  summary?: string
  findings?: ReviewFinding[]
  error?: string
}

export interface ReviewDeps {
  loadRows: (day: string) => Promise<ReviewRow[]>
  loadPrior: (day: string) => Promise<Array<{ day: string; findings: unknown }>>
  toolNames: () => Promise<string[]>
  save: (day: string, result: ReviewResult) => Promise<void>
}

const defaultDeps: ReviewDeps = {
  loadRows: loadDayRows,
  loadPrior: loadPriorReviews,
  // Lazy: skills.ts → notificationScheduler → reviewer would be a cycle.
  toolNames: async () => (await import('../assistant/skills.js')).skills.map((s) => s.name),
  save: async (day, result) => {
    await db.delete(assistantReviews).where(eq(assistantReviews.day, day))
    await db.insert(assistantReviews).values({
      day,
      status: result.status,
      stats: result.stats as unknown as Record<string, number>,
      findings: (result.findings ?? []) as unknown[],
      summary: result.summary ?? null,
      model: result.status === 'ok' ? REVIEW_MODEL : null,
      errorMessage: result.error ?? null,
    })
  },
}

/**
 * Pure: the model's message — the day's signals, the reviewer's memory (keys
 * and patterns of the MEMORY_DAYS before) and the transcripts.
 */
export function buildReviewInput(day: string, stats: ReviewStats, rows: readonly ReviewRow[], prior: ReadonlyArray<{ day: string; findings: unknown }>): string {
  return [`Día ${day}. Señales: ${JSON.stringify(stats)}`, formatMemory(priorFindings(prior), day), buildTranscripts(rows).join('\n\n')].join('\n\n')
}

/** Review one Madrid day and store the report (replaces an existing one for that day). */
export async function reviewDay(
  day: string,
  llm: ReviewerLLM = claudeReviewer,
  opts: { notify?: boolean } = {},
  deps: ReviewDeps = defaultDeps,
): Promise<ReviewResult> {
  const rows = await deps.loadRows(day)
  const stats = computeStats(rows)
  let result: ReviewResult
  if (stats.turns === 0) {
    result = { day, status: 'empty', stats, summary: 'Sin conversaciones ese día.', findings: [] }
  } else {
    try {
      const prior = await deps.loadPrior(day)
      const review = await llm(reviewerSystemPrompt(await deps.toolNames()), buildReviewInput(day, stats, rows, prior))
      const findings = annotateFindings(review.findings as unknown as Array<ReviewFinding & Record<string, unknown>>, priorFindings(prior), day)
      result = { day, status: 'ok', stats, summary: review.summary, findings }
    } catch (err: any) {
      result = { day, status: 'failed', stats, error: String(err?.message ?? err).slice(0, 500) }
    }
  }
  await deps.save(day, result)
  if (result.status === 'ok' && opts.notify !== false) await notifyRecipients(day, stats, result.summary ?? '', result.findings ?? [])
  return result
}

async function notifyRecipients(day: string, stats: ReviewStats, summary: string, findings: ReviewFinding[]): Promise<void> {
  if (!isWhatsAppConfigured()) return
  const emails = (env.WHATSAPP_REVIEW_EMAILS.length ? env.WHATSAPP_REVIEW_EMAILS : env.ADMIN_EMAILS).map((e) => e.toLowerCase())
  if (emails.length === 0) return
  const recipients = await db
    .select({
      userId: whatsappLinks.userId,
      phone: whatsappLinks.phone,
      notify: whatsappLinks.notify,
      prefs: whatsappLinks.prefs,
      lastInboundAt: whatsappLinks.lastInboundAt,
      email: users.email,
      username: users.username,
      suspendedAt: users.suspendedAt,
      onboardingDone: users.onboardingDone,
    })
    .from(whatsappLinks)
    .innerJoin(users, eq(users.id, whatsappLinks.userId))
    .where(inArray(users.email, emails))
  const text = formatReviewMessage(day, stats, summary, findings)
  for (const r of recipients) {
    // kind 'review' stays out of the recipient's own chat history.
    await sendProactive(r, [{ type: 'text', text }], 'review').catch(() => {})
  }
}

/**
 * Called from the scheduler tick: review yesterday once, after 01:00 Madrid.
 * No WhatsApp summary at that hour (Miguel wants no messages before 08:00):
 * the findings reach HQ through the flags route (D-189).
 */
export async function runDailyReviewIfDue(now: Date = new Date()): Promise<ReviewResult | null> {
  // PRO-1315: not in staging with «Mimo remoto».
  if (!env.ANTHROPIC_API_KEY || !aiJobsWithoutUserAllowed()) return null
  const p = madridParts(now)
  if (p.hour < REVIEW_HOUR) return null
  const day = addDays(p.isoDate, -1)
  const [existing] = await db.select({ id: assistantReviews.id }).from(assistantReviews).where(eq(assistantReviews.day, day)).limit(1)
  if (existing) return null
  return reviewDay(day, claudeReviewer, { notify: false })
}
