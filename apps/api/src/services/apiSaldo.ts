/**
 * PRO-1101 (D-156): saber cuándo la API de Anthropic se queda sin saldo.
 *
 * Cuando una llamada a Anthropic devuelve el 400 «Your credit balance is too
 * low…», `noteApiBalanceError` lo apunta en el registro de errores
 * (`app_errors`, un solo grupo `server` cuyo mensaje empieza por
 * `saldo_api:`, así que el token de métricas lo ve con `type: 'saldo_api'`),
 * como mucho una vez por hora: en memoria y, para sobrevivir a un reinicio,
 * también en el UPDATE. En ese grupo, `first_seen` es el principio de la racha
 * sin saldo y `resolved_at` su final: lo cierra la primera respuesta buena de
 * Mimo (`noteApiCallOk`) o un admin con POST /admin/errors/:id/resolve.
 *
 * Lo detectan Mimo en la app y en WhatsApp (que contestan `API_SALDO_REPLY` en
 * vez del error genérico) y, para el resto de llamadas, el `console.error` /
 * `console.warn` del fallo (middleware/errorCapture.ts).
 *
 * `/admin/metrics` → `apiSaldo: { sinSaldoDesde, ultimoError }`: lo lee la
 * oficina para el aviso al móvil y el brief. Spec: specs/errors.md,
 * specs/metrics.md, specs/advisor.md.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { fingerprint, normalizeMessage, serverRelease } from './appErrors.js'

type Db = typeof defaultDb

/** Lo que contesta Mimo, en la app y en WhatsApp, mientras no hay saldo. */
export const API_SALDO_REPLY = 'Ahora mismo no puedo contestarte; lo estamos arreglando. Vuelve a escribirme en un rato.'

/** El `type` del grupo para el token de métricas (services/agentView.ts). */
export const API_SALDO_TYPE = 'saldo_api'
export const API_SALDO_MESSAGE = normalizeMessage(`${API_SALDO_TYPE}: la API de Anthropic no tiene saldo (credit balance is too low)`)
export const API_SALDO_PATH = 'anthropic'
export const API_SALDO_FINGERPRINT = fingerprint('server', API_SALDO_MESSAGE, API_SALDO_PATH)

const HOUR_MS = 60 * 60 * 1000
const BALANCE_TEXT = /credit balance is too low/i

/** El error (o el texto de log) es el de saldo insuficiente de Anthropic. */
export function isApiBalanceError(err: unknown): boolean {
  if (typeof err === 'string') return BALANCE_TEXT.test(err)
  if (!err || typeof err !== 'object') return false
  const e = err as { message?: unknown; error?: { error?: { message?: unknown } } }
  if (typeof e.message === 'string' && BALANCE_TEXT.test(e.message)) return true
  const inner = e.error?.error?.message
  return typeof inner === 'string' && BALANCE_TEXT.test(inner)
}

/**
 * Apunta el error en el grupo `saldo_api`. Escribe si no había grupo, si la
 * racha anterior estaba cerrada (abre otra: `first_seen` = ahora) o si la
 * última vez fue hace una hora o más. true si ha escrito.
 */
export async function recordApiBalanceError(now: Date = new Date(), db: Db = defaultDb): Promise<boolean> {
  const at = now.toISOString()
  const res = await db.execute(sql`
    INSERT INTO app_errors (fingerprint, kind, message, sample_path, release, count, first_seen, last_seen)
    VALUES (${API_SALDO_FINGERPRINT}, 'server', ${API_SALDO_MESSAGE}, ${API_SALDO_PATH}, ${serverRelease()}, 1, ${at}::timestamptz, ${at}::timestamptz)
    ON CONFLICT (fingerprint) DO UPDATE SET
      count = app_errors.count + 1,
      last_seen = EXCLUDED.last_seen,
      first_seen = CASE WHEN app_errors.resolved_at IS NOT NULL THEN EXCLUDED.first_seen ELSE app_errors.first_seen END,
      release = COALESCE(EXCLUDED.release, app_errors.release),
      resolved_at = NULL
    WHERE app_errors.resolved_at IS NOT NULL OR app_errors.last_seen <= EXCLUDED.last_seen - interval '1 hour'
    RETURNING id
  `)
  return res.rows.length > 0
}

