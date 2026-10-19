/**
 * Waitlist retention (PRO-171, LEG-17; specs/waitlist.md «Retention»,
 * /privacidad «11. Lista de espera»).
 *
 * The policy keeps a waitlist entry until 2027-05-16 (six months after
 * registration opened to everyone on 2026-11-16) or until the person leaves,
 * whichever comes first. From that day (Madrid), once a day, the scheduler
 * removes what identifies each entry — email, name and supermarket, plus the
 * newsletter's send traces for that email — and keeps the answers for the
 * counts. Same columns as leaving the list (`unsubscribe` in waitlist.ts).
 *
 * Who keeps their email: whoever still has the Friday newsletter on
 * (`newsletter_opt_in`): the policy keeps it «mientras no te des de baja».
 * If they turn it off later, the next daily run anonymises them too.
 *
 * Split like the rest of the waitlist: the date rule and the run are pure
 * over a small repo (tests/waitlistRetention.test.ts); Postgres in
 * `createDbWaitlistRetentionRepo`.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { waitlistEntries } from '../db/schema.js'
import { madridParts } from './madridTime.js'
import { forgetNewsletterSends } from './newsletter.js'

type Db = typeof defaultDb

/** The day the waitlist's personal data goes (Madrid). Quoted word for word in /privacidad. */
export const WAITLIST_RETENTION_DATE = '2027-05-16'

/** True from 00:00 Madrid on WAITLIST_RETENTION_DATE onwards. */
export function isWaitlistRetentionDue(now: Date): boolean {
  return madridParts(now).isoDate >= WAITLIST_RETENTION_DATE
}

export interface RetentionCandidate {
  id: string
  email: string
}

export interface WaitlistRetentionRepo {
  /** Entries that still hold an email and don't have the Friday newsletter on. */
  listExpired(): Promise<RetentionCandidate[]>
  /** Removes email, name and supermarket of these entries and the send traces of their emails. */
  anonymise(entries: RetentionCandidate[]): Promise<number>
}

/** Runs the purge if the date has come. Returns how many entries were anonymised, or null before the date. */
export async function purgeWaitlistPersonalData(now: Date, repo: WaitlistRetentionRepo): Promise<number | null> {
  if (!isWaitlistRetentionDue(now)) return null
  const expired = await repo.listExpired()
  if (expired.length === 0) return 0
  return repo.anonymise(expired)
}

/**
 * Postgres repo. `onlyIds` scopes it to some entries (the smoke test runs the
 * real SQL on its own rows without touching anyone else's).
 */
export function createDbWaitlistRetentionRepo(db: Db = defaultDb, onlyIds?: string[]): WaitlistRetentionRepo {
  const scope = onlyIds ? inArray(waitlistEntries.id, onlyIds) : undefined
  return {
    async listExpired() {
      const rows = await db
        .select({ id: waitlistEntries.id, email: waitlistEntries.email })
        .from(waitlistEntries)
        .where(and(isNotNull(waitlistEntries.email), eq(waitlistEntries.newsletterOptIn, false), scope))
      return rows.filter((r): r is RetentionCandidate => !!r.email)
    },
    async anonymise(entries) {
      const ids = entries.map((e) => e.id)
      return db.transaction(async (tx) => {
        const updated = await tx
          .update(waitlistEntries)
          .set({ email: null, firstName: null, supermarket: null })
          // Re-checks the newsletter: someone who turned it on in between keeps their email.
          .where(and(inArray(waitlistEntries.id, ids), eq(waitlistEntries.newsletterOptIn, false)))
          .returning({ id: waitlistEntries.id })
        const done = new Set(updated.map((u) => u.id))
        for (const e of entries) if (done.has(e.id)) await forgetNewsletterSends(tx, e.email)
        return updated.length
      })
    },
  }
}

let lastRunDay: string | null = null

/** Called from the scheduler tick: once per Madrid day per process, from the retention date on. */
export async function purgeWaitlistPersonalDataIfDue(
  now: Date = new Date(),
  repo: WaitlistRetentionRepo = createDbWaitlistRetentionRepo(),
): Promise<number | null> {
  if (!isWaitlistRetentionDue(now)) return null
  const day = madridParts(now).isoDate
  if (lastRunDay === day) return null
  lastRunDay = day
  return purgeWaitlistPersonalData(now, repo)
}

/** Tests only: forget the once-a-day memo. */
export function resetWaitlistRetentionMemo(): void {
  lastRunDay = null
}
