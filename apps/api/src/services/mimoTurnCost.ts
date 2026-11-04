/**
 * What one Mimo reply costs, by kind of turn (PRO-393, E-45/E-46). Every
 * turn is one `cost_events` row (`assistant_chat`, `whatsapp_chat`,
 * `telegram_chat`) with its tokens summed over the turn's model calls; since
 * PRO-393 it also carries `rounds` (model calls) and `toolCalls`.
 *
 * Two ways to slice it:
 *   - `kind`, by tool rounds: only rows from PRO-393 on have it (older ones
 *     are `sin_dato`);
 *   - `cache`, whether the turn wrote the fixed block (tools + instructions,
 *     ~38 000 tokens) to the cache or read it: works on every row, so it
 *     gives the «before» too.
 *
 * Read it with `pnpm --filter @ona/api exec tsx scripts/mimoTurnCost.ts`.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { madridParts, mondayOf } from './madridTime.js'

type Db = typeof defaultDb

/**
 * A turn that wrote at least this many tokens to the cache wrote the fixed
 * block (it alone is ~38 000 on 2026-11-05; a household's context plus a long
 * history stay well under).
 */
export const FIXED_BLOCK_WRITE_MIN = 20_000

export type TurnKind = 'sin_herramientas' | 'una_ronda' | 'varias_rondas' | 'sin_dato'
export type CacheState = 'escribe_bloque_fijo' | 'lee_bloque_fijo'

export const TURN_KIND_LABELS: Record<TurnKind, string> = {
  sin_herramientas: 'contesta sin herramientas (1 llamada)',
  una_ronda: 'una ronda de herramientas (2 llamadas)',
  varias_rondas: 'dos rondas o más (3+ llamadas)',
  sin_dato: 'sin dato de rondas (antes de PRO-393)',
}

export interface TurnRow {
  feature: string
  units: Record<string, number> | null
  costMicros: number | null
  createdAt: Date
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)

export function turnKind(units: Record<string, number> | null): TurnKind {
  const rounds = units?.rounds
  if (typeof rounds !== 'number' || rounds < 1) return 'sin_dato'
  if (rounds === 1 || num(units?.toolCalls) === 0) return 'sin_herramientas'
  return rounds === 2 ? 'una_ronda' : 'varias_rondas'
}

export function cacheState(units: Record<string, number> | null): CacheState {
  return num(units?.cacheWriteTokens) >= FIXED_BLOCK_WRITE_MIN ? 'escribe_bloque_fijo' : 'lee_bloque_fijo'
}

export interface TurnCostGroup {
  week: string
  feature: string
  /** `kind:<TurnKind>`, `cache:<CacheState>` or `total`. */
  group: string
  turns: number
  avgCostEur: number
  avgInputTokens: number
  avgCacheReadTokens: number
  avgCacheWriteTokens: number
  avgCacheWrite1hTokens: number
  avgOutputTokens: number
  /** Null when no row of the group carries `rounds`. */
  avgRounds: number | null
}

/** Pure: per Madrid week (Monday), feature and group, the average turn. */
export function summarizeTurnCosts(rows: readonly TurnRow[]): TurnCostGroup[] {
  const acc = new Map<string, { week: string; feature: string; group: string; rows: TurnRow[] }>()
  for (const r of rows) {
    const p = madridParts(r.createdAt)
    const week = mondayOf(p.isoDate, p.weekday)
    for (const group of ['total', `kind:${turnKind(r.units)}`, `cache:${cacheState(r.units)}`]) {
      const key = `${week}|${r.feature}|${group}`
      const g = acc.get(key) ?? { week, feature: r.feature, group, rows: [] }
      g.rows.push(r)
      acc.set(key, g)
    }
  }
  const avg = (rs: TurnRow[], f: (r: TurnRow) => number) => rs.reduce((s, r) => s + f(r), 0) / rs.length
  const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d
  return [...acc.values()]
    .map(({ week, feature, group, rows: rs }) => {
      const withRounds = rs.filter((r) => typeof r.units?.rounds === 'number')
      return {
        week,
        feature,
        group,
        turns: rs.length,
        avgCostEur: round(avg(rs, (r) => num(r.costMicros)) / 1_000_000, 4),
        avgInputTokens: Math.round(avg(rs, (r) => num(r.units?.inputTokens))),
        avgCacheReadTokens: Math.round(avg(rs, (r) => num(r.units?.cacheReadTokens))),
        avgCacheWriteTokens: Math.round(avg(rs, (r) => num(r.units?.cacheWriteTokens))),
        avgCacheWrite1hTokens: Math.round(avg(rs, (r) => num(r.units?.cacheWrite1hTokens))),
        avgOutputTokens: Math.round(avg(rs, (r) => num(r.units?.outputTokens))),
        avgRounds: withRounds.length ? round(avg(withRounds, (r) => num(r.units?.rounds)), 2) : null,
      }
    })
    .sort((a, b) => (a.week === b.week ? (a.feature === b.feature ? a.group.localeCompare(b.group) : a.feature.localeCompare(b.feature)) : a.week.localeCompare(b.week)))
}

/** Mimo's turns since `since` (internal accounts included: staging's test households are what's measured). */
export async function loadMimoTurns(since: Date, db: Db = defaultDb): Promise<TurnRow[]> {
  const res: any = await db.execute(sql`
    SELECT feature, units, cost_micros, created_at
    FROM cost_events
    WHERE feature IN ('assistant_chat', 'whatsapp_chat', 'telegram_chat')
      AND created_at >= ${since.toISOString()}::timestamptz
    ORDER BY created_at
  `)
  const rows: any[] = res.rows ?? res
  return rows.map((r) => ({
    feature: String(r.feature),
    units: (r.units ?? null) as Record<string, number> | null,
    costMicros: r.cost_micros === null || r.cost_micros === undefined ? null : Number(r.cost_micros),
    createdAt: new Date(r.created_at),
  }))
}
