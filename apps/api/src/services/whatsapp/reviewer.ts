import Anthropic from '@anthropic-ai/sdk'
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm'
import { env } from '../../config/env.js'
import { db } from '../../db/connection.js'
import { assistantReviews, users, whatsappLinks, whatsappMessages } from '../../db/schema.js'
import { addDays, madridMidnightUtc, madridParts } from '../madridTime.js'
import { isWhatsAppConfigured } from './config.js'
import { sendProactive } from './outbound.js'
import { recordAnthropicCost } from '../costLedger.js'

/**
 * Conversation reviewer agent. Once a day (07:00 Madrid, from the scheduler
 * tick) it reads yesterday's WhatsApp conversations, computes objective
 * signals (slow turns, failures, engine corrective rounds, frustration cues,
 * closing questions), and asks Claude to judge every turn against ONA's
 * product rules. The report is stored in `assistant_reviews`, exposed at
 * GET /admin/assistant-reviews, and summarised over WhatsApp to the review
 * recipients (WHATSAPP_REVIEW_EMAILS, else ADMIN_EMAILS).
 *
 * Findings are for the developers: what to change in the prompt, a skill, or
 * which capability is missing. The reviewer never changes user data.
 */

export const REVIEW_MODEL = 'claude-opus-5-5'
/** Run after 07:00 Madrid, before the 09:00 morning brief. */
export const REVIEW_HOUR = 7
export const SLOW_TURN_MS = 20_000

export interface ReviewRow {
  phone: string
  userId: string | null
  username: string | null
  direction: string
  kind: string
  body: string | null
  status: string
  errorMessage: string | null
  meta: { tools?: string[]; corrections?: string[]; ms?: number } | null
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
  }
}

const hhmm = (d: Date) => {
  const p = madridParts(d)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** Pure: one readable transcript per user, with the engine's trace per turn. */
export function buildTranscripts(rows: readonly ReviewRow[]): string[] {
  const byUser = new Map<string, ReviewRow[]>()
  for (const r of rows) {
    const key = r.userId ?? `tel:${r.phone.slice(-3)}`
    byUser.set(key, [...(byUser.get(key) ?? []), r])
  }
  const out: string[] = []
  let n = 0
  for (const convo of byUser.values()) {
    n += 1
    const label = convo.find((r) => r.username)?.username ?? `usuario ${n}`
    const lines = [`=== Conversación ${n} (${label}) ===`]
    for (const r of [...convo].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
      const body = (r.body ?? '').replace(/\s+\n/g, '\n').trim()
      if (r.direction === 'in') {
        lines.push(`[${hhmm(r.createdAt)}] USUARIO (${r.kind}${r.status !== 'processed' ? `, ${r.status}` : ''}): ${body}`)
        const t = r.meta
        const trace = [
          !t ? 'herramientas: sin registro' : t.tools?.length ? `herramientas: ${t.tools.join(', ')}` : 'herramientas: ninguna',
          t?.corrections?.length ? `correcciones del motor: ${t.corrections.join(', ')}` : null,
          typeof t?.ms === 'number' ? `${(t.ms / 1000).toFixed(1)} s` : null,
          r.errorMessage ? `error: ${r.errorMessage}` : null,
        ].filter(Boolean)
        if (r.status === 'processed' || r.errorMessage) lines.push(`   ↳ ${trace.join(' · ')}`)
      } else {
        lines.push(`[${hhmm(r.createdAt)}] ONA (${r.kind}${r.status !== 'sent' ? `, ${r.status}` : ''}): ${body}`)
      }
    }
    out.push(lines.join('\n'))
  }
  return out
}

export interface ReviewFinding {
  severity: 'alta' | 'media' | 'baja'
  category: string
  when: string
  userMessage: string
  whatHappened: string
  expected: string
  suggestedFix: string
}

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
        required: ['severity', 'category', 'when', 'userMessage', 'whatHappened', 'expected', 'suggestedFix'],
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
              'proactividad',
              'otro',
            ],
          },
          when: { type: 'string' },
          userMessage: { type: 'string' },
          whatHappened: { type: 'string' },
          expected: { type: 'string' },
          suggestedFix: { type: 'string' },
        },
      },
    },
  },
} as const

