/**
 * PRO-07 «Primeros pasos» on /menu: who sees the guide.
 *
 * The rule lives in three places that must agree:
 *   - the column defaults to false (every account that existed before the
 *     migration, and any row inserted without saying otherwise, is "seen");
 *   - only POST /register writes true (a brand-new account);
 *   - POST /user/:id/first-steps writes false (finished or skipped).
 * The browser flow (sees it, skips it, reload, gone) is in
 * apps/web/e2e/first-steps.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { users } from '../db/schema.js'

const SRC = join(__dirname, '..')

describe('users.first_steps_pending', () => {
  it('is NOT NULL with default false, so existing accounts never see the guide', () => {
    const col = getTableConfig(users).columns.find((c) => c.name === 'first_steps_pending')
    expect(col).toBeDefined()
    expect(col!.notNull).toBe(true)
    expect(col!.default).toBe(false)
  })

  it('arrives with an additive migration (no backfill, no data touched)', () => {
    const sql = readFileSync(join(SRC, 'db/migrations/0044_first_steps_pending.sql'), 'utf8').trim()
    expect(sql).toBe('ALTER TABLE "users" ADD COLUMN "first_steps_pending" boolean DEFAULT false NOT NULL;')
  })

  it('only the sign-up sets it to true; the guide endpoint sets it back to false', () => {
    const auth = readFileSync(join(SRC, 'routes/auth.ts'), 'utf8')
    const register = auth.slice(auth.indexOf("router.post('/register'"), auth.indexOf("router.post('/login'"))
    expect(register).toMatch(/firstStepsPending: true/)

    const usersRoutes = readFileSync(join(SRC, 'routes/users.ts'), 'utf8')
    const done = usersRoutes.slice(usersRoutes.indexOf("router.post('/user/:id/first-steps'"))
    expect(done).toMatch(/set\(\{ firstStepsPending: false \}\)/)
    expect(done).toMatch(/req\.userId !== req\.params\.id/)

    // No other code path turns it on.
    const occurrences = [auth, usersRoutes].join('\n').match(/firstStepsPending: true/g) ?? []
    expect(occurrences).toHaveLength(1)
  })
})
