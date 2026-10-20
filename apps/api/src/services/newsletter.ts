import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  ASSISTANT_NAME,
  BRAND_NAME,
  WAITLIST_NEWSLETTER_CONSENT_VERSION,
  waitlistReferralUrl,
  waitlistUnsubscribePath,
} from '@ona/shared'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { newsletterSends, users, waitlistEntries } from '../db/schema.js'
import { maskEmail, sendEmail, sendEmailBatch, type EmailMessage, type EmailResult } from './email.js'
import { contentLinks, createDbNewsletterStatsRepo, withTrackedLinks, type NewsletterStatsRepo } from './newsletterStats.js'
import {
  ACCENT,
  BODY,
  BORDER,
  BORDER_SOFT,
  CREAM_DEEP,
  EYEBROW,
  INK,
  INK_MID,
  MUTED,
  PAPER,
  SANS,
  SERIF,
  TERRACOTTA,
  TERRACOTTA_DEEP,
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
} from './emailBrand.js'

/**
 * Newsletter «El menú de los viernes» (PRO-94, specs/newsletter.md).
 *
 *   - Recipients: waitlist entries that ticked the newsletter box and haven't
 *     left, and users who ticked it at /register or in the profile (PRO-95);
 *     one email per address (`selectNewsletterRecipients`).
 *   - Idempotent per issue: each recipient is claimed in `newsletter_sends`
 *     (unique issue + sha256(email)) before the email goes out; a failed or
 *     unconfigured send releases the claim so a re-run retries only those.
 *   - One-click opt-out that turns off ONLY the newsletter (the place on the
 *     list stays): `/newsletter/baja?t=<token>` + `List-Unsubscribe(-Post)`.
 *   - Waitlist recipients get their own invite link in the footer (PRO-130):
 *     «Invita a tu hogar y entráis antes: <web>/?invita=<their code>».
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

/** A free section after the star (e.g. the mission, «por qué esta carta»). */
const section = z.object({
  label: z.string().trim().max(60).optional(),
  title: z.string().trim().max(160).optional(),
  /** A short line set big in the brand's italic, before the body. */
  quote: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(1500),
  /** `band`: on a cream-deep panel; `plain` (default): after a thin rule. */
  tone: z.enum(['band', 'plain']).optional(),
})

export const newsletterContentSchema = z.object({
  /** Under the masthead, e.g. «N.º 1 · 16 de octubre de 2026». */
  edition: z.string().trim().max(80).optional(),
  /** A short greeting above the headline (Miguel, 2026-10-16: «Hola a todos…»). */
  preface: z.string().trim().max(600).optional(),
  /** The issue's one headline; `*word*` sets that word in the accent italic. */
  headline: z.string().trim().max(160).optional(),
  /** Opening letter (or a line from Mimo). */
  intro: z.string().trim().max(2000).optional(),
  /** The star recipe always comes first after the letter, full width, with its photo. */
  star: block.extend({
    imageUrl: httpsUrl,
    imageAlt: z.string().trim().min(1).max(200),
    url: httpsUrl,
    /** One line under the title, e.g. «Cuchara · 3 horas · para 6». */
    meta: z.string().trim().max(120).optional(),
  }),
  sections: z.array(section).max(4).optional(),
  news: block.optional(),
  tip: block.optional(),
  cta: z.object({ label: z.string().trim().min(1).max(60), url: httpsUrl }),
  /** Small print (e.g. how the photos are made). */
  note: z.string().trim().max(400).optional(),
  signoff: z.string().trim().max(400).optional(),
  /** Who signs (a person, e.g. Miguel): the name goes under the signoff in the accent italic. */
  from: z.object({ name: z.string().trim().min(1).max(60), role: z.string().trim().max(80).optional() }).optional(),
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
  /** With dryRun: also say whether this address would get it. */
  includes: z.string().trim().toLowerCase().email().optional(),
})
export type NewsletterSendInput = z.infer<typeof newsletterSendSchema>

