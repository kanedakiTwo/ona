/**
 * PRO-396 · Sonda diaria del menú: entra con una cuenta de prueba en un
 * Mimoia desplegado (staging o producción), genera el menú de la semana que
 * viene y mide cuánto tarda. ROJO si falla o pasa del tope (30 s).
 *
 * Lo corre `scripts/menuProbe.ts` desde GitHub Actions (una vez al día y tras
 * cada publicación). El resultado es un JSON sin datos personales (entorno,
 * segundos, ok, fecha y, si falla, el motivo) que la oficina lee del
 * artefacto. Ver specs/menu-probe.md.
 *
 * Nada de aquí lee la base de datos: solo habla HTTP con la API.
 */
import { madridWeekStart } from './madridTime.js'

/** Más de esto, ROJO (auditoría del 18-nov: el menú tardó 7 min 8 días). */
export const PROBE_MAX_SECONDS = 30
/** La petición se corta aquí: lo bastante por encima del tope para medirlo. */
export const PROBE_REQUEST_TIMEOUT_MS = 180_000

export type ProbeEnv = 'staging' | 'production'

export interface ProbeResult {
  entorno: ProbeEnv
  /** Segundos de POST /menu/generate (null si no se llegó a pedir). */
  segundos: number | null
  ok: boolean
  /** ISO del momento de la sonda. */
  fecha: string
  /** Lunes (AAAA-MM-DD) de la semana generada. */
  semana: string
  topeSegundos: number
  /** Por qué es ROJO; null en verde. Nunca lleva datos de la cuenta. */
  motivo: string | null
}

export interface ProbeConfig {
  env: ProbeEnv
  apiUrl: string
  /** Cuenta propia de la sonda (usuario o correo + contraseña). */
  username?: string
  password?: string
  /**
   * Solo staging: sin cuenta, se da de alta una de usar y tirar
   * (`sonda…@example.com`) con esta invitación, como el smoke profundo.
   */
  inviteCode?: string
  maxSeconds?: number
  now?: Date
  fetchImpl?: typeof fetch
}

/** Lo que decide verde o ROJO, sin red: así se prueba. */
export function verdict(input: { status: number | null; seconds: number | null; days: number; maxSeconds: number }): string | null {
  if (input.status === null) return 'la API no contestó a tiempo'
  if (input.status !== 200 && input.status !== 201) return `POST /menu/generate respondió ${input.status}`
  if (input.days === 0) return 'el menú vino vacío'
  if (input.seconds !== null && input.seconds > input.maxSeconds) return `tardó ${input.seconds} s (tope ${input.maxSeconds} s)`
  return null
}

/** El lunes de la semana que viene en Madrid: la que planifica la gente. */
export function nextWeekStart(now: Date = new Date()): string {
  return madridWeekStart(now, 1)
}

/** Nunca escribir datos de usar y tirar en producción. */
export function isProductionUrl(url: string): boolean {
  return /production|mimoia\.com/i.test(url)
}

/** Una línea para el registro del workflow y para el aviso de la oficina. */
export function describe(r: ProbeResult): string {
  const s = r.segundos === null ? '—' : `${r.segundos} s`
  if (r.ok) return `VERDE ${r.entorno}: menú de ${r.semana} en ${s} (tope ${r.topeSegundos} s)`
  return r.motivo?.startsWith('tardó') ? `ROJO ${r.entorno}: ${r.motivo}` : `ROJO ${r.entorno}: ${r.motivo} (${s})`
}

const round1 = (n: number) => Math.round(n * 10) / 10

async function call(f: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<{ status: number; body: any } | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await f(url, { ...init, signal: ctrl.signal })
    const text = await res.text()
    let body: any = null
    try { body = JSON.parse(text) } catch { /* no JSON: el cuerpo no se guarda */ }
    return { status: res.status, body }
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const json = (body: unknown, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
})

/** Entra (o da de alta en staging), genera el menú y mide. Nunca lanza. */
export async function runMenuProbe(cfg: ProbeConfig): Promise<ProbeResult> {
  const now = cfg.now ?? new Date()
  const f = cfg.fetchImpl ?? fetch
  const api = cfg.apiUrl.replace(/\/+$/, '')
  const maxSeconds = cfg.maxSeconds ?? PROBE_MAX_SECONDS
  const base: ProbeResult = { entorno: cfg.env, segundos: null, ok: false, fecha: now.toISOString(), semana: nextWeekStart(now), topeSegundos: maxSeconds, motivo: null }
  const red = (motivo: string, segundos: number | null = null): ProbeResult => ({ ...base, segundos, motivo })

  let session: { status: number; body: any } | null
  if (cfg.username && cfg.password) {
    session = await call(f, `${api}/login`, json({ username: cfg.username, password: cfg.password }), 30_000)
    if (!session) return red('el login no contestó')
    if (session.status !== 200) return red(`el login respondió ${session.status}`)
  } else {
    if (cfg.env === 'production' || isProductionUrl(api)) return red('faltan las credenciales de la cuenta de la sonda')
    if (!cfg.inviteCode) return red('sin cuenta ni invitación para dar de alta una de prueba')
    const stamp = `${now.getTime()}${Math.floor(Math.random() * 1e4)}`
    session = await call(f, `${api}/register`, json({
      username: `sonda${stamp}`,
      email: `sonda${stamp}@example.com`,
      password: `sonda-${stamp}`,
      ageConfirmed: true,
      inviteCode: cfg.inviteCode,
    }), 30_000)
    if (!session) return red('el alta no contestó')
    if (session.status !== 200 && session.status !== 201) return red(`el alta respondió ${session.status}`)
  }
  const token: string | undefined = session.body?.token
  const userId: string | undefined = session.body?.user?.id
  if (!token || !userId) return red('la sesión no trajo token')

  const t0 = performance.now()
  const gen = await call(f, `${api}/menu/generate`, json({ userId, weekStart: base.semana }, token), PROBE_REQUEST_TIMEOUT_MS)
  const seconds = round1((performance.now() - t0) / 1000)
  const days = Array.isArray(gen?.body?.days) ? gen!.body.days.length : 0
  const motivo = verdict({ status: gen?.status ?? null, seconds: gen ? seconds : null, days, maxSeconds })
  return { ...base, segundos: seconds, ok: motivo === null, motivo }
}
