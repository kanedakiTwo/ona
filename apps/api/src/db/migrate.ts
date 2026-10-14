import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './connection.js'
import { applyCatalogSourceLinks } from '../services/catalogSourceLinks.js'
import { applyCatalogRecipeFixes } from '../services/catalogRecipeFixes.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') })
  console.log('Migrations complete.')
  // Idempotent data backfill (PRO-57): catalogue recipes get their Notion
  // source link. Runs on every boot; a failure is logged, never blocks it.
  try {
    await applyCatalogSourceLinks(db)
  } catch (err) {
    console.error('[catalog-source-links] failed:', err)
  }
  // Idempotent data fix (PRO-78): «Arroz al caldero» gets its real
  // ingredients while it still only has «Arroz, Ajo».
  try {
    await applyCatalogRecipeFixes(db)
  } catch (err) {
    console.error('[catalog-recipe-fixes] failed:', err)
  }
  await pool.end()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
