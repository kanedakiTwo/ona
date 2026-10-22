import type { AssistantResponse, ChatMessage } from '../assistant/types.js'
import type { ChatOptions } from '../assistant/engine.js'
import type { TokenUsage } from '../advisorBudget.js'
import type { WeekView } from '../menuText.js'
import { buildChatHistory } from '../whatsapp/history.js'
import { COPY, replyMessages, STALE_MESSAGE_MS } from '../whatsapp/inbound.js'
import { controlCommand } from '../whatsapp/commands.js'
import { lastSentButtons, outboundBody, renderPlainText, type OutboundMessage } from '../whatsapp/render.js'
import { TELEGRAM_COPY } from './copy.js'
import { toTelegramSends, type TelegramSend } from './format.js'
import { compactTrace, toHistoryRows, type TelegramHistoryEntry } from './history.js'
import type { TelegramInbound } from './updateParser.js'

/**
 * Inbound orchestrator for Telegram (PRO-313, piece 1): one update in → zero
 * or more messages out. It reuses WhatsApp's pieces: the same engine in
 * `whatsapp` mode (same tools, same health rule: nothing about health is
 * stored from here), the same history builder, the same reply renderer and
 * the same € budget, monthly spend cap and paused-account gate. Side effects
 * come through `deps` (tested with fakes in `telegram.test.ts`; real ones in
 * `wiring.ts`).
 */
export interface TelegramDeps {
  webUrl: string
  supportEmail?: string
  now: () => Date
  store: {
    getLinkByChat: (chatId: string) => Promise<{ userId: string; history: TelegramHistoryEntry[] } | null>
    consumeLinkCode: (code: string, chatId: string, now: Date) => Promise<{ userId: string } | null>
    claimUpdate: (chatId: string, updateId: number, now: Date) => Promise<boolean>
    appendHistory: (chatId: string, entries: TelegramHistoryEntry[], now: Date) => Promise<void>
  }
  client: {
    sendMessage: (chatId: string, send: TelegramSend) => Promise<unknown>
    sendTyping: (chatId: string) => Promise<void>
  }
  chat: (userId: string, message: string, history: ChatMessage[], opts: ChatOptions) => Promise<AssistantResponse & { usage: TokenUsage }>
  checkBudget: (userId: string) => Promise<{ exceeded: boolean; budgetMicros: number }>
  isPaused?: (userId: string) => Promise<boolean>
  recordUsage: (userId: string, usage: TokenUsage) => Promise<void>
  menuDigest?: (userId: string, menuId: string | null, view: WeekView) => Promise<string | null>
  /** «escribiendo…» is renewed this often while a turn runs (ms; 0 = only once). */
  typingEveryMs?: number
}

/** The options every Telegram turn runs the engine with. */
export const TELEGRAM_CHAT_OPTIONS: Pick<ChatOptions, 'mode' | 'surface' | 'onboarding'> = {
  mode: 'whatsapp',
  surface: 'telegram',
  // The sign-up's first steps happen on the web or on WhatsApp, not here.
  onboarding: false,
}

export async function processTelegramUpdate(msg: TelegramInbound, deps: TelegramDeps): Promise<void> {
  const now = deps.now()
  const { store, client } = deps
  const send = async (messages: OutboundMessage[]): Promise<TelegramHistoryEntry[]> => {
    const out: TelegramHistoryEntry[] = []
    for (const m of messages) {
      for (const s of toTelegramSends([m])) {
        try {
          await client.sendMessage(msg.chatId, s)
        } catch (err: any) {
          console.error('[telegram] send failed:', err?.message ?? err)
        }
      }
      out.push({ direction: 'out', kind: 'reply', body: outboundBody(m), status: 'sent', createdAt: deps.now().toISOString() })
    }
    return out
  }
  const sendText = (text: string) => send(renderPlainText(text))

  if (msg.date > 0 && now.getTime() - msg.date * 1000 > STALE_MESSAGE_MS) return

  // ── 1. Linking: `/start <code>` from the t.me link.
  if (msg.kind === 'start' && msg.startPayload) {
    const linked = await store.consumeLinkCode(msg.startPayload, msg.chatId, now)
    if (linked) {
      await sendText(TELEGRAM_COPY.linked)
      return
    }
  }

  // ── 2. Who is this?
  const link = await store.getLinkByChat(msg.chatId)
  if (!link) {
    await sendText(TELEGRAM_COPY.notLinked)
    return
  }
  if (!(await store.claimUpdate(msg.chatId, msg.updateId, now))) return
  const userId = link.userId

  // A plain `/start` (or a stale code) from a chat that is already linked.
  if (msg.kind === 'start') {
    await sendText(TELEGRAM_COPY.linked)
    return
  }
  if (msg.kind !== 'text' || !msg.text?.trim()) {
    await sendText(TELEGRAM_COPY.unsupported)
    return
  }
  const text = msg.text.trim()
  if (controlCommand(text) === 'human') {
    await sendText(COPY.human(deps.supportEmail))
    return
  }
  if (deps.isPaused && (await deps.isPaused(userId))) {
    await sendText(COPY.paused(`${deps.webUrl.replace(/\/$/, '')}/profile/suscripcion`))
    return
  }

  void client.sendTyping(msg.chatId)
  const typing = deps.typingEveryMs ? setInterval(() => void client.sendTyping(msg.chatId), deps.typingEveryMs) : null
  try {
    // Same cap as the web chat and WhatsApp, before any paid work.
    const budget = await deps.checkBudget(userId)
    if (budget.exceeded) {
      await sendText(COPY.budget((budget.budgetMicros / 1_000_000).toFixed(0)))
      return
    }
    const rows = toHistoryRows(link.history ?? [])
    const history = buildChatHistory(rows, now)
    const { usage, ...response } = await deps.chat(userId, text, history, { ...TELEGRAM_CHAT_OPTIONS })
    try {
      await deps.recordUsage(userId, usage)
    } catch (err) {
      console.warn('[telegram] recordUsage failed (continuing):', err)
    }
    const inbound: TelegramHistoryEntry = {
      direction: 'in',
      kind: 'text',
      body: text,
      status: 'processed',
      createdAt: now.toISOString(),
      meta: { toolTrace: compactTrace(response.toolTrace) },
    }
    const replies = await replyMessages(response, userId, { menuDigest: deps.menuDigest, webUrl: deps.webUrl }, lastSentButtons(rows))
    const out = await send(replies)
    await store.appendHistory(msg.chatId, [inbound, ...out], deps.now())
  } catch (err: any) {
    console.error('[telegram] processing failed:', err?.message ?? err)
    await sendText(COPY.error)
  } finally {
    if (typing) clearInterval(typing)
  }
}

/** One turn at a time per chat, in arrival order (like WhatsApp's queue per phone). */
const queues = new Map<string, Promise<void>>()

export function enqueueTelegramUpdate(msg: TelegramInbound, deps: TelegramDeps): Promise<void> {
  const prev = queues.get(msg.chatId) ?? Promise.resolve()
  const next = prev
    .catch(() => {})
    .then(() => processTelegramUpdate(msg, deps))
    .catch((err) => console.error('[telegram] turn failed:', err?.message ?? err))
  queues.set(msg.chatId, next)
  void next.finally(() => {
    if (queues.get(msg.chatId) === next) queues.delete(msg.chatId)
  })
  return next
}
