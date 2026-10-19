/**
 * Smoke for PRO-164 against the real Postgres: the offer's state and the
 * resolved weeks load with the real SQL (menus, activity_events, the new
 * users.invite_offer_* columns), and a «no» after the offer is stored.
 * Registers its own user (needs REGISTRATION_MODE=open, as CI's smoke job).
 * Skips when the API isn't reachable.
 */
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { users } from '../db/schema.js'
import { INVITE_OFFER_MARKER, loadInviteOfferInput, maybeAppendInviteOffer, recordInviteOfferAnswer } from '../services/inviteOffer.js'

const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`

describe.skipIf(!reachable)('invite offer (real DB)', () => {
  it('a new account: no resolved week, nothing appended; a «no» after the offer is stored', async () => {
    const r = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `io_${id}`.slice(0, 30), email: `io_${id}@test.local`, password: 'smokepass123', ageConfirmed: true }),
    })
    expect(r.status).toBe(201)
    const { user } = await r.json()

    const input = await loadInviteOfferInput(user.id, db)
    expect(input).toMatchObject({ offeredAt: null, declinedAt: null, resolvedWeeks: [] })
    expect(await maybeAppendInviteOffer(user.id, 'Hola')).toBe('Hola')

    const history = [{ role: 'assistant' as const, content: `Listo. ${INVITE_OFFER_MARKER}: https://x` }]
    expect(await recordInviteOfferAnswer(user.id, 'no', history, db)).toBe(true)
    const [row] = await db.select({ d: users.inviteOfferDeclinedAt }).from(users).where(eq(users.id, user.id))
    expect(row.d).toBeInstanceOf(Date)
    expect((await loadInviteOfferInput(user.id, db))?.declinedAt).toBeInstanceOf(Date)
  })
})
