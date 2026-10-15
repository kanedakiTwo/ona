import { env } from '../config/env.js'
import {
  BODY,
  BORDER_SOFT,
  INK,
  MUTED,
  PAPER,
  SANS,
  SERIF,
  TERRACOTTA,
  brandAssets,
  button,
  emailDocument,
  esc,
  footerBand,
  headlineRow,
  masthead,
  paragraphs,
  plainHeadline,
  row,
  signature,
  type BrandAssets,
  type Signer,
} from './emailBrand.js'

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
  /** Small caps line under the logo (e.g. «Lista de espera»). */
  eyebrow?: string
  /** The one headline; `*word*` goes in the terracotta italic. */
  heading: string
  paragraphs: string[]
  /** A short numbered list after the paragraphs («Para empezar»). */
  steps?: string[]
  button?: { label: string; url: string }
  /** Paragraphs after the button (e.g. how the link works). */
  after?: string[]
  /** «Un abrazo,» before the signer's name. */
  signoff?: string
  /** Who signs (Miguel on the personal emails, constitution §5). */
  from?: Signer
  /** Small print in the footer band (why you get this, how to leave). */
  footer?: string[]
  unsubscribeUrl?: string
  /** Logo, symbol and home link; defaults to `WEB_PUBLIC_URL`. */
  assets?: BrandAssets
}

/**
 * The brand shell for the transactional emails, the same as the newsletter
 * (emailBrand.ts): logo, headline, paragraphs, an optional numbered list,
 * the forest button, the signature and the cream-deep footer band. Every
 * string is escaped; the text version says the same thing.
 */
export function renderBrandEmail(e: BrandEmail): { html: string; text: string } {
  const assets = e.assets ?? brandAssets(env.WEB_PUBLIC_URL)
  const body = (list: string[], padding: string) =>
    list.length ? row(list.map((t) => paragraphs(t, `${BODY}font-size:17px;line-height:1.65;`, 16)).join(''), padding) : ''
  const steps = e.steps?.length
    ? row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};border:1px solid ${BORDER_SOFT};border-radius:16px;"><tr><td style="padding:20px 22px 8px;">${e.steps
          .map(
            (t, k) =>
              `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;"><tr><td width="34" valign="top" style="font-family:${SERIF};font-size:22px;line-height:1.1;color:${TERRACOTTA};">${k + 1}</td><td valign="top" style="font-family:${SANS};font-size:16px;line-height:1.55;color:${INK};">${esc(t)}</td></tr></table>`,
          )
          .join('')}</td></tr></table>`,
        '4px 28px 26px',
      )
    : ''
  const html = emailDocument(
    plainHeadline(e.heading),
    e.preheader,
    [
      masthead(assets, e.eyebrow),
      headlineRow(e.heading),
      body(e.paragraphs, '24px 28px 6px'),
      steps,
      e.button ? button(e.button.label, e.button.url, '6px 28px 26px') : '',
      body(e.after ?? [], '0 28px 6px'),
      signature(e.signoff, e.from, '10px 28px 40px'),
      footerBand(assets, [
        ...(e.footer ?? []).map(esc),
        ...(e.unsubscribeUrl ? [`<a href="${esc(e.unsubscribeUrl)}" style="color:${MUTED};">Darme de baja</a>`] : []),
      ]),
    ].join('\n'),
  )
  const text = [
    plainHeadline(e.heading),
    '',
    ...e.paragraphs.flatMap((t) => [t, '']),
    ...(e.steps?.length ? [...e.steps.map((t, k) => `${k + 1}. ${t}`), ''] : []),
    ...(e.button ? [`${e.button.label}: ${e.button.url}`, ''] : []),
    ...(e.after ?? []).flatMap((t) => [t, '']),
    ...(e.signoff ? [e.signoff] : []),
    ...(e.from ? [e.from.name, ...(e.from.role ? [e.from.role] : [])] : []),
    ...(e.signoff || e.from ? [''] : []),
    ...(e.footer ?? []),
    ...(e.unsubscribeUrl ? [`Darme de baja: ${e.unsubscribeUrl}`] : []),
  ]
    .join('\n')
    .trim()
  return { html, text }
}
