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
 *
 * PRO-1291: `/admin/usage` carries `mimoCache`, the cache tokens written and
 * read per turn by week (`buildMimoCacheWeekly`), so a turn that stops
 * reusing the fixed block shows up the same week (PRO-392 broke it on
 * 2026-11-11 and nobody saw it for 12 days).
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { madridMidnightUtc, madridParts, mondayOf } from './madridTime.js'

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
  /** Who wrote: «seguido» compares a turn with the previous one of the same person (PRO-1291). */
  userId?: string | null
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
    SELECT feature, user_id, units, cost_micros, created_at
    FROM cost_events
    WHERE feature IN ('assistant_chat', 'whatsapp_chat', 'telegram_chat')
      AND created_at >= ${since.toISOString()}::timestamptz
    ORDER BY created_at
  `)
  const rows: any[] = res.rows ?? res
  return rows.map((r) => ({
    feature: String(r.feature),
    userId: r.user_id ? String(r.user_id) : null,
    units: (r.units ?? null) as Record<string, number> | null,
    costMicros: r.cost_micros === null || r.cost_micros === undefined ? null : Number(r.cost_micros),
    createdAt: new Date(r.created_at),
  }))
}

/** A turn less than this after the previous one of the same person and channel is «seguido». */
export const FOLLOW_UP_MS = 5 * 60_000
/** The channels `/admin/usage` watches: the app's chat and WhatsApp. */
export const CACHE_WATCH_FEATURES = ['whatsapp_chat', 'assistant_chat'] as const

export interface MimoCacheWeek {
  /** Monday (Madrid) of the week. */
  week: string
  feature: (typeof CACHE_WATCH_FEATURES)[number]
  turns: number
  cacheWritePerTurn: number
  cacheReadPerTurn: number
  /** Turns less than 5 minutes after the previous one of the same person on the same channel. */
  followUpTurns: number
  /** Their mean cache write: under ~8 000 when the fixed block is reused (PRO-1291); null without any. */
  followUpCacheWritePerTurn: number | null
}

/** Pure: per Madrid week and channel, the cache tokens written and read per turn. */
export function buildMimoCacheWeekly(rows: readonly TurnRow[]): MimoCacheWeek[] {
  const watched = new Set<string>(CACHE_WATCH_FEATURES)
  const sorted = rows.filter((r) => watched.has(r.feature)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const last = new Map<string, number>()
  const acc = new Map<string, { week: string; feature: MimoCacheWeek['feature']; turns: number; write: number; read: number; follow: number; followWrite: number }>()
  for (const r of sorted) {
    const p = madridParts(r.createdAt)
    const week = mondayOf(p.isoDate, p.weekday)
    const key = `${week}|${r.feature}`
    const g = acc.get(key) ?? { week, feature: r.feature as MimoCacheWeek['feature'], turns: 0, write: 0, read: 0, follow: 0, followWrite: 0 }
    const write = num(r.units?.cacheWriteTokens)
    g.turns += 1
    g.write += write
    g.read += num(r.units?.cacheReadTokens)
    const who = r.userId ? `${r.userId}|${r.feature}` : null
    const prev = who ? last.get(who) : undefined
    if (prev !== undefined && r.createdAt.getTime() - prev < FOLLOW_UP_MS) {
      g.follow += 1
      g.followWrite += write
    }
    if (who) last.set(who, r.createdAt.getTime())
    acc.set(key, g)
  }
  return [...acc.values()]
    .map((g) => ({
      week: g.week,
      feature: g.feature,
      turns: g.turns,
      cacheWritePerTurn: Math.round(g.write / g.turns),
      cacheReadPerTurn: Math.round(g.read / g.turns),
      followUpTurns: g.follow,
      followUpCacheWritePerTurn: g.follow ? Math.round(g.followWrite / g.follow) : null,
    }))
    .sort((a, b) => (a.week === b.week ? a.feature.localeCompare(b.feature) : a.week.localeCompare(b.week)))
}

/**
 * `/admin/usage`'s `mimoCache`: the weeks the window touches, from their
 * Monday (whole weeks), every account (it is the API bill, not usage).
 */
export async function loadMimoCacheWeekly(days: number, now: Date = new Date(), db: Db = defaultDb): Promise<MimoCacheWeek[]> {
  const first = madridParts(new Date(now.getTime() - (Math.max(1, days) - 1) * 86_400_000))
  return buildMimoCacheWeekly(await loadMimoTurns(madridMidnightUtc(mondayOf(first.isoDate, first.weekday)), db))
}
