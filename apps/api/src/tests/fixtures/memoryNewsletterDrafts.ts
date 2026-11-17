/**
 * PRO-1123: the newsletter drafts repo in memory, for the route and scheduler
 * tests. `readyDrafts(issue…)` = each issue's template saved and its proof
 * sent, as a real send now needs.
 */
import type { NewsletterDraft, NewsletterDraftsRepo, NewsletterTemplate } from '../../services/newsletterDrafts.js'

export function memoryDraftsRepo(): NewsletterDraftsRepo & { rows: Map<string, NewsletterDraft> } {
  const rows = new Map<string, NewsletterDraft>()
  const blank = (issueId: string): NewsletterDraft => ({
    issueId,
    recommendation: null,
    recommendedAt: null,
    template: null,
    savedBy: null,
    savedAt: null,
    proofSentAt: null,
    scheduledFor: null,
    scheduledBy: null,
    apiUrl: null,
    sentAt: null,
    sendResult: null,
  })
  const upd = (issueId: string, patch: Partial<NewsletterDraft>) => {
    const d = { ...(rows.get(issueId) ?? blank(issueId)), ...patch }
    rows.set(issueId, d)
    return d
  }
  return {
    rows,
    async get(issueId) {
      return rows.get(issueId) ?? null
    },
    async list(limit) {
      return [...rows.values()].sort((a, b) => b.issueId.localeCompare(a.issueId)).slice(0, limit)
    },
    async saveRecommendation(issueId, rec, now) {
      return upd(issueId, { recommendation: rec, recommendedAt: now })
    },
    async saveTemplate(issueId, tpl, adminId, now) {
      if (rows.get(issueId)?.sentAt) return null
      return upd(issueId, { template: tpl, savedBy: adminId, savedAt: now, proofSentAt: null, scheduledFor: null, scheduledBy: null })
    },
    async markProof(issueId, savedAt, now) {
      const d = rows.get(issueId)
      if (d?.savedAt?.getTime() === savedAt.getTime()) upd(issueId, { proofSentAt: now })
    },
    async schedule(issueId, at, adminId, apiUrl) {
      const d = rows.get(issueId)
      return d && !d.sentAt ? upd(issueId, { scheduledFor: at, scheduledBy: adminId, apiUrl }) : null
    },
    async unschedule(issueId) {
      const d = rows.get(issueId)
      return d && !d.sentAt ? upd(issueId, { scheduledFor: null, scheduledBy: null }) : null
    },
    async due(now) {
      return [...rows.values()].filter((d) => d.scheduledFor && d.scheduledFor.getTime() <= now.getTime() && !d.sentAt)
    },
    async claimSend(issueId, now) {
      const d = rows.get(issueId)
      if (d?.sentAt) return false
      upd(issueId, { sentAt: now })
      return true
    },
    async releaseSend(issueId) {
      if (rows.has(issueId)) upd(issueId, { sentAt: null })
    },
    async recordResult(issueId, result) {
      upd(issueId, { sendResult: result })
    },
  }
}

/** Each issue saved as a template a minute ago, with its proof. */
export function readyDrafts(...issues: Array<NewsletterTemplate & { issueId: string }>): ReturnType<typeof memoryDraftsRepo> {
  const repo = memoryDraftsRepo()
  const savedAt = new Date(Date.now() - 60_000)
  for (const { issueId, subject, preheader, content } of issues) {
    repo.rows.set(issueId, {
      ...repo.rows.get(issueId),
      issueId,
      recommendation: null,
      recommendedAt: null,
      template: { subject, preheader, content },
      savedBy: null,
      savedAt,
      proofSentAt: new Date(savedAt.getTime() + 1000),
      scheduledFor: null,
      scheduledBy: null,
      apiUrl: null,
      sentAt: null,
      sendResult: null,
    })
  }
  return repo
}
