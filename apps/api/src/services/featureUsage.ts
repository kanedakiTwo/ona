/**
 * Uso de cada función por hogar (PRO-1023, specs/feature-usage.md).
 *
 * Cada noche, una pasada lee los eventos de uso (`usage_events`) de cada
 * función del catálogo (`FEATURE_CATALOG`, @ona/shared) y guarda en
 * `household_feature_usage`, por hogar (o persona) y función: primera vez,
 * última vez, usos en los últimos 30 días y en total. `usage_events` solo
 * guarda 180 días (USAGE_RETENTION_DAYS); esta tabla se queda, así que
 * `uses_total` sigue sumando.
 *
 * Cómo cuenta sin repetir: cada fila guarda `counted_until` (las 00:00 de
 * Madrid del día de la pasada). La siguiente solo suma los eventos desde ahí
 * hasta su propia medianoche. Una acción suma un uso por evento; un ajuste
 * suma una vez por semana (lunes a domingo, Madrid) en que actuó, y la semana
 * de su última vez no vuelve a contar. Los 30 días se recalculan enteros.
 *
 * Solo cifras y fechas, sin props ni texto. Se borra con el hogar y con la
 * cuenta (CASCADE). Partido como el resto: la cuenta es pura sobre un repo
 * pequeño (tests/featureUsage.test.ts); Postgres en `createDbFeatureUsageRepo`
 * (tests/featureUsage.smoke.ts).
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { FEATURE_CATALOG, type FeatureCatalogEntry } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { householdFeatureUsage } from '../db/schema.js'
import { addDays, madridMidnightUtc, madridParts, madridWeekStart } from './madridTime.js'

type Db = typeof defaultDb
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Ventana de `uses_30d`, en días de Madrid. */
export const FEATURE_USAGE_WINDOW_DAYS = 30

export interface FeatureUsageRow {
  householdId: string
  /** null = fila del hogar. */
  userId: string | null
  firstUsedAt: Date
  lastUsedAt: Date
  uses30d: number
  usesTotal: number
}

/** Eventos nuevos de una función para un hogar (o persona), ya agregados. */
export interface FeatureActivity {
  householdId: string
  userId: string | null
  firstAt: Date
  lastAt: Date
  count: number
  /** Lunes (AAAA-MM-DD, Madrid) de cada semana con algún evento, sin repetir. */
  weeks: string[]
}

export interface FeatureUsageRepo {
  /** Filas guardadas de la función y hasta cuándo están contadas (null = ninguna aún). */
  load(feature: FeatureCatalogEntry): Promise<{ rows: FeatureUsageRow[]; countedUntil: Date | null }>
  /** Eventos de la función en [since, until), por hogar (o persona). */
  activity(feature: FeatureCatalogEntry, since: Date | null, until: Date): Promise<FeatureActivity[]>
  /** Sustituye las filas de la función por estas, contadas hasta `countedUntil`. */
  save(feature: FeatureCatalogEntry, rows: FeatureUsageRow[], countedUntil: Date): Promise<void>
  /** Corre `fn` en exclusiva (una transacción); null si otra pasada ya está corriendo. */
  exclusive<T>(fn: (repo: FeatureUsageRepo) => Promise<T>): Promise<T | null>
}

const keyOf = (r: { householdId: string; userId: string | null }) => `${r.householdId}|${r.userId ?? ''}`

/** Puro: lo que suman los eventos nuevos. Un ajuste no vuelve a contar la semana de su última vez. */
export function newUses(kind: FeatureCatalogEntry['kind'], prev: FeatureUsageRow | undefined, act: FeatureActivity | undefined): number {
  if (!act) return 0
  if (kind === 'accion') return act.count
  const counted = prev ? madridWeekStart(prev.lastUsedAt) : null
  return new Set(act.weeks.filter((w) => w !== counted)).size
}

/** Puro: usos dentro de la ventana (un ajuste: semanas). */
export function windowUses(kind: FeatureCatalogEntry['kind'], act: FeatureActivity | undefined): number {
  if (!act) return 0
  return kind === 'accion' ? act.count : new Set(act.weeks).size
}

