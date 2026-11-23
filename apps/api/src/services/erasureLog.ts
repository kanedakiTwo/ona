import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'

/**
 * The erasure log (PRO-1122). Every night Oracle keeps an encrypted copy of
 * the database for 14 days (D-138). When someone deletes their account, a
 * person of their household or withdraws the health-data consent, the data
 * leave the database at once but stay in those copies: this log keeps only
 * what was erased and when (the id, never the data) for 15 days, so a
 * restore can erase it again before the service opens
 * (`services/restoreErasures.ts`, `pnpm --filter @ona/api db:apply-erasures`).
 *
 * The table lives outside the Drizzle migrations on purpose: it is created
 * here if missing, so it exists in any copy, even one from before it.
 */

export type ErasureKind = 'account' | 'person' | 'health_consent'

export interface Erasure {
  kind: ErasureKind
  subjectId: string
  erasedAt: Date
}

/** Copies last 14 days; one more so a restore of the oldest still sees everything. */
export const ERASURE_LOG_DAYS = 15

type Db = { execute: (q: any) => Promise<any> }

const CREATE = sql`CREATE TABLE IF NOT EXISTS erasure_log (
  kind text NOT NULL,
  subject_id uuid NOT NULL,
  erased_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, subject_id, erased_at)
)`

let ensured: Promise<unknown> | null = null

/** Creates the table if missing (once per process on the app's own database). */
export async function ensureErasureLog(db: Db = defaultDb): Promise<void> {
  if (db !== defaultDb) {
    await db.execute(CREATE)
    return
  }
  ensured ??= db.execute(CREATE).catch((err) => {
    ensured = null
    throw err
  })
  await ensured
}

/**
 * Writes one erasure. Call it inside the transaction that erases, after
 * `ensureErasureLog()` outside it: the erasure and its record commit together.
 * Rows older than 15 days go in the same call.
 */
export async function recordErasure(db: Db, kind: ErasureKind, subjectId: string, at: Date = new Date()): Promise<void> {
  await db.execute(
    sql`INSERT INTO erasure_log (kind, subject_id, erased_at) VALUES (${kind}, ${subjectId}, ${at.toISOString()}) ON CONFLICT DO NOTHING`,
  )
  await db.execute(sql`DELETE FROM erasure_log WHERE erased_at < ${cutoff(at).toISOString()}`)
}

/** The erasures of the last 15 days, oldest first. */
export async function loadErasures(db: Db = defaultDb, now: Date = new Date()): Promise<Erasure[]> {
  await ensureErasureLog(db)
  const res = await db.execute(
    sql`SELECT kind, subject_id, erased_at FROM erasure_log WHERE erased_at >= ${cutoff(now).toISOString()} ORDER BY erased_at`,
  )
  return (res.rows ?? res).map((r: any) => ({ kind: r.kind, subjectId: r.subject_id, erasedAt: new Date(r.erased_at) }))
}

function cutoff(now: Date): Date {
  return new Date(now.getTime() - ERASURE_LOG_DAYS * 24 * 60 * 60 * 1000)
}
