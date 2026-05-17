/**
 * Household management REST surface.
 *
 *   GET    /households/me                        — read current household (auth)
 *   PATCH  /households/me            { name }    — owner-only rename
 *   POST   /households/me/invites    { role, email? } — owner generates a token
 *   POST   /households/me/invites/:inviteId/revoke   — owner revokes a pending invite
 *   POST   /households/me/members/:userId/remove     — owner kicks a member
 *   POST   /households/me/leave                       — current user leaves; auto solo household
 *   GET    /invites/:token                            — preview (public, no auth — recipient may not have an account)
 *   POST   /invites/:token/accept                     — accept (auth)
 */
import { Router } from 'express'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import {
  loadHouseholdForUser,
  renameHousehold,
  createInvite,
  revokeInvite,
  removeMember,
  leaveHousehold,
  previewInvite,
  acceptInvite,
  HouseholdNotFoundError,
  NotHouseholdMemberError,
  NotHouseholdOwnerError,
  InviteExpiredError,
} from '../services/householdStore.js'

// PUBLIC invite preview — recipient may not have an account yet, so this must
// not require auth. Exported as a separate router so it can be mounted in
// `index.ts` BEFORE any router whose `router.use(authMiddleware)` would
// otherwise intercept it (see [users.ts](./users.ts) — its top-level
// authMiddleware catches every request that reaches that router).
export const publicHouseholdRouter = Router()
publicHouseholdRouter.get('/invites/:token', async (req, res) => {
  try {
    const preview = await previewInvite(String(req.params.token))
    res.json(preview)
  } catch (err) {
    if (err instanceof HouseholdNotFoundError) {
      res.status(404).json({ error: 'Invitación no encontrada' })
      return
    }
    if (err instanceof InviteExpiredError) {
      res.status(410).json({ error: err.message })
      return
    }
    console.error('previewInvite error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const router = Router()

router.use(authMiddleware)

router.get('/households/me', async (req: AuthRequest, res) => {
  try {
    const h = await loadHouseholdForUser(req.userId!)
    if (!h) {
      res.status(404).json({ error: 'No household' })
      return
    }
    res.json(h)
  } catch (err) {
    console.error('GET /households/me error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.patch('/households/me', async (req: AuthRequest, res) => {
  try {
    const current = await loadHouseholdForUser(req.userId!)
    if (!current) {
      res.status(404).json({ error: 'No household' })
      return
    }
    const next = await renameHousehold(req.userId!, current.id, String(req.body?.name ?? ''))
    res.json(next)
  } catch (err) {
    if (err instanceof NotHouseholdOwnerError) {
      res.status(403).json({ error: err.message })
      return
    }
    if (err instanceof Error && err.message.includes('El nombre')) {
      res.status(400).json({ error: err.message })
      return
    }
    console.error('PATCH /households/me error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/households/me/invites', async (req: AuthRequest, res) => {
  try {
    const current = await loadHouseholdForUser(req.userId!)
    if (!current) {
      res.status(404).json({ error: 'No household' })
      return
    }
    const role = req.body?.role === 'child' ? 'child' : 'member'
    const email = typeof req.body?.email === 'string' ? req.body.email : null
    const result = await createInvite(req.userId!, current.id, role, email)
    res.status(201).json(result)
  } catch (err) {
    if (err instanceof NotHouseholdOwnerError) {
      res.status(403).json({ error: err.message })
      return
    }
    console.error('POST /households/me/invites error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/households/me/invites/:inviteId/revoke', async (req: AuthRequest, res) => {
  try {
    await revokeInvite(req.userId!, String(req.params.inviteId))
    res.status(204).send()
  } catch (err) {
    if (err instanceof HouseholdNotFoundError) {
      res.status(404).json({ error: 'Invite not found' })
      return
    }
    if (err instanceof NotHouseholdOwnerError) {
      res.status(403).json({ error: err.message })
      return
    }
    console.error('Revoke invite error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/households/me/members/:userId/remove', async (req: AuthRequest, res) => {
  try {
    const current = await loadHouseholdForUser(req.userId!)
    if (!current) {
      res.status(404).json({ error: 'No household' })
      return
    }
    const updated = await removeMember(req.userId!, current.id, String(req.params.userId))
    res.json(updated)
  } catch (err) {
    if (err instanceof NotHouseholdOwnerError) {
      res.status(403).json({ error: err.message })
      return
    }
    if (err instanceof NotHouseholdMemberError) {
      res.status(404).json({ error: 'Member not found' })
      return
    }
    if (err instanceof Error && err.message.includes('No puedes quitar')) {
      res.status(400).json({ error: err.message })
      return
    }
    console.error('Remove member error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/households/me/leave', async (req: AuthRequest, res) => {
  try {
    const current = await loadHouseholdForUser(req.userId!)
    if (!current) {
      res.status(404).json({ error: 'No household' })
      return
    }
    const next = await leaveHousehold(req.userId!, current.id)
    res.json(next)
  } catch (err) {
    if (err instanceof NotHouseholdMemberError) {
      res.status(404).json({ error: 'Not a member' })
      return
    }
    console.error('Leave household error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/invites/:token/accept', async (req: AuthRequest, res) => {
  try {
    const next = await acceptInvite(req.userId!, String(req.params.token))
    res.json(next)
  } catch (err) {
    if (err instanceof HouseholdNotFoundError) {
      res.status(404).json({ error: 'Invitación no encontrada' })
      return
    }
    if (err instanceof InviteExpiredError) {
      res.status(410).json({ error: err.message })
      return
    }
    console.error('Accept invite error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
