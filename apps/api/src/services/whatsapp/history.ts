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
  /** Inbound rows: `{ toolTrace }` of the turn they started (inbound.ts). */
  meta?: unknown
}

/** Bounds for the ⟦hecho: …⟧ line: enough to know what happened, not a log dump. */
const TRACE_ITEM_MAX = 260
const TRACE_MAX = 1200

/**
 * One line telling the model what its tools did in a past turn:
 * `⟦hecho: swap_meal {"dayIndex":3,…} → Hecho. He puesto "X" en la cena del jueves. · log_cooked … → …⟧`.
 * Without it, history was only the text of past replies, so Mimo didn't know
 * what it had done ("ya estaba hecho desde hace un turno", 2026-10-08/10).
 */
export function traceLine(meta: unknown): string | null {
  const trace = (meta as { toolTrace?: unknown } | null)?.toolTrace
  if (!Array.isArray(trace) || trace.length === 0) return null
  const items = trace
    .filter((t): t is { name: string; input?: string; summary?: string; error?: boolean } => !!t && typeof (t as any).name === 'string')
    .map((t) => {
      const item = `${t.name} ${t.input ?? ''} → ${t.error ? 'ERROR: ' : ''}${t.summary ?? ''}`.replace(/\s+/g, ' ').trim()
      return item.length > TRACE_ITEM_MAX ? `${item.slice(0, TRACE_ITEM_MAX - 1)}…` : item
    })
  if (items.length === 0) return null
  let line = items.join(' · ')
  if (line.length > TRACE_MAX) line = `${line.slice(0, TRACE_MAX - 1)}…`
  return `⟦hecho: ${line}⟧`
}



export const HISTORY_MAX_MESSAGES = 20
export const HISTORY_WINDOW_MS = 12 * 60 * 60 * 1000

/**
 * Shop-order links (`…/c/<token>`) from earlier replies. The model copied
 * them into a new "dame la compra" answer instead of calling
 * prepare_shop_orders (2026-10-08: Miguel got the morning's orders, written
 * before the v1.1 rules). Links only ever come from this turn's tools.
 */
const SHOP_LINK = /https?:\/\/\S+?\/c\/[A-Za-z0-9_-]+/g
export const OLD_SHOP_LINK = '[enlace de un pedido anterior]'

const NON_CONVERSATION_KINDS = new Set(['system', 'link', 'ack', 'review', 'optout', 'optin', 'optin_prompt'])

/** Placeholder user turn when the assistant (Mimo) spoke first (proactive nudge, alert). */
export const ONA_STARTED_MARKER = '(Mimo me ha escrito primero)'

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
    // Inbound rows count once answered. Outbound replies count even if
    // delivery failed: the actions behind them DID run, and leaving the
    // request "unanswered" in history makes the model redo it next turn.
    .filter((r) => (r.direction === 'in' ? r.status === 'processed' : r.status === 'sent' || r.kind === 'reply'))
    .filter((r) => !(r.direction === 'out' && NON_CONVERSATION_KINDS.has(r.kind ?? '')))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(-maxMessages)

  // Merge consecutive same-role turns (two quick messages from the user, or
  // a reply split across several WhatsApp messages) — the Messages API wants
  // alternating roles.
  const merged: ChatMessage[] = []
  // The trace of a user turn goes in front of the reply it produced.
  let pendingTrace: string | null = null
  for (const r of usable) {
    const role: ChatMessage['role'] = r.direction === 'in' ? 'user' : 'assistant'
    let content = role === 'assistant' ? r.body!.trim().replace(SHOP_LINK, OLD_SHOP_LINK) : r.body!.trim()
    if (role === 'user') {
      pendingTrace = traceLine(r.meta)
    } else if (pendingTrace && r.kind === 'reply') {
      content = `${pendingTrace}\n${content}`
      pendingTrace = null
    }
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
