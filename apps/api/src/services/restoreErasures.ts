import { eq } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { householdPersons, users } from '../db/schema.js'
import { AdminAccountDeletionError, deleteAccount } from './accountDeletion.js'
import { type Erasure, ensureErasureLog, loadErasures, recordErasure } from './erasureLog.js'
import { withdrawHealthConsent } from './healthConsent.js'

/**
 * After restoring a backup, before the service opens (PRO-1122): erase again
 * what people erased since that copy was made. The erasures come from the
 * restored database's own log plus, when given, the log of another database
 * (the one being replaced, or the newest copy), which knows the later ones.
 *
 *   ERASURES_FROM_URL=<postgres url> pnpm --filter @ona/api db:apply-erasures
 */

export interface ErasureReplay {
  accounts: number
  persons: number
  healthConsents: number
}

export async function applyErasures(opts: { db?: any; from?: Erasure[]; now?: Date } = {}): Promise<ErasureReplay> {
  const db = opts.db ?? defaultDb
  await ensureErasureLog(db)
  // Whatever the other log knows goes into this one too: the next copy keeps it.
  for (const e of opts.from ?? []) await recordErasure(db, e.kind, e.subjectId, e.erasedAt)
  const out: ErasureReplay = { accounts: 0, persons: 0, healthConsents: 0 }
  for (const e of await loadErasures(db, opts.now)) {
    if (e.kind === 'account') {
      const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, e.subjectId)).limit(1)
      if (!u) continue
      try {
        await deleteAccount(e.subjectId, { db, at: e.erasedAt })
        out.accounts += 1
      } catch (err) {
        // Never logged for an admin (refused before the log), but never block a restore on it.
        if (!(err instanceof AdminAccountDeletionError)) throw err
      }
    } else if (e.kind === 'person') {
      const gone = await db.delete(householdPersons).where(eq(householdPersons.id, e.subjectId)).returning({ id: householdPersons.id })
      out.persons += gone.length
    } else if (e.kind === 'health_consent') {
      const [u] = await db
        .select({ consentAt: users.healthConsentAt, withdrawnAt: users.healthConsentWithdrawnAt })
        .from(users)
        .where(eq(users.id, e.subjectId))
        .limit(1)
      if (!needsHealthReplay(u, e.erasedAt)) continue
      await withdrawHealthConsent(e.subjectId, { db, at: e.erasedAt })
      out.healthConsents += 1
    }
  }
  return out
}

/**
 * Pure: whether the copy still holds health data the person withdrew. Not when
 * the account isn't there, when the copy already has that withdrawal (or a
 * later one), or when the consent in the copy was given again after it.
 */
export function needsHealthReplay(u: { consentAt: Date | null; withdrawnAt: Date | null } | undefined, erasedAt: Date): boolean {
  if (!u) return false
  if (u.withdrawnAt && u.withdrawnAt.getTime() >= erasedAt.getTime()) return false
  if (u.consentAt && u.consentAt.getTime() > erasedAt.getTime()) return false
  return true
}
