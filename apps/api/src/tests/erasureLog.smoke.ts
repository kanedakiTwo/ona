/**
 * Smoke (real API + Postgres) for PRO-1122: the erasure log and its replay
 * after restoring a backup.
 *   - deleting an account, a person of the ficha or withdrawing the health
 *     consent writes only the id and the date to `erasure_log`;
 *   - `applyErasures` erases again, in a «restored copy» that still has them,
 *     what the log (its own or another one) says, and nothing else: a consent
 *     given again after the withdrawal stays, and a 16-day-old row is gone;
 *   - running it twice does nothing the second time.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/erasureLog.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdPersons, users } from '../db/schema.js'
import { ERASURE_LOG_DAYS, loadErasures } from '../services/erasureLog.js'
import { applyErasures, needsHealthReplay } from '../services/restoreErasures.js'

const DAY = 24 * 60 * 60 * 1000

async function call(method: string, path: string, token?: string, body?: unknown) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: r.status, json }
}

async function register(tag: string) {
  const name = `${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const r = await call('POST', '/register', undefined, { username: name, email: `${name}@test.local`, password: 'e2epass123', ageConfirmed: true })
  expect(r.status).toBeLessThan(300)
  return { token: r.json.token as string, id: r.json.user.id as string }
}

/** A user with health data under a consent given `daysAgo` days ago. */
async function withHealthData(tag: string, daysAgo: number) {
  const u = await register(tag)
  await db
    .update(users)
    .set({ healthConsentAt: new Date(Date.now() - daysAgo * DAY), healthConsentVersion: 'salud-v2-2026-10', age: 41, weight: 70, restrictions: ['sin gluten'] })
    .where(eq(users.id, u.id))
  return u
}

async function addPerson(token: string) {
  const r = await call('POST', '/household/profile/persons', token, { alias: 'la abuela', ageBand: 'adulto' })
  expect(r.status).toBe(201)
  const [p] = await db.select({ id: householdPersons.id }).from(householdPersons).where(eq(householdPersons.alias, 'la abuela')).orderBy(sql`created_at desc`).limit(1)
  return p.id as string
}

const logged = async (kind: string, id: string) => (await loadErasures()).filter((e) => e.kind === kind && e.subjectId === id)

describe.skipIf(!reachable)('erasure log (PRO-1122)', () => {
  it('each erasure writes only its id and date', async () => {
    const a = await withHealthData('erase_hc', 3)
    expect((await call('POST', `/user/${a.id}/health-consent`, a.token, { consent: false })).status).toBe(200)
    expect(await logged('health_consent', a.id)).toHaveLength(1)

    const personId = await addPerson(a.token)
    expect((await call('DELETE', `/household/profile/persons/${personId}`, a.token)).status).toBe(204)
    expect(await logged('person', personId)).toHaveLength(1)

    expect((await call('DELETE', `/user/${a.id}`, a.token, { password: 'e2epass123' })).status).toBe(200)
    expect(await logged('account', a.id)).toHaveLength(1)

    const cols = await db.execute(sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'erasure_log' ORDER BY column_name`)
    expect(cols.rows.map((r: any) => r.column_name)).toEqual(['erased_at', 'kind', 'subject_id'])
  })

  it('a restored copy erases again what the logs say, and only that', async () => {
    // The «restored copy» still holds what was erased after it was made.
    const gone = await register('erase_acc')
    const withdrawn = await withHealthData('erase_wd', 5)
    const regranted = await withHealthData('erase_rg', 0)
    const owner = await register('erase_owner')
    const personId = await addPerson(owner.token)
    const old = await register('erase_old')

    const now = new Date()
    const from = [
      { kind: 'account' as const, subjectId: gone.id, erasedAt: new Date(now.getTime() - 2 * DAY) },
      { kind: 'health_consent' as const, subjectId: withdrawn.id, erasedAt: new Date(now.getTime() - DAY) },
      { kind: 'health_consent' as const, subjectId: regranted.id, erasedAt: new Date(now.getTime() - DAY) },
      { kind: 'person' as const, subjectId: personId, erasedAt: new Date(now.getTime() - DAY) },
      { kind: 'account' as const, subjectId: old.id, erasedAt: new Date(now.getTime() - (ERASURE_LOG_DAYS + 1) * DAY) },
    ]
    const out = await applyErasures({ from })
    expect(out.accounts).toBeGreaterThanOrEqual(1)
    expect(out.persons).toBeGreaterThanOrEqual(1)

    expect(await db.select().from(users).where(eq(users.id, gone.id))).toHaveLength(0)
    expect(await db.select().from(householdPersons).where(eq(householdPersons.id, personId))).toHaveLength(0)
    const [w] = await db.select().from(users).where(eq(users.id, withdrawn.id))
    expect(w).toMatchObject({ age: null, weight: null, restrictions: [] })
    expect(w.healthConsentWithdrawnAt?.getTime()).toBe(from[1].erasedAt.getTime())
    // Consent given again after the withdrawal: the copy's data are the new ones.
    const [r] = await db.select().from(users).where(eq(users.id, regranted.id))
    expect(r).toMatchObject({ age: 41, restrictions: ['sin gluten'] })
    // Older than the copies: out of the log, never applied.
    expect(await db.select().from(users).where(eq(users.id, old.id))).toHaveLength(1)
    expect(await logged('account', old.id)).toHaveLength(0)
    // The other log's rows are now in this one.
    expect(await logged('account', gone.id)).toHaveLength(1)

    // Twice: nothing left to erase for these.
    await applyErasures()
    expect(await db.select().from(users).where(eq(users.id, old.id))).toHaveLength(1)
    const [r2] = await db.select().from(users).where(eq(users.id, regranted.id))
    expect(r2.age).toBe(41)
  })
})

describe('needsHealthReplay', () => {
  const at = new Date('2026-11-10T10:00:00Z')
  const before = new Date('2026-11-01T10:00:00Z')
  const after = new Date('2026-11-11T10:00:00Z')
  it('only when the copy still has the consent from before the withdrawal', () => {
    expect(needsHealthReplay({ consentAt: before, withdrawnAt: null }, at)).toBe(true)
    expect(needsHealthReplay({ consentAt: before, withdrawnAt: before }, at)).toBe(true)
    expect(needsHealthReplay({ consentAt: before, withdrawnAt: at }, at)).toBe(false)
    expect(needsHealthReplay({ consentAt: after, withdrawnAt: null }, at)).toBe(false)
    expect(needsHealthReplay(undefined, at)).toBe(false)
  })
})
