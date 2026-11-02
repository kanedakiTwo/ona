/**
 * PRO-1090 (D-148): saber cuándo un usuario llega al tope de gasto de Mimo.
 *
 * La primera vez de cada usuario y mes (Madrid) que salta uno de los dos
 * topes — el de Mimo (`asistente`, 429 ADVISOR_BUDGET_EXCEEDED,
 * services/advisorBudget.ts) o el de toda la IA (`ia`, 429
 * SPEND_CAP_EXCEEDED, services/spendCap.ts) — en la app o por WhatsApp, se
 * guarda una fila en `cap_hits`. Las siguientes de ese mes no escriben nada
 * (índice único usuario + mes). Los admins no cuentan: están exentos.
 *
 * `/admin/metrics` → `capHits` lo da agregado y sin nombres ni textos (D-094):
 * del hogar, solo los 8 primeros caracteres del id. Lo lee la oficina para el
 * brief y el aviso al móvil. Spec: specs/advisor.md, specs/metrics.md.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { LIVE_STATUSES } from './billing.js'
import { madridParts } from './madridTime.js'

type Db = typeof defaultDb

export type CapKind = 'asistente' | 'ia'
export type CapChannel = 'app' | 'whatsapp'

export interface CapHitInput {
  userId: string
  cap: CapKind
  spentEur: number
  capEur: number
  channel: CapChannel
  now?: Date
}

/** AAAA-MM del mes en Madrid. */
export function madridMonthKey(now: Date): string {
  return madridParts(now).isoDate.slice(0, 7)
}

const micros = (eur: number) => Math.round(eur * 1_000_000)

/**
 * Anota el tope si es la primera vez de este usuario en el mes. true si ha
 * escrito la fila. Nunca falla el camino del usuario: un error se registra y
 * devuelve false (el 429 sale igual).
 */
export async function recordCapHit(hit: CapHitInput, db: Db = defaultDb): Promise<boolean> {
  const now = hit.now ?? new Date()
  try {
    const res = await db.execute(sql`
      INSERT INTO cap_hits (user_id, household_id, month, cap, spent_micros, cap_micros, channel, created_at)
      SELECT u.id, u.primary_household_id, ${madridMonthKey(now)}, ${hit.cap},
             ${micros(hit.spentEur)}, ${micros(hit.capEur)}, ${hit.channel}, ${now.toISOString()}::timestamptz
        FROM users u
       WHERE u.id = ${hit.userId}::uuid AND u.role <> 'admin'
      ON CONFLICT (user_id, month) DO NOTHING
      RETURNING id
    `)
    return res.rows.length > 0
  } catch (err) {
    console.warn('[capHits] record failed (continuing):', (err as Error)?.message ?? err)
    return false
  }
}

export interface CapHitRow {
  householdId: string | null
  plan: string | null
  cap: CapKind
  channel: CapChannel
  spentMicros: number
  capMicros: number
  createdAt: Date
  month: string
}

export interface CapHitsSummary {
  mes: string
  total: number
  porTope: Record<CapKind, number>
  porCanal: Record<CapChannel, number>
  ultimos7d: number
  lista: Array<{
    hogar: string
    plan: string
    tope: CapKind
    gastadoEur: number
    topeEur: number
    canal: CapChannel
    en: string
  }>
}

const eur2 = (m: number) => Math.round(m / 10_000) / 100
const DAY_MS = 24 * 60 * 60 * 1000

/** Pure: las filas del mes (y de los últimos 7 días) → la forma de `capHits`. */
export function buildCapHits(rows: CapHitRow[], now: Date): CapHitsSummary {
  const mes = madridMonthKey(now)
  const ofMonth = rows.filter((r) => r.month === mes).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  const since = now.getTime() - 7 * DAY_MS
  const out: CapHitsSummary = {
    mes,
    total: ofMonth.length,
    porTope: { asistente: 0, ia: 0 },
    porCanal: { app: 0, whatsapp: 0 },
    ultimos7d: rows.filter((r) => r.createdAt.getTime() >= since && r.createdAt.getTime() <= now.getTime()).length,
    lista: [],
  }
  for (const r of ofMonth) {
    out.porTope[r.cap] += 1
    out.porCanal[r.channel] += 1
    out.lista.push({
      hogar: (r.householdId ?? '').slice(0, 8),
      plan: r.plan ?? 'ninguno',
      tope: r.cap,
      gastadoEur: eur2(r.spentMicros),
      topeEur: eur2(r.capMicros),
      canal: r.channel,
      en: r.createdAt.toISOString(),
    })
  }
  return out
}

/** `capHits` de `/admin/metrics`: el mes de Madrid en curso y los últimos 7 días. */
export async function loadCapHits(now: Date = new Date(), db: Db = defaultDb): Promise<CapHitsSummary> {
  const live = sql.join(LIVE_STATUSES.map((s) => sql`${s}`), sql`, `)
  const res = await db.execute(sql`
    SELECT ch.household_id::text AS household_id, ch.month, ch.cap, ch.channel,
           ch.spent_micros, ch.cap_micros, ch.created_at,
           (SELECT s.plan FROM subscriptions s
             WHERE s.household_id = ch.household_id AND s.status IN (${live})
             ORDER BY s.created_at DESC LIMIT 1) AS plan
      FROM cap_hits ch
     WHERE ch.month = ${madridMonthKey(now)}
        OR ch.created_at >= ${new Date(now.getTime() - 7 * DAY_MS).toISOString()}::timestamptz
  `)
  const rows: CapHitRow[] = (res.rows as any[]).map((r) => ({
    householdId: r.household_id ?? null,
    plan: r.plan ?? null,
    cap: r.cap,
    channel: r.channel,
    spentMicros: Number(r.spent_micros),
    capMicros: Number(r.cap_micros),
    createdAt: new Date(r.created_at),
    month: r.month,
  }))
  return buildCapHits(rows, now)
}