export function reviewerSystemPrompt(toolNames: string[]): string {
  return `Eres el revisor de calidad de ONA, un asistente de menús semanales que funciona por WhatsApp. Revisas las conversaciones de un dia entre usuarios y ONA para encontrar lo que hay que corregir en el producto.

Reglas del producto (contra ellas evaluas cada turno):
1. Resolutivo: hace TODO lo que pide el mensaje en el mismo turno. Si pidio varias cosas, todas.
2. Veraz: nunca afirma haber hecho algo que ninguna herramienta hizo (comprueba la linea "herramientas" de cada turno; si pone "sin registro" es un mensaje anterior al registro de herramientas y NO puedes juzgarlo por eso). Nunca promete hacerlo "luego": no puede actuar despues de responder.
3. Transparente: si cambia algo que no se pidio literalmente (p. ej. pone la receta mas parecida), lo dice.
4. Breve: si hizo cambios, "Hecho:" y una linea por cambio. Sin consejos ni avisos no pedidos. Solo pregunta si es imprescindible.
5. Lo que el usuario pide explicitamente manda sobre lo guardado (gustos, disgustos), salvo alergias.
6. Rapido: mas de 20 s sin respuesta es lento (salvo importar recetas o generar menus, que llevan un aviso "me pongo con ello").
7. Proactividad util: los avisos (resumen, cocinar, ¿hiciste la cena?, compra, menu del domingo) aportan y no molestan.
8. Las notas de voz llegan transcritas: si la transcripcion parece erronea, es un hallazgo de "transcripcion".

Herramientas que ONA tiene disponibles: ${toolNames.join(', ')}.

Para cada problema REAL crea un hallazgo con una correccion concreta y accionable (que cambiar en las instrucciones, en una herramienta, o que herramienta/funcion falta). Severidad alta = el usuario se queda sin lo que pidio o recibe informacion falsa; media = friccion clara; baja = pulido. No inventes problemas ni repitas el mismo dos veces: si todo fue bien, findings vacio. "summary": 2-3 frases en español sobre como fue el dia. Todo en español.`
}

let client: Anthropic | null = null
const getClient = () => (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }))

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

async function loadDayRows(day: string): Promise<ReviewRow[]> {
  const from = madridMidnightUtc(day)
  const to = madridMidnightUtc(addDays(day, 1))
  return db
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
    .orderBy(asc(whatsappMessages.createdAt)) as Promise<ReviewRow[]>
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

/** Review one Madrid day and store the report (replaces an existing one for that day). */
export async function reviewDay(day: string, llm: ReviewerLLM = claudeReviewer, opts: { notify?: boolean } = {}): Promise<ReviewResult> {
  const rows = await loadDayRows(day)
  const stats = computeStats(rows)
  let result: ReviewResult
  if (stats.turns === 0) {
    result = { day, status: 'empty', stats, summary: 'Sin conversaciones ese día.', findings: [] }
  } else {
    try {
      const transcript = buildTranscripts(rows).join('\n\n')
      const header = `Día ${day}. Señales: ${JSON.stringify(stats)}\n\n`
      // Lazy: skills.ts → notificationScheduler → reviewer would be a cycle.
      const { skills } = await import('../assistant/skills.js')
      const review = await llm(reviewerSystemPrompt(skills.map((s) => s.name)), header + transcript)
      result = { day, status: 'ok', stats, summary: review.summary, findings: review.findings }
    } catch (err: any) {
      result = { day, status: 'failed', stats, error: String(err?.message ?? err).slice(0, 500) }
    }
  }
  await db.delete(assistantReviews).where(eq(assistantReviews.day, day))
  await db.insert(assistantReviews).values({
    day,
    status: result.status,
    stats: stats as unknown as Record<string, number>,
    findings: (result.findings ?? []) as unknown[],
    summary: result.summary ?? null,
    model: result.status === 'ok' ? REVIEW_MODEL : null,
    errorMessage: result.error ?? null,
  })
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

/** Called from the scheduler tick: review yesterday once, after 07:00 Madrid. */
export async function runDailyReviewIfDue(now: Date = new Date()): Promise<ReviewResult | null> {
  if (!env.ANTHROPIC_API_KEY) return null
  const p = madridParts(now)
  if (p.hour < REVIEW_HOUR) return null
  const day = addDays(p.isoDate, -1)
  const [existing] = await db.select({ id: assistantReviews.id }).from(assistantReviews).where(eq(assistantReviews.day, day)).limit(1)
  if (existing) return null
  return reviewDay(day)
}
