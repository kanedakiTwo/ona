/**
 * Smoke for PRO-384 against the real Postgres: the resolved week that fires
 * the founder offer loads with the real SQL (menus, activity_events), and
 * only list use from the trial's first day counts.
 * Registers its own user (needs REGISTRATION_MODE=open, as CI's smoke job).
 * Skips when the API isn't reachable.
 */
import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { users } from '../db/schema.js'
import { householdWeekResolved } from '../services/founderOffer.js'
import { madridWeekStart } from '../services/madridTime.js'

const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const madridDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d)

describe.skipIf(!reachable)('founder offer: resolved week (real DB)', () => {
  it('a menu for this week and the list used today → resolved; list use before the trial does not count', async () => {
    const r = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `fo_${id}`.slice(0, 30), email: `fo_${id}@test.local`, password: 'smokepass123', ageConfirmed: true }),
    })
    expect(r.status).toBe(201)
    const { user } = await r.json()
    const [row] = await db.select({ household: users.primaryHouseholdId }).from(users).where(eq(users.id, user.id))
    const household = String(row.household)
    const now = new Date()
    const today = madridDay(now)
    const tomorrow = madridDay(new Date(now.getTime() + 86_400_000))

    expect(await householdWeekResolved(household, today, db)).toBe(false)
    await db.execute(sql`
      INSERT INTO menus (user_id, household_id, week_start, days)
      VALUES (${user.id}::uuid, ${household}::uuid, ${madridWeekStart(now)}::date, '[]'::jsonb)
    `)
    expect(await householdWeekResolved(household, today, db)).toBe(false)
    await db.execute(sql`
      INSERT INTO activity_events (user_id, household_id, kind, item, toggled_on)
      VALUES (${user.id}::uuid, ${household}::uuid, 'shopping_check', 'leche', true)
    `)
    expect(await householdWeekResolved(household, today, db)).toBe(true)
    expect(await householdWeekResolved(household, tomorrow, db)).toBe(false)
  })
})
