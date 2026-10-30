/**
 * Newsletter numbers without tracking people (PRO-191, specs/newsletter.md).
 *
 * Resend's open and click tracking stay off (the open pixel needs consent;
 * its click tracking keeps who clicked). Instead:
 *   - at send, every link of the content is rewritten to
 *     `<web>/n/<issueId>/<index>` and its destination saved
 *     (`newsletter_clicks`); the web route asks the API, which adds 1 and
 *     answers with the saved destination. Never a destination that comes in
 *     the request (no open redirect); an unknown issue or index → 404.
 *   - HEAD requests and known mail scanners / link previewers (by
 *     user-agent) don't count. A click is a click, not a person.
 *   - an opt-out from an issue's link adds a row to
 *     `newsletter_unsubscribes` (issue, user or waitlist, date). The issue
 *     comes in the link, so it is kept only when that issue was sent to
 *     that very address (`wasSentTo`); otherwise the row has no issue, and
 *     the stats never turn an issue no admin sent into a row of its own.
 * No IP, browser or recipient is stored.
 */
import { and, eq, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { newsletterClicks, newsletterSends, newsletterUnsubscribes } from '../db/schema.js'
import type { NewsletterContent } from './newsletter.js'

type Db = typeof defaultDb

export interface TrackedLink {
  index: number
  destination: string
}

/**
 * Pure: the distinct links of the content, in reading order, numbered from 1
 * (star recipe, sections have none, news, tip, call to action). The same URL
 * twice is one link.
 */
export function contentLinks(content: NewsletterContent): TrackedLink[] {
  const urls = [content.star.url, content.cta.url, content.news?.url, content.tip?.url].filter((u): u is string => !!u)
  const out: TrackedLink[] = []
  for (const u of urls) if (!out.some((l) => l.destination === u)) out.push({ index: out.length + 1, destination: u })
  return out
}

/** `<web>/n/<issueId>/<index>` (+ `?prueba=1` on a proof, which never counts). */
export function trackedUrl(publicUrl: string, issueId: string, index: number, proof = false): string {
  return `${publicUrl.replace(/\/+$/, '')}/n/${encodeURIComponent(issueId)}/${index}${proof ? '?prueba=1' : ''}`
}

// ─── Slots: per-recipient links (PRO-1019) ───────────────────────

/**
 * A slot is a place in the email whose destination is different for each
 * recipient (their own invite link), so it can't be saved at send like a
 * content link. Its rows in `newsletter_clicks` take a fixed index (above
 * any content link, which are at most 4) and a descriptor as destination;
 * the click carries the recipient's code (`?c=<code>&k=lista|hogar`) and
 * the API builds the destination from it (`slotDestination`): always
 * wa.me or our own page, never a URL from the request.
 */
export const NEWSLETTER_SLOT_LINKS = [
  { index: 41, slot: 'corre_la_voz', button: 'whatsapp' },
  { index: 42, slot: 'corre_la_voz', button: 'copiar' },
  // PRO-1020: each person's recipe (`?r=<recipe id>`) and tip (`?t=<tip id>`).
  { index: 43, slot: 'receta', button: 'abrir' },
  { index: 44, slot: 'truco', button: 'abrir' },
] as const
export type NewsletterSlotLink = (typeof NEWSLETTER_SLOT_LINKS)[number]
export type InviteKind = 'lista' | 'hogar'

const slotDescriptor = (l: NewsletterSlotLink) => `hueco:${l.slot}:${l.button}`

export function slotLinkAt(index: number): NewsletterSlotLink | null {
  return NEWSLETTER_SLOT_LINKS.find((l) => l.index === index) ?? null
}

export function slotLinkFor<S extends NewsletterSlotLink['slot']>(
  slot: S,
  button: Extract<NewsletterSlotLink, { slot: S }>['button'],
): NewsletterSlotLink {
  return NEWSLETTER_SLOT_LINKS.find((l) => l.slot === slot && l.button === button)!
}

/** The slot rows saved with the issue's links (the recipe and tip slots only when the issue is personalised). */
export function slotLinks(slots: readonly NewsletterSlotLink['slot'][] = ['corre_la_voz']): TrackedLink[] {
  return NEWSLETTER_SLOT_LINKS.filter((l) => slots.includes(l.slot)).map((l) => ({ index: l.index, destination: slotDescriptor(l) }))
}

/** `<web>/n/<issueId>/<index>?c=<code>&k=<kind>` (+ `&prueba=1` on a proof). */
export function trackedSlotUrl(publicUrl: string, issueId: string, link: NewsletterSlotLink, code: string, kind: InviteKind, proof = false): string {
  return `${trackedUrl(publicUrl, issueId, link.index)}?c=${encodeURIComponent(code)}&k=${kind}${proof ? '&prueba=1' : ''}`
}

/** PRO-1020: `<web>/n/<issueId>/43?r=<recipe id>` or `/44?t=<tip id>` (+ `&prueba=1` on a proof). */
export function trackedPersonalUrl(publicUrl: string, issueId: string, slot: 'receta' | 'truco', id: string, proof = false): string {
  const link = slotLinkFor(slot, 'abrir')
  return `${trackedUrl(publicUrl, issueId, link.index)}?${slot === 'receta' ? 'r' : 't'}=${encodeURIComponent(id)}${proof ? '&prueba=1' : ''}`
}

/** Pure: the content with each link replaced by its tracked URL. */
export function withTrackedLinks(
  content: NewsletterContent,
  links: TrackedLink[],
  publicUrl: string,
  issueId: string,
  proof = false,
): NewsletterContent {
  const map = new Map(links.map((l) => [l.destination, trackedUrl(publicUrl, issueId, l.index, proof)]))
  const t = (u: string | undefined) => (u ? (map.get(u) ?? u) : u)
  return {
    ...content,
    star: { ...content.star, url: t(content.star.url)! },
    cta: { ...content.cta, url: t(content.cta.url)! },
    ...(content.news ? { news: { ...content.news, url: t(content.news.url) } } : {}),
    ...(content.tip ? { tip: { ...content.tip, url: t(content.tip.url) } } : {}),
  }
}

/**
 * Mail security scanners, link previewers and scripts open every link of an
 * email without anyone clicking. Over-eager on purpose: a click missed costs
 * less than a scanner counted as interest.
 */
const NOT_A_PERSON =
  /bot\b|bot\/|crawler|spider|slurp|preview|scanner|proofpoint|mimecast|barracuda|safelinks|fireeye|symantec|messagelabs|trendmicro|sophos|forcepoint|cisco|ironport|zscaler|linkcheck|curl\/|wget|python-|go-http-client|okhttp|java\/|axios|node-fetch|undici|headless|phantomjs|facebookexternalhit|whatsapp|telegram|slack|discord|skypeuripreview|googleimageproxy/i

/** Pure: does this request count as a click? */
export function countsAsClick(req: { method: string; userAgent?: string | null; proof?: boolean }): boolean {
  if (req.proof) return false
  if (req.method.toUpperCase() !== 'GET') return false
  const ua = (req.userAgent ?? '').trim()
  if (!ua) return false
  return !NOT_A_PERSON.test(ua)
}

export interface IssueStats {
  issueId: string
  firstSentAt: string | null
  sent: { total: number; user: number; waitlist: number }
  clicks: {
    /** Content links and slots together. */
    total: number
    links: Array<{ index: number; destination: string; clicks: number }>
    /** Per-recipient slots (PRO-1019), e.g. `corre_la_voz` → whatsapp and copiar. */
    slots: Record<string, { total: number; buttons: Record<string, number> }>
  }
  unsubscribes: { total: number; user: number; waitlist: number }
}

export interface NewsletterStats {
  issues: IssueStats[]
  /** Opt-outs from links without an issue (emails sent before PRO-191) or whose issue doesn't count (see `buildIssueStats`). */
  unsubscribesWithoutIssue: { total: number; user: number; waitlist: number }
}

export interface NewsletterStatsRepo {
  /** Save (or update) the issue's links at send; clicks already counted stay. */
  registerLinks(issueId: string, links: TrackedLink[]): Promise<void>
  /** The saved destination (null = unknown issue or link), adding 1 when `count`. */
  click(issueId: string, index: number, count: boolean): Promise<string | null>
  /** Did this issue go out to this address (`newsletter_sends` row with status sent)? */
  wasSentTo(issueId: string, recipientHash: string): Promise<boolean>
  recordUnsubscribe(issueId: string | null, source: 'user' | 'waitlist'): Promise<void>
  /** Per issue: sent, clicks per link and in total, opt-outs. Counts only. */
  stats(): Promise<NewsletterStats>
}

export function createDbNewsletterStatsRepo(db: Db = defaultDb): NewsletterStatsRepo {
  return {
    async registerLinks(issueId, links) {
      for (const l of links) {
        await db
          .insert(newsletterClicks)
          .values({ issueId, linkIndex: l.index, destination: l.destination })
          .onConflictDoUpdate({
            target: [newsletterClicks.issueId, newsletterClicks.linkIndex],
            set: { destination: l.destination },
          })
      }
    },
    async click(issueId, index, count) {
      const where = and(eq(newsletterClicks.issueId, issueId), eq(newsletterClicks.linkIndex, index))
      if (count) {
        const [row] = await db
          .update(newsletterClicks)
          .set({ clicks: sql`${newsletterClicks.clicks} + 1` })
          .where(where)
          .returning({ destination: newsletterClicks.destination })
        return row?.destination ?? null
      }
      const [row] = await db.select({ destination: newsletterClicks.destination }).from(newsletterClicks).where(where).limit(1)
      return row?.destination ?? null
    },
    async wasSentTo(issueId, recipientHash) {
      // Served by uq_newsletter_sends_issue_recipient (issue_id, recipient_hash).
      const [row] = await db
        .select({ id: newsletterSends.id })
        .from(newsletterSends)
        .where(
          and(
            eq(newsletterSends.issueId, issueId),
            eq(newsletterSends.recipientHash, recipientHash),
            eq(newsletterSends.status, 'sent'),
          ),
        )
        .limit(1)
      return !!row
    },
    async recordUnsubscribe(issueId, source) {
      await db.insert(newsletterUnsubscribes).values({ issueId, source })
    },
    async stats() {
      const sends = await db.execute(sql`
        SELECT issue_id, MIN(sent_at) AS first_sent_at,
               COUNT(*) FILTER (WHERE status = 'sent')::int AS total,
               COUNT(*) FILTER (WHERE status = 'sent' AND source = 'user')::int AS users,
               COUNT(*) FILTER (WHERE status = 'sent' AND source = 'waitlist')::int AS waitlist
          FROM newsletter_sends GROUP BY issue_id`)
      const clicks = await db.execute(sql`
        SELECT issue_id, link_index, destination, clicks FROM newsletter_clicks ORDER BY issue_id, link_index`)
      const unsubs = await db.execute(sql`
        SELECT issue_id, source, COUNT(*)::int AS n FROM newsletter_unsubscribes GROUP BY issue_id, source`)
      return buildIssueStats(
        (sends.rows as any[]).map((r) => ({
          issueId: r.issue_id,
          firstSentAt: r.first_sent_at ? new Date(r.first_sent_at).toISOString() : null,
          total: Number(r.total),
          user: Number(r.users),
          waitlist: Number(r.waitlist),
        })),
        (clicks.rows as any[]).map((r) => ({ issueId: r.issue_id, index: Number(r.link_index), destination: r.destination, clicks: Number(r.clicks) })),
        (unsubs.rows as any[]).map((r) => ({ issueId: r.issue_id ?? null, source: r.source, n: Number(r.n) })),
      )
    },
  }
}

/**
 * Pure: the per-issue rows from the three aggregates, newest issue first.
 * An issue is known when it has sends or saved links (only an admin's send
 * or proof creates them, and links are never deleted, so forgetting an
 * address's sends doesn't move earlier opt-outs). An opt-out naming any
 * other issue counts without issue.
 */
export function buildIssueStats(
  sends: Array<{ issueId: string; firstSentAt: string | null; total: number; user: number; waitlist: number }>,
  clicks: Array<{ issueId: string; index: number; destination: string; clicks: number }>,
  allUnsubs: Array<{ issueId: string | null; source: string; n: number }>,
): NewsletterStats {
  const known = new Set([...sends.map((s) => s.issueId), ...clicks.map((c) => c.issueId)])
  const unsubs = allUnsubs.map((u) => (u.issueId && known.has(u.issueId) ? u : { ...u, issueId: null }))
  const none = unsubs.filter((u) => !u.issueId)
  const user = none.filter((u) => u.source === 'user').reduce((a, u) => a + u.n, 0)
  const waitlist = none.filter((u) => u.source === 'waitlist').reduce((a, u) => a + u.n, 0)
  return { issues: issueRows(sends, clicks, unsubs), unsubscribesWithoutIssue: { total: user + waitlist, user, waitlist } }
}

function issueRows(
  sends: Array<{ issueId: string; firstSentAt: string | null; total: number; user: number; waitlist: number }>,
  clicks: Array<{ issueId: string; index: number; destination: string; clicks: number }>,
  unsubs: Array<{ issueId: string | null; source: string; n: number }>,
): IssueStats[] {
  // Issues come from sends and saved links only, never from an opt-out link.
  const ids = new Set<string>([...sends.map((s) => s.issueId), ...clicks.map((c) => c.issueId)])
  const out: IssueStats[] = [...ids].map((issueId) => {
    const s = sends.find((x) => x.issueId === issueId)
    const all = clicks.filter((c) => c.issueId === issueId).sort((a, b) => a.index - b.index)
    const links = all.filter((c) => !slotLinkAt(c.index))
    const slots: IssueStats['clicks']['slots'] = {}
    for (const c of all) {
      const s = slotLinkAt(c.index)
      if (!s) continue
      const row = (slots[s.slot] ??= { total: 0, buttons: {} })
      row.total += c.clicks
      row.buttons[s.button] = (row.buttons[s.button] ?? 0) + c.clicks
    }
    const un = unsubs.filter((u) => u.issueId === issueId)
    const user = un.filter((u) => u.source === 'user').reduce((a, u) => a + u.n, 0)
    const waitlist = un.filter((u) => u.source === 'waitlist').reduce((a, u) => a + u.n, 0)
    return {
      issueId,
      firstSentAt: s?.firstSentAt ?? null,
      sent: { total: s?.total ?? 0, user: s?.user ?? 0, waitlist: s?.waitlist ?? 0 },
      clicks: {
        total: all.reduce((a, l) => a + l.clicks, 0),
        links: links.map(({ index, destination, clicks: n }) => ({ index, destination, clicks: n })),
        slots,
      },
      unsubscribes: { total: user + waitlist, user, waitlist },
    }
  })
  return out.sort((a, b) => (b.firstSentAt ?? '9999').localeCompare(a.firstSentAt ?? '9999') || b.issueId.localeCompare(a.issueId))
}

export const NEWSLETTER_STATS_DEFINITIONS = {
  sent: 'Emails that went out for the issue (newsletter_sends with status sent), by source: user (accounts) and waitlist.',
  clicks:
    'Our own counter (PRO-191): times each link of the content was opened through <web>/n/<issue>/<index>. Clicks, not people: one person can click twice and nobody is identified. HEAD requests, proofs (?prueba=1) and known mail scanners or link previewers (by user-agent) do not count. Resend tracking stays off. links: the content links; slots: the per-recipient places (PRO-1019: corre_la_voz → whatsapp and copiar, the «Corre la voz» buttons), counted without knowing whose link it was; PRO-1020: receta and truco → abrir, the recipe and the tip chosen for each person, counted without knowing whose or which; total: both.',
  unsubscribes:
    'Newsletter-only opt-outs done from that issue’s link (since PRO-191), by source, counted under the issue only when it was sent to that address. Opt-outs whose link has no issue (earlier emails), or names an issue not sent to that address, count under unsubscribesWithoutIssue.',
}
