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
import { userMemories } from '../db/schema.js'
import { HealthConsentRequiredError, hasHealthConsent } from './healthConsent.js'
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

export { HealthConsentRequiredError }

/** Health keys (physical.*, restrictions) need the art. 9 consent (PRO-21). Returns whether the user has it. */
async function assertHealthConsentFor(userId: string, keys: string[]): Promise<boolean> {
  if (!keys.some(isHealthMemoryKey)) return false
  if (!(await hasHealthConsent(userId))) throw new HealthConsentRequiredError()
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
  const consent = await assertHealthConsentFor(userId, [v.key])
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
  const consent = await assertHealthConsentFor(userId, validated.map((f) => f.key))
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
