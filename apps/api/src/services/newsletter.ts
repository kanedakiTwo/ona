import { createHash } from 'node:crypto'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { ASSISTANT_NAME, BRAND_NAME, waitlistUnsubscribePath } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { newsletterSends, users, waitlistEntries } from '../db/schema.js'
import { maskEmail, sendEmail, sendEmailBatch, type EmailMessage, type EmailResult } from './email.js'

/**
 * Newsletter «El menú de los viernes» (PRO-94, specs/newsletter.md).
 *
 *   - Recipients: waitlist entries that ticked the newsletter box and haven't
 *     left (`selectNewsletterRecipients`). PRO-95 adds users with their own box.
 *   - Idempotent per issue: each recipient is claimed in `newsletter_sends`
 *     (unique issue + sha256(email)) before the email goes out; a failed or
 *     unconfigured send releases the claim so a re-run retries only those.
 *   - One-click opt-out that turns off ONLY the newsletter (the place on the
 *     list stays): `/newsletter/baja?t=<token>` + `List-Unsubscribe(-Post)`.
 */

// ─── Content ─────────────────────────────────────────────────────

const httpsUrl = z.string().trim().url().max(2000).refine((u) => /^https?:\/\//.test(u), 'URL absoluta')

const block = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(1200),
  imageUrl: httpsUrl.optional(),
  imageAlt: z.string().trim().max(200).optional(),
  url: httpsUrl.optional(),
})

export const newsletterContentSchema = z.object({
  /** Opening line from Mimo (optional). */
  intro: z.string().trim().max(600).optional(),
  /** The star recipe always opens the email, full width, with its photo. */
  star: block.extend({ imageUrl: httpsUrl, imageAlt: z.string().trim().min(1).max(200), url: httpsUrl }),
  news: block.optional(),
  tip: block.optional(),
  cta: z.object({ label: z.string().trim().min(1).max(60), url: httpsUrl }),
  /** Small print (e.g. how the photos are made). */
  note: z.string().trim().max(400).optional(),
  signoff: z.string().trim().max(200).optional(),
})
export type NewsletterContent = z.infer<typeof newsletterContentSchema>

export const newsletterSendSchema = z.object({
  issueId: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'issueId: minúsculas, números y guiones'),
  subject: z.string().trim().min(1).max(160),
  preheader: z.string().trim().max(200).optional(),
  content: newsletterContentSchema,
  /** Send one proof to this address (must belong to an admin) and nothing else. */
  testTo: z.string().trim().toLowerCase().email().optional(),
  /** Count the recipients without sending. */
  dryRun: z.boolean().optional(),
})
export type NewsletterSendInput = z.infer<typeof newsletterSendSchema>

// ─── Template ────────────────────────────────────────────────────

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
const CARD = '#FFFFFF'
const SERIF = "Fraunces, Georgia, 'Times New Roman', serif"
const SANS = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"

function paragraphs(text: string, style: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px;${style}">${esc(p.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function img(url: string, alt: string, link?: string, radius = '16px'): string {
  const tag = `<img src="${esc(url)}" alt="${esc(alt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:${radius};">`
  return link ? `<a href="${esc(link)}" style="text-decoration:none;">${tag}</a>` : tag
}

function sideBlock(label: string, b: NonNullable<NewsletterContent['news']>): string {
  const body = paragraphs(b.body, `font-family:${SANS};font-size:15px;line-height:1.55;color:${INK};`)
  const link = b.url
    ? `<p style="margin:0;"><a href="${esc(b.url)}" style="font-family:${SANS};font-size:15px;font-weight:600;color:${TERRACOTTA};">Ver más</a></p>`
    : ''
  return `<tr><td style="padding:0 0 24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CARD};border-radius:16px;">
${b.imageUrl ? `<tr><td>${img(b.imageUrl, b.imageAlt ?? b.title, b.url, '16px 16px 0 0')}</td></tr>` : ''}
<tr><td style="padding:20px 20px 16px;">
<p style="margin:0 0 6px;font-family:${SANS};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">${esc(label)}</p>
<p style="margin:0 0 10px;font-family:${SERIF};font-size:22px;line-height:1.25;color:${INK};">${esc(b.title)}</p>
${body}${link}
</td></tr></table></td></tr>`
}

/**
 * The visual newsletter: the star recipe's photo full width at the top, then
 * cards with images. Tables + inline styles, 600 px, absolute image URLs with
 * `alt` (Gmail and Apple Mail on a phone). `unsubscribeUrl` is per recipient.
 */
