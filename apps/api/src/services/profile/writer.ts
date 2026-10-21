/**
 * PRO-316 (D-064, D-110) — the one way a fact gets into the ficha del hogar.
 *
 * Every write about a person or the household goes through
 * `upsertProfileFact` / `retireProfileFacts`: the fact and its history row
 * (`profile_changes`) in the caller's transaction. Single-valued types (every
 * memory key and the household habits) are updated in place; multi-valued
 * ones (fixed dishes, affinities…) add a row unless the same value is there.
 *
 * `user_memories` stays as a **mirror** of the memory keys while readers of
 * the memory remain (the menu generator reads restrictions, dislikes,
 * equipment and time from it): every memory write calls `mirrorMemoryWrite`
 * / `mirrorMemoryDelete` in the same transaction, so the ficha never lags
 * behind what the person told us. Spec: specs/household-profile.md.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import {
  MEMORY_SOURCE_TO_ORIGIN,
  canWriteProfileFact,
  isMultiValuedProfileFactType,
  memoryKeyIsHouseholdLevel,
  type MemorySource,
  type ProfileEvidence,
  type ProfileFactOrigin,
  type ProfileWriteChannel,
} from '@ona/shared'
import { householdMembers, profileChanges, profileFacts, users } from '../../db/schema.js'
import { describeFact } from './reader.js'

/** Where a write comes from, for the fact's evidence («¿Por qué lo sé?»). */
export type FactSignal = 'profile' | 'chat' | 'whatsapp' | 'voice' | 'onboarding' | 'afina' | 'system'

const SIGNAL_LABEL: Record<FactSignal, string> = {
  profile: 'Lo escribiste en Perfil',
  chat: 'Se lo dijiste a Mimo en la web',
  whatsapp: 'Se lo dijiste a Mimo por WhatsApp',
  voice: 'Se lo dijiste a Mimo de viva voz',
  onboarding: 'Lo contestaste en el alta',
  afina: 'Salió de «Afina tu menú»',
  system: 'Lo apuntó Mimoia',
}

/** The write channel the health rules check (`canWriteProfileFact`). */
export function channelOf(signal: FactSignal): ProfileWriteChannel {
  return signal === 'whatsapp' ? 'whatsapp' : signal === 'system' ? 'system' : 'web'
}

export function madridDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
}

/** Pure: the evidence item a write leaves («Se lo dijiste a Mimo por WhatsApp: No le gusta: cilantro»). */
export function signalEvidence(signal: FactSignal, type: string, value: unknown, now: Date): ProfileEvidence {
  const what = describeFact({ type, value, validUntil: null })
  const summary = what ? `${SIGNAL_LABEL[signal]}: ${what}` : SIGNAL_LABEL[signal]
  return { signal, date: madridDate(now), summary: summary.length > 280 ? `${summary.slice(0, 279)}…` : summary }
}

/** Same value, whatever the key order or array order of a list. */
export function sameFactValue(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon).map((x) => JSON.stringify(x)).sort()
    if (v && typeof v === 'object') return Object.keys(v as object).sort().map((k) => [k, canon((v as any)[k])])
    return v
  }
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
}

export interface FactWrite {
  householdId: string
  subjectUserId: string | null
  subjectPersonId: string | null
  type: string
  value: unknown
  origin: ProfileFactOrigin
  confidence: number
  evidence: ProfileEvidence
  validUntil?: Date | null
  /** The `user_memories` row this fact mirrors (memory keys only). */
  sourceMemoryId?: string | null
  reason: string
  actorUserId: string | null
  now?: Date
}

export type FactWriteResult = { factId: string; action: 'added' | 'updated' | 'unchanged' }

function subjectWhere(householdId: string, subjectUserId: string | null, subjectPersonId: string | null, type: string) {
  return and(
    eq(profileFacts.householdId, householdId),
    eq(profileFacts.type, type),
    eq(profileFacts.status, 'active'),
    subjectUserId ? eq(profileFacts.subjectUserId, subjectUserId) : isNull(profileFacts.subjectUserId),
    subjectPersonId ? eq(profileFacts.subjectPersonId, subjectPersonId) : isNull(profileFacts.subjectPersonId),
  )
}

/**
 * Add the fact, or update the subject's one of a single-valued type. The same
 * value again only appends its evidence (no history row). Runs in `tx`.
 */
export async function upsertProfileFact(tx: any, w: FactWrite): Promise<FactWriteResult> {
  const now = w.now ?? new Date()
  const confidence = Math.min(1, Math.max(0, w.confidence))
  const current: any[] = await tx.select().from(profileFacts)
    .where(subjectWhere(w.householdId, w.subjectUserId, w.subjectPersonId, w.type))
    .orderBy(asc(profileFacts.createdAt), asc(profileFacts.id))
  const same = current.find((f) => sameFactValue(f.value, w.value))
  const target = same ?? (isMultiValuedProfileFactType(w.type) ? null : current[current.length - 1] ?? null)

  if (target) {
    const prior = Array.isArray(target.evidence) ? target.evidence : []
    const evidence = [...prior, w.evidence].slice(-20)
    const time = (d: unknown) => (d instanceof Date ? d.getTime() : d ? new Date(String(d)).getTime() : null)
    const untilChanged = w.validUntil !== undefined && time(target.validUntil) !== time(w.validUntil)
    const changed = !sameFactValue(target.value, w.value) || target.origin !== w.origin || target.confidence !== confidence || untilChanged
    await tx.update(profileFacts).set({
      value: w.value,
      origin: w.origin,
      confidence,
      evidence,
      ...(w.validUntil !== undefined ? { validUntil: w.validUntil } : {}),
      // Point the fact at the memory row it mirrors, so the boot copy never duplicates it.
      ...(w.sourceMemoryId && target.sourceMemoryId !== w.sourceMemoryId ? { sourceMemoryId: w.sourceMemoryId } : {}),
      updatedAt: now,
    }).where(eq(profileFacts.id, target.id))
    if (!changed) return { factId: target.id, action: 'unchanged' }
    await tx.insert(profileChanges).values({
      householdId: w.householdId, factId: target.id, action: 'fact_updated', factType: w.type,
      before: { value: target.value, confidence: target.confidence, origin: target.origin },
      after: { value: w.value, confidence }, reason: w.reason, origin: w.origin, actorUserId: w.actorUserId,
    })
    return { factId: target.id, action: 'updated' }
  }

  const [row] = await tx.insert(profileFacts).values({
    householdId: w.householdId,
    subjectUserId: w.subjectUserId,
    subjectPersonId: w.subjectPersonId,
    type: w.type,
    value: w.value,
    origin: w.origin,
    confidence,
    evidence: [w.evidence],
    validUntil: w.validUntil ?? null,
    sourceMemoryId: w.sourceMemoryId ?? null,
  }).returning({ id: profileFacts.id })
  await tx.insert(profileChanges).values({
    householdId: w.householdId, factId: row.id, action: 'fact_added', factType: w.type,
    before: null, after: { value: w.value, confidence }, reason: w.reason, origin: w.origin, actorUserId: w.actorUserId,
  })
  return { factId: row.id, action: 'added' }
}