// ─── Template ────────────────────────────────────────────────────

function img(url: string, alt: string, link?: string, radius = '14px'): string {
  const tag = `<img src="${esc(url)}" alt="${esc(alt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:${radius};">`
  return link ? `<a href="${esc(link)}" style="text-decoration:none;">${tag}</a>` : tag
}

function sideBlock(label: string, b: NonNullable<NewsletterContent['news']>): string {
  const link = b.url
    ? `<p style="margin:0;"><a href="${esc(b.url)}" style="font-family:${SANS};font-size:15px;font-weight:600;color:${TERRACOTTA_DEEP};">Ver más</a></p>`
    : ''
  return row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};border:1px solid ${BORDER_SOFT};border-radius:16px;">
${b.imageUrl ? `<tr><td>${img(b.imageUrl, b.imageAlt ?? b.title, b.url, '16px 16px 0 0')}</td></tr>` : ''}
<tr><td style="padding:22px 22px 10px;">
<p style="${EYEBROW}color:${MUTED};">${esc(label)}</p>
<p style="margin:0 0 10px;font-family:${SERIF};font-size:22px;line-height:1.2;font-weight:650;letter-spacing:-0.01em;color:${INK};">${esc(b.title)}</p>
${paragraphs(b.body, `font-family:${SANS};font-size:15px;line-height:1.55;color:${INK};`, 12)}${link}
</td></tr></table>`,
    '0 28px 28px',
  )
}

function sectionBlock(s: NonNullable<NewsletterContent['sections']>[number]): string {
  const label = s.label ? `<p style="${EYEBROW}color:${MUTED};">${esc(s.label)}</p>` : ''
  const title = s.title
    ? `<p style="margin:0 0 14px;font-family:${SERIF};font-size:24px;line-height:1.15;letter-spacing:-0.02em;color:${INK};">${esc(s.title)}</p>`
    : ''
  const quote = s.quote
    ? `<p style="margin:4px 0 18px;font-family:${ACCENT};font-style:italic;font-weight:500;font-size:28px;line-height:1.2;color:${TERRACOTTA};">«${esc(s.quote)}»</p>`
    : ''
  const body = paragraphs(s.body, s.tone === 'band' ? `${BODY}color:${INK_MID};` : BODY)
  if (s.tone === 'band') {
    return row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CREAM_DEEP};border-radius:16px;"><tr><td style="padding:30px 26px 18px;">${label}${title}${quote}${body}</td></tr></table>`,
      '0 28px 32px',
    )
  }
  return row(`<div style="border-top:1px solid ${BORDER};padding-top:26px;">${label}${title}${quote}${body}</div>`, '0 28px 18px')
}

/** Footer call for waitlist recipients (PRO-130). Until the 16-nov opening; PRO-167 changes it. */
export const NEWSLETTER_INVITE_LINE = 'Invita a tu hogar y entráis antes:'

/**
 * The visual newsletter, on the shared brand shell (emailBrand.ts): masthead
 * with the logo → greeting (optional) → headline → letter → the star recipe's photo full width →
 * sections → cards → signature → footer band. Absolute image URLs with `alt`.
 * `unsubscribeUrl`, `leaveListUrl` and `inviteUrl` are per recipient.
 */
