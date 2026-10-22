import { isValidStartPayload } from './linking.js'

/**
 * Pure: one Telegram `Update` → what the inbound flow needs, or null for
 * anything that isn't a person writing to the bot in a private chat (groups,
 * channels, edits, other bots, callback queries…).
 */
export interface TelegramInbound {
  updateId: number
  /** Private chat id, as text (it can exceed 32 bits). */
  chatId: string
  /** Unix seconds. */
  date: number
  /** `start` = `/start` (with or without a payload); `unsupported` = voice, photo, sticker… */
  kind: 'text' | 'start' | 'unsupported'
  text: string | null
  /** The `/start <payload>` code, only when it is a valid deep-link payload. */
  startPayload: string | null
}

const START = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/

export function parseTelegramUpdate(body: unknown): TelegramInbound | null {
  if (!body || typeof body !== 'object') return null
  const update = body as Record<string, any>
  if (typeof update.update_id !== 'number') return null
  const message = update.message
  if (!message || typeof message !== 'object') return null
  const chat = message.chat
  if (!chat || chat.type !== 'private' || (typeof chat.id !== 'number' && typeof chat.id !== 'string')) return null
  if (message.from?.is_bot === true) return null
  const base = {
    updateId: update.update_id,
    chatId: String(chat.id),
    date: typeof message.date === 'number' ? message.date : 0,
  }
  if (typeof message.text !== 'string' || message.text.trim() === '') {
    return { ...base, kind: 'unsupported', text: null, startPayload: null }
  }
  const text = message.text
  const start = START.exec(text.trim())
  if (start) {
    return { ...base, kind: 'start', text, startPayload: isValidStartPayload(start[1]) ? start[1] : null }
  }
  return { ...base, kind: 'text', text, startPayload: null }
}
