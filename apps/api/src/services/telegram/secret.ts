import crypto from 'crypto'

/**
 * Telegram signs nothing: setWebhook takes a `secret_token` and every update
 * carries it back in `X-Telegram-Bot-Api-Secret-Token`. Compared in constant
 * time (both sides hashed first, so the length doesn't leak either).
 */
export const TELEGRAM_SECRET_HEADER = 'x-telegram-bot-api-secret-token'

export function verifyWebhookSecret(header: string | undefined | null, secret: string): boolean {
  if (!secret || typeof header !== 'string' || header.length === 0) return false
  const a = crypto.createHash('sha256').update(header, 'utf8').digest()
  const b = crypto.createHash('sha256').update(secret, 'utf8').digest()
  return crypto.timingSafeEqual(a, b)
}
