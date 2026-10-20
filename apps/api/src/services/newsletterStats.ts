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
 *     `newsletter_unsubscribes` (issue, user or waitlist, date).
 * No IP, browser or recipient is stored.
 */
import { and, eq, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { newsletterClicks, newsletterUnsubscribes } from '../db/schema.js'
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
  clicks: { total: number; links: Array<{ index: number; destination: string; clicks: number }> }
  unsubscribes: { total: number; user: number; waitlist: number }
}

export interface NewsletterStats {
  issues: IssueStats[]
  /** Opt-outs from links without an issue (emails sent before PRO-191). */
  unsubscribesWithoutIssue: { total: number; user: number; waitlist: number }
}

export interface NewsletterStatsRepo {
  /** Save (or update) the issue's links at send; clicks already counted stay. */
  registerLinks(issueId: string, links: TrackedLink[]): Promise<void>
  /** The saved destination (null = unknown issue or link), adding 1 when `count`. */
  click(issueId: string, index: number, count: boolean): Promise<string | null>
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

/** Pure: the per-issue rows from the three aggregates, newest issue first. */
export function buildIssueStats(
  sends: Array<{ issueId: string; firstSentAt: string | null; total: number; user: number; waitlist: number }>,
  clicks: Array<{ issueId: string; index: number; destination: string; clicks: number }>,
  unsubs: Array<{ issueId: string | null; source: string; n: number }>,
): NewsletterStats {
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
  const ids = new Set<string>([...sends.map((s) => s.issueId), ...clicks.map((c) => c.issueId)])
  for (const u of unsubs) if (u.issueId) ids.add(u.issueId)
  const out: IssueStats[] = [...ids].map((issueId) => {
    const s = sends.find((x) => x.issueId === issueId)
    const links = clicks.filter((c) => c.issueId === issueId).sort((a, b) => a.index - b.index)
    const un = unsubs.filter((u) => u.issueId === issueId)
    const user = un.filter((u) => u.source === 'user').reduce((a, u) => a + u.n, 0)
    const waitlist = un.filter((u) => u.source === 'waitlist').reduce((a, u) => a + u.n, 0)
    return {
      issueId,
      firstSentAt: s?.firstSentAt ?? null,
      sent: { total: s?.total ?? 0, user: s?.user ?? 0, waitlist: s?.waitlist ?? 0 },
      clicks: {
        total: links.reduce((a, l) => a + l.clicks, 0),
        links: links.map(({ index, destination, clicks: n }) => ({ index, destination, clicks: n })),
      },
      unsubscribes: { total: user + waitlist, user, waitlist },
    }
  })
  return out.sort((a, b) => (b.firstSentAt ?? '9999').localeCompare(a.firstSentAt ?? '9999') || b.issueId.localeCompare(a.issueId))
}

export const NEWSLETTER_STATS_DEFINITIONS = {
  sent: 'Emails that went out for the issue (newsletter_sends with status sent), by source: user (accounts) and waitlist.',
  clicks:
    'Our own counter (PRO-191): times each link of the content was opened through <web>/n/<issue>/<index>. Clicks, not people: one person can click twice and nobody is identified. HEAD requests, proofs (?prueba=1) and known mail scanners or link previewers (by user-agent) do not count. Resend tracking stays off.',
  unsubscribes:
    'Newsletter-only opt-outs done from that issue’s link (since PRO-191; earlier emails have no issue in the link and count under issueId null), by source.',
}
