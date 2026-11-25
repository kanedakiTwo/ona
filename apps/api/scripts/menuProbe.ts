/**
 * PRO-396 · Sonda del menú contra un Mimoia desplegado (specs/menu-probe.md).
 *
 *   PROBE_ENV=staging API_URL=https://ona-api-staging.up.railway.app \
 *   SMOKE_INVITE_CODE=… pnpm --filter @ona/api exec tsx scripts/menuProbe.ts [--out=menu-probe.json] [--max-seconds=30]
 *
 * Cuenta: PROBE_USERNAME + PROBE_PASSWORD (la de producción, en el entorno
 * `menu-probe-production` de GitHub, nunca en el repo). Sin ellas y solo en
 * staging, da de alta una de usar y tirar con SMOKE_INVITE_CODE (por defecto
 * la campaña «smoke (prueba profunda)» de staging, como scripts/smoke-remote.sh).
 *
 * Escribe el JSON (sin datos personales) en --out y en stdout; sale con 1 en
 * ROJO (falla o pasa del tope). No necesita base de datos ni claves.
 */
import fs from 'node:fs'
import { describe, PROBE_MAX_SECONDS, runMenuProbe, type ProbeEnv } from '../src/services/menuProbe.js'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const env = process.env.PROBE_ENV as ProbeEnv | undefined
if (env !== 'staging' && env !== 'production') throw new Error('PROBE_ENV must be staging or production')
const apiUrl = process.env.API_URL
if (!apiUrl) throw new Error('API_URL is required')
const maxSeconds = Number(arg('max-seconds') ?? process.env.PROBE_MAX_SECONDS ?? PROBE_MAX_SECONDS)
if (!(maxSeconds > 0)) throw new Error('--max-seconds must be a positive number')

const result = await runMenuProbe({
  env,
  apiUrl,
  username: process.env.PROBE_USERNAME || undefined,
  password: process.env.PROBE_PASSWORD || undefined,
  inviteCode: env === 'staging' ? process.env.SMOKE_INVITE_CODE || '9n8j31yf' : undefined,
  maxSeconds,
})

const out = arg('out')
if (out) fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result))
console.log(describe(result))
process.exit(result.ok ? 0 : 1)
