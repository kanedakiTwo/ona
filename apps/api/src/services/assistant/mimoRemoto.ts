/**
 * «Mimo remoto» en staging (PRO-1102, D-157; specs/advisor.md). With
 * `MIMO_REMOTO=1` no round of Mimo goes to Anthropic: each request is saved,
 * as is, in `mimo_turnos_remotos` and the office answers it (Claude Code with
 * the subscription) through `POST /agent/mimo-remoto/…`. The engine gets the
 * answer as if Anthropic had sent it: it runs the tools and asks for the next
 * round the same way. 0 $ of API, so nothing goes to `cost_events`.
 *
 * Never in production: the API refuses to boot with the mode on there
 * (config/mimoRemoto.ts, read by config/env.ts).
 */
import { and, eq, inArray, sql } from 'drizzle-orm'
import { mimoTurnosRemotos } from '../../db/schema.js'

/** How long a round waits for the office before it gives up (`caducado`). */
export const REMOTE_TURN_TIMEOUT_MS = 120_000
/** How long `POST /agent/mimo-remoto/siguiente` waits for a pending round. */
export const NEXT_TURN_WAIT_MS = 25_000
const POLL_MS = 500

export type RemoteTurnState = 'pendiente' | 'cogido' | 'respondido' | 'caducado'

/** The answer the office sends: Messages API `content` (text and `tool_use` blocks) and `stop_reason`. */
export interface RemoteAnswer {
  content: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> })[]
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'refusal'
}

export class MimoRemotoTimeoutError extends Error {
  constructor(id: string) {
    super(`Mimo remoto: el turno ${id} no tuvo respuesta en ${REMOTE_TURN_TIMEOUT_MS / 1000} s`)
  }
}

/** Where the rounds wait: the table in the API, an array in the unit tests. */
export interface RemoteTurnStore {
  create(peticion: unknown): Promise<string>
  /** The answer, once the round is `respondido`; null before. */
  answerOf(id: string): Promise<RemoteAnswer | null>
  /** `pendiente`/`cogido` → `caducado`. False when it had just been answered. */
  expire(id: string): Promise<boolean>
}

export function dbTurnStore(db: any): RemoteTurnStore {
  return {
    async create(peticion) {
      const [row] = await db.insert(mimoTurnosRemotos).values({ peticion }).returning({ id: mimoTurnosRemotos.id })
      return row.id
    },
    async answerOf(id) {
      const [row] = await db
        .select({ estado: mimoTurnosRemotos.estado, respuesta: mimoTurnosRemotos.respuesta })
        .from(mimoTurnosRemotos)
        .where(eq(mimoTurnosRemotos.id, id))
        .limit(1)
      return row?.estado === 'respondido' ? (row.respuesta as RemoteAnswer) : null
    },
    async expire(id) {
      const rows = await db
        .update(mimoTurnosRemotos)
        .set({ estado: 'caducado' })
        .where(and(eq(mimoTurnosRemotos.id, id), inArray(mimoTurnosRemotos.estado, ['pendiente', 'cogido'])))
        .returning({ id: mimoTurnosRemotos.id })
      return rows.length > 0
    },
  }
}

export interface WaitOptions {
  timeoutMs?: number
  pollMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Same shape as the Anthropic client's `messages.create` (what `runToolLoop`
 * calls), backed by the table: saves the request, waits for its answer and
 * returns it with no `usage` (nothing was paid). No answer within 120 s →
 * `caducado` and an error, as when Anthropic fails.
 */
export function remoteMessagesClient(store: RemoteTurnStore, opts: WaitOptions = {}) {
  const timeoutMs = opts.timeoutMs ?? REMOTE_TURN_TIMEOUT_MS
  const pollMs = opts.pollMs ?? POLL_MS
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? realSleep
  return {
    messages: {
      async create(args: any): Promise<any> {
        const id = await store.create(args)
        const deadline = now() + timeoutMs
        for (;;) {
          const answer = await store.answerOf(id)
          if (answer) return { id, type: 'message', role: 'assistant', content: answer.content, stop_reason: answer.stop_reason }
          if (now() >= deadline) {
            if (await store.expire(id)) throw new MimoRemotoTimeoutError(id)
            // Answered between the last read and the expiry: use it.
            const late = await store.answerOf(id)
            if (late) return { id, type: 'message', role: 'assistant', content: late.content, stop_reason: late.stop_reason }
            throw new MimoRemotoTimeoutError(id)
          }
          await sleep(pollMs)
        }
      },
    },
  }
}

/**
 * The oldest pending round, now `cogido` (two office runs never get the same
 * one: SKIP LOCKED). Waits up to `waitMs` for one; null when none came.
 */
export async function takeNextTurn(
  db: any,
  opts: { waitMs?: number; pollMs?: number } = {},
): Promise<{ id: string; creado: string; peticion: unknown } | null> {
  const deadline = Date.now() + (opts.waitMs ?? NEXT_TURN_WAIT_MS)
  for (;;) {
    const result = await db.execute(sql`
      UPDATE mimo_turnos_remotos SET estado = 'cogido'
      WHERE id = (
        SELECT id FROM mimo_turnos_remotos
        WHERE estado = 'pendiente'
        ORDER BY creado
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, creado, peticion
    `)
    const row = (result.rows ?? result)[0]
    if (row) return { id: row.id, creado: new Date(row.creado).toISOString(), peticion: row.peticion }
    if (Date.now() >= deadline) return null
    await realSleep(opts.pollMs ?? POLL_MS)
  }
}

const STOP_REASONS = new Set(['end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'refusal'])

/** Pure: the office's body → a valid answer, or why not. */
export function parseRemoteAnswer(body: any): { ok: true; answer: RemoteAnswer } | { ok: false; error: string } {
  if (!body || !Array.isArray(body.content)) return { ok: false, error: '`content` tiene que ser una lista de bloques' }
  if (!STOP_REASONS.has(body.stop_reason)) return { ok: false, error: '`stop_reason` no válido' }
  const content: RemoteAnswer['content'] = []
  for (const b of body.content) {
    if (b?.type === 'text' && typeof b.text === 'string') {
      content.push({ type: 'text', text: b.text })
    } else if (
      b?.type === 'tool_use' &&
      typeof b.id === 'string' && b.id &&
      typeof b.name === 'string' && b.name &&
      b.input && typeof b.input === 'object' && !Array.isArray(b.input)
    ) {
      content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input })
    } else {
      return { ok: false, error: 'cada bloque es `text` (con `text`) o `tool_use` (con `id`, `name` e `input`)' }
    }
  }
  return { ok: true, answer: { content, stop_reason: body.stop_reason } }
}

/** `cogido`/`pendiente` → `respondido` with the answer; otherwise the state it was in (or null: no such round). */
export async function answerTurn(
  db: any,
  id: string,
  answer: RemoteAnswer,
): Promise<{ ok: true } | { ok: false; estado: RemoteTurnState | null }> {
  const rows = await db
    .update(mimoTurnosRemotos)
    .set({ estado: 'respondido', respuesta: answer })
    .where(and(eq(mimoTurnosRemotos.id, id), inArray(mimoTurnosRemotos.estado, ['pendiente', 'cogido'])))
    .returning({ id: mimoTurnosRemotos.id })
  if (rows.length > 0) return { ok: true }
  const [row] = await db.select({ estado: mimoTurnosRemotos.estado }).from(mimoTurnosRemotos).where(eq(mimoTurnosRemotos.id, id)).limit(1)
  return { ok: false, estado: (row?.estado as RemoteTurnState) ?? null }
}
