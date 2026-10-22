import { env } from '../../config/env.js'

/**
 * Mimo on Telegram (PRO-313, piece 1) is live only when the bot token, the
 * webhook secret and the bot's username are all set. Without
 * `TELEGRAM_BOT_TOKEN` everything is off: the webhook and the link-code
 * endpoint answer 404 and nothing is sent.
 */
export function isTelegramConfigured(
  cfg: { token: string; secret: string; username: string } = {
    token: env.TELEGRAM_BOT_TOKEN,
    secret: env.TELEGRAM_WEBHOOK_SECRET,
    username: env.TELEGRAM_BOT_USERNAME,
  },
): boolean {
  return Boolean(cfg.token && cfg.secret && cfg.username)
}