/** Cierra la racha abierta (vuelve a haber saldo). true si había una. */
export async function closeApiBalanceStreak(now: Date = new Date(), db: Db = defaultDb): Promise<boolean> {
  const res = await db.execute(sql`
    UPDATE app_errors SET resolved_at = ${now.toISOString()}::timestamptz
     WHERE fingerprint = ${API_SALDO_FINGERPRINT} AND resolved_at IS NULL
    RETURNING id
  `)
  return res.rows.length > 0
}

export interface ApiSaldoWriter {
  record(now: Date): Promise<unknown>
  close(now: Date): Promise<unknown>
}

const dbWriter: ApiSaldoWriter = { record: (now) => recordApiBalanceError(now), close: (now) => closeApiBalanceStreak(now) }

let writer: ApiSaldoWriter = dbWriter
let lastNotedAt = Number.NEGATIVE_INFINITY
// Tras un arranque no se sabe si quedó una racha abierta: la primera respuesta
// buena lo mira (un UPDATE). En los tests unitarios, nunca contra la base.
let streakMaybeOpen = !process.env.VITEST

const warn = (err: any) => console.warn('[apiSaldo] write failed (ignored):', err?.message ?? err)

/**
 * Si `err` es el de saldo, lo apunta (como mucho una vez por hora, en segundo
 * plano; nunca falla) y devuelve true para que quien llama conteste
 * `API_SALDO_REPLY`. Si no lo es, false y nada más.
 */
export function noteApiBalanceError(err: unknown, now: number = Date.now()): boolean {
  if (!isApiBalanceError(err)) return false
  if (now - lastNotedAt < HOUR_MS) return true
  lastNotedAt = now
  streakMaybeOpen = true
  try {
    writer.record(new Date(now)).catch(warn)
  } catch (e) {
    warn(e)
  }
  return true
}

/** Una llamada a Anthropic ha ido bien: si había racha sin saldo, se cierra. */
export function noteApiCallOk(now: number = Date.now()): void {
  if (!streakMaybeOpen) return
  streakMaybeOpen = false
  lastNotedAt = Number.NEGATIVE_INFINITY
  try {
    writer.close(new Date(now)).catch(warn)
  } catch (e) {
    warn(e)
  }
}

/** Test seam: escrituras de mentira (`null` vuelve a la base) y estado en memoria limpio. */
export function setApiSaldoWriterForTests(fake: ApiSaldoWriter | null, opts: { streakMaybeOpen?: boolean } = {}): void {
  writer = fake ?? dbWriter
  lastNotedAt = Number.NEGATIVE_INFINITY
  streakMaybeOpen = opts.streakMaybeOpen ?? false
}

export interface ApiSaldoSummary {
  /** ISO: desde cuándo no hay saldo (racha abierta); null si hay saldo o nunca faltó. */
  sinSaldoDesde: string | null
  /** ISO: la última vez apuntada (con precisión de una hora); null si nunca. */
  ultimoError: string | null
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)

/** `apiSaldo` de `/admin/metrics`. */
export async function loadApiSaldo(db: Db = defaultDb): Promise<ApiSaldoSummary> {
  const res = await db.execute(sql`
    SELECT first_seen, last_seen, resolved_at FROM app_errors WHERE fingerprint = ${API_SALDO_FINGERPRINT}
  `)
  const r = (res.rows as any[])[0]
  if (!r) return { sinSaldoDesde: null, ultimoError: null }
  return { sinSaldoDesde: r.resolved_at ? null : iso(r.first_seen), ultimoError: iso(r.last_seen) }
}
