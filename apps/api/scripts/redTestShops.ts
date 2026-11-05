/**
 * Red de tiendas: create (or move) the three test shops in a postal code.
 * Tramos 1a/1b only: the guided sign-up arrives in tramo 2. Made-up names and
 * 600 000 0NN numbers (PRO-76).
 *
 *   DATABASE_URL=… pnpm --filter @ona/api exec tsx scripts/redTestShops.ts --cp 28001 [--reparte 28002,28003] [--yes]
 *
 * A database that isn't local (staging) needs --yes.
 */
import { isPostalCode } from '@ona/shared'
import { pool } from '../src/db/connection.js'
import { seedRedTestShops } from '../src/services/red/testShops.js'

const args = process.argv.slice(2)
const arg = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const cp = arg('--cp') ?? ''
const reparte = (arg('--reparte') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const url = process.env.DATABASE_URL ?? ''

if (!isPostalCode(cp) || !reparte.every(isPostalCode)) {
  console.error('Uso: redTestShops.ts --cp 28001 [--reparte 28002,28003] [--yes]')
  process.exit(2)
}
if (!/localhost|127\.0\.0\.1|host=\/tmp/.test(url) && !args.includes('--yes')) {
  console.error('La base no es local. Si de verdad es staging, añade --yes. En producción, nunca.')
  process.exit(2)
}

const shops = await seedRedTestShops({ postalCode: cp, deliversTo: reparte })
for (const s of shops) console.log(`${s.kind}\t${s.name}\t${s.id}`)
await pool.end()
