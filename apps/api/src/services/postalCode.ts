/**
 * PRO-1124 (D-179): el código postal de todos los hogares y la demanda de
 * tiendas por zona.
 *
 *   - La pregunta sale una sola vez, en el siguiente «Hazme la compra» del
 *     hogar (`POST /shop-orders/prepare` → `askPostalCode`, en la web y con
 *     Mimo). Al ofrecerla se apunta `postal_code_asked_at`: contestada,
 *     saltada o ignorada, no vuelve sola. Se cambia o se borra en Perfil →
 *     Tu casa (`PUT /households/me/postal-code`).
 *   - `/admin/metrics` → `postalDemand`: hogares por código postal y tipo de
 *     tienda sin cubrir (frutería, carnicería, pescadería), sin ningún grupo
 *     de menos de 3 hogares (D-094, LEG-506): esos van a «otros» por tipo, y
 *     «otros» tampoco sale con menos de 3.
 *
 * Spec: specs/household.md, specs/metrics.md, specs/privacy.md.
 */
import { and, eq, isNull, sql } from 'drizzle-orm'
import { normalizePostalCode, POSTAL_CODE_INVALID } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { householdMembers, households, users } from '../db/schema.js'

type Db = typeof defaultDb

/** Lo más pequeño que sale en el recuento: menos, agrupado (D-094, LEG-506). */
export const POSTAL_DEMAND_MIN_GROUP = 3

/** Los tipos de tienda de barrio que cuenta el recuento (los de la Red). */
export const POSTAL_DEMAND_KINDS = ['fruteria', 'carniceria', 'pescaderia'] as const
export type PostalDemandKind = (typeof POSTAL_DEMAND_KINDS)[number]

export class PostalCodeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PostalCodeError'
  }
}

export interface HouseholdPostalCode {
  postalCode: string | null
  /** Ya se le preguntó (o lo guardó / borró en Perfil). */
  asked: boolean
}

async function membership(userId: string, db: Db) {
  const [row] = await db
    .select({ householdId: users.primaryHouseholdId, role: householdMembers.role })
    .from(users)
    .leftJoin(householdMembers, and(eq(householdMembers.userId, users.id), eq(householdMembers.householdId, users.primaryHouseholdId)))
    .where(eq(users.id, userId))
    .limit(1)
  return row?.householdId ? { householdId: row.householdId, role: row.role } : null
}

export async function getPostalCode(userId: string, db: Db = defaultDb): Promise<HouseholdPostalCode | null> {
  const m = await membership(userId, db)
  if (!m) return null
  const [h] = await db
    .select({ postalCode: households.postalCode, askedAt: households.postalCodeAskedAt })
    .from(households)
    .where(eq(households.id, m.householdId))
    .limit(1)
  return h ? { postalCode: h.postalCode, asked: h.askedAt != null } : null
}

/**
 * Guarda (o, con null / «», borra) el código postal del hogar. Cualquier
 * adulto de la casa; un niño, no (403). Cuenta como pregunta contestada.
 */
export async function setPostalCode(userId: string, raw: unknown, db: Db = defaultDb): Promise<HouseholdPostalCode> {
  const m = await membership(userId, db)
  if (!m) throw new PostalCodeError('No household', 404)
  if (m.role === 'child') throw new PostalCodeError('El código postal lo cambia un adulto de la casa', 403)
  const clear = raw == null || (typeof raw === 'string' && raw.trim() === '')
  const postalCode = clear ? null : normalizePostalCode(raw)
  if (!clear && !postalCode) throw new PostalCodeError(POSTAL_CODE_INVALID, 400)
  await db.update(households).set({ postalCode, postalCodeAskedAt: sql`COALESCE(${households.postalCodeAskedAt}, now())` }).where(eq(households.id, m.householdId))
  return { postalCode, asked: true }
}

/** «Ahora no»: la pregunta no vuelve sola. */
export async function skipPostalCode(userId: string, db: Db = defaultDb): Promise<void> {
  const m = await membership(userId, db)
  if (!m) throw new PostalCodeError('No household', 404)
  await db.update(households).set({ postalCodeAskedAt: new Date() }).where(and(eq(households.id, m.householdId), isNull(households.postalCodeAskedAt)))
}

/**
 * ¿Toca preguntar en este «Hazme la compra»? true una sola vez por hogar: el
 * mismo UPDATE apunta que se ha ofrecido, así que dos peticiones a la vez
 * (la web y Mimo) no la sacan dos veces.
 */
