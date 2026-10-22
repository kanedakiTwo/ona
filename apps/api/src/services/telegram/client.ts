import { env } from '../../config/env.js'
import type { TelegramSend } from './format.js'

/**
 * Thin Telegram Bot API client (PRO-313). Throws on any non-ok answer so the
 * caller can record the failure; never logs the token.
 */
type Fetch = typeof fetch

const API_BASE = 'https://api.telegram.org'

async function call(method: string, body: unknown, fetchImpl: Fetch = fetch, token: string = env.TELEGRAM_BOT_TOKEN): Promise<any> {
  if (!token) throw new Error('Telegram no está configurado')
  const res = await fetchImpl(`${API_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json: any = await res.json().catch(() => null)
  if (!res.ok || !json?.ok) {
    throw new Error(`Telegram ${method} ${res.status}: ${String(json?.description ?? '').slice(0, 200)}`)
  }
  return json.result
}

export async function sendMessage(chatId: string, send: TelegramSend, fetchImpl?: Fetch): Promise<number | null> {
  const result = await call('sendMessage', { chat_id: chatId, ...send }, fetchImpl)
  return typeof result?.message_id === 'number' ? result.message_id : null
}

/** «escribiendo…» for ~5 s. Best effort. */
export async function sendTyping(chatId: string, fetchImpl?: Fetch): Promise<void> {
  await call('sendChatAction', { chat_id: chatId, action: 'typing' }, fetchImpl).catch(() => {})
}
