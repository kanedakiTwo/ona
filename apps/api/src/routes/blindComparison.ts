/**
 * PRO-256 — comparación a ciegas del menú inteligente (specs/smart-menu.md).
 *
 *   GET  /menu/:menuId/a-ciegas      the two weeks, A and B (test accounts only; 404 otherwise)
 *   POST /menu/:menuId/a-ciegas      { choice: 'A' | 'B' | 'igual', reason? } — the household's pick
 *   GET  /admin/menu-planner/comparison   admin JWT or x-metrics-token: one line per test household
 */
import { Router } from 'express'
import { and, desc, eq, gte, inArray, like } from 'drizzle-orm'
import { z } from 'zod'
import type { DayMenu } from '@ona/shared'
import { db } from '../db/connection.js'
import { menuBlindVotes, menuPlans, menus, users } from '../db/schema.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { metricsAuth } from '../middleware/metricsAuth.js'
import { BLIND_TEST_EMAIL_SUFFIX, blindPair, isBlindTestAccount, preferredSource, summarizeComparison } from '../services/blindComparison.js'
import { canAccessRow, resolveScope } from '../services/scopeResolver.js'

const router = Router()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The menu and its latest usable shadow plan, if the caller is a test account that can read the menu. */
async function loadForCaller(req: AuthRequest) {
  const menuId = String(req.params.menuId)
  if (!UUID_RE.test(menuId)) return null
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.userId!)).limit(1)
  if (!isBlindTestAccount(user?.email)) return null
  const [menu] = await db.select({ id: menus.id, userId: menus.userId, householdId: menus.householdId }).from(menus).where(eq(menus.id, menuId)).limit(1)
  if (!menu || !canAccessRow(menu, req.userId!, await resolveScope(req.userId!))) return null
  const [plan] = await db.select().from(menuPlans)
    .where(and(eq(menuPlans.menuId, menuId), inArray(menuPlans.status, ['ok', 'partial'])))
    .orderBy(desc(menuPlans.createdAt)).limit(1)
  return { menu, plan: plan && plan.days && plan.generatorDays ? plan : null }
}

router.get('/menu/:menuId/a-ciegas', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const found = await loadForCaller(req)
    if (!found) { res.status(404).json({ error: 'No encontrado' }); return }
    if (!found.plan) { res.status(404).json({ error: 'Este menú no tiene semana para comparar.', code: 'NO_PLAN' }); return }
    const [vote] = await db.select({ label: menuBlindVotes.label }).from(menuBlindVotes)
      .where(and(eq(menuBlindVotes.planId, found.plan.id), eq(menuBlindVotes.userId, req.userId!))).limit(1)
    res.json({
      menuId: found.menu.id,
      question: '¿Qué semana os apetece más, la A o la B? ¿Por qué?',
      weeks: blindPair(found.menu.id, found.plan.days as DayMenu[], found.plan.generatorDays as DayMenu[]),
      choice: vote?.label ?? null,
    })
  } catch (err) {
    console.error('[a-ciegas] read failed:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const voteSchema = z.object({
  choice: z.enum(['A', 'B', 'igual']),
  reason: z.string().trim().max(500).optional(),
})

router.post('/menu/:menuId/a-ciegas', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const parsed = voteSchema.safeParse(req.body)
    if (!parsed.success) { res.status(400).json({ error: 'Elige A, B o igual.' }); return }
    const found = await loadForCaller(req)
    if (!found) { res.status(404).json({ error: 'No encontrado' }); return }
    if (!found.plan) { res.status(404).json({ error: 'Este menú no tiene semana para comparar.', code: 'NO_PLAN' }); return }
    const values = {
      planId: found.plan.id,
      menuId: found.menu.id,
      userId: req.userId!,
      householdId: found.menu.householdId,
      label: parsed.data.choice,
      preferred: preferredSource(found.menu.id, parsed.data.choice),
      reason: parsed.data.reason || null,
    }
    await db.insert(menuBlindVotes).values(values).onConflictDoUpdate({
      target: [menuBlindVotes.planId, menuBlindVotes.userId],
      set: { label: values.label, preferred: values.preferred, reason: values.reason, updatedAt: new Date() },
    })
    // The answer never says which week was whose: the comparison stays blind.
    res.status(201).json({ ok: true, choice: parsed.data.choice })
  } catch (err) {
    console.error('[a-ciegas] vote failed:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.get('/admin/menu-planner/comparison', metricsAuth, async (req, res) => {
  try {
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? new Date(`${req.query.from}T00:00:00Z`) : new Date(Date.now() - 14 * 86_400_000)
    const testUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `%${BLIND_TEST_EMAIL_SUFFIX}`))
    const ids = testUsers.map((u) => u.id)
    if (!ids.length) { res.json({ from: from.toISOString().slice(0, 10), households: [] }); return }
    const plans = await db.select({
      householdId: menuPlans.householdId, status: menuPlans.status, check: menuPlans.check, plannerScore: menuPlans.plannerScore, generatorScore: menuPlans.generatorScore,
    }).from(menuPlans).where(and(inArray(menuPlans.userId, ids), gte(menuPlans.createdAt, from)))
    const votes = await db.select({ householdId: menuBlindVotes.householdId, preferred: menuBlindVotes.preferred, reason: menuBlindVotes.reason })
      .from(menuBlindVotes).where(and(inArray(menuBlindVotes.userId, ids), gte(menuBlindVotes.createdAt, from)))
    res.json({ from: from.toISOString().slice(0, 10), households: summarizeComparison(plans as any, votes) })
  } catch (err) {
    console.error('[a-ciegas] report failed:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