/** Retire the subject's active facts of a type (all of them), each with its history row. Runs in `tx`. */
export async function retireProfileFacts(
  tx: any,
  w: { householdId: string; subjectUserId: string | null; subjectPersonId: string | null; type: string; reason: string; origin: ProfileFactOrigin; actorUserId: string | null; now?: Date },
): Promise<number> {
  const now = w.now ?? new Date()
  const current: any[] = await tx.select().from(profileFacts)
    .where(subjectWhere(w.householdId, w.subjectUserId, w.subjectPersonId, w.type))
  for (const f of current) {
    await tx.update(profileFacts).set({ status: 'retired', updatedAt: now }).where(eq(profileFacts.id, f.id))
    await tx.insert(profileChanges).values({
      householdId: w.householdId, factId: f.id, action: 'fact_retired', factType: w.type,
      before: { value: f.value, confidence: f.confidence, origin: f.origin }, after: null,
      reason: w.reason, origin: w.origin, actorUserId: w.actorUserId,
    })
  }
  return current.length
}

/** The household a user's facts go to: their primary household, else the first they joined (as the boot copy). */
export async function householdIdForUser(tx: any, userId: string): Promise<string | null> {
  const [u] = await tx.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
  if (u?.householdId) return u.householdId
  const [m] = await tx.select({ householdId: householdMembers.householdId }).from(householdMembers)
    .where(eq(householdMembers.userId, userId)).orderBy(asc(householdMembers.joinedAt)).limit(1)
  return m?.householdId ?? null
}

/** Pure: whom a memory key is about in the ficha (the household or the user). */
export function memorySubject(key: string, userId: string): { subjectUserId: string | null; subjectPersonId: null } {
  return { subjectUserId: memoryKeyIsHouseholdLevel(key) ? null : userId, subjectPersonId: null }
}

/**
 * The ficha side of a memory write (same transaction). A user without a
 * household is skipped (the boot copy picks it up when they have one); a
 * health fact the ficha rules refuse (by WhatsApp) is not mirrored.
 */
export async function mirrorMemoryWrite(
  tx: any,
  w: { userId: string; memoryId: string; key: string; value: unknown; source: MemorySource; confidence: number; signal: FactSignal; hasHealthConsent: boolean; now?: Date },
): Promise<FactWriteResult | null> {
  const allowed = canWriteProfileFact({ type: w.key, channel: channelOf(w.signal), hasHealthConsent: w.hasHealthConsent })
  if (!allowed.ok) return null
  const householdId = await householdIdForUser(tx, w.userId)
  if (!householdId) return null
  const now = w.now ?? new Date()
  const origin = MEMORY_SOURCE_TO_ORIGIN[w.source] ?? 'user'
  return upsertProfileFact(tx, {
    householdId,
    ...memorySubject(w.key, w.userId),
    type: w.key,
    value: w.value,
    origin,
    confidence: w.confidence,
    evidence: signalEvidence(w.signal, w.key, w.value, now),
    sourceMemoryId: w.memoryId,
    reason: SIGNAL_LABEL[w.signal],
    actorUserId: origin === 'user' || origin === 'onboarding' ? w.userId : null,
    now,
  })
}

/** The ficha side of forgetting a memory key (same transaction). */
export async function mirrorMemoryDelete(tx: any, w: { userId: string; key: string; signal: FactSignal; now?: Date }): Promise<number> {
  const householdId = await householdIdForUser(tx, w.userId)
  if (!householdId) return 0
  return retireProfileFacts(tx, {
    householdId, ...memorySubject(w.key, w.userId), type: w.key,
    reason: `${SIGNAL_LABEL[w.signal]}: lo olvidó`, origin: 'user', actorUserId: w.userId, now: w.now,
  })
}

/** Stale copies: facts copied from a memory row whose value changed after the copy (boot fix, PRO-316). */
export const STALE_MEMORY_COPIES_SQL = sql`
  SELECT f.id AS fact_id, f.household_id, f.value AS fact_value, f.origin AS fact_origin, f.confidence AS fact_confidence,
         m.id AS memory_id, m.user_id, m.key, m.value AS memory_value, m.source, m.confidence, m.updated_at
  FROM profile_facts f
  JOIN user_memories m ON m.id = f.source_memory_id
  WHERE f.status = 'active' AND f.value IS DISTINCT FROM m.value AND m.updated_at > f.updated_at
`
