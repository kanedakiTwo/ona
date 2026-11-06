import { Router, type Request, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { record as recordAudit } from '../services/auditLog.js'
import {
  NewsletterTestAddressError,
  createDbNewsletterRepo,
  defaultNewsletterDeps,
  newsletterSendSchema,
  parseNewsletterToken,
  previewNewsletter,
  sendNewsletter,
  type NewsletterDeps,
  type NewsletterRepo,
} from '../services/newsletter.js'
import {
  NEWSLETTER_STATS_DEFINITIONS,
  countsAsClick,
  createDbNewsletterStatsRepo,
  slotLinkAt,
  type NewsletterStatsRepo,
} from '../services/newsletterStats.js'
import { parseSlotParams, slotDestination } from '../services/newsletterShare.js'
import { personalSlotDestination } from '../services/newsletterTips.js'
import {
  WINE_ID_RE,
  createDbNewsletterWineRepo,
  parseWineBase,
  wineDestination,
  wineEnabled,
  type NewsletterWineRepo,
} from '../services/newsletterWine.js'
import { metricsAuth } from '../middleware/metricsAuth.js'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { users } from '../db/schema.js'
import {
  NOT_READY_MESSAGE,
  createDbNewsletterDraftsRepo,
  draftReadiness,
  newsletterTemplateSchema,
  nextFridayNine,
  sameTemplate,
  type NewsletterDraft,
  type NewsletterDraftsRepo,
} from '../services/newsletterDrafts.js'

/**
 * Newsletter «El menú de los viernes» (PRO-94, specs/newsletter.md).
 *
 *   POST /admin/newsletter/send    admin JWT: dryRun (count) | testTo (one proof to an admin) | send
 *   GET  /newsletter/me            JWT: { optIn } — the profile switch (PRO-95)
 *   PUT  /newsletter/me { optIn }  JWT: on (consent date + version) / off (also the waitlist entry)
 *   POST /newsletter/unsubscribe   public: newsletter off, the place on the list stays.
 *                                  JSON `{ token, issueId? }` from /newsletter/baja, or the RFC 8058
 *                                  one-click POST to `?t=<token>&i=<issue>` from the inbox.
 *   GET  /newsletter/click/:issueId/:n  public, for the web's /n/<issue>/<n> (PRO-191):
 *                                  `{ url }` = the destination saved at send (+1 click
 *                                  unless HEAD, a proof or a scanner); unknown → 404.
 *                                  The «Corre la voz» slot (41 WhatsApp, 42 copy, PRO-1019)
 *                                  takes `?c=<code>&k=lista|hogar` and answers wa.me or our
 *                                  copy page with that code; a bad code → 404.
 *                                  The person's recipe (43, `?r=<recipe id>`) and tip (44,
 *                                  `?t=<tip id>`, PRO-1020) answer our recipe page or the
 *                                  tip's screen; a bad id → 404.
 *                                  The person's wine (45, `?v=<wine id>`, PRO-395) answers
 *                                  the base's link to where it is bought; a bad id → 404.
 *   GET  /admin/newsletter/stats   admin JWT or x-metrics-token: per issue sent, clicks
 *                                  per link and opt-outs. Counts only.
<<<<<<< 4945beb5eca27da30e41ee26e3d030df5fd33dde
 *   PUT  /admin/newsletter/wines   admin JWT (PRO-395): `{ base, legal? }` = HQ's
 *                                  `vinos/base.md` as written and LEG-505's yes with its
 *                                  moderation line. Replaces the whole wine base; answers
 *                                  counts and whether wine can go out.
=======
 *
 * The Admin «Newsletter» editor (PRO-1123, D-176), admin JWT:
 *   GET    /admin/newsletter/drafts                       the last issues and their state
 *   GET    /admin/newsletter/drafts/:issueId              recommendation + template + state
 *   PUT    /admin/newsletter/drafts/:issueId/recommendation  Marketing's proposal { subject, preheader?, content }
 *   PUT    /admin/newsletter/drafts/:issueId/template     Miguel's template (clears proof and schedule)
 *   POST   /admin/newsletter/drafts/:issueId/preview      the saved template for 2–3 real people
 *   POST   /admin/newsletter/drafts/:issueId/proof        the proof, to the signed-in admin's own email
 *   POST   /admin/newsletter/drafts/:issueId/schedule     Friday 9:00 Madrid, only with a proof of the saved template
 *   DELETE /admin/newsletter/drafts/:issueId/schedule     unschedule
 * A real `POST /admin/newsletter/send` also needs that proof and the very same template.
>>>>>>> b4a050c0748c0606e08e83257e70b75c50836039
 */

const ISSUE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

const unsubscribeSchema = z.object({ token: z.string().trim().min(3).max(200) })
const winesSchema = z.object({
  /** `departments/marketing/vinos/base.md`, as written. */
  base: z.string().min(1).max(500_000),
  /** LEG-505: without its yes and its moderation line no wine goes out. */
  legal: z
    .object({
      approved: z.boolean(),
      ref: z.string().trim().max(40).optional(),
      moderationLine: z.string().trim().min(1).max(300),
    })
    .optional(),
})
const optInSchema = z.object({ optIn: z.boolean() })

/** The API's own origin, for the one-click URL (behind Railway: `trust proxy` is on). */
function apiOrigin(req: Request): string {
  return `${req.protocol}://${req.get('host')}`
}

/**
 * The `i` of an opt-out link comes from the request: anyone with an opt-out
 * token (a public waitlist signup gives one) could put any text there. It
 * counts under that issue only when the issue was sent to this very address;
 * otherwise, or if that check fails, the opt-out is counted without an
 * issue, like the emails from before PRO-191.
 */
async function countUnsubscribe(
  stats: NewsletterStatsRepo,
  rawIssue: unknown,
  hash: string | null,
  source: 'user' | 'waitlist',
): Promise<void> {
  const asked = typeof rawIssue === 'string' && ISSUE_ID_RE.test(rawIssue) ? rawIssue : null
  const mine = asked && hash ? await stats.wasSentTo(asked, hash).catch(() => false) : false
  await stats.recordUnsubscribe(mine ? asked : null, source)
}

export interface NewsletterRouterDeps {
  repo: NewsletterRepo
  adminAuth: RequestHandler[]
  userAuth: RequestHandler
  unsubscribeLimiter: RequestHandler
  send: typeof sendNewsletter
  makeDeps: (urls: { publicUrl: string; apiUrl: string }) => NewsletterDeps
  audit: typeof recordAudit
  publicUrl: () => string
  /** PRO-191: clicks and opt-outs per issue. */
  stats: NewsletterStatsRepo
  /** Admin JWT or the read-only metrics token used by internal reporting. */
  statsAuth: RequestHandler
<<<<<<< 4945beb5eca27da30e41ee26e3d030df5fd33dde
  /** PRO-395: the wine base. */
  wines: NewsletterWineRepo
=======
  /** PRO-1123: the Admin «Newsletter» editor (recommendation, template, proof, schedule). */
  drafts: NewsletterDraftsRepo
  /** The email of the signed-in admin's own account (the proof goes there). */
  adminEmail: (userId: string) => Promise<string | null>
  now: () => Date
}

async function accountEmail(userId: string): Promise<string | null> {
  const [u] = await db.select({ email: users.email }).from(users).where(and(eq(users.id, userId), eq(users.role, 'admin'))).limit(1)
  return u?.email ?? null
}

/** What the editor shows of an issue (the full texts only in the one-issue read). */
function draftView(d: NewsletterDraft, now: Date, full: boolean) {
  const at = d.scheduledFor ?? nextFridayNine(now)
  const ready = draftReadiness(d, at)
  return {
    issueId: d.issueId,
    recommendedAt: d.recommendedAt,
    savedAt: d.savedAt,
    proofSentAt: d.proofSentAt,
    scheduledFor: d.scheduledFor,
    sentAt: d.sentAt,
    sendResult: d.sendResult,
    ready: ready.ok,
    notReady: ready.ok ? null : ready.reason,
    ...(full ? { recommendation: d.recommendation, template: d.template } : {}),
  }
>>>>>>> b4a050c0748c0606e08e83257e70b75c50836039
}

export function createNewsletterRouter(overrides: Partial<NewsletterRouterDeps> = {}): Router {
  const repo = overrides.repo ?? createDbNewsletterRepo()
  const stats = overrides.stats ?? createDbNewsletterStatsRepo()
  const deps: NewsletterRouterDeps = {
    repo,
    stats,
    statsAuth: metricsAuth as RequestHandler,
    adminAuth: [authMiddleware as RequestHandler, requireAdmin as RequestHandler],
    userAuth: authMiddleware as RequestHandler,
    unsubscribeLimiter: rateLimit({ max: 30, windowMs: 60 * 60_000 }),
    send: sendNewsletter,
    makeDeps: (urls) => ({ ...defaultNewsletterDeps(urls), repo, stats }),
    audit: recordAudit,
    publicUrl: () => env.WEB_PUBLIC_URL,
<<<<<<< 4945beb5eca27da30e41ee26e3d030df5fd33dde
    wines: overrides.wines ?? createDbNewsletterWineRepo(),
=======
    drafts: overrides.drafts ?? createDbNewsletterDraftsRepo(),
    adminEmail: accountEmail,
    now: () => new Date(),
>>>>>>> b4a050c0748c0606e08e83257e70b75c50836039
    ...overrides,
  }
  const router = Router()

  router.post('/admin/newsletter/send', ...deps.adminAuth, async (req: AuthRequest, res: Response) => {
    const parsed = newsletterSendSchema.safeParse(req.body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      res.status(400).json({
        error: `Revisa el número: ${issue?.path.join('.') || 'cuerpo'} — ${issue?.message ?? 'no válido'}`,
        code: 'INVALID_NEWSLETTER',
      })
      return
    }
    let claimed = false
    try {
      const real = !parsed.data.dryRun && !parsed.data.testTo
      // PRO-1123: a real send only sends the template Miguel saved and got the proof of.
      if (real) {
        const d = await deps.drafts.get(parsed.data.issueId)
        const ready = draftReadiness(d, deps.now())
        if (!ready.ok || !sameTemplate(d!.template!, parsed.data)) {
          const reason = ready.ok ? 'otro_texto' : ready.reason
          res.status(409).json({
            error: ready.ok ? 'Esto no es la plantilla guardada y probada de este número.' : NOT_READY_MESSAGE[ready.reason],
            code: 'NEWSLETTER_NOT_READY',
            reason,
          })
          return
        }
        if (!(await deps.drafts.claimSend(parsed.data.issueId, deps.now()))) {
          res.status(409).json({ error: NOT_READY_MESSAGE.ya_enviada, code: 'NEWSLETTER_NOT_READY', reason: 'ya_enviada' })
          return
        }
        claimed = true
      }
      const outcome = await deps.send(parsed.data, deps.makeDeps({ publicUrl: deps.publicUrl(), apiUrl: apiOrigin(req) }))
      if (outcome.mode === 'send') {
        await deps.drafts.recordResult(outcome.issueId, {
          sent: outcome.sent,
          failed: outcome.failed,
          skipped: outcome.skipped,
          alreadySent: outcome.alreadySent,
        })
        await deps.audit({
          adminId: req.userId!,
          action: 'newsletter.send',
          targetType: 'newsletter_issue',
          payload: { issueId: outcome.issueId, sent: outcome.sent, failed: outcome.failed, skipped: outcome.skipped },
        })
      }
      res.json(outcome)
    } catch (err: any) {
      if (err instanceof NewsletterTestAddressError) {
        res.status(400).json({ error: 'La prueba solo se manda al email de un admin.', code: 'NEWSLETTER_TEST_NOT_ADMIN' })
        return
      }
      console.error('[newsletter] send failed:', err?.message ?? err)
      // Nobody gets it twice on a retry (`newsletter_sends`): let the issue go again.
      if (claimed) await deps.drafts.releaseSend(parsed.data.issueId).catch(() => {})
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // ─── PRO-1123: the Admin «Newsletter» editor ─────────────────────

  const issueParam = (req: Request, res: Response): string | null => {
    const id = String(req.params.issueId)
    if (ISSUE_ID_RE.test(id)) return id
    res.status(400).json({ error: 'El número va en minúsculas, números y guiones (p. ej. 2026-11-06).', code: 'INVALID_NEWSLETTER_ISSUE' })
    return null
  }
  const parseTemplate = (req: Request, res: Response) => {
    const parsed = newsletterTemplateSchema.safeParse(req.body)
    if (parsed.success) return parsed.data
    const issue = parsed.error.issues[0]
    res.status(400).json({
      error: `Revisa el número: ${issue?.path.join('.') || 'cuerpo'} — ${issue?.message ?? 'no válido'}`,
      code: 'INVALID_NEWSLETTER',
    })
    return null
  }
  const fail = (what: string) => (err: any, res: Response) => {
    console.error(`[newsletter] ${what} failed:`, err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }

  router.get('/admin/newsletter/drafts', ...deps.adminAuth, async (_req: Request, res: Response) => {
    try {
      const now = deps.now()
      res.json({ drafts: (await deps.drafts.list(12)).map((d) => draftView(d, now, false)), nextFriday: nextFridayNine(now) })
    } catch (err) {
      fail('drafts list')(err, res)
    }
  })

  router.get('/admin/newsletter/drafts/:issueId', ...deps.adminAuth, async (req: Request, res: Response) => {
    const issueId = issueParam(req, res)
    if (!issueId) return
    try {
      const d = await deps.drafts.get(issueId)
      const now = deps.now()
      res.json({ draft: d ? draftView(d, now, true) : null, nextFriday: nextFridayNine(now) })
    } catch (err) {
      fail('draft read')(err, res)
    }
  })

  router.put('/admin/newsletter/drafts/:issueId/recommendation', ...deps.adminAuth, async (req: Request, res: Response) => {
    const issueId = issueParam(req, res)
    if (!issueId) return
    const rec = parseTemplate(req, res)
    if (!rec) return
    try {
      const d = await deps.drafts.saveRecommendation(issueId, rec, deps.now())
      res.json({ draft: draftView(d, deps.now(), true) })
    } catch (err) {
      fail('recommendation save')(err, res)
    }
  })

  router.put('/admin/newsletter/drafts/:issueId/template', ...deps.adminAuth, async (req: AuthRequest, res: Response) => {
    const issueId = issueParam(req, res)
    if (!issueId) return
    const tpl = parseTemplate(req, res)
    if (!tpl) return
    try {
      const d = await deps.drafts.saveTemplate(issueId, tpl, req.userId!, deps.now())
      if (!d) {
        res.status(409).json({ error: NOT_READY_MESSAGE.ya_enviada, code: 'NEWSLETTER_NOT_READY', reason: 'ya_enviada' })
        return
      }
      await deps.audit({ adminId: req.userId!, action: 'newsletter.template_save', targetType: 'newsletter_issue', payload: { issueId } })
      res.json({ draft: draftView(d, deps.now(), true) })
    } catch (err) {
      fail('template save')(err, res)
    }
  })

  /** The saved template, or 409 with the editor's message. */
  const savedTemplate = async (issueId: string, res: Response) => {
    const d = await deps.drafts.get(issueId)
    if (d?.template && d.savedAt) return { d, template: d.template, savedAt: d.savedAt }
    res.status(409).json({ error: NOT_READY_MESSAGE.sin_plantilla, code: 'NEWSLETTER_NOT_READY', reason: 'sin_plantilla' })
    return null
  }

  router.post('/admin/newsletter/drafts/:issueId/preview', ...deps.adminAuth, async (req: AuthRequest, res: Response) => {
    const issueId = issueParam(req, res)
    if (!issueId) return
    try {
      const saved = await savedTemplate(issueId, res)
      if (!saved) return
      const previews = await previewNewsletter(
        { issueId, ...saved.template },
        deps.makeDeps({ publicUrl: deps.publicUrl(), apiUrl: apiOrigin(req) }),
      )
      // Real people's letters, for the admin's eyes only: who looked, never whom.
      await deps.audit({ adminId: req.userId!, action: 'newsletter.preview', targetType: 'newsletter_issue', payload: { issueId, people: previews.length } })
      res.set('Cache-Control', 'no-store').json({ previews })
    } catch (err) {
      fail('preview')(err, res)
    }
  })

  router.post('/admin/newsletter/drafts/:issueId/proof', ...deps.adminAuth, async (req: AuthRequest, res: Response) => {
    const issueId = issueParam(req, res)
    if (!issueId) return
    try {
      const saved = await savedTemplate(issueId, res)
      if (!saved) return
      const to = await deps.adminEmail(req.userId!)
      if (!to) {
        res.status(400).json({ error: 'La prueba solo se manda al email de un admin.', code: 'NEWSLETTER_TEST_NOT_ADMIN' })
        return
      }
      const outcome = await deps.send(
        { issueId, ...saved.template, testTo: to.trim().toLowerCase() },
        deps.makeDeps({ publicUrl: deps.publicUrl(), apiUrl: apiOrigin(req) }),
      )
      const status = outcome.mode === 'test' ? outcome.status : 'failed'
      // Only a proof that went out counts as seen (and only for the template it was made from).
      if (status === 'sent') await deps.drafts.markProof(issueId, saved.savedAt, deps.now())
      await deps.audit({ adminId: req.userId!, action: 'newsletter.proof', targetType: 'newsletter_issue', payload: { issueId, status } })
      const d = await deps.drafts.get(issueId)
      res.json({ status, to: outcome.mode === 'test' ? outcome.to : null, draft: d ? draftView(d, deps.now(), false) : null })
    } catch (err) {
      if (err instanceof NewsletterTestAddressError) {
        res.status(400).json({ error: 'La prueba solo se manda al email de un admin.', code: 'NEWSLETTER_TEST_NOT_ADMIN' })
        return
      }
      fail('proof')(err, res)
    }
  })

  router.post('/admin/newsletter/drafts/:issueId/schedule', ...deps.adminAuth, async (req: AuthRequest, res: Response) => {
    const issueId = issueParam(req, res)
    if (!issueId) return
    try {
      const at = nextFridayNine(deps.now())
      const ready = draftReadiness(await deps.drafts.get(issueId), at)
      if (!ready.ok) {
        res.status(409).json({ error: NOT_READY_MESSAGE[ready.reason], code: 'NEWSLETTER_NOT_READY', reason: ready.reason })
        return
      }
      const d = await deps.drafts.schedule(issueId, at, req.userId!, apiOrigin(req))
      if (!d) {
        res.status(409).json({ error: NOT_READY_MESSAGE.ya_enviada, code: 'NEWSLETTER_NOT_READY', reason: 'ya_enviada' })
        return
      }
      await deps.audit({ adminId: req.userId!, action: 'newsletter.schedule', targetType: 'newsletter_issue', payload: { issueId, at: at.toISOString() } })
      res.json({ draft: draftView(d, deps.now(), false) })
    } catch (err) {
      fail('schedule')(err, res)
    }
  })

  router.delete('/admin/newsletter/drafts/:issueId/schedule', ...deps.adminAuth, async (req: AuthRequest, res: Response) => {
    const issueId = issueParam(req, res)
    if (!issueId) return
    try {
      const d = await deps.drafts.unschedule(issueId)
      if (!d) {
        res.status(404).json({ error: 'Este número no está programado.', code: 'NEWSLETTER_NOT_SCHEDULED' })
        return
      }
      await deps.audit({ adminId: req.userId!, action: 'newsletter.schedule', targetType: 'newsletter_issue', payload: { issueId, at: null } })
      res.json({ draft: draftView(d, deps.now(), false) })
    } catch (err) {
      fail('unschedule')(err, res)
    }
  })

  router.get('/newsletter/me', deps.userAuth, async (req: AuthRequest, res: Response) => {
    try {
      const on = await deps.repo.getUserOptIn(req.userId!)
      if (on === null) {
        res.status(404).json({ error: 'User not found' })
        return
      }
      res.json({ optIn: on })
    } catch (err: any) {
      console.error('[newsletter] read opt-in failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.put('/newsletter/me', deps.userAuth, async (req: AuthRequest, res: Response) => {
    const parsed = optInSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Pasa `optIn` (true o false).', code: 'INVALID_NEWSLETTER_OPT_IN' })
      return
    }
    try {
      const on = await deps.repo.setUserOptIn(req.userId!, parsed.data.optIn)
      if (on === null) {
        res.status(404).json({ error: 'User not found' })
        return
      }
      res.json({ optIn: on })
    } catch (err: any) {
      console.error('[newsletter] set opt-in failed:', err?.message ?? err)
      res.status(500).json({ error: 'No hemos podido guardarlo. Inténtalo de nuevo en un momento.' })
    }
  })

  router.post('/newsletter/unsubscribe', deps.unsubscribeLimiter, async (req: Request, res: Response) => {
    // One-click from the inbox: `?t=` in the URL, `List-Unsubscribe=One-Click` in the form body.
    const raw = typeof req.query.t === 'string' ? req.query.t : req.body?.token
    const parsed = unsubscribeSchema.safeParse({ token: raw })
    const notFound = () =>
      res.status(404).json({ error: 'Este enlace de baja no es válido.', code: 'NEWSLETTER_TOKEN_NOT_FOUND' })
    if (!parsed.success) {
      notFound()
      return
    }
    try {
      const { outcome, recipientHash } = await deps.repo.unsubscribe(parsed.data.token)
      if (outcome === 'not_found') {
        notFound()
        return
      }
      // PRO-191: count the opt-out under the issue it came from (counts only).
      if (outcome === 'ok') {
        const rawIssue = typeof req.query.i === 'string' ? req.query.i : req.body?.issueId
        const ref = parseNewsletterToken(parsed.data.token)
        await countUnsubscribe(deps.stats, rawIssue, recipientHash, ref?.kind === 'user' ? 'user' : 'waitlist').catch((err) =>
          console.warn('[newsletter] opt-out not counted:', err?.message ?? err),
        )
      }
      res.json({ ok: true, alreadyUnsubscribed: outcome === 'already' })
    } catch (err: any) {
      console.error('[newsletter] unsubscribe failed:', err?.message ?? err)
      res.status(500).json({ error: 'No hemos podido darte de baja. Inténtalo de nuevo en un momento.' })
    }
  })

  router.get('/newsletter/click/:issueId/:n', async (req: Request, res: Response) => {
    const issueId = String(req.params.issueId)
    const n = Number(req.params.n)
    if (!ISSUE_ID_RE.test(issueId) || !Number.isInteger(n) || n < 1 || n > 50) {
      res.status(404).json({ error: 'Este enlace no existe.', code: 'NEWSLETTER_LINK_NOT_FOUND' })
      return
    }
    try {
      // The web route passes a HEAD on as `x-newsletter-head` (its fetch is a GET).
      const method = req.get('x-newsletter-head') === '1' ? 'HEAD' : req.method
      const count = countsAsClick({ method, userAgent: req.get('user-agent'), proof: req.query.prueba === '1' })
      // A «Corre la voz» button (PRO-1019): its destination is built from the
      // recipient's code in the link, so a bad code is a 404 and counts nothing.
      // The person's recipe and tip (PRO-1020): from the recipe or tip id, the same way.
      const slot = slotLinkAt(n)
      let built: string | null = null
      if (slot?.slot === 'corre_la_voz') {
        const params = parseSlotParams(req.query.c, req.query.k)
        built = params ? slotDestination(slot, deps.publicUrl(), params.code, params.kind) : null
      } else if (slot?.slot === 'vino') {
        // The person's wine (PRO-395): the base's link, never a URL from the request.
        const id = req.query.v
        const link = typeof id === 'string' && WINE_ID_RE.test(id) ? await deps.wines.link(id) : null
        built = link ? wineDestination(link, issueId) : null
      } else if (slot) {
        built = personalSlotDestination(slot.slot, deps.publicUrl(), slot.slot === 'receta' ? req.query.r : req.query.t)
      }
      if (slot && !built) {
        res.status(404).json({ error: 'Este enlace no existe.', code: 'NEWSLETTER_LINK_NOT_FOUND' })
        return
      }
      const saved = await deps.stats.click(issueId, n, count)
      const url = saved && slot ? built : saved
      if (!url) {
        res.status(404).json({ error: 'Este enlace no existe.', code: 'NEWSLETTER_LINK_NOT_FOUND' })
        return
      }
      res.set('Cache-Control', 'no-store').json({ url })
    } catch (err: any) {
      console.error('[newsletter] click failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.get('/admin/newsletter/stats', deps.statsAuth, async (_req: Request, res: Response) => {
    try {
      res.json({ ...(await deps.stats.stats()), definitions: NEWSLETTER_STATS_DEFINITIONS })
    } catch (err: any) {
      console.error('[newsletter] stats failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.put('/admin/newsletter/wines', ...deps.adminAuth, async (req: AuthRequest, res: Response) => {
    const parsed = winesSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Pasa `base` (el texto de vinos/base.md) y, si Legal ha dicho que sí, `legal`.', code: 'INVALID_WINE_BASE' })
      return
    }
    try {
      const base = parseWineBase(parsed.data.base)
      const legal = parsed.data.legal
      const legalApproved = legal?.approved === true
      const settings = {
        legalApproved,
        legalRef: legal?.ref ?? null,
        moderationLine: legalApproved ? legal!.moderationLine : null,
      }
      await deps.wines.replace(base, settings)
      const enabled = wineEnabled({ ...base.settings, ...settings }) && base.wines.length > 0
      const byDishType: Record<string, number> = {}
      for (const w of base.wines) for (const c of w.categories) byDishType[c] = (byDishType[c] ?? 0) + 1
      const summary = {
        wines: base.wines.length,
        skipped: base.skipped,
        byDishType,
        rules: base.settings.rules.length,
        unparsedRules: base.unparsedRules,
        videoWineId: base.settings.videoWineId,
        signatureAccepted: base.settings.signatureAccepted,
        legalApproved,
        enabled,
      }
      await deps.audit({
        adminId: req.userId!,
        action: 'newsletter.wines_load',
        targetType: 'newsletter_issue',
        payload: { wines: summary.wines, skipped: summary.skipped.length, legalApproved, signatureAccepted: summary.signatureAccepted, enabled },
      })
      res.json(summary)
    } catch (err: any) {
      console.error('[newsletter] wine base load failed:', err?.message ?? err)
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}

export default createNewsletterRouter()
