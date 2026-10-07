/**
 * In-memory `WaitlistRepo` for the waitlist unit and route tests: same
 * semantics as the Postgres one (unique email / code / token, anonymising
 * unsubscribe), plus two knobs to force the rare paths.
 */
import type { WaitlistStatus } from '@ona/shared'
import type { NewWaitlistEntry, UnsubscribeOutcome, WaitlistRepo } from '../../services/waitlist.js'

export interface MemoryWaitlistRow extends Omit<NewWaitlistEntry, 'email'> {
  id: string
  email: string | null
  status: WaitlistStatus
  createdAt: Date
}

export interface MemoryWaitlistRepo extends WaitlistRepo {
  rows: MemoryWaitlistRow[]
  /** Next N inserts report a collision (as if the random code were taken). */
  forceCodeCollisions: number
  /** Next email lookup misses (as if a concurrent request inserted in between). */
  hideEmailOnNextLookup: boolean
}

export function createMemoryWaitlistRepo(): MemoryWaitlistRepo {
  const rows: MemoryWaitlistRow[] = []
  const repo: MemoryWaitlistRepo = {
    rows,
    forceCodeCollisions: 0,
    hideEmailOnNextLookup: false,
    async findCodeByEmail(email) {
      if (repo.hideEmailOnNextLookup) {
        repo.hideEmailOnNextLookup = false
        return null
      }
      return rows.find((r) => r.email === email)?.referralCode ?? null
    },
    async isActiveCode(code) {
      return rows.some((r) => r.referralCode === code && r.status !== 'unsubscribed')
    },
    async insert(entry) {
      if (repo.forceCodeCollisions > 0) {
        repo.forceCodeCollisions -= 1
        return false
      }
      const taken = rows.some(
        (r) =>
          (r.email !== null && r.email === entry.email) ||
          r.referralCode === entry.referralCode ||
          r.unsubscribeToken === entry.unsubscribeToken,
      )
      if (taken) return false
      rows.push({ ...entry, id: `row-${rows.length + 1}`, status: 'waiting', createdAt: new Date() })
      return true
    },
    async countReferred(code) {
      return rows.filter((r) => r.referredByCode === code && r.status !== 'unsubscribed').length
    },
    async unsubscribe(token): Promise<UnsubscribeOutcome> {
      const row = rows.find((r) => r.unsubscribeToken === token)
      if (!row) return 'not_found'
      if (row.status === 'unsubscribed') return 'already'
      row.status = 'unsubscribed'
      row.email = null
      row.firstName = null
      row.supermarket = null
      row.newsletterOptIn = false
      return 'unsubscribed'
    },
  }
  return repo
}
