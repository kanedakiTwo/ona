/**
 * User-memory store — thin wrapper around the `user_memories` table that
 * validates every write against the per-key Zod schema in @ona/shared.
 *
 * PRO-316 (D-064, D-110): the ficha del hogar is the one source of what we
 * know about a person. Every write and every delete here also writes the
 * ficha, in the same transaction (`mirrorMemoryWrite` / `mirrorMemoryDelete`,
 * services/profile/writer.ts), with its history row; `user_memories` stays as
 * a mirror while the menu generator still reads it.
 *
 * Reads are cheap (one indexed lookup per user); the advisor caches the
 * digest per session so we don't fetch on every skill invocation.
 */
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { userMemories, users } from '../db/schema.js'
import { HealthConsentRequiredError, ReligionConsentRequiredError, assertReligionConsent, hasHealthConsent } from './healthConsent.js'
import { mirrorMemoryDelete, mirrorMemoryWrite, type FactSignal } from './profile/writer.js'
import {
  isHealthMemoryKey,
  validateMemoryFactValue,
  buildMemoryDigestText,
  type MemoryKey,
  type MemorySource,
  type MemoryFact,
  type UserMemory,
} from '@ona/shared'

export class UnknownMemoryKeyError extends Error {
  constructor(key: string) {
    super(`Unknown memory key: ${key}`)
    this.name = 'UnknownMemoryKeyError'
  }
}

export class MemoryValueValidationError extends Error {
  constructor(public readonly key: string, public readonly reason: string) {
    super(`Invalid value for ${key}: ${reason}`)
    this.name = 'MemoryValueValidationError'
  }
}

function rowToFact(row: typeof userMemories.$inferSelect): MemoryFact {
  return {
    key: row.key as MemoryKey,
    value: row.value,
    source: row.source as MemorySource,
    confidence: row.confidence,
    updatedAt: row.updatedAt.toISOString(),
  }
}

/**
 * Load every memory fact for the user as a key-indexed object. Missing
 * keys are absent (no nulls) so the frontend can use `memory?.key?.value`
 * without juggling undefined vs null.
 */
export async function getMemoryForUser(userId: string): Promise<UserMemory> {
  const rows = await db.select().from(userMemories).where(eq(userMemories.userId, userId))
  const out: UserMemory = {}
  for (const row of rows) {
    out[row.key as MemoryKey] = rowToFact(row)
  }
  return out
}

export { HealthConsentRequiredError, ReligionConsentRequiredError }

/**
 * Health keys (physical.*, restrictions) need the art. 9 consent (PRO-21);
 * a diet for religious reasons, the consent text that names it (E-19).
 * Returns whether the user has the consent.
 */
async function assertHealthConsentFor(userId: string, facts: ReadonlyArray<{ key: string; value: unknown }>): Promise<boolean> {
  if (!facts.some((f) => isHealthMemoryKey(f.key))) return false
  if (!(await hasHealthConsent(userId))) throw new HealthConsentRequiredError()
  for (const f of facts) if (f.key === 'restrictions') await assertReligionConsent(userId, f.value)
  return true
}

/** Where a memory write comes from (the ficha's evidence). Without one, from the source. */
export interface MemoryWriteOptions {
  signal?: FactSignal
}

function signalFor(source: MemorySource, opts?: MemoryWriteOptions): FactSignal {
  if (opts?.signal) return opts.signal
  return source === 'onboarding' ? 'onboarding' : source === 'inferred' ? 'chat' : 'profile'
}

/**
 * `household.adults` / `household.kids_2_to_10` are also the account's counts
 * (`users.adults` / `users.kidsCount`), the ones the profile, the shopping
 * list and the menu read: what Mimo notes («tenemos dos niños») lands there
 * too (2026-10-22: a tester's kids were in WhatsApp but not in her profile).
 */
export function householdCountsPatch(key: string, value: unknown): { adults: number } | { kidsCount: number } | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (key === 'household.adults') return value >= 1 ? { adults: value } : null
  if (key === 'household.kids_2_to_10') return value >= 0 ? { kidsCount: value } : null
  return null
}

/** Same transaction as the memory write. Also used by the ficha when it edits these keys. */
export async function syncHouseholdCounts(tx: any, userId: string, facts: ReadonlyArray<{ key: string; value: unknown }>): Promise<void> {
  const patch = Object.assign({}, ...facts.map((f) => householdCountsPatch(f.key, f.value) ?? {}))
  if (Object.keys(patch).length === 0) return
  await tx.update(users).set(patch).where(eq(users.id, userId))
}

/**
 * The other way round: counts changed in the profile (or with
 * `update_household`) refresh the memory copies, when there are any, so Mimo
 * doesn't keep reading the old ones.
 */