export function renderNewsletterEmail(
  input: Pick<NewsletterSendInput, 'subject' | 'preheader' | 'content'>,
  links: { unsubscribeUrl: string; leaveListUrl?: string; inviteUrl?: string } & BrandAssets,
): { html: string; text: string } {
  const c = input.content
  const brand = esc(BRAND_NAME)
  const preface = c.preface ? row(paragraphs(c.preface, `${BODY}font-size:17px;line-height:1.65;`, 16), '24px 28px 0') : ''
  const intro = c.intro ? row(paragraphs(c.intro, `${BODY}font-size:17px;line-height:1.65;`, 16), '24px 28px 14px') : ''
  const star = `${row(img(c.star.imageUrl, c.star.imageAlt, c.star.url), '10px 28px 22px')}
${row(
  `<p style="${EYEBROW}color:${TERRACOTTA_DEEP};">La receta de la semana</p>
<p style="margin:0 0 8px;font-family:${SERIF};font-size:30px;line-height:1.12;letter-spacing:-0.02em;color:${INK};"><a href="${esc(c.star.url)}" style="color:${INK};text-decoration:none;">${esc(c.star.title)}</a></p>
${c.star.meta ? `<p style="margin:0 0 16px;font-family:${SANS};font-size:14px;line-height:1.45;color:${MUTED};">${esc(c.star.meta)}</p>` : ''}
${paragraphs(c.star.body, BODY)}`,
)}
${button(c.cta.label, c.cta.url, '6px 28px 38px')}`
  const html = emailDocument(
    input.subject,
    input.preheader,
    [
      masthead(links, 'El menú de los viernes', c.edition),
      preface,
      c.headline ? headlineRow(c.headline) : '',
      intro,
      star,
      ...(c.sections ?? []).map(sectionBlock),
      c.news ? sideBlock(`Novedad en ${BRAND_NAME}`, c.news) : '',
      c.tip ? sideBlock(`Un truco con ${ASSISTANT_NAME}`, c.tip) : '',
      signature(c.signoff, c.from),
      footerBand(links, [
        ...(links.inviteUrl
          ? [
              `<span style="color:${INK};">${esc(NEWSLETTER_INVITE_LINE)}</span> <a href="${esc(links.inviteUrl)}" style="color:${TERRACOTTA_DEEP};font-weight:600;">${esc(links.inviteUrl.replace(/^https?:\/\//, ''))}</a>`,
            ]
          : []),
        ...(c.note ? [esc(c.note)] : []),
        `Te llega porque pediste el menú de los viernes de ${brand}.`,
        `<a href="${esc(links.unsubscribeUrl)}" style="color:${MUTED};">No quiero recibir más el menú de los viernes</a>${links.leaveListUrl ? ` · <a href="${esc(links.leaveListUrl)}" style="color:${MUTED};">Salir de la lista de espera</a>` : ''}`,
      ]),
    ].join('\n'),
  )

  const block = (label: string, b?: NewsletterContent['news']) =>
    b ? [`${label.toUpperCase()}: ${b.title}`, b.body, ...(b.url ? [b.url] : []), ''] : []
  const text = [
    `${BRAND_NAME} · El menú de los viernes${c.edition ? ` · ${c.edition}` : ''}`,
    '',
    ...(c.preface ? [c.preface, ''] : []),
    ...(c.headline ? [plainHeadline(c.headline), ''] : []),
    ...(c.intro ? [c.intro, ''] : []),
    `LA RECETA DE LA SEMANA: ${c.star.title}`,
    ...(c.star.meta ? [c.star.meta] : []),
    c.star.body,
    c.star.url,
    '',
    `${c.cta.label}: ${c.cta.url}`,
    '',
    ...(c.sections ?? []).flatMap((s) => [
      ...(s.label || s.title ? [[s.label?.toUpperCase(), s.title].filter(Boolean).join(': ')] : []),
      ...(s.quote ? [`«${s.quote}»`] : []),
      s.body,
      '',
    ]),
    ...block(`Novedad en ${BRAND_NAME}`, c.news),
    ...block(`Un truco con ${ASSISTANT_NAME}`, c.tip),
    ...(c.signoff ? [c.signoff] : []),
    ...(c.from ? [c.from.name, ...(c.from.role ? [c.from.role] : [])] : []),
    ...(c.signoff || c.from ? [''] : []),
    ...(links.inviteUrl ? [`${NEWSLETTER_INVITE_LINE} ${links.inviteUrl}`, ''] : []),
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

/**
 * Forget the send traces of an address (PRO-132): delete every
 * `newsletter_sends` row with its hash — a hash of an email is still
 * pseudonymised personal data. Called when someone leaves the waitlist
 * (`/lista/baja`) or deletes their account; NOT on the newsletter-only
 * opt-out (the rows stop the same issue going out twice). Accepts a
 * transaction. Returns how many rows went.
 */
export async function forgetNewsletterSends(db: Pick<Db, 'delete'>, email: string | null | undefined): Promise<number> {
  if (!email?.trim()) return 0
  const rows = await db
    .delete(newsletterSends)
    .where(eq(newsletterSends.recipientHash, recipientHash(email)))
    .returning({ h: newsletterSends.recipientHash })
  return rows.length
}

/** The newsletter-only opt-out token of a waitlist entry: `w.` + its private opt-out token. */
export function newsletterTokenForWaitlist(unsubscribeToken: string): string {
  return `w.${unsubscribeToken}`
}

function userSig(userId: string): string {
  return createHmac('sha256', env.JWT_SECRET).update(`newsletter:${userId}`).digest('base64url').slice(0, 22)
}

/** A user's newsletter-only opt-out token: `u.<userId>.<hmac>` (no row to look up, nothing to leak). */
export function newsletterTokenForUser(userId: string): string {
  return `u.${userId}.${userSig(userId)}`
}

/** `i=<issueId>` (PRO-191): the opt-out is counted under that issue; no person is stored. */
export function newsletterUnsubscribePath(token: string, issueId?: string): string {
  return `/newsletter/baja?t=${encodeURIComponent(token)}${issueId ? `&i=${encodeURIComponent(issueId)}` : ''}`
}

export type NewsletterTokenRef = { kind: 'waitlist'; token: string } | { kind: 'user'; userId: string }

/** `w.<waitlist opt-out token>` or a valid `u.<userId>.<hmac>`; anything else → null. */
export function parseNewsletterToken(token: string): NewsletterTokenRef | null {
  const t = token.trim()
  const w = /^w\.([A-Za-z0-9_-]{16,128})$/.exec(t)
  if (w) return { kind: 'waitlist', token: w[1] }
  const u = /^u\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})$/.exec(t)
  if (u) {
    const want = Buffer.from(userSig(u[1]))
    const got = Buffer.from(u[2])
    if (want.length === got.length && timingSafeEqual(want, got)) return { kind: 'user', userId: u[1] }
  }
  return null
}

