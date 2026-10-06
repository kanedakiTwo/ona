import type { ChatMessage } from '../assistant/types.js'

/**
 * Pure: stored WhatsApp rows → the `history` array `chat()` expects.
 *
 * The web client sends its own last-20 history; WhatsApp has no client, so
 * we rebuild it from `whatsapp_messages`. A conversation "session" is the
 * last 12 h — older context is more confusing than helpful in a chat app.
 */

export interface HistoryRow {
  direction: 'in' | 'out' | string
  /** Outbound `system`/`link`/`ack` notices (budget, linking help, "me pongo con ello") are not conversation. */
  kind?: string
  body: string | null
  status: string
  createdAt: Date
}

export const HISTORY_MAX_MESSAGES = 20
export const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000

const NON_CONVERSATION_KINDS = new Set(['system', 'link', 'ack'])

/** Placeholder user turn when ONA spoke first (proactive nudge, alert). */
export const ONA_STARTED_MARKER = '(ONA me ha escrito primero)'

export function buildChatHistory(
  rows: readonly HistoryRow[],
  now: Date = new Date(),
  opts: { maxMessages?: number; windowMs?: number } = {},
): ChatMessage[] {
  const maxMessages = opts.maxMessages ?? HISTORY_MAX_MESSAGES
  const windowMs = opts.windowMs ?? HISTORY_WINDOW_MS
  const since = now.getTime() - windowMs

  const usable = [...rows]
    .filter((r) => r.createdAt.getTime() >= since)
    .filter((r) => typeof r.body === 'string' && r.body.trim().length > 0)
    // Inbound rows count once answered; outbound once Meta accepted them.
    .filter((r) => (r.direction === 'in' ? r.status === 'processed' : r.status === 'sent'))
    .filter((r) => !(r.direction === 'out' && NON_CONVERSATION_KINDS.has(r.kind ?? '')))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(-maxMessages)

  // Merge consecutive same-role turns (two quick messages from the user, or
  // a reply split across several WhatsApp messages) — the Messages API wants
  // alternating roles.
  const merged: ChatMessage[] = []
  for (const r of usable) {
    const role: ChatMessage['role'] = r.direction === 'in' ? 'user' : 'assistant'
    const content = r.body!.trim()
    const last = merged[merged.length - 1]
    if (last && last.role === role) last.content = `${last.content}\n\n${content}`
    else merged.push({ role, content })
  }

  if (merged[0]?.role === 'assistant') {
    merged.unshift({ role: 'user', content: ONA_STARTED_MARKER })
  }
  // The caller appends the new user message; a trailing user turn (one that
  // never got a reply) would break alternation, so drop it.
  while (merged.length > 0 && merged[merged.length - 1].role === 'user') merged.pop()

  return merged
}