export async function alignHouseholdMemory(userId: string, counts: { adults?: number | null; kidsCount?: number | null }): Promise<void> {
  const memory = await getMemoryForUser(userId)
  const facts: Array<{ key: string; value: number }> = []
  const adults = memory['household.adults']
  const kids = memory['household.kids_2_to_10']
  if (typeof counts.adults === 'number' && adults && adults.value !== counts.adults) facts.push({ key: 'household.adults', value: counts.adults })
  if (typeof counts.kidsCount === 'number' && kids && kids.value !== counts.kidsCount) facts.push({ key: 'household.kids_2_to_10', value: counts.kidsCount })
  if (facts.length > 0) await setMemoryBatch(userId, facts, 'manual', { signal: 'profile' })
}

/**
 * Upsert one fact. Throws if the key is unknown or the value fails its
 * schema. Returns the resulting fact (for the route's response).
 */
export async function setMemoryFact(
  userId: string,
  key: string,
  value: unknown,
  source: MemorySource = 'manual',
  confidence: number = 1,
  opts?: MemoryWriteOptions,
): Promise<MemoryFact> {
  const v = validateMemoryFactValue(key, value)
  if (!v.ok) {
    if (v.reason.startsWith('unknown')) throw new UnknownMemoryKeyError(key)
    throw new MemoryValueValidationError(key, v.reason)
  }
  const consent = await assertHealthConsentFor(userId, [v])
  const signal = signalFor(source, opts)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(userMemories)
      .values({
        userId,
        key: v.key,
        value: v.value as object,
        source,
        confidence,
      })
      .onConflictDoUpdate({
        target: [userMemories.userId, userMemories.key],
        set: {
          value: v.value as object,
          source,
          confidence,
          updatedAt: new Date(),
        },
      })
      .returning()
    await mirrorMemoryWrite(tx, { userId, memoryId: row.id, key: v.key, value: v.value, source, confidence, signal, hasHealthConsent: consent })
    await syncHouseholdCounts(tx, userId, [v])
    return rowToFact(row)
  })
}

/**
 * Bulk-upsert helper for the voice-onboarding flow + the assistant's
 * `update_memory` skill. Each fact is validated independently; the first
 * failure rolls back the whole batch so the user never ends up with a
 * half-written memory.
 */
export async function setMemoryBatch(
  userId: string,
  facts: Array<{ key: string; value: unknown; confidence?: number }>,
  source: MemorySource = 'manual',
  opts?: MemoryWriteOptions,
): Promise<UserMemory> {
  // Validate everything first — fail fast outside the transaction so the
  // 400 includes the offending key.
  const validated: Array<{ key: MemoryKey; value: unknown; confidence: number }> = []
  for (const f of facts) {
    const v = validateMemoryFactValue(f.key, f.value)
    if (!v.ok) {
      if (v.reason.startsWith('unknown')) throw new UnknownMemoryKeyError(f.key)
      throw new MemoryValueValidationError(f.key, v.reason)
    }
    validated.push({ key: v.key, value: v.value, confidence: f.confidence ?? 1 })
  }
  const consent = await assertHealthConsentFor(userId, validated)
  const signal = signalFor(source, opts)
  await db.transaction(async (tx) => {
    for (const f of validated) {
      const [row] = await tx
        .insert(userMemories)
        .values({
          userId,
          key: f.key,
          value: f.value as object,
          source,
          confidence: f.confidence,
        })
        .onConflictDoUpdate({
          target: [userMemories.userId, userMemories.key],
          set: {
            value: f.value as object,
            source,
            confidence: f.confidence,
            updatedAt: new Date(),
          },
        })
        .returning({ id: userMemories.id })
      await mirrorMemoryWrite(tx, { userId, memoryId: row.id, key: f.key, value: f.value, source, confidence: f.confidence, signal, hasHealthConsent: consent })
    }
    await syncHouseholdCounts(tx, userId, validated)
  })
  return await getMemoryForUser(userId)
}

export async function deleteMemoryFact(userId: string, key: string, opts?: MemoryWriteOptions): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(userMemories)
      .where(and(eq(userMemories.userId, userId), eq(userMemories.key, key)))
    await mirrorMemoryDelete(tx, { userId, key, signal: opts?.signal ?? 'profile' })
  })
}

/**
 * Compose the Spanish-language digest the advisor injects into its system
 * prompt. Stable shape — the prompt-cache assumes the digest only changes
 * when the user edits a memory fact, so don't reorder lines casually.
 */
export async function buildMemoryDigest(userId: string): Promise<string> {
  const memory = await getMemoryForUser(userId)
  return buildMemoryDigestText(memory)
}

/** Drop every memory fact for a user (used by test cleanup, not production). */
export async function clearMemoryForUser(userId: string): Promise<void> {
  await db.delete(userMemories).where(eq(userMemories.userId, userId))
}