export interface NewsletterCandidate {
  source: 'waitlist' | 'user'
  email: string | null
  /** waitlist: waiting | invited | joined | unsubscribed; user: active | suspended */
  status: string
  newsletterOptIn: boolean
  /** Newsletter-only opt-out token. */
  token: string
  /** Full waitlist opt-out token (for «Salir de la lista de espera»); waitlist only. */
  leaveToken?: string
  /** The entry's public invite code (`/?invita=<code>`, PRO-130); waitlist only. */
  referralCode?: string
}

export interface NewsletterRecipient {
  source: 'waitlist' | 'user'
  email: string
  hash: string
  token: string
  leaveToken?: string
  referralCode?: string
}

/**
 * Opted in, still on the list (or an active account), with an email, not yet
 * sent this issue; one per email — the first candidate wins, so pass users first.
 */
export function selectNewsletterRecipients(
  candidates: NewsletterCandidate[],
  alreadySent: ReadonlySet<string>,
): NewsletterRecipient[] {
  const seen = new Set<string>()
  const out: NewsletterRecipient[] = []
  for (const c of candidates) {
    if (!c.newsletterOptIn || c.status === 'unsubscribed' || c.status === 'suspended' || !c.email?.trim()) continue
    const hash = recipientHash(c.email)
    if (alreadySent.has(hash) || seen.has(hash)) continue
    seen.add(hash)
    out.push({
      source: c.source,
      email: c.email.trim().toLowerCase(),
      hash,
      token: c.token,
      ...(c.leaveToken ? { leaveToken: c.leaveToken } : {}),
      ...(c.source === 'waitlist' && c.referralCode ? { referralCode: c.referralCode } : {}),
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
  /**
   * Newsletter off for the token's address, in the waitlist AND the account
   * with that email (one person, one switch). The place on the list stays.
   */
  unsubscribe(token: string): Promise<'ok' | 'already' | 'not_found'>
  /** The profile switch (PRO-95). Off also turns off the waitlist entry with that email. */
  getUserOptIn(userId: string): Promise<boolean | null>
  setUserOptIn(userId: string, optIn: boolean): Promise<boolean | null>
}

type Db = typeof defaultDb

export function createDbNewsletterRepo(db: Db = defaultDb): NewsletterRepo {
  return {
    async candidates() {
      const people = await db
        .select({ id: users.id, email: users.email, suspendedAt: users.suspendedAt })
        .from(users)
        .where(eq(users.newsletterOptIn, true))
      const rows = await db
        .select({
          email: waitlistEntries.email,
          status: waitlistEntries.status,
          unsubscribeToken: waitlistEntries.unsubscribeToken,
          referralCode: waitlistEntries.referralCode,
        })
        .from(waitlistEntries)
        .where(and(eq(waitlistEntries.newsletterOptIn, true), ne(waitlistEntries.status, 'unsubscribed')))
      return [
        ...people.map((u) => ({
          source: 'user' as const,
          email: u.email,
          status: u.suspendedAt ? 'suspended' : 'active',
          newsletterOptIn: true,
          token: newsletterTokenForUser(u.id),
        })),
        ...rows.map((r) => ({
          source: 'waitlist' as const,
          email: r.email,
          status: r.status,
          newsletterOptIn: true,
          token: newsletterTokenForWaitlist(r.unsubscribeToken),
          leaveToken: r.unsubscribeToken,
          referralCode: r.referralCode,
        })),
      ]
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
      const ref = parseNewsletterToken(token)
      if (!ref) return 'not_found'
      let email: string | null = null
      if (ref.kind === 'waitlist') {
        const [entry] = await db
          .select({ email: waitlistEntries.email, status: waitlistEntries.status })
          .from(waitlistEntries)
          .where(eq(waitlistEntries.unsubscribeToken, ref.token))
          .limit(1)
        if (!entry) return 'not_found'
        if (entry.status === 'unsubscribed' || !entry.email) return 'already'
        email = entry.email
      } else {
        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, ref.userId)).limit(1)
        if (!user) return 'not_found'
        email = user.email
      }
      return (await turnOffByEmail(db, email)) > 0 ? 'ok' : 'already'
    },
    async getUserOptIn(userId) {
      const [u] = await db.select({ on: users.newsletterOptIn }).from(users).where(eq(users.id, userId)).limit(1)
      return u ? u.on : null
    },
    async setUserOptIn(userId, optIn) {
      if (optIn) {
        const rows = await db
          .update(users)
          .set({ newsletterOptIn: true, newsletterConsentAt: new Date(), newsletterConsentVersion: WAITLIST_NEWSLETTER_CONSENT_VERSION })
          .where(eq(users.id, userId))
          .returning({ id: users.id })
        return rows.length > 0 ? true : null
      }
      const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
      if (!u) return null
      await turnOffByEmail(db, u.email)
      return false
    },
  }
}

/** Newsletter off for every row with this email (account + waitlist). Returns how many were on. */
async function turnOffByEmail(db: Db, email: string): Promise<number> {
  const e = email.trim().toLowerCase()
  const a = await db
    .update(users)
    .set({ newsletterOptIn: false })
    .where(and(sql`lower(${users.email}) = ${e}`, eq(users.newsletterOptIn, true)))
    .returning({ id: users.id })
  const b = await db
    .update(waitlistEntries)
    .set({ newsletterOptIn: false })
    .where(and(eq(waitlistEntries.email, e), eq(waitlistEntries.newsletterOptIn, true)))
    .returning({ id: waitlistEntries.id })
  return a.length + b.length
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
  /**
   * PRO-191: our own click counter. Present → the content's links go through
   * `<web>/n/<issue>/<index>` and are saved before sending. Absent → links as written.
   */
  stats?: NewsletterStatsRepo
}

export function defaultNewsletterDeps(urls: { publicUrl: string; apiUrl: string }): NewsletterDeps {
  return {
    repo: createDbNewsletterRepo(),
    sendBatch: (m) => sendEmailBatch(m),
    sendOne: (m) => sendEmail(m),
    stats: createDbNewsletterStatsRepo(),
    ...urls,
  }
}

export function buildNewsletterMessage(
  input: Pick<NewsletterSendInput, 'subject' | 'preheader' | 'content'>,
  to: string,
  tokens: { token: string; leaveToken?: string; referralCode?: string },
  urls: { publicUrl: string; apiUrl: string },
  issueId?: string,
): EmailMessage {
  const web = urls.publicUrl.replace(/\/+$/, '')
  const api = urls.apiUrl.replace(/\/+$/, '')
  const unsubscribeUrl = `${web}${newsletterUnsubscribePath(tokens.token, issueId)}`
  const leaveListUrl = tokens.leaveToken ? `${web}${waitlistUnsubscribePath(tokens.leaveToken)}` : undefined
  const inviteUrl = tokens.referralCode ? waitlistReferralUrl(web, tokens.referralCode) : undefined
  const oneClick = `${api}/newsletter/unsubscribe?t=${encodeURIComponent(tokens.token)}${issueId ? `&i=${encodeURIComponent(issueId)}` : ''}`
  const { html, text } = renderNewsletterEmail(input, { unsubscribeUrl, leaveListUrl, inviteUrl, ...brandAssets(web) })
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
  | {
      mode: 'dry_run'
      issueId: string
      recipients: number
      alreadySent: number
      bySource: { waitlist: number; user: number }
      includes?: boolean
    }
  | { mode: 'test'; issueId: string; to: string; status: EmailResult['status'] }
  | { mode: 'send'; issueId: string; sent: number; failed: number; skipped: number; alreadySent: number }

export class NewsletterTestAddressError extends Error {}

/**
 * PRO-191: with a stats repo, save the issue's links and return the content
 * with them going through our counter (a proof's links never count).
 */
async function trackContent(input: NewsletterSendInput, deps: NewsletterDeps, proof: boolean): Promise<NewsletterSendInput> {
  if (!deps.stats) return input
  const links = contentLinks(input.content)
  await deps.stats.registerLinks(input.issueId, links)
  return { ...input, content: withTrackedLinks(input.content, links, deps.publicUrl, input.issueId, proof) }
}

export async function sendNewsletter(input: NewsletterSendInput, deps: NewsletterDeps): Promise<NewsletterOutcome> {
  const urls = { publicUrl: deps.publicUrl, apiUrl: deps.apiUrl }
  if (input.testTo) {
    if (!(await deps.repo.isAdminEmail(input.testTo))) throw new NewsletterTestAddressError(input.testTo)
    const tracked = await trackContent(input, deps, true)
    const msg = buildNewsletterMessage(
      { ...tracked, subject: `[Prueba] ${input.subject}` },
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
    return {
      mode: 'dry_run',
      issueId: input.issueId,
      recipients: recipients.length,
      alreadySent: claimedBefore.size,
      bySource: {
        waitlist: recipients.filter((r) => r.source === 'waitlist').length,
        user: recipients.filter((r) => r.source === 'user').length,
      },
      ...(input.includes ? { includes: recipients.some((r) => r.hash === recipientHash(input.includes!)) } : {}),
    }
  }

  // Links saved before claiming anyone: a failure here sends nothing and leaves no claim behind.
  const tracked = recipients.length > 0 ? await trackContent(input, deps, false) : input
  const claimed = await deps.repo.claim(input.issueId, recipients)
  const mine = recipients.filter((r) => claimed.has(r.hash))
  const results = await deps.sendBatch(
    mine.map((r) =>
      buildNewsletterMessage(tracked, r.email, { token: r.token, leaveToken: r.leaveToken, referralCode: r.referralCode }, urls, input.issueId),
    ),
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
