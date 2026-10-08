import crypto from 'crypto'

/**
 * Phone ↔ user linking, pure half. The user taps "Conectar WhatsApp" in
 * /profile, which mints a one-time code and opens
 * `wa.me/<our number>?text=Vincular Mimoia: <code>`. Sending that message from
 * the phone proves possession of both the app session and the number.
 */

/** No 0/O/1/I — the code may get typed by hand. */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const LINK_CODE_LENGTH = 6
export const LINK_CODE_TTL_MS = 10 * 60 * 1000

const DIGITS = '23456789'

/**
 * 6 chars from the unambiguous alphabet, always with at least one digit so a
 * plain 6-letter word in a chat message ("PLATOS") is never a candidate.
 */
export function generateLinkCode(randomInt: (max: number) => number = crypto.randomInt): string {
  const chars: string[] = []
  for (let i = 0; i < LINK_CODE_LENGTH; i += 1) {
    chars.push(LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)])
  }
  if (!chars.some((c) => DIGITS.includes(c))) {
    chars[randomInt(LINK_CODE_LENGTH)] = DIGITS[randomInt(DIGITS.length)]
  }
  return chars.join('')
}

/** Candidate codes in a free-text message (case-insensitive), most likely first. */
export function extractLinkCodeCandidates(text: string | null | undefined): string[] {
  if (!text) return []
  const tokens = text.toUpperCase().match(/[A-Z0-9]+/g) ?? []
  const valid = tokens.filter(
    (t) =>
      t.length === LINK_CODE_LENGTH &&
      [...t].every((c) => LINK_CODE_ALPHABET.includes(c)) &&
      /[2-9]/.test(t),
  )
  return Array.from(new Set(valid)).slice(0, 3)
}

/**
 * WhatsApp-first entry point. Deliberately carries no token: the page makes
 * the logged-in user send a one-time code FROM their WhatsApp, so the phone
 * that gets linked is always the one that sent the code — a forwarded link
 * can't attach someone else's phone to your account.
 */
export function connectUrl(webUrl: string): string {
  return `${webUrl}/whatsapp/conectar`
}

export function linkMessageText(code: string): string {
  return `Vincular Mimoia: ${code}`
}

export function buildWaLink(displayNumber: string, text?: string): string {
  const digits = displayNumber.replace(/\D/g, '')
  return text
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${digits}`
}

/** "+34 ••• ••• 222" — enough to recognise your own number in /profile. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 5) return `+${digits}`
  return `+${digits.slice(0, 2)} ••• ••• ${digits.slice(-3)}`
}
