import { BRAND_NAME } from '@ona/shared'
import { env } from '../config/env.js'

/**
 * Transactional email through Resend's REST API (specs/email.md). A plain
 * fetch, no SDK, so tests stub `fetch` and nothing else.
 *
 * Without `RESEND_API_KEY` nothing is sent: every call resolves
 * `{ status: 'skipped' }` and logs one line, like WhatsApp unconfigured.
 * Sending never throws: a failure comes back as `{ status: 'failed' }` so the
 * caller (an invite, a newsletter run) keeps going and reports it.
 *
 * Logs carry the masked recipient only (`m***@g***.com`), never the address.
 */

export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
  /** Extra headers, e.g. `List-Unsubscribe`. */
  headers?: Record<string, string>
}

export type EmailResult =
  | { status: 'sent'; id: string | null }
  | { status: 'skipped'; reason: 'not_configured' }
  | { status: 'failed'; error: string }

export interface EmailConfig {
  apiKey: string
  from: string
  baseUrl: string
  fetch: typeof fetch
}

/** Resend accepts up to 100 messages per batch call. */
export const RESEND_BATCH_LIMIT = 100
const TIMEOUT_MS = 20_000

export function defaultEmailConfig(): EmailConfig {
  return {
    apiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM,
    baseUrl: env.RESEND_BASE_URL,
    fetch: (...args) => fetch(...args),
  }
}

export function isEmailConfigured(cfg: Pick<EmailConfig, 'apiKey'> = defaultEmailConfig()): boolean {
  return cfg.apiKey.trim().length > 0
}

/** `miguel@gmail.com` → `m***@g***.com`. For logs: enough to tell two people apart, not to write to them. */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().split('@')
  const dot = domain.lastIndexOf('.')
  const host = dot > 0 ? domain.slice(0, dot) : domain
  const tld = dot > 0 ? domain.slice(dot) : ''
  return `${local.slice(0, 1)}***@${host.slice(0, 1)}***${tld}`
}

/** `List-Unsubscribe` for an opt-out page (the click on that page is what unsubscribes). */
export function listUnsubscribeHeaders(url: string): Record<string, string> {
  return { 'List-Unsubscribe': `<${url}>` }
}

function toResendBody(msg: EmailMessage, from: string): Record<string, unknown> {
  return {
    from,
    to: [msg.to],
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    ...(msg.headers && Object.keys(msg.headers).length > 0 ? { headers: msg.headers } : {}),
  }
}

async function postResend(cfg: EmailConfig, path: string, body: unknown): Promise<any> {
  const r = await cfg.fetch(`${cfg.baseUrl.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const json: any = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(json?.message ?? json?.error ?? `Resend ${r.status}`)
  return json
}

export async function sendEmail(msg: EmailMessage, cfg: EmailConfig = defaultEmailConfig()): Promise<EmailResult> {
  if (!isEmailConfigured(cfg)) {
    console.log(`[email] not configured (RESEND_API_KEY unset): not sending «${msg.subject}» to ${maskEmail(msg.to)}`)
    return { status: 'skipped', reason: 'not_configured' }
  }
  try {
    const json = await postResend(cfg, '/emails', toResendBody(msg, cfg.from))
    console.log(`[email] sent «${msg.subject}» to ${maskEmail(msg.to)} (${json?.id ?? 'no id'})`)
    return { status: 'sent', id: json?.id ?? null }
  } catch (err: any) {
    const error = String(err?.message ?? err)
    console.error(`[email] failed «${msg.subject}» to ${maskEmail(msg.to)}: ${error}`)
    return { status: 'failed', error }
  }
}

/**
 * Many messages through `POST /emails/batch`, `RESEND_BATCH_LIMIT` per call.
 * Results come back in the input order; a failed call marks its whole chunk failed.
 */
export async function sendEmailBatch(
  msgs: EmailMessage[],
  cfg: EmailConfig = defaultEmailConfig(),
): Promise<EmailResult[]> {
  if (msgs.length === 0) return []
  if (!isEmailConfigured(cfg)) {
    console.log(`[email] not configured (RESEND_API_KEY unset): not sending a batch of ${msgs.length}`)
    return msgs.map(() => ({ status: 'skipped', reason: 'not_configured' }) as const)
  }
  const results: EmailResult[] = []
  for (let i = 0; i < msgs.length; i += RESEND_BATCH_LIMIT) {
    const chunk = msgs.slice(i, i + RESEND_BATCH_LIMIT)
    try {
      const json = await postResend(cfg, '/emails/batch', chunk.map((m) => toResendBody(m, cfg.from)))
      const ids: any[] = Array.isArray(json?.data) ? json.data : []
      chunk.forEach((_, k) => results.push({ status: 'sent', id: ids[k]?.id ?? null }))
      console.log(`[email] batch sent: ${chunk.length} messages`)
    } catch (err: any) {
      const error = String(err?.message ?? err)
      console.error(`[email] batch of ${chunk.length} failed: ${error}`)
      chunk.forEach(() => results.push({ status: 'failed', error }))
    }
  }
  return results
}

// ─── Template ────────────────────────────────────────────────────

export interface BrandEmail {
  /** Hidden preview line shown by the inbox next to the subject. */
  preheader?: string
  heading: string
  paragraphs: string[]
  button?: { label: string; url: string }
  /** Small print under the button (why you get this, how to leave). */
  footer?: string[]
  unsubscribeUrl?: string
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const INK = '#1A1612'
const CREAM = '#FAF6EE'
const TERRACOTTA = '#C65D38'
const MUTED = '#6B6158'
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif"
const SANS = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

/**
 * The brand shell: cream page, 600 px column, Fraunces with email-safe
 * fallbacks, tables and inline styles (Gmail and Apple Mail on a phone).
 * Every string is escaped; the text version says the same thing.
 */
export function renderBrandEmail(e: BrandEmail): { html: string; text: string } {
  const p = (t: string) =>
    `<p style="margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.55;color:${INK};">${esc(t)}</p>`
  const small = (t: string) =>
    `<p style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:1.5;color:${MUTED};">${esc(t)}</p>`
  const button = e.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;"><tr><td style="background:${TERRACOTTA};border-radius:999px;"><a href="${esc(e.button.url)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;">${esc(e.button.label)}</a></td></tr></table>`
    : ''
  const footer = [
    ...(e.footer ?? []).map(small),
    e.unsubscribeUrl
      ? `<p style="margin:0 0 8px;font-family:${SANS};font-size:13px;line-height:1.5;color:${MUTED};"><a href="${esc(e.unsubscribeUrl)}" style="color:${MUTED};">Darme de baja</a></p>`
      : '',
  ].join('')
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.heading)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
${e.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(e.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 0 24px;font-family:${SERIF};font-size:22px;color:${TERRACOTTA};">${esc(BRAND_NAME)}</td></tr>
<tr><td style="padding:0 0 16px;font-family:${SERIF};font-size:30px;line-height:1.2;color:${INK};">${esc(e.heading)}</td></tr>
<tr><td>${e.paragraphs.map(p).join('')}${button}</td></tr>
<tr><td style="padding:16px 0 0;border-top:1px solid #E6DED2;">${footer}</td></tr>
</table></td></tr></table>
</body></html>`
  const text = [
    e.heading,
    '',
    ...e.paragraphs.flatMap((t) => [t, '']),
    ...(e.button ? [`${e.button.label}: ${e.button.url}`, ''] : []),
    ...(e.footer ?? []),
    ...(e.unsubscribeUrl ? [`Darme de baja: ${e.unsubscribeUrl}`] : []),
  ]
    .join('\n')
    .trim()
  return { html, text }
}
