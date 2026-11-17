/**
 * «¿Quién hace la compra?» in the household's ficha (PRO-383, D-158, D-064;
 * specs/household-profile.md). One `shopper` fact about the whole household,
 * written by the sign-up (web and Mimo's WhatsApp sign-up, origin
 * `onboarding`). Single-valued like `cooking_style`; every change leaves its
 * `profile_changes` row. Only collected and shown today.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { SHOPPER_LABELS, type Shopper } from '@ona/shared'
import { db as defaultDb } from '../../db/connection.js'
import { profileChanges, profileFacts } from '../../db/schema.js'

export const SHOPPER_FACT = 'shopper'

/** Where the answer came from, for the fact's evidence. */
export type ShopperSignal = 'onboarding' | 'whatsapp'

const SIGNAL_SUMMARY: Record<ShopperSignal, string> = {
  onboarding: 'Lo contestó en el alta',
  whatsapp: 'Se lo dijo a Mimo en el alta por WhatsApp',
}

function madridDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
}

/** Save the household's answer: adds the fact or updates the one there is. The same answer again is a no-op. */
export async function setShopper(
  input: { householdId: string; who: Shopper; actorUserId: string | null; signal: ShopperSignal; now?: Date },
  db: any = defaultDb,
): Promise<{ who: Shopper; changed: boolean }> {
  const now = input.now ?? new Date()
  const value = { who: input.who }
  const evidence = { signal: input.signal, date: madridDate(now), summary: `${SIGNAL_SUMMARY[input.signal]}: «${SHOPPER_LABELS[input.who]}»` }
  const reason = `${SIGNAL_SUMMARY[input.signal]} quién hace la compra`
  return db.transaction(async (tx: any) => {
    const [current] = await tx
      .select()
      .from(profileFacts)
      .where(and(
        eq(profileFacts.householdId, input.householdId),
        eq(profileFacts.type, SHOPPER_FACT),
        eq(profileFacts.status, 'active'),
        isNull(profileFacts.subjectUserId),
        isNull(profileFacts.subjectPersonId),
      ))
      .orderBy(sql`${profileFacts.updatedAt} DESC`)
      .limit(1)
    if (current && (current.value as { who?: unknown })?.who === input.who) return { who: input.who, changed: false }
    if (current) {
      const prior = Array.isArray(current.evidence) ? current.evidence : []
      await tx.update(profileFacts)
        .set({ value, origin: 'onboarding', confidence: 1, evidence: [...prior, evidence].slice(-20), updatedAt: now })
        .where(eq(profileFacts.id, current.id))
      await tx.insert(profileChanges).values({
        householdId: input.householdId, factId: current.id, action: 'fact_updated', factType: SHOPPER_FACT,
        before: { value: current.value, confidence: current.confidence, origin: current.origin },
        after: { value, confidence: 1 }, reason, origin: 'onboarding', actorUserId: input.actorUserId,
      })
    } else {
      const [row] = await tx.insert(profileFacts).values({
        householdId: input.householdId, type: SHOPPER_FACT, value, origin: 'onboarding', confidence: 1, evidence: [evidence],
      }).returning({ id: profileFacts.id })
      await tx.insert(profileChanges).values({
        householdId: input.householdId, factId: row.id, action: 'fact_added', factType: SHOPPER_FACT,
        before: null, after: { value, confidence: 1 }, reason, origin: 'onboarding', actorUserId: input.actorUserId,
      })
    }
    return { who: input.who, changed: true }
  })
}
