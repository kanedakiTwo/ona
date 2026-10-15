import type { EmailMessage, EmailResult } from './email.js'

/**
 * Staging mail sink (specs/email.md → «Buzón de pruebas»). With
 * `EMAIL_SINK_DOMAINS=example.com` set, an email to an address in one of
 * those domains is not sent: it is kept in memory (the last 300) and can be
 * read back with `GET /email-sink?to=<address>`. The test households
 * (ona-hq hogares-prueba) use it to follow the invitation, welcome and
 * password-reset emails. Never on production (`RAILWAY_ENVIRONMENT_NAME=production`).
 */

export interface SinkedEmail extends EmailMessage {
  id: string
  at: string
}

const MAX_KEPT = 300
const kept: SinkedEmail[] = []
let seq = 0

export function emailSinkDomains(e: NodeJS.ProcessEnv = process.env): string[] {
  if (e.RAILWAY_ENVIRONMENT_NAME === 'production') return []
  return (e.EMAIL_SINK_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
}

export function isSinkAddress(to: string, domains: string[] = emailSinkDomains()): boolean {
  const domain = to.trim().toLowerCase().split('@')[1]
  return !!domain && domains.includes(domain)
}

export function sinkEmail(msg: EmailMessage): EmailResult {
  const id = `sink-${Date.now()}-${++seq}`
  kept.push({ ...msg, to: msg.to.trim().toLowerCase(), id, at: new Date().toISOString() })
  if (kept.length > MAX_KEPT) kept.splice(0, kept.length - MAX_KEPT)
  console.log(`[email] sink: kept «${msg.subject}» (${id})`)
  return { status: 'sent', id }
}

/** What the sink holds for this address, oldest first. */
export function readSink(to: string): SinkedEmail[] {
  const t = to.trim().toLowerCase()
  return kept.filter((m) => m.to === t)
}

/** Tests only. */
export function clearSink(): void {
  kept.length = 0
}
