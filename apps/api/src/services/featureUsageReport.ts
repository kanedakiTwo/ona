/**
 * GET /admin/feature-usage (PRO-1025, specs/feature-usage.md «Uso de
 * funciones»): una fila por función del catálogo (`FEATURE_CATALOG`) desde
 * `household_feature_usage`, solo agregados. Ni ids ni textos salen de aquí,
 * y un grupo de 1 a 4 hogares (o personas) sale «menos de 5», con sus usos.
 *
 * El SQL agrega por función; `buildFeatureUsageReport` (puro, con tests)
 * hace las filas, el bloque «Trucos de la newsletter» y el recorte.
 */
import { sql } from 'drizzle-orm'
import { FEATURE_CATALOG, type FeatureKind, type FeatureScope } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { addDays, madridMidnightUtc, madridParts } from './madridTime.js'

type Db = typeof defaultDb

/** Por debajo de esto (y por encima de 0), la celda no lleva la cifra. */
export const SMALL_GROUP_MIN = 5
export const SMALL_GROUP_LABEL = 'menos de 5'

export type Cell = number | typeof SMALL_GROUP_LABEL

/** Una cifra de hogares o personas: de 1 a 4, «menos de 5». */
export function smallCell(n: number): Cell {
  return n > 0 && n < SMALL_GROUP_MIN ? SMALL_GROUP_LABEL : n
}

/** Lo que devuelve el SQL por función: ya agregado. */
export interface FeatureAggRow {
  feature: string
  /** Hogares (función del hogar) o personas (de persona) con fila. */
  units: number
  /** Hogares distintos con fila (en las de persona, hogares con alguien que la usa). */
  households: number
  /** De `units`, los que la usaron en la ventana (`last_used_at`). */
  active: number
  uses30d: number
  usesTotal: number
  /** Mediana de días desde la última vez, sobre `units`. */
  medianDaysSinceLast: number | null
}

export interface FeatureUsageBase {
  /** Hogares con algún miembro contado. */
  households: number
  /** Personas contadas que están en un hogar. */
  people: number
}

export interface FeatureUsageRow {
  id: string
  nombre: string
  kind: FeatureKind
  per: FeatureScope
  /** Unidad de `users`, `active`, `lapsed` y `never`: hogares o personas, según `per`. */
  unit: 'hogares' | 'personas'
  /** La han usado alguna vez. */
  users: Cell
  /** La han usado en los últimos `days` días. */
  active: Cell
  /** La usaron, pero no en la ventana. */
  lapsed: Cell
  /** Nunca la han usado (de la base). */
  never: Cell
  /** Hogares distintos que la usan (en las de persona, con alguien que la usa). */
  households: Cell
  uses30d: Cell
  usesTotal: Cell
  medianDaysSinceLast: number | null | typeof SMALL_GROUP_LABEL
  /** % de la base que la ha usado; null si el grupo es pequeño o no hay base. */
  share: number | null
}

export interface FeatureTrick {
  id: string
  nombre: string
  per: FeatureScope
  unit: 'hogares' | 'personas'
  /** A quién se le puede proponer: no la han usado nunca. */
  never: Cell
  /** La dejaron: la usaron, pero no en la ventana. */
  lapsed: Cell
}

/**
 * Puro: las filas por función (en el orden del catálogo) y los trucos, de más
 * a menos gente a quien proponérselos. Una función sin filas sale con ceros.
 */
export function buildFeatureUsageReport(base: FeatureUsageBase, rows: readonly FeatureAggRow[]) {
  const byFeature = new Map(rows.map((r) => [r.feature, r]))
  const raw = FEATURE_CATALOG.map((f) => {
    const r = byFeature.get(f.id)
    const baseUnits = f.per === 'hogar' ? base.households : base.people
    const units = r?.units ?? 0
    const active = r?.active ?? 0
    return {
      f,
      baseUnits,
      units,
      active,
      lapsed: Math.max(units - active, 0),
      never: Math.max(baseUnits - units, 0),
      households: r?.households ?? 0,
      uses30d: r?.uses30d ?? 0,
      usesTotal: r?.usesTotal ?? 0,
      median: r?.medianDaysSinceLast ?? null,
    }
  })
  const features: FeatureUsageRow[] = raw.map((x) => {
    const small = x.units > 0 && x.units < SMALL_GROUP_MIN
    // Las cifras de un grupo pequeño hablan de esas pocas casas: van recortadas con él.
    const ofGroup = (n: number): Cell => (small ? SMALL_GROUP_LABEL : n)
    return {
      id: x.f.id,
      nombre: x.f.nombre,
      kind: x.f.kind,
      per: x.f.per,
      unit: x.f.per === 'hogar' ? 'hogares' : 'personas',
      users: smallCell(x.units),
      active: small ? SMALL_GROUP_LABEL : smallCell(x.active),
      lapsed: small ? SMALL_GROUP_LABEL : smallCell(x.lapsed),
      never: smallCell(x.never),
      households: small ? SMALL_GROUP_LABEL : smallCell(x.households),
      uses30d: ofGroup(x.uses30d),
      usesTotal: ofGroup(x.usesTotal),
      medianDaysSinceLast: small ? SMALL_GROUP_LABEL : x.median == null ? null : Math.round(x.median),
      share: small || x.baseUnits === 0 ? null : Math.round((x.units / x.baseUnits) * 1000) / 1000,
    }
  })
  const tricks: FeatureTrick[] = raw
    .filter((x) => x.never > 0 || x.lapsed > 0)
    .sort((a, b) => b.never - a.never || b.lapsed - a.lapsed || a.f.id.localeCompare(b.f.id))
    .map((x) => ({
      id: x.f.id,
      nombre: x.f.nombre,
      per: x.f.per,
      unit: x.f.per === 'hogar' ? 'hogares' : 'personas',
      never: smallCell(x.never),
      lapsed: x.units > 0 && x.units < SMALL_GROUP_MIN ? SMALL_GROUP_LABEL : smallCell(x.lapsed),
    }))
  return {
    base: { households: smallCell(base.households), people: smallCell(base.people) },
    features,
    tricks,
  }
}

