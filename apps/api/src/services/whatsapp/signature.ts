import crypto from 'crypto'

/**
 * Verify Meta's `X-Hub-Signature-256: sha256=<hex>` header — an HMAC-SHA256
 * of the raw request body keyed with the app secret. Must run on the raw
 * bytes: re-serialising parsed JSON changes whitespace/escaping and breaks it.
 */
export function verifySignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim())
  if (!match) return false
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest()
  const received = Buffer.from(match[1], 'hex')
  return received.length === expected.length && crypto.timingSafeEqual(received, expected)
}

/** Test/E2E helper: the header Meta would send for `rawBody`. */
export function signBody(rawBody: Buffer | string, appSecret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
}