export async function claimPostalCodeQuestion(userId: string, db: Db = defaultDb): Promise<boolean> {
  const m = await membership(userId, db)
  if (!m || m.role === 'child') return false
  const res = await db
    .update(households)
    .set({ postalCodeAskedAt: new Date() })
    .where(and(eq(households.id, m.householdId), isNull(households.postalCode), isNull(households.postalCodeAskedAt)))
    .returning({ id: households.id })
  return res.length > 0
}

// ─── Recuento por zona (/admin/metrics → postalDemand) ──────────────

export interface PostalDemandCell {
  postalCode: string
  kind: PostalDemandKind
  households: number
}

export interface PostalDemand {
  /** Hogares contados con código postal / sin él (admins y suspendidos fuera). */
  withPostalCode: number
  withoutPostalCode: number
  minGroup: number
  /** Código postal × tipo sin cubrir, solo los de 3 hogares o más; de más a menos. */
  zones: PostalDemandCell[]
  /** Por tipo, la suma de los grupos de menos de 3 (sin código); null si también es menos de 3. */
  others: Record<PostalDemandKind, number | null>
  note: string
}

/** Agrupa las celdas pequeñas: nunca sale un código postal × tipo con menos de `min` hogares. */
export function groupPostalDemand(cells: PostalDemandCell[], min = POSTAL_DEMAND_MIN_GROUP): Pick<PostalDemand, 'zones' | 'others'> {
  const zones = cells
    .filter((c) => c.households >= min)
    .sort((a, b) => b.households - a.households || a.postalCode.localeCompare(b.postalCode) || a.kind.localeCompare(b.kind))
  const small = Object.fromEntries(POSTAL_DEMAND_KINDS.map((k) => [k, 0])) as Record<PostalDemandKind, number>
  for (const c of cells) if (c.households > 0 && c.households < min) small[c.kind] += c.households
  const others = Object.fromEntries(POSTAL_DEMAND_KINDS.map((k) => [k, small[k] >= min ? small[k] : null])) as Record<PostalDemandKind, number | null>
  return { zones, others }
}

/**
 * Hogares que esperan una tienda: con código postal y sin ninguna tienda
 * propia de ese tipo en «Tus tiendas». Cuenta los hogares cuyo dueño cuenta
 * en las métricas (fuera admins y suspendidos, salvo `includeInternal`).
 */
export async function loadPostalDemand(opts: { includeInternal?: boolean } = {}, db: Db = defaultDb): Promise<PostalDemand> {
  const inc = opts.includeInternal === true
  const counted = sql`(${inc}::boolean OR (u.role <> 'admin' AND u.suspended_at IS NULL))`
  const kinds = sql.join(POSTAL_DEMAND_KINDS.map((k) => sql`(${k})`), sql`, `)
  const [totals, cells] = await Promise.all([
    db.execute(sql`
      SELECT count(*) FILTER (WHERE h.postal_code IS NOT NULL)::int AS with_code,
             count(*) FILTER (WHERE h.postal_code IS NULL)::int AS without_code
        FROM households h JOIN users u ON u.id = h.owner_id
       WHERE ${counted}
    `),
    db.execute(sql`
      SELECT h.postal_code AS postal_code, k.kind AS kind, count(*)::int AS households
        FROM households h
        JOIN users u ON u.id = h.owner_id
       CROSS JOIN (VALUES ${kinds}) AS k(kind)
       WHERE h.postal_code IS NOT NULL AND ${counted}
         AND NOT EXISTS (SELECT 1 FROM household_shops s WHERE s.household_id = h.id AND s.kind = k.kind)
       GROUP BY h.postal_code, k.kind
    `),
  ])
  const t = (totals.rows[0] ?? {}) as { with_code?: number; without_code?: number }
  const rows = cells.rows as Array<{ postal_code: string; kind: PostalDemandKind; households: number }>
  return {
    withPostalCode: Number(t.with_code ?? 0),
    withoutPostalCode: Number(t.without_code ?? 0),
    minGroup: POSTAL_DEMAND_MIN_GROUP,
    ...groupPostalDemand(rows.map((r) => ({ postalCode: r.postal_code, kind: r.kind, households: Number(r.households) }))),
    note: 'Hogares con código postal y sin tienda propia de ese tipo en «Tus tiendas». Ningún código postal × tipo con menos de 3 hogares: van a «others» por tipo, que tampoco sale (null) con menos de 3 (D-094, LEG-506).',
  }
}
