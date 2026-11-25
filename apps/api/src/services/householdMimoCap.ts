/**
 * PRO-1290 — a household's own monthly Mimo cap (`households.mimo_cap_eur`),
 * set by an admin (`PUT /admin/households/:id/mimo-cap`, specs/admin-dashboard.md)
 * when a household runs out of Mimo before the month ends (one went 11 days
 * without it, waiting for an env change).
 *
 * The cap goes from the plan's up to `MIMO_CAP_MAX_MULTIPLIER` times it.
 * Every plan has the same Mimo cap today (`ADVISOR_MONTHLY_BUDGET_EUR`); the
 * per-plan figures (PRO-15) go in `planMimoCapEur`.
 *
 * For every member of the household (their primary household):
 *   - Mimo's cap (advisorBudget.ts) is the household's;
 *   - the cap on all paid AI (spendCap.ts) is at least the household's, so a
 *     raised Mimo cap isn't stopped by the general one.
 * A person's own cap (`USER_CAP_OVERRIDES_EUR`, capOverrides.ts) wins over
 * both. A lookup that fails falls back to the general caps.
 */
import { eq } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { households, users } from '../db/schema.js'
import { record } from './auditLog.js'

type Db = typeof defaultDb

export const MIMO_CAP_MAX_MULTIPLIER = 3

/** The Mimo cap of the household's plan, in euros. The same for every plan until PRO-15. */
export function planMimoCapEur(): number {
  return env.ADVISOR_MONTHLY_BUDGET_EUR
}

/** The highest cap an admin can give a household. */
export function maxMimoCapEur(planCap: number = planMimoCapEur()): number {
  return Math.round(planCap * MIMO_CAP_MAX_MULTIPLIER * 100) / 100
}

/** This user's household cap in euros (their primary household), or undefined. Never throws. */
export async function householdMimoCapEur(userId: string | null | undefined, db: Db = defaultDb): Promise<number | undefined> {
  if (!userId) return undefined
  try {
    const [row] = await db
      .select({ cap: households.mimoCapEur })
      .from(users)
      .innerJoin(households, eq(households.id, users.primaryHouseholdId))
      .where(eq(users.id, userId))
      .limit(1)
    return row?.cap != null && row.cap > 0 ? row.cap : undefined
  } catch (err) {
    console.warn('[mimo-cap] household cap read failed, general caps apply:', (err as Error)?.message ?? err)
    return undefined
  }
}

export type MimoCapResult =
  | { ok: true; householdId: string; capEur: number | null; previousEur: number | null; planCapEur: number; maxEur: number; changed: boolean }
  | { ok: false; code: 'NOT_FOUND' }
  | { ok: false; code: 'TOO_HIGH'; maxEur: number; planCapEur: number }

/**
 * Set (or, with null, take back to the plan's) a household's Mimo cap. The
 * audit row (`household.mimo_cap`) goes in the same transaction; nothing is
 * written when the cap doesn't change.
 */
export async function setHouseholdMimoCap(householdId: string, capEur: number | null, adminId: string, db: Db = defaultDb): Promise<MimoCapResult> {
  const planCapEur = planMimoCapEur()
  const maxEur = maxMimoCapEur(planCapEur)
  if (capEur != null && capEur > maxEur) return { ok: false, code: 'TOO_HIGH', maxEur, planCapEur }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: households.id, cap: households.mimoCapEur })
      .from(households)
      .where(eq(households.id, householdId))
      .for('update')
    if (!row) return { ok: false, code: 'NOT_FOUND' } as const
    const previousEur = row.cap ?? null
    if (previousEur === capEur) return { ok: true, householdId, capEur, previousEur, planCapEur, maxEur, changed: false } as const
    await tx.update(households).set({ mimoCapEur: capEur }).where(eq(households.id, householdId))
    await record({
      adminId,
      action: 'household.mimo_cap',
      targetType: 'household',
      targetId: householdId,
      payload: { before: { capEur: previousEur }, after: { capEur }, planCapEur, maxEur },
    }, tx)
    return { ok: true, householdId, capEur, previousEur, planCapEur, maxEur, changed: true } as const
  })
}
