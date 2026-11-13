/**
 * Household management REST surface.
 *
 *   GET    /households/me                        — read current household (auth)
 *   POST   /households/me/cook-today { name, day?, meal? } — «hoy cocina Pablo» (PRO-230, Mimo only)
 *   PATCH  /households/me            { name }    — owner-only rename
 *   POST   /households/me/invites    { role, email?, source?, shared? } — owner generates a token (30 days, one use)
 *   POST   /households/me/invites/:inviteId/revoke   — owner revokes a pending invite
 *   POST   /households/me/invites/:inviteId/shared   — owner tapped «Enviar por WhatsApp» / «Copiar» (PRO-260)
 *   GET    /households/me/allergies                    — who has told us their allergies and diet (PRO-271)
 *   GET    /households/me/week-type                    — the household's «semana tipo» (D-182)
 *   PUT    /households/me/week-type/:day/:meal { slot } — change that one slot (the rest as they are)
 *   GET    /households/me/family-offer                — show the invitation offer in the sign-up / list? (PRO-261)
 *   POST   /households/me/family-offer { moment }     — the offer was shown: never again (PRO-261)
 *   POST   /households/me/members/:userId/remove     — owner kicks a member
 *   POST   /households/me/leave                       — current user leaves; auto solo household
 *   GET    /invites/:token                            — preview (public, no auth — recipient may not have an account)
 *   POST   /invites/:token/accept                     — accept (auth)
 */
