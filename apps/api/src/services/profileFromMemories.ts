/**
 * PRO-150 — copies `user_memories` into the ficha del hogar
 * (specs/household-profile.md).
 *
 * Each memory row becomes one `profile_facts` row in the user's household
 * (primary household, else the first one they joined), with its origin
 * (manual → user, onboarding → onboarding, inferred → ai_realtime), its
 * confidence, and one piece of evidence saying where it came from. Each
 * copied fact leaves a `profile_changes` row («fact_added»).
 *
 * Idempotent: `profile_facts.source_memory_id` is unique, so a row already
 * copied is skipped (`ON CONFLICT DO NOTHING`). Since PRO-316 every memory
 * write also writes the ficha (services/profile/writer.ts); this copy only
 * catches rows written before that, or by a user who had no household yet,
 * and puts back in step a copy whose memory changed after it was copied
 * (`refreshed`, with its history row).
 *
 * Runs by itself after `db:migrate` (every API boot), like the PRO-57 and
 * PRO-78 data fixes.
 */
import { sql } from 'drizzle-orm'
import { STALE_MEMORY_COPIES_SQL, upsertProfileFact, madridDate as madridDay } from './profile/writer.js'
import {
  MEMORY_SOURCE_TO_ORIGIN,
  memoryKeyIsHouseholdLevel,
  type MemorySource,
  type ProfileEvidence,
  type ProfileFactOrigin,
} from '@ona/shared'

/** What the copy needs from a `user_memories` row. */
export interface MemoryRowForProfile {
  id: string
  userId: string
  key: string
  value: unknown
  source: string
  confidence: number
  updatedAt: Date
  /** The household the user belongs to (null: none, the row is skipped). */
  householdId: string | null
}

export interface ProfileFactFromMemory {
  householdId: string
  subjectUserId: string | null
  type: string
  value: unknown
  origin: ProfileFactOrigin
  confidence: number
  evidence: ProfileEvidence[]
  sourceMemoryId: string
}

const SOURCE_LABEL: Record<MemorySource, string> = {
  manual: 'lo escribió el usuario',
  onboarding: 'del alta',
  inferred: 'lo dedujo Mimo en una conversación',
}

function madridDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)
}

/** Pure: one memory row → the fact it becomes (null when the user has no household). */
export function memoryRowToProfileFact(row: MemoryRowForProfile): ProfileFactFromMemory | null {
  if (!row.householdId) return null
  const source = (row.source in MEMORY_SOURCE_TO_ORIGIN ? row.source : 'manual') as MemorySource
  const confidence = Math.min(1, Math.max(0, Number.isFinite(row.confidence) ? row.confidence : 1))
  return {
    householdId: row.householdId,
    subjectUserId: memoryKeyIsHouseholdLevel(row.key) ? null : row.userId,
    type: row.key,
    value: row.value,
    origin: MEMORY_SOURCE_TO_ORIGIN[source],
    confidence,
    evidence: [{
      signal: 'user_memories',
      date: madridDate(row.updatedAt),
      summary: `Copiado de la memoria de Mimo (${SOURCE_LABEL[source]})`,
    }],
    sourceMemoryId: row.id,
  }
}

export interface ProfileFromMemoriesResult {
  memories: number
  copied: number
  alreadyCopied: number
  withoutHousehold: number
  /** Copies put back in step with a memory that changed after the copy (PRO-316). */
  refreshed: number
}

type Db = typeof import('../db/connection.js').db

export async function applyProfileFromMemories(
  db: Db,
  log: (line: string) => void = console.log,
): Promise<ProfileFromMemoriesResult> {
  const res = await db.execute(sql`
    SELECT m.id, m.user_id, m.key, m.value, m.source, m.confidence, m.updated_at,
           COALESCE(
             (SELECT h.id FROM households h WHERE h.id = u.primary_household_id),
             (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = m.user_id ORDER BY hm.joined_at LIMIT 1)
           ) AS household_id
    FROM user_memories m
    JOIN users u ON u.id = m.user_id
    WHERE NOT EXISTS (SELECT 1 FROM profile_facts f WHERE f.source_memory_id = m.id)
  `)
  const rows = (res.rows as any[]).map((r): MemoryRowForProfile => ({
    id: r.id,
    userId: r.user_id,
    key: r.key,
    value: r.value,
    source: r.source,
    confidence: Number(r.confidence),
    updatedAt: new Date(r.updated_at),
    householdId: r.household_id ?? null,
  }))

  const result: ProfileFromMemoriesResult = { memories: rows.length, copied: 0, alreadyCopied: 0, withoutHousehold: 0, refreshed: 0 }
  for (const row of rows) {
    const fact = memoryRowToProfileFact(row)
    if (!fact) {
      result.withoutHousehold++
      continue
    }
    await db.transaction(async (tx) => {
      const inserted = await tx.execute(sql`
        INSERT INTO profile_facts (household_id, subject_user_id, type, value, origin, confidence, evidence, source_memory_id)
        VALUES (${fact.householdId}, ${fact.subjectUserId}, ${fact.type}, ${JSON.stringify(fact.value)}::jsonb,
                ${fact.origin}, ${fact.confidence}, ${JSON.stringify(fact.evidence)}::jsonb, ${fact.sourceMemoryId})
        ON CONFLICT (source_memory_id) DO NOTHING
        RETURNING id
      `)
      const factId = (inserted.rows as any[])[0]?.id as string | undefined
      if (!factId) {
        result.alreadyCopied++
        return
      }
      await tx.execute(sql`
        INSERT INTO profile_changes (household_id, fact_id, action, fact_type, before, after, reason, origin)
        VALUES (${fact.householdId}, ${factId}, 'fact_added', ${fact.type}, NULL, ${JSON.stringify(fact.value)}::jsonb,
                'Migración desde la memoria de Mimo (user_memories)', ${fact.origin})
      `)
      result.copied++
    })
  }
  // PRO-316: copies whose memory changed after the copy go back in step.
  const stale = await db.execute(STALE_MEMORY_COPIES_SQL)
  for (const r of stale.rows as any[]) {
    const source = (r.source in MEMORY_SOURCE_TO_ORIGIN ? r.source : 'manual') as MemorySource
    const now = new Date()
    await db.transaction(async (tx) => {
      const out = await upsertProfileFact(tx, {
        householdId: r.household_id,
        subjectUserId: memoryKeyIsHouseholdLevel(r.key) ? null : r.user_id,
        subjectPersonId: null,
        type: r.key,
        value: r.memory_value,
        origin: MEMORY_SOURCE_TO_ORIGIN[source],
        confidence: Math.min(1, Math.max(0, Number(r.confidence))),
        evidence: { signal: 'user_memories', date: madridDay(new Date(r.updated_at)), summary: `Puesto al día con la memoria de Mimo (${SOURCE_LABEL[source]})` },
        sourceMemoryId: r.memory_id,
        reason: 'La memoria de Mimo cambió después de copiarla a la ficha',
        actorUserId: null,
        now,
      })
      if (out.action !== 'unchanged') result.refreshed++
    })
  }
  if (result.memories > 0 || result.refreshed > 0) {
    log(`[profile-from-memories] ${result.copied} hechos copiados a la ficha, ${result.alreadyCopied} ya estaban, ${result.withoutHousehold} sin hogar, ${result.refreshed} puestos al día`)
  }
  return result
}
