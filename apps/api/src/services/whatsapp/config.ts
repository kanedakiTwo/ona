import { env } from '../../config/env.js'

/** The channel is live only when Meta credentials + webhook secrets are set. */
export function isWhatsAppConfigured(): boolean {
  return Boolean(
    env.WHATSAPP_ACCESS_TOKEN &&
      env.WHATSAPP_PHONE_NUMBER_ID &&
      env.WHATSAPP_APP_SECRET &&
      env.WHATSAPP_VERIFY_TOKEN,
  )
}

/**
 * v1 gate: only the emails in `WHATSAPP_ALLOWED_EMAILS` may link a phone.
 * An empty list opens the channel to every user.
 */
export function isUserAllowed(
  email: string | null | undefined,
  allowed: readonly string[] = env.WHATSAPP_ALLOWED_EMAILS,
): boolean {
  if (allowed.length === 0) return true
  if (!email) return false
  return allowed.includes(email.trim().toLowerCase())
}