export function renderNewsletterEmail(
  input: Pick<NewsletterSendInput, 'subject' | 'preheader' | 'content'>,
  links: { unsubscribeUrl: string; leaveListUrl?: string },
): { html: string; text: string } {
  const c = input.content
  const starBody = paragraphs(c.star.body, `font-family:${SANS};font-size:16px;line-height:1.55;color:${INK};`)
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(input.subject)}</title></head>
<body style="margin:0;padding:0;background:${CREAM};">
${input.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(input.preheader)}</div>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
<tr><td style="padding:0 4px 16px;font-family:${SERIF};font-size:22px;color:${TERRACOTTA};">${esc(BRAND_NAME)} <span style="font-family:${SANS};font-size:13px;color:${MUTED};">· El menú de los viernes</span></td></tr>
${c.intro ? `<tr><td style="padding:0 4px 16px;">${paragraphs(c.intro, `font-family:${SANS};font-size:16px;line-height:1.55;color:${INK};`)}</td></tr>` : ''}
<tr><td style="padding:0 0 16px;">${img(c.star.imageUrl, c.star.imageAlt, c.star.url)}</td></tr>
<tr><td style="padding:0 4px 8px;">
<p style="margin:0 0 6px;font-family:${SANS};font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">La receta de la semana</p>
<p style="margin:0 0 12px;font-family:${SERIF};font-size:30px;line-height:1.2;color:${INK};"><a href="${esc(c.star.url)}" style="color:${INK};text-decoration:none;">${esc(c.star.title)}</a></p>
${starBody}
</td></tr>
<tr><td style="padding:0 4px 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:${TERRACOTTA};border-radius:999px;"><a href="${esc(c.cta.url)}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;">${esc(c.cta.label)}</a></td></tr></table></td></tr>
${c.news ? sideBlock(`Novedad en ${BRAND_NAME}`, c.news) : ''}
${c.tip ? sideBlock(`Un truco con ${ASSISTANT_NAME}`, c.tip) : ''}
${c.signoff ? `<tr><td style="padding:0 4px 16px;">${paragraphs(c.signoff, `font-family:${SERIF};font-size:18px;line-height:1.4;color:${INK};`)}</td></tr>` : ''}
<tr><td style="padding:16px 4px 0;border-top:1px solid #E6DED2;">
${c.note ? `<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};">${esc(c.note)}</p>` : ''}
<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};">Te llega porque pediste el menú de los viernes de ${esc(BRAND_NAME)}.</p>
<p style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.5;color:${MUTED};"><a href="${esc(links.unsubscribeUrl)}" style="color:${MUTED};">No quiero recibir más el menú de los viernes</a>${links.leaveListUrl ? ` · <a href="${esc(links.leaveListUrl)}" style="color:${MUTED};">Salir de la lista de espera</a>` : ''}</p>
</td></tr>
</table></td></tr></table>
</body></html>`
  const block = (label: string, b?: NewsletterContent['news']) =>
    b ? [`${label.toUpperCase()}: ${b.title}`, b.body, ...(b.url ? [b.url] : []), ''] : []
  const text = [
    `${BRAND_NAME} · El menú de los viernes`,
    '',
    ...(c.intro ? [c.intro, ''] : []),
    `LA RECETA DE LA SEMANA: ${c.star.title}`,
    c.star.body,
    c.star.url,
    '',
    `${c.cta.label}: ${c.cta.url}`,
    '',
    ...block(`Novedad en ${BRAND_NAME}`, c.news),
    ...block(`Un truco con ${ASSISTANT_NAME}`, c.tip),
    ...(c.signoff ? [c.signoff, ''] : []),
    ...(c.note ? [c.note, ''] : []),
    `Te llega porque pediste el menú de los viernes de ${BRAND_NAME}.`,
    `No quiero recibir más el menú de los viernes: ${links.unsubscribeUrl}`,
    ...(links.leaveListUrl ? [`Salir de la lista de espera: ${links.leaveListUrl}`] : []),
  ].join('\n')
  return { html, text }
}

// ─── Recipients ──────────────────────────────────────────────────

export function recipientHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
}

/** The newsletter-only opt-out token of a waitlist entry: `w.` + its private opt-out token. */
export function newsletterTokenForWaitlist(unsubscribeToken: string): string {
  return `w.${unsubscribeToken}`
}

export function newsletterUnsubscribePath(token: string): string {
  return `/newsletter/baja?t=${encodeURIComponent(token)}`
}

export interface NewsletterCandidate {
  source: 'waitlist'
  email: string | null
  firstName: string | null
  status: string
  newsletterOptIn: boolean
  unsubscribeToken: string
}

export interface NewsletterRecipient {
  source: 'waitlist'
  email: string
  hash: string
  /** Newsletter-only opt-out token. */
  token: string
  /** Full waitlist opt-out token (for «Salir de la lista de espera»). */
  leaveToken: string
}

/** Opted in, still on the list, with an email, not yet sent this issue; one per email. */
export function selectNewsletterRecipients(
  candidates: NewsletterCandidate[],
  alreadySent: ReadonlySet<string>,
): NewsletterRecipient[] {
  const seen = new Set<string>()
  const out: NewsletterRecipient[] = []
  for (const c of candidates) {
    if (!c.newsletterOptIn || c.status === 'unsubscribed' || !c.email?.trim()) continue
    const hash = recipientHash(c.email)
    if (alreadySent.has(hash) || seen.has(hash)) continue
    seen.add(hash)
    out.push({
      source: c.source,
      email: c.email.trim().toLowerCase(),
      hash,
      token: newsletterTokenForWaitlist(c.unsubscribeToken),
      leaveToken: c.unsubscribeToken,
    })
  }
  return out
}

// ─── Repo ────────────────────────────────────────────────────────

export interface NewsletterRepo {
  candidates(): Promise<NewsletterCandidate[]>
  /** Hashes already claimed for this issue (pending or sent). */
  claimedHashes(issueId: string): Promise<Set<string>>
  /** Insert claims; returns only the hashes this call claimed (a concurrent run gets the rest). */
  claim(issueId: string, recipients: NewsletterRecipient[]): Promise<Set<string>>
  markSent(issueId: string, sent: { hash: string; providerId: string | null }[]): Promise<void>
  /** Drop claims whose email didn't go out, so a re-run retries them. */
  release(issueId: string, hashes: string[]): Promise<void>
  isAdminEmail(email: string): Promise<boolean>
  /** Newsletter off for the token's entry; the entry stays on the list. */
  unsubscribe(token: string): Promise<'ok' | 'already' | 'not_found'>
}

type Db = typeof defaultDb

export function createDbNewsletterRepo(db: Db = defaultDb): NewsletterRepo {
  return {
    async candidates() {
      const rows = await db
        .select({
          email: waitlistEntries.email,
          firstName: waitlistEntries.firstName,
          status: waitlistEntries.status,
          newsletterOptIn: waitlistEntries.newsletterOptIn,
          unsubscribeToken: waitlistEntries.unsubscribeToken,
        })
        .from(waitlistEntries)
        .where(and(eq(waitlistEntries.newsletterOptIn, true), ne(waitlistEntries.status, 'unsubscribed')))
      return rows.map((r) => ({ source: 'waitlist' as const, ...r }))
    },
    async claimedHashes(issueId) {
      const rows = await db
        .select({ h: newsletterSends.recipientHash })
        .from(newsletterSends)
        .where(eq(newsletterSends.issueId, issueId))
      return new Set(rows.map((r) => r.h))
    },
    async claim(issueId, recipients) {
      if (recipients.length === 0) return new Set()
      const claimed = new Set<string>()
      for (let i = 0; i < recipients.length; i += 500) {
        const rows = await db
          .insert(newsletterSends)
          .values(recipients.slice(i, i + 500).map((r) => ({ issueId, recipientHash: r.hash, source: r.source })))
          .onConflictDoNothing()
          .returning({ h: newsletterSends.recipientHash })
        rows.forEach((r) => claimed.add(r.h))
      }
      return claimed
    },
    async markSent(issueId, sent) {
      for (const s of sent) {
        await db
          .update(newsletterSends)
          .set({ status: 'sent', providerId: s.providerId, sentAt: new Date() })
          .where(and(eq(newsletterSends.issueId, issueId), eq(newsletterSends.recipientHash, s.hash)))
      }
    },
    async release(issueId, hashes) {
      if (hashes.length === 0) return
      await db
        .delete(newsletterSends)
        .where(
          and(
            eq(newsletterSends.issueId, issueId),
            inArray(newsletterSends.recipientHash, hashes),
            eq(newsletterSends.status, 'pending'),
          ),
        )
    },
    async isAdminEmail(email) {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`, eq(users.role, 'admin')))
        .limit(1)
      return !!row
    },
    async unsubscribe(token) {
      const raw = parseNewsletterToken(token)
      if (!raw) return 'not_found'
      const [entry] = await db
        .select({ id: waitlistEntries.id, optIn: waitlistEntries.newsletterOptIn, status: waitlistEntries.status })
        .from(waitlistEntries)
        .where(eq(waitlistEntries.unsubscribeToken, raw.token))
        .limit(1)
      if (!entry || entry.status === 'unsubscribed') return entry ? 'already' : 'not_found'
      if (!entry.optIn) return 'already'
      await db.update(waitlistEntries).set({ newsletterOptIn: false }).where(eq(waitlistEntries.id, entry.id))
      return 'ok'
    },
  }
}