export const FEATURE_USAGE_DEFINITIONS = {
  rows: 'PRO-1025: una fila por función de FEATURE_CATALOG (specs/feature-usage.md), desde household_feature_usage (la pasada de cada noche: los eventos de hoy aún no cuentan). unit = hogares en las funciones del hogar y personas en las de persona.',
  users: 'Hogares (o personas) que la han usado alguna vez; active = en los últimos `days` días (last_used_at); lapsed = la usaron, pero no en esos días; never = de la base, no la han usado nunca.',
  uses: 'uses30d = usos en los 30 días antes de la última pasada (un ajuste: semanas en que actuó), siempre 30 días aunque cambie `days`; usesTotal = desde la primera vez.',
  small: 'Un grupo de 1 a 4 hogares o personas sale «menos de 5»; si los que la usan son menos de 5, también sus usos, la mediana y los que la dejaron.',
  tricks: 'Trucos de la newsletter: las funciones con alguien a quien proponerlas, de más a menos que no la han usado nunca (y después, los que la dejaron).',
  base: 'Hogares con algún miembro contado y personas contadas en un hogar. Sin cuentas de admin ni suspendidas, salvo includeInternal=1.',
}

export interface FeatureUsageLoadOptions {
  days: number
  includeInternal?: boolean
  now?: Date
}

export async function loadFeatureUsageReport(opts: FeatureUsageLoadOptions, db: Db = defaultDb) {
  const now = opts.now ?? new Date()
  const today = madridParts(now).isoDate
  // Los últimos `days` días ya contados: hasta las 00:00 de hoy (Madrid).
  const fromDay = addDays(today, -opts.days)
  const from = madridMidnightUtc(fromDay)
  const inc = opts.includeInternal === true
  const member = sql`(${inc}::boolean OR (mu.role <> 'admin' AND mu.suspended_at IS NULL))`

  // Ids solo dentro del SQL: sale una fila de cifras por función.
  const baseQ = db.execute(sql`
    SELECT COUNT(DISTINCT hm.household_id)::int AS households, COUNT(DISTINCT mu.id)::int AS people
      FROM household_members hm JOIN users mu ON mu.id = hm.user_id
      WHERE ${member}
  `)
  const rowsQ = db.execute(sql`
    SELECT f.feature,
           COUNT(*)::int AS units,
           COUNT(DISTINCT f.household_id)::int AS households,
           COUNT(*) FILTER (WHERE f.last_used_at >= ${from})::int AS active,
           COALESCE(SUM(f.uses_30d), 0)::int AS uses_30d,
           COALESCE(SUM(f.uses_total), 0)::bigint AS uses_total,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${now}::timestamptz - f.last_used_at)) / 86400) AS median_days,
           MAX(f.counted_until) AS counted_until
      FROM household_feature_usage f
      LEFT JOIN users fu ON fu.id = f.user_id
      WHERE f.household_id IN (
              SELECT hm.household_id FROM household_members hm JOIN users mu ON mu.id = hm.user_id WHERE ${member}
            )
        AND (f.user_id IS NULL OR ${inc}::boolean OR (fu.role <> 'admin' AND fu.suspended_at IS NULL))
      GROUP BY 1
  `)
  const [baseRes, rowsRes] = await Promise.all([baseQ, rowsQ])
  const b = (baseRes.rows as any[])[0] ?? {}
  const rows = rowsRes.rows as any[]
  const countedUntil = rows.reduce<Date | null>((max, r) => {
    const d = r.counted_until ? new Date(r.counted_until) : null
    return d && (!max || d > max) ? d : max
  }, null)
  return {
    generatedAt: now.toISOString(),
    days: opts.days,
    from: fromDay,
    includeInternal: inc,
    countedUntil: countedUntil ? countedUntil.toISOString() : null,
    ...buildFeatureUsageReport(
      { households: Number(b.households ?? 0), people: Number(b.people ?? 0) },
      rows.map((r) => ({
        feature: String(r.feature),
        units: Number(r.units),
        households: Number(r.households),
        active: Number(r.active),
        uses30d: Number(r.uses_30d),
        usesTotal: Number(r.uses_total),
        medianDaysSinceLast: r.median_days == null ? null : Number(r.median_days),
      })),
    ),
    definitions: FEATURE_USAGE_DEFINITIONS,
  }
}
