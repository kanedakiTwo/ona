#!/usr/bin/env tsx
/**
 * After restoring a backup, before the service opens (PRO-1122): erase again
 * the accounts, household persons and health data erased since the copy
 * (`services/restoreErasures.ts`). Safe to run twice.
 *
 *   DATABASE_URL=<restored db> [ERASURES_FROM_URL=<db being replaced, or the newest copy>] \
 *     pnpm --filter @ona/api db:apply-erasures
 *
 * ERASURES_FROM_URL goes in the environment, never on the command line. Exits
 * 1 on any failure: then the service must not open.
 */
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { pool } from '../src/db/connection.js'
import { loadErasures, type Erasure } from '../src/services/erasureLog.js'
import { applyErasures } from '../src/services/restoreErasures.js'

async function main() {
  let from: Erasure[] = []
  const fromUrl = process.env.ERASURES_FROM_URL
  if (fromUrl) {
    const other = new pg.Pool({ connectionString: fromUrl })
    try {
      from = await loadErasures(drizzle(other))
    } finally {
      await other.end()
    }
  }
  const out = await applyErasures({ from })
  console.log(
    `[erasures] ${from.length} from the other log; erased again: ${out.accounts} accounts, ${out.persons} persons, ${out.healthConsents} health consents`,
  )
}

main()
  .catch((err) => {
    console.error('[erasures] failed:', err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