/** `w.<waitlist opt-out token>` → the waitlist token; anything else → null. */
export function parseNewsletterToken(token: string): { kind: 'waitlist'; token: string } | null {
  const m = /^w\.([A-Za-z0-9_-]{16,128})$/.exec(token.trim())
  return m ? { kind: 'waitlist', token: m[1] } : null
}

// ─── Send ────────────────────────────────────────────────────────

export interface NewsletterDeps {
  repo: NewsletterRepo
  sendBatch: (msgs: EmailMessage[]) => Promise<EmailResult[]>
  sendOne: (msg: EmailMessage) => Promise<EmailResult>
  /** Web origin for the opt-out pages. */
  publicUrl: string
  /** API origin for the RFC 8058 one-click POST. */
  apiUrl: string
}

export function defaultNewsletterDeps(urls: { publicUrl: string; apiUrl: string }): NewsletterDeps {
  return {
    repo: createDbNewsletterRepo(),
    sendBatch: (m) => sendEmailBatch(m),
    sendOne: (m) => sendEmail(m),
    ...urls,
  }
}

export function buildNewsletterMessage(
  input: Pick<NewsletterSendInput, 'subject' | 'preheader' | 'content'>,
  to: string,
  tokens: { token: string; leaveToken?: string },
  urls: { publicUrl: string; apiUrl: string },
): EmailMessage {
  const web = urls.publicUrl.replace(/\/+$/, '')
  const api = urls.apiUrl.replace(/\/+$/, '')
  const unsubscribeUrl = `${web}${newsletterUnsubscribePath(tokens.token)}`
  const leaveListUrl = tokens.leaveToken ? `${web}${waitlistUnsubscribePath(tokens.leaveToken)}` : undefined
  const oneClick = `${api}/newsletter/unsubscribe?t=${encodeURIComponent(tokens.token)}`
  const { html, text } = renderNewsletterEmail(input, { unsubscribeUrl, leaveListUrl })
  return {
    to,
    subject: input.subject,
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${oneClick}>, <${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  }
}

export type NewsletterOutcome =
  | { mode: 'dry_run'; issueId: string; recipients: number; alreadySent: number }
  | { mode: 'test'; issueId: string; to: string; status: EmailResult['status'] }
  | { mode: 'send'; issueId: string; sent: number; failed: number; skipped: number; alreadySent: number }

export class NewsletterTestAddressError extends Error {}

export async function sendNewsletter(input: NewsletterSendInput, deps: NewsletterDeps): Promise<NewsletterOutcome> {
  const urls = { publicUrl: deps.publicUrl, apiUrl: deps.apiUrl }
  if (input.testTo) {
    if (!(await deps.repo.isAdminEmail(input.testTo))) throw new NewsletterTestAddressError(input.testTo)
    const msg = buildNewsletterMessage(
      { ...input, subject: `[Prueba] ${input.subject}` },
      input.testTo,
      { token: 'w.prueba-no-da-de-baja-a-nadie' },
      urls,
    )
    const r = await deps.sendOne(msg)
    return { mode: 'test', issueId: input.issueId, to: maskEmail(input.testTo), status: r.status }
  }

  const claimedBefore = await deps.repo.claimedHashes(input.issueId)
  const recipients = selectNewsletterRecipients(await deps.repo.candidates(), claimedBefore)
  if (input.dryRun) {
    return { mode: 'dry_run', issueId: input.issueId, recipients: recipients.length, alreadySent: claimedBefore.size }
  }

  const claimed = await deps.repo.claim(input.issueId, recipients)
  const mine = recipients.filter((r) => claimed.has(r.hash))
  const results = await deps.sendBatch(
    mine.map((r) => buildNewsletterMessage(input, r.email, { token: r.token, leaveToken: r.leaveToken }, urls)),
  )
  const sent: { hash: string; providerId: string | null }[] = []
  const notSent: string[] = []
  let failed = 0
  let skipped = 0
  mine.forEach((r, k) => {
    const res = results[k]
    if (res?.status === 'sent') sent.push({ hash: r.hash, providerId: res.id })
    else {
      notSent.push(r.hash)
      if (res?.status === 'skipped') skipped++
      else failed++
    }
  })
  await deps.repo.markSent(input.issueId, sent)
  await deps.repo.release(input.issueId, notSent)
  console.log(
    `[newsletter] ${input.issueId}: sent ${sent.length}, failed ${failed}, skipped ${skipped}, already ${claimedBefore.size + (recipients.length - mine.length)}`,
  )
  return {
    mode: 'send',
    issueId: input.issueId,
    sent: sent.length,
    failed,
    skipped,
    alreadySent: claimedBefore.size + (recipients.length - mine.length),
  }
}