/**
 * Puro: la fila nueva de un hogar (o persona) a partir de la guardada, los
 * eventos nuevos y los de los últimos 30 días. null = nunca la ha usado.
 */
export function mergeFeatureUsage(
  kind: FeatureCatalogEntry['kind'],
  prev: FeatureUsageRow | undefined,
  fresh: FeatureActivity | undefined,
  recent: FeatureActivity | undefined,
): FeatureUsageRow | null {
  const base = prev ?? fresh
  if (!base) return null
  const firstUsedAt = prev ? (fresh && fresh.firstAt < prev.firstUsedAt ? fresh.firstAt : prev.firstUsedAt) : fresh!.firstAt
  const lastUsedAt = prev ? (fresh && fresh.lastAt > prev.lastUsedAt ? fresh.lastAt : prev.lastUsedAt) : fresh!.lastAt
  return {
    householdId: base.householdId,
    userId: base.userId,
    firstUsedAt,
    lastUsedAt,
    uses30d: windowUses(kind, recent),
    usesTotal: (prev?.usesTotal ?? 0) + newUses(kind, prev, fresh),
  }
}

/** Puro: hasta dónde cuenta la pasada de `now` (las 00:00 de hoy en Madrid) y desde dónde van los 30 días. */
export function featureUsageWindow(now: Date): { cutoff: Date; windowStart: Date } {
  const today = madridParts(now).isoDate
  return { cutoff: madridMidnightUtc(today), windowStart: madridMidnightUtc(addDays(today, -FEATURE_USAGE_WINDOW_DAYS)) }
}

export interface FeatureUsagePassResult {
  cutoff: Date
  /** Funciones recalculadas (las ya contadas hoy se saltan). */
  features: number
  rows: number
  newUses: number
}

/** La pasada: todas las funciones del catálogo, hasta las 00:00 de hoy en Madrid. null = otra pasada en curso. */
export async function runFeatureUsagePass(
  now: Date,
  repo: FeatureUsageRepo,
  catalog: readonly FeatureCatalogEntry[] = FEATURE_CATALOG,
): Promise<FeatureUsagePassResult | null> {
  const { cutoff, windowStart } = featureUsageWindow(now)
  return repo.exclusive(async (r) => {
    const result: FeatureUsagePassResult = { cutoff, features: 0, rows: 0, newUses: 0 }
    for (const feature of catalog) {
      const { rows, countedUntil } = await r.load(feature)
      if (countedUntil && countedUntil >= cutoff) continue
      const fresh = await r.activity(feature, countedUntil, cutoff)
      const recent = await r.activity(feature, windowStart, cutoff)
      const prevBy = new Map(rows.map((x) => [keyOf(x), x]))
      const freshBy = new Map(fresh.map((x) => [keyOf(x), x]))
      const recentBy = new Map(recent.map((x) => [keyOf(x), x]))
      const out: FeatureUsageRow[] = []
      for (const key of new Set([...prevBy.keys(), ...freshBy.keys()])) {
        const prev = prevBy.get(key)
        const row = mergeFeatureUsage(feature.kind, prev, freshBy.get(key), recentBy.get(key))
        if (!row) continue
        result.newUses += row.usesTotal - (prev?.usesTotal ?? 0)
        out.push(row)
      }
      await r.save(feature, out, cutoff)
      result.features++
      result.rows += out.length
    }
    return result
  })
}

// ─── Postgres ──────────────────────────────────────────────────────

/** SQL: el evento `e` cuenta para la función (alguna de sus reglas). */
function matchSql(feature: FeatureCatalogEntry): SQL {
  const rules = feature.events.map((rule) => {
    const parts: SQL[] = [sql`e.name = ${rule.name}`]
    if (rule.channel) parts.push(sql`e.channel = ${rule.channel}`)
    for (const [k, v] of Object.entries(rule.props ?? {})) {
      const values = (Array.isArray(v) ? v : [v]).map(String)
      parts.push(sql`(e.props ->> ${k}) IN (${sql.join(values.map((x) => sql`${x}`), sql`, `)})`)
    }
    return sql`(${sql.join(parts, sql` AND `)})`
  })
  return sql`(${sql.join(rules, sql` OR `)})`
}

