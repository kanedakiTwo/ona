/**
 * Invitation links by campaign, admin side (PRO-27, specs/auth.md):
 *
 *   GET  /admin/invite-campaigns   admin JWT: every campaign with its link and uses
 *   POST /admin/invite-campaigns   admin JWT: { name, maxUses?, expiresAt? } → new link (audited)
 *
 * Signups / activation / week 3 per campaign live in GET /admin/metrics → `campaigns`.
 */
import { Router, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin, type AuthRequest } from '../middleware/auth.js'
import { record } from '../services/auditLog.js'
import { campaignUrl, createCampaign, listCampaigns } from '../services/inviteCampaigns.js'

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  maxUses: z.number().int().min(1).max(100_000).nullish(),
  expiresAt: z.string().datetime({ offset: true }).nullish(),
})

const router = Router()
const admin = [authMiddleware as RequestHandler, requireAdmin as RequestHandler]

router.get('/admin/invite-campaigns', ...admin, async (_req, res: Response) => {
  try {
    const rows = await listCampaigns()
    res.json(rows.map((c) => ({ ...c, url: campaignUrl(env.WEB_PUBLIC_URL, c.code) })))
  } catch (err: any) {
    console.error('[invite-campaigns] list failed:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/admin/invite-campaigns', ...admin, async (req: AuthRequest, res: Response) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Pon un nombre de campaña (y, si quieres, usos máximos y caducidad).' })
    return
  }
  try {
    const c = await createCampaign(
      {
        name: parsed.data.name,
        maxUses: parsed.data.maxUses ?? null,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      },
      req.userId!,
    )
    await record({
      adminId: req.userId!,
      action: 'invite_campaign.create',
      targetType: 'invite_campaign',
      targetId: c.id,
      payload: { created: { name: c.name, maxUses: c.maxUses, expiresAt: c.expiresAt } },
    })
    res.status(201).json({ ...c, url: campaignUrl(env.WEB_PUBLIC_URL, c.code) })
  } catch (err: any) {
    console.error('[invite-campaigns] create failed:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
