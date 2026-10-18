/**
 * «¿Cómo cocináis en casa?» in the household's ficha (PRO-217, D-069;
 * specs/household-profile.md). One `cooking_style` fact about the whole
 * household, written by the sign-up (origin `onboarding`), Perfil and Mimo
 * (origin `user`: the household said it). Every change leaves its
 * `profile_changes` row. Only collected and shown today; the menu reads it
 * with PRO-219.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { COOKING_STYLE_LABELS, isCookingStyle, type CookingStyle, type ProfileFactOrigin } from '@ona/shared'
import { db as defaultDb } from '../../db/connection.js'
import { householdMembers, profileChanges, profileFacts, users } from '../../db/schema.js'

export const COOKING_STYLE_FACT = 'cooking_style'

/** Where the answer came from, for the fact's evidence. */
export type CookingStyleSignal = 'onboarding' | 'profile' | 'chat' | 'whatsapp'

const SIGNAL_SUMMARY: Record<CookingStyleSignal, string> = {
  onboarding: 'Lo contestó en el alta',
  profile: 'Lo eligió en Perfil',
  chat: 'Se lo dijo a Mimo en la web',
  whatsapp: 'Se lo dijo a Mimo por WhatsApp',
}

function madridDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
}

/** The household's active `cooking_style`, or null. */
export async function getCookingStyle(householdId: string, db: any = defaultDb): Promise<CookingStyle | null> {
  const [row] = await db
    .select({ value: profileFacts.value })
    .from(profileFacts)
    .where(and(
      eq(profileFacts.householdId, householdId),
      eq(profileFacts.type, COOKING_STYLE_FACT),
      eq(profileFacts.status, 'active'),
      isNull(profileFacts.subjectUserId),
      isNull(profileFacts.subjectPersonId),
    ))
    .orderBy(sql`${profileFacts.updatedAt} DESC`)
    .limit(1)
  const style = (row?.value as { style?: unknown } | undefined)?.style
  return isCookingStyle(style) ? style : null
}

/**
 * Save the household's answer: adds the fact or updates the one there is
 * (single-valued, like the refiner treats it). The same answer again is a
 * no-op. Returns whether something changed.
 */
export async function setCookingStyle(
  input: { householdId: string; style: CookingStyle; origin: ProfileFactOrigin; actorUserId: string | null; signal: CookingStyleSignal; now?: Date },
  db: any = defaultDb,
): Promise<{ style: CookingStyle; changed: boolean }> {
  const now = input.now ?? new Date()
  const value = { style: input.style }
  const evidence = { signal: input.signal, date: madridDate(now), summary: `${SIGNAL_SUMMARY[input.signal]}: «${COOKING_STYLE_LABELS[input.style]}»` }
  return db.transaction(async (tx: any) => {
    const [current] = await tx
      .select()
      .from(profileFacts)
      .where(and(
        eq(profileFacts.householdId, input.householdId),
        eq(profileFacts.type, COOKING_STYLE_FACT),
        eq(profileFacts.status, 'active'),
        isNull(profileFacts.subjectUserId),
        isNull(profileFacts.subjectPersonId),
      ))
      .orderBy(sql`${profileFacts.updatedAt} DESC`)
      .limit(1)
    if (current && (current.value as { style?: unknown })?.style === input.style) {
      return { style: input.style, changed: false }
    }
    const reason = `${SIGNAL_SUMMARY[input.signal]} cómo cocinan`
    if (current) {
      const prior = Array.isArray(current.evidence) ? current.evidence : []
      await tx.update(profileFacts)
        .set({ value, origin: input.origin, confidence: 1, evidence: [...prior, evidence].slice(-20), updatedAt: now })
        .where(eq(profileFacts.id, current.id))
      await tx.insert(profileChanges).values({
        householdId: input.householdId, factId: current.id, action: 'fact_updated', factType: COOKING_STYLE_FACT,
        before: { value: current.value, confidence: current.confidence, origin: current.origin },
        after: { value, confidence: 1 }, reason, origin: input.origin, actorUserId: input.actorUserId,
      })
    } else {
      const [row] = await tx.insert(profileFacts).values({
        householdId: input.householdId, type: COOKING_STYLE_FACT, value, origin: input.origin, confidence: 1, evidence: [evidence],
      }).returning({ id: profileFacts.id })
      await tx.insert(profileChanges).values({
        householdId: input.householdId, factId: row.id, action: 'fact_added', factType: COOKING_STYLE_FACT,
        before: null, after: { value, confidence: 1 }, reason, origin: input.origin, actorUserId: input.actorUserId,
      })
    }
    return { style: input.style, changed: true }
  })
}

/**
 * The household a user's answer goes to: their primary household, and
 * whether they may change it (owner or member; a `child` member reads only).
 */
export async function cookingStyleHousehold(userId: string, db: any = defaultDb): Promise<{ householdId: string; canEdit: boolean } | null> {
  const [row] = await db
    .select({ householdId: users.primaryHouseholdId, role: householdMembers.role })
    .from(users)
    .leftJoin(householdMembers, and(eq(householdMembers.userId, users.id), eq(householdMembers.householdId, users.primaryHouseholdId)))
    .where(eq(users.id, userId))
    .limit(1)
  if (!row?.householdId) return null
  return { householdId: row.householdId, canEdit: row.role !== 'child' }
}