import { Router } from 'express'
import { z } from 'zod'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { assignCookToday, dbCookTodayDeps } from '../services/cookToday.js'
import { isHouseholdInviteSource } from '@ona/shared'
import { loadHouseholdAllergiesStatus } from '../services/householdAllergies.js'
import { and, inArray } from 'drizzle-orm'
import { MEALS, stableSlotJson, weekTypeSlotError, weekTypeSlotSchema, type Meal, type WeekTypeSlot } from '@ona/shared'
import { db } from '../db/connection.js'
import { recipes } from '../db/schema.js'
import { visibleAuthorIds, visibleRecipeWhere } from '../services/recipeVisibility.js'
import { currentWeekStart, isChildOfHousehold, loadWeekType, saveWeekTypeSlots } from '../services/weekType.js'
import { getPrimaryHouseholdId } from '../services/scopeResolver.js'
import { requestChannel } from '../services/usageEvents.js'
import { familyOfferDue, familyOfferEligible, loadFamilyOfferInput, stampFamilyOffer } from '../services/familyInviteOffers.js'
import {
  loadHouseholdForUser,
  renameHousehold,
  createInvite,
  markInviteShared,
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

// PRO-230: «hoy cocina Pablo, mándale la receta» — only through Mimo (no UI).
const cookTodaySchema = z.object({
  name: z.string().trim().min(1).max(80),
  day: z.string().trim().max(60).optional(),
  meal: z.enum(['breakfast', 'lunch', 'snack', 'dinner']).optional(),
})
router.post('/households/me/cook-today', async (req: AuthRequest, res) => {
  const parsed = cookTodaySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Body inválido: { name, day?, meal? }' })
    return
  }
  try {
    res.json(await assignCookToday(req.userId!, parsed.data, dbCookTodayDeps()))
  } catch (err) {
    console.error('cook-today error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

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

// PRO-271: «Generar mi menú» warns when someone in the household hasn't
// said their allergies and diet («no ha contestado» ≠ «ninguna»).
router.get('/households/me/allergies', async (req: AuthRequest, res) => {
  try {
    res.json(await loadHouseholdAllergiesStatus(req.userId!))
  } catch (err) {
    console.error('GET /households/me/allergies error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// «Semana tipo» (D-182): what the household usually eats each day. One per
// household; the menu of every week comes from it.
router.get('/households/me/week-type', async (req: AuthRequest, res) => {
  try {
    const householdId = await getPrimaryHouseholdId(req.userId!)
    if (!householdId) {
      res.status(404).json({ error: 'No household' })
      return
    }
    res.json({ days: await loadWeekType(householdId) })
  } catch (err) {
    console.error('GET /households/me/week-type error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// One slot, whole: `{ off?, options?, together?, diners?, dishes?, since? }`.
// The other slots are never touched; two people on the same slot → the last
// one wins. Changing its options starts the turns again this week.
router.put('/households/me/week-type/:day/:meal', async (req: AuthRequest, res) => {
  const day = Number(req.params.day)
  const meal = String(req.params.meal) as Meal
  if (!Number.isInteger(day) || day < 0 || day > 6 || !(MEALS as readonly string[]).includes(meal)) {
    res.status(400).json({ error: 'Día (0-6) o comida no válidos.' })
    return
  }
  const parsed = weekTypeSlotSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: 'Hueco no válido.', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    return
  }
  const slot = parsed.data as WeekTypeSlot
  const invalid = weekTypeSlotError(day, meal, slot)
  if (invalid) {
    res.status(400).json({ error: invalid })
    return
  }
  try {
    const householdId = await getPrimaryHouseholdId(req.userId!)
    if (!householdId) {
      res.status(404).json({ error: 'No household' })
      return
    }
    if (await isChildOfHousehold(householdId, req.userId!)) {
      res.status(403).json({ error: 'La semana tipo la cambian los adultos de la casa.' })
      return
    }
    // A concrete recipe must be one this household can see; its name comes from the recipe.
    const recipeIds = (slot.options ?? []).flatMap((o) => (o.kind === 'recipe' ? [o.recipeId] : []))
    if (recipeIds.length) {
      const found = await db.select({ id: recipes.id, name: recipes.name }).from(recipes)
        .where(and(inArray(recipes.id, recipeIds), visibleRecipeWhere(await visibleAuthorIds(req.userId!))))
      const names = new Map(found.map((r) => [r.id, r.name]))
      if (recipeIds.some((id) => !names.has(id))) {
        res.status(404).json({ error: 'Esa receta no está en vuestro catálogo.' })
        return
      }
      slot.options = slot.options!.map((o) => (o.kind === 'recipe' ? { ...o, name: names.get(o.recipeId)! } : o))
    }
    if (!slot.options?.length) delete slot.options
    if ((slot.options?.length ?? 0) < 2) delete slot.together
    const before = (await loadWeekType(householdId))[day]?.[meal]
    if (!slot.since) {
      const sameOptions = stableSlotJson({ options: before?.options, together: before?.together }) === stableSlotJson({ options: slot.options, together: slot.together })
      if (sameOptions && before?.since) slot.since = before.since
      else if (slot.options?.length) slot.since = currentWeekStart()
    }
    res.json({ days: await saveWeekTypeSlots(householdId, [{ day, meal, slot }], db, { track: { userId: req.userId!, channel: requestChannel(req) } }) })
  } catch (err) {
    console.error('PUT /households/me/week-type error:', err)
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
    // Where it was prepared (PRO-263 counts by moment); `shared` = Mimo hands it over now.
    const source = isHouseholdInviteSource(req.body?.source) ? req.body.source : 'casa'
    const result = await createInvite(req.userId!, current.id, role, email, { source, shared: req.body?.shared === true })
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

router.post('/households/me/invites/:inviteId/shared', async (req: AuthRequest, res) => {
  try {
    await markInviteShared(req.userId!, String(req.params.inviteId))
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
    console.error('Shared invite error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * «Familia en el mismo hogar» offers (PRO-261, D-088). `alta` is whether the
 * sign-up may offer it (the form checks its own adults count, ≥ 2, since it
 * isn't saved yet); `compra` already includes `users.adults` ≥ 2.
 */
router.get('/households/me/family-offer', async (req: AuthRequest, res) => {
  try {
    const input = await loadFamilyOfferInput(req.userId!)
    if (!input) {
      res.json({ alta: false, compra: false })
      return
    }
    res.json({
      alta: !input.state.alta && familyOfferEligible(input),
      compra: familyOfferDue('compra', input),
    })
  } catch (err) {
    console.error('GET /households/me/family-offer error:', err)
    res.json({ alta: false, compra: false })
  }
})

router.post('/households/me/family-offer', async (req: AuthRequest, res) => {
  const moment = req.body?.moment
  if (moment !== 'alta' && moment !== 'compra') {
    res.status(400).json({ error: 'moment debe ser alta o compra' })
    return
  }
  try {
    await stampFamilyOffer(req.userId!, moment)
    res.status(204).send()
  } catch (err) {
    console.error('POST /households/me/family-offer error:', err)
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
