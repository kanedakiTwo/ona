/**
 * PRO-390 (D-167.3): da de alta en staging los gemelos de los hogares reales
 * como hogares de prueba `@example.com`, para la prueba a ciegas del menú
 * inteligente. Lee lo que devuelve `GET /admin/menu-planner/gemelos` de
 * producción (sin IA, sin datos de nadie) y, por cada gemelo, se registra,
 * contesta el alta y guarda su presupuesto y sus cocinas, por la API de
 * staging, como una persona.
 *
 *   pnpm --filter @ona/api exec tsx scripts/seedPlannerTwins.ts \
 *     --twins=gemelos.json --out=/fuera/del/repo/cuentas-gemelos.json \
 *     [--api=https://ona-api-staging.up.railway.app] [--invite=<código de campaña>] [--from=1]
 *
 * - Solo staging (o localhost): con otra API se niega.
 * - Cuentas `gemelo.NN@example.com`; una que ya existe se salta (409) y se
 *   dice. Contraseñas al azar, solo en `--out` (fuera del repo; la oficina
 *   las guarda con las de los hogares de prueba, `$HOGARES_CUENTAS`).
 * - El tope de registros por IP (429) se espera lo que diga `Retry-After`.
 * - `--out` lleva, por gemelo, su ficha para «Hogares»: el perfil y los
 *   tipos de plato que suele cambiar.
 */
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { twinSignup, type Twin } from '../src/services/menuTwins.js'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const API = (arg('api') ?? 'https://ona-api-staging.up.railway.app').replace(/\/+$/, '')
const TWINS = arg('twins')
const OUT = arg('out')
const INVITE = arg('invite')
const FROM = Number(arg('from') ?? 1)

function allowedApi(url: string): boolean {
  const host = new URL(url).hostname
  return host === 'localhost' || host === '127.0.0.1' || /staging/.test(host)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function call(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> {
  for (;;) {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    if (r.status === 429) {
      const wait = Number(r.headers.get('retry-after') ?? 600)
      console.log(`  tope de la API: espero ${wait} s`)
      await sleep((wait + 5) * 1000)
      continue
    }
    let parsed: any = null
    try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
    return { status: r.status, body: parsed }
  }
}

async function main() {
  if (!TWINS || !OUT) throw new Error('Faltan --twins=<fichero> y --out=<fichero fuera del repo>')
  if (!allowedApi(API)) throw new Error(`Solo staging o localhost: ${API} no lo es`)
  const raw = JSON.parse(await readFile(TWINS, 'utf8'))
  const twins: Twin[] = Array.isArray(raw) ? raw : raw.twins
  if (!Array.isArray(twins) || !twins.length) throw new Error('El fichero no trae gemelos')

  // A second run adds to the accounts of the first.
  const accounts: Record<string, unknown> = await readFile(OUT, 'utf8').then((t) => JSON.parse(t), () => ({}))
  for (let i = FROM - 1; i < twins.length; i++) {
    const t = twins[i]
    const nn = String(i + 1).padStart(2, '0')
    const key = `gemelo-${nn}`
    const username = `gemelo_${nn}`
    const email = `gemelo.${nn}@example.com`
    const password = randomBytes(12).toString('base64url')
    const reg = await call('POST', '/register', { username, email, password, ageConfirmed: true, ...(INVITE ? { inviteCode: INVITE } : {}) })
    if (reg.status === 409) {
      console.log(`${key}: ya existe, lo salto`)
      continue
    }
    if (reg.status !== 201) throw new Error(`${key}: el registro dio ${reg.status} ${JSON.stringify(reg.body)}`)
    const { token, user } = reg.body
    const { onboarding, facts } = twinSignup(t)
    const ob = await call('POST', `/user/${user.id}/onboarding`, onboarding, token)
    if (ob.status !== 200) throw new Error(`${key}: el alta dio ${ob.status} ${JSON.stringify(ob.body)}`)
    if (facts.length) {
      const mem = await call('PATCH', '/memory', { facts }, token)
      if (mem.status !== 200) throw new Error(`${key}: la memoria dio ${mem.status} ${JSON.stringify(mem.body)}`)
    }
    accounts[key] = { nombre: `Gemelo ${nn}`, username, email, password, perfil: t }
    // Written after each one, so a cut leaves the accounts made so far.
    await writeFile(OUT, JSON.stringify(accounts, null, 2) + '\n', { mode: 0o600 })
    console.log(`${key}: dado de alta`)
  }
  console.log(`${Object.keys(accounts).length} gemelos en ${OUT} (${API})`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
