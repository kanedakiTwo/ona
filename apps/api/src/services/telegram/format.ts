import type { OutboundMessage } from '../whatsapp/render.js'

/**
 * Pure: the WhatsApp-shaped messages Mimo's reply renders to (whatsapp/render.ts)
 * → Telegram `sendMessage` payloads. Text goes as HTML (`*bold*` → <b>, the
 * rest escaped); the [[opciones]] buttons become a one-time reply keyboard,
 * so a tap sends the option back as an ordinary message, as on WhatsApp.
 */
export interface TelegramSend {
  text: string
  parse_mode: 'HTML'
  link_preview_options: { is_disabled: true }
  reply_markup?:
    | { keyboard: { text: string }[][]; one_time_keyboard: true; resize_keyboard: true }
    | { remove_keyboard: true }
}

/** Telegram's limit for one message's text. */
export const TG_TEXT_MAX = 4096

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** WhatsApp markup → Telegram HTML: only `*bold*` is translated; underscores stay (they live in URLs). */
export function toTelegramHtml(text: string): string {
  return escapeHtml(text).replace(/(^|[^\w*])\*([^*\n]+?)\*(?=[^\w*]|$)/g, '$1<b>$2</b>')
}

export function toTelegramSends(messages: readonly OutboundMessage[]): TelegramSend[] {
  const sends: TelegramSend[] = []
  for (const m of messages) {
    // Pictures aren't sent on Telegram yet (piece 1): the text version goes instead.
    if (m.type === 'image') {
      sends.push(...toTelegramSends(m.fallback.length > 0 ? m.fallback : [{ type: 'text', text: m.text }]))
      continue
    }
    const send: TelegramSend = { text: toTelegramHtml(m.text), parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
    if (m.type === 'buttons') {
      send.reply_markup = {
        keyboard: [m.buttons.map((b) => ({ text: b.title }))],
        one_time_keyboard: true,
        resize_keyboard: true,
      }
    }
    sends.push(send)
  }
  return sends
}
