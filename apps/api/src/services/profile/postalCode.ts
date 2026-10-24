/**
 * The household's postal code in its ficha (PRO-358, D-064, D-065;
 * specs/shop-orders.md → «Tiendas de Mimoia»). One `postal_code` fact about
 * the whole household, asked once, the first time «Tiendas de Mimoia» is
 * shown («¿En qué código postal vivís?»), or told to Mimo. Origin `user`:
 * the household said it. Every change leaves its `profile_changes` row.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { isPostalCode } from '@ona/shared'
import { db as defaultDb } from '../../db/connection.js'
import { profileChanges, profileFacts } from '../../db/schema.js'

export const POSTAL_CODE_FACT = 'postal_code'

/** Where the answer came from, for the fact's evidence. */
export type PostalCodeSignal = 'tiendas' | 'chat' | 'whatsapp'

const SIGNAL_SUMMARY: Record<PostalCodeSignal, string> = {
  tiendas: 'Lo contestó en Tiendas de Mimoia',
  chat: 'Se lo dijo a Mimo en la web',
  whatsapp: 'Se lo dijo a Mimo por WhatsApp',
}

function madridDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
}

const householdFact = (householdId: string) => and(
  eq(profileFacts.householdId, householdId),
  eq(profileFacts.type, POSTAL_CODE_FACT),
  eq(profileFacts.status, 'active'),
  isNull(profileFacts.subjectUserId),
  isNull(profileFacts.subjectPersonId),
)

/** The household's active postal code, or null (not asked yet). */
export async function getPostalCode(householdId: string, db: any = defaultDb): Promise<string | null> {
  const [row] = await db
    .select({ value: profileFacts.value })
    .from(profileFacts)
    .where(householdFact(householdId))
    .orderBy(sql`${profileFacts.updatedAt} DESC`)
    .limit(1)
  const code = (row?.value as { code?: unknown } | undefined)?.code
  return isPostalCode(code) ? code : null
}

/**
 * Save the household's postal code: adds the fact or updates the one there
 * is (single-valued). The same code again is a no-op.
 */
export async function setPostalCode(
  input: { householdId: string; code: string; actorUserId: string | null; signal: PostalCodeSignal; now?: Date },
  db: any = defaultDb,
): Promise<{ postalCode: string; changed: boolean }> {
  const now = input.now ?? new Date()
  const value = { code: input.code }
  const evidence = { signal: input.signal, date: madridDate(now), summary: `${SIGNAL_SUMMARY[input.signal]}: ${input.code}` }
  return db.transaction(async (tx: any) => {
    const [current] = await tx
      .select()
      .from(profileFacts)
      .where(householdFact(input.householdId))
      .orderBy(sql`${profileFacts.updatedAt} DESC`)
      .limit(1)
    if (current && (current.value as { code?: unknown })?.code === input.code) {
      return { postalCode: input.code, changed: false }
    }
    const reason = `${SIGNAL_SUMMARY[input.signal]} su código postal`
    if (current) {
      const prior = Array.isArray(current.evidence) ? current.evidence : []
      await tx.update(profileFacts)
        .set({ value, origin: 'user', confidence: 1, evidence: [...prior, evidence].slice(-20), updatedAt: now })
        .where(eq(profileFacts.id, current.id))
      await tx.insert(profileChanges).values({
        householdId: input.householdId, factId: current.id, action: 'fact_updated', factType: POSTAL_CODE_FACT,
        before: { value: current.value, confidence: current.confidence, origin: current.origin },
        after: { value, confidence: 1 }, reason, origin: 'user', actorUserId: input.actorUserId,
      })
    } else {
      const [row] = await tx.insert(profileFacts).values({
        householdId: input.householdId, type: POSTAL_CODE_FACT, value, origin: 'user', confidence: 1, evidence: [evidence],
      }).returning({ id: profileFacts.id })
      await tx.insert(profileChanges).values({
        householdId: input.householdId, factId: row.id, action: 'fact_added', factType: POSTAL_CODE_FACT,
        before: null, after: { value, confidence: 1 }, reason, origin: 'user', actorUserId: input.actorUserId,
      })
    }
    return { postalCode: input.code, changed: true }
  })
}
