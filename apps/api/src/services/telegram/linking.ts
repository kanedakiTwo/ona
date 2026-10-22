import crypto from 'crypto'

/**
 * Account ↔ Telegram chat linking, pure half (PRO-313). A bot can't write
 * first, so the link is `t.me/<bot>?start=<code>`: tapping «Iniciar» sends the
 * bot `/start <code>` from that chat, which proves both the app session (it
 * minted the code) and the chat. One-time, 10 minutes, like WhatsApp's.
 */
export const TG_LINK_CODE_TTL_MS = 10 * 60 * 1000
/** Telegram's deep-link payload: up to 64 chars of [A-Za-z0-9_-]. */
const PAYLOAD = /^[A-Za-z0-9_-]{1,64}$/

/** 24 random bytes → 32 base64url chars: unguessable, valid as a start payload. */
export function generateTelegramLinkCode(bytes: (n: number) => Buffer = crypto.randomBytes): string {
  return bytes(24).toString('base64url')
}

export function isValidStartPayload(payload: string | null | undefined): payload is string {
  return typeof payload === 'string' && PAYLOAD.test(payload)
}

export function telegramStartLink(botUsername: string, code: string): string {
  return `https://t.me/${botUsername.replace(/^@/, '')}?start=${code}`
}
