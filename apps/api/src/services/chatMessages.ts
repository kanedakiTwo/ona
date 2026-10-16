/**
 * Mimo's web chat, kept server-side for 90 days (PRO-148, D-064).
 *
 * The assistant route writes two rows per web turn — what the user said and
 * what Mimo answered, with what it did (tools, review signals and the tool
 * trace, as `whatsapp_messages.meta` does for WhatsApp). The household
 * profile learns from these rows; the companion panel keeps showing the
 * conversation from `sessionStorage` and never reads them back.
 *
 * Retention: rows older than CHAT_RETENTION_DAYS are deleted from the
 * scheduler tick (`purgeOldChatMessagesIfDue`). Deleting the account deletes
 * them (FK cascade on `user_id`).
 */
import { eq, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { chatMessages, users } from '../db/schema.js'
import type { AssistantResponse } from './assistant/types.js'

export const CHAT_RETENTION_DAYS = 90

/** Upper bound for one stored message (a chat turn is far shorter). */
const MAX_BODY_CHARS = 8_000

export interface WebTurnInput {
  userId: string
  householdId: string | null
  /** The user's own words, without the page-context note sent to the model. */
  userMessage: string
  response: Pick<AssistantResponse, 'message' | 'toolsUsed' | 'corrections' | 'toolTrace'>
  mode: string
  path: string | null
  /** Turn duration in ms (model + tools). */
  ms?: number
  /** Clock for the rows; the assistant row is 1 ms after the user row so order survives. */
  now?: Date
}

export type ChatMessageRow = typeof chatMessages.$inferInsert

/** The two rows a web turn leaves (pure, for tests). */
export function buildWebTurnRows(input: WebTurnInput): ChatMessageRow[] {
  const now = input.now ?? new Date()
  const { response } = input
  const assistantMeta: NonNullable<ChatMessageRow['meta']> = { mode: input.mode }
  if (response.toolsUsed?.length) assistantMeta.tools = response.toolsUsed
  if (response.corrections?.length) assistantMeta.corrections = response.corrections
  if (response.toolTrace?.length) assistantMeta.toolTrace = response.toolTrace
  if (typeof input.ms === 'number') assistantMeta.ms = input.ms
  return [
    {
      userId: input.userId,
      householdId: input.householdId,
      channel: 'web',
      role: 'user',
      body: input.userMessage.slice(0, MAX_BODY_CHARS),
      meta: { mode: input.mode, path: input.path },
      createdAt: now,
    },
    {
      userId: input.userId,
      householdId: input.householdId,
      channel: 'web',
      role: 'assistant',
      body: (response.message ?? '').slice(0, MAX_BODY_CHARS),
      meta: assistantMeta,
      createdAt: new Date(now.getTime() + 1),
    },
  ]
}

/** Writes one web turn (user + assistant rows). The caller swallows failures. */
export async function recordWebChatTurn(
  input: Omit<WebTurnInput, 'householdId'> & { householdId?: string | null },
  db: any = defaultDb,
): Promise<void> {
  let householdId = input.householdId ?? null
  if (input.householdId === undefined) {
    const [u] = await db
      .select({ householdId: users.primaryHouseholdId })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
    householdId = u?.householdId ?? null
  }
  await db.insert(chatMessages).values(buildWebTurnRows({ ...input, householdId }))
}

/** Deletes chat rows older than CHAT_RETENTION_DAYS. Returns how many went. */
export async function purgeOldChatMessages(db: any = defaultDb): Promise<number | null> {
  const res: any = await db.execute(sql`
    DELETE FROM chat_messages WHERE created_at < now() - make_interval(days => ${CHAT_RETENTION_DAYS})
  `)
  return typeof res?.rowCount === 'number' ? res.rowCount : null
}

let lastPurgeDay: string | null = null

/** Called from the scheduler tick: purge once per day per process. */
export async function purgeOldChatMessagesIfDue(now: Date = new Date()): Promise<number | null> {
  const day = now.toISOString().slice(0, 10)
  if (lastPurgeDay === day) return null
  lastPurgeDay = day
  return purgeOldChatMessages()
}