const WEEK_SQL = sql`to_char(date_trunc('week', e.created_at AT TIME ZONE 'Europe/Madrid'), 'YYYY-MM-DD')`

/**
 * Repo de Postgres. `onlyHouseholds` lo limita a esos hogares (el smoke corre
 * el SQL de verdad sobre sus filas sin tocar las de nadie más).
 */
export function createDbFeatureUsageRepo(db: Db | Tx = defaultDb, onlyHouseholds?: string[]): FeatureUsageRepo {
  const rowScope = onlyHouseholds ? inArray(householdFeatureUsage.householdId, onlyHouseholds) : undefined
  const eventScope = onlyHouseholds
    ? sql`AND e.household_id IN (${sql.join(onlyHouseholds.map((h) => sql`${h}::uuid`), sql`, `)})`
    : sql``
  return {
    async load(feature) {
      const rows = await db
        .select()
        .from(householdFeatureUsage)
        .where(and(eq(householdFeatureUsage.feature, feature.id), rowScope))
      let countedUntil: Date | null = null
      for (const r of rows) if (!countedUntil || r.countedUntil > countedUntil) countedUntil = r.countedUntil
      return {
        rows: rows.map((r) => ({
          householdId: r.householdId,
          userId: r.userId,
          firstUsedAt: r.firstUsedAt,
          lastUsedAt: r.lastUsedAt,
          uses30d: r.uses30d,
          usesTotal: r.usesTotal,
        })),
        countedUntil,
      }
    },
    async activity(feature, since, until) {
      const persona = feature.per === 'persona'
      const res: any = await db.execute(sql`
        SELECT e.household_id AS "householdId",
               ${persona ? sql`e.user_id` : sql`NULL::uuid`} AS "userId",
               min(e.created_at) AS "firstAt",
               max(e.created_at) AS "lastAt",
               count(*)::int AS "count",
               array_agg(DISTINCT ${WEEK_SQL}) AS "weeks"
          FROM usage_events e
         WHERE ${matchSql(feature)}
           AND e.household_id IS NOT NULL
           ${persona ? sql`AND e.user_id IS NOT NULL` : sql``}
           AND e.created_at < ${until.toISOString()}::timestamptz
           ${since ? sql`AND e.created_at >= ${since.toISOString()}::timestamptz` : sql``}
           ${eventScope}
         GROUP BY 1, 2
      `)
      return (res.rows ?? []).map((r: any) => ({
        householdId: r.householdId,
        userId: r.userId ?? null,
        firstAt: new Date(r.firstAt),
        lastAt: new Date(r.lastAt),
        count: Number(r.count),
        weeks: r.weeks ?? [],
      }))
    },
    async save(feature, rows, countedUntil) {
      await db.delete(householdFeatureUsage).where(and(eq(householdFeatureUsage.feature, feature.id), rowScope))
      const now = new Date()
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(householdFeatureUsage).values(
          rows.slice(i, i + 500).map((r) => ({ ...r, feature: feature.id, countedUntil, updatedAt: now })),
        )
      }
    },
    async exclusive(fn) {
      return (db as Db).transaction(async (tx) => {
        const lock: any = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('household_feature_usage')) AS ok`)
        if (!lock.rows?.[0]?.ok) return null
        return fn(createDbFeatureUsageRepo(tx, onlyHouseholds))
      })
    },
  }
}

let lastRunDay: string | null = null

/** Desde la 01:00 de Madrid, lejos de la medianoche que cierra el día que se cuenta. */
export const FEATURE_USAGE_HOUR = 1

/** Lo llama el tick del planificador: una vez por día de Madrid y proceso, desde la 01:00. */
export async function runFeatureUsagePassIfDue(
  now: Date = new Date(),
  repo: FeatureUsageRepo = createDbFeatureUsageRepo(),
): Promise<FeatureUsagePassResult | null> {
  const p = madridParts(now)
  if (p.hour < FEATURE_USAGE_HOUR || lastRunDay === p.isoDate) return null
  lastRunDay = p.isoDate
  return runFeatureUsagePass(now, repo)
}

/** Solo tests: olvida la marca de una vez al día. */
export function resetFeatureUsageMemo(): void {
  lastRunDay = null
}
