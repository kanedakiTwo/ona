import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './connection.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  console.log('Running migrations...')
  await migrate(db, { migrationsFolder: path.join(__dirname, 'migrations') })
  console.log('Migrations complete.')
  await pool.end()
}

main().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
