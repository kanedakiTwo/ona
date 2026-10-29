/**
 * Factor K de las invitaciones (PRO-1018, D-132 punto 3; specs/metrics.md
 * «Factor K»): cada semana y acumulado, cuántas invitaciones se compartieron
 * («Invitar a otro hogar», `invite_shared`), cuántas acabaron en registro (un
 * hogar nuevo con el código de otro hogar) y hogares nuevos por hogar que
 * invita. Lo lee Dirección para el scorecard. Solo cifras: los ids y los
 * códigos se quedan en este proceso.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { addDays } from './madridTime.js'
import { isOtherHousehold, loadInvitedSignups, type InvitedSignup } from './referralRewards.js'
import { isoWeekLabel, weekOfDay } from './businessMetrics.js'

type Db = typeof defaultDb

export interface InviteShare {
  /** Hogar de quien tocó compartir (null si no se sabe: cuenta como compartida, no como hogar). */
  householdId: string | null
  /** Día de Madrid, YYYY-MM-DD. */
  day: string
  count: number
}

export interface KFactorCounts {
  /** Toques en «Invitar a otro hogar» (`invite_shared`). */
  inviteShared: number
  /** Hogares nuevos registrados con el código de otro hogar. */
  inviteSignups: number
  /** Hogares distintos que invitan: compartieron o su código trajo un registro. */
  invitingHouseholds: number
  /** inviteSignups / invitingHouseholds, con 2 decimales (null sin hogares que invitan). */
  kFactor: number | null
}

export interface KFactorWeek extends KFactorCounts {
  week: string
  isoWeek: string
  partial: boolean
  /** Lo mismo desde el principio hasta el domingo de esa semana. */
  cumulative: KFactorCounts
}

const ratio = (signups: number, inviters: number) => (inviters > 0 ? Math.round((signups / inviters) * 100) / 100 : null)

/**
 * Puro: el bloque `kFactor` de GET /admin/metrics para las semanas de la
 * ventana (`weeks`, lunes, de la más antigua a la actual), y el acumulado de
 * todo el histórico (`allTime`).
 */
export function buildKFactor(
  weeks: readonly string[],
  shares: readonly InviteShare[],
  signups: readonly InvitedSignup[],
): { weekly: KFactorWeek[]; allTime: KFactorCounts } {
  // Quien entra en el hogar de quien invita es un miembro, no un hogar nuevo.
  const newHomes = signups.filter(isOtherHousehold).map((s) => ({
    day: s.signupDay,
    home: s.inviteeHouseholdId ?? `u:${s.inviteeUserId}`,
    inviter: s.inviterHouseholdId ?? `c:${s.inviterCode}`,
  }))

  const count = (inPeriod: (day: string) => boolean): KFactorCounts => {
    const inviters = new Set<string>()
    const homes = new Set<string>()
    let inviteShared = 0
    for (const s of shares) {
      if (!inPeriod(s.day)) continue
      inviteShared += s.count
      if (s.householdId) inviters.add(s.householdId)
    }
    for (const s of newHomes) {
      if (!inPeriod(s.day)) continue
      homes.add(s.home)
      inviters.add(s.inviter)
    }
    return { inviteShared, inviteSignups: homes.size, invitingHouseholds: inviters.size, kFactor: ratio(homes.size, inviters.size) }
  }

  const current = weeks[weeks.length - 1]
  const weekly = weeks.map((week) => {
    const sunday = addDays(week, 6)
    return {
      week,
      isoWeek: isoWeekLabel(week),
      partial: week === current,
      ...count((day) => weekOfDay(day) === week),
      cumulative: count((day) => day <= sunday),
    }
  })
  return { weekly, allTime: count(() => true) }
}

const TZ = 'Europe/Madrid'

/** Los toques en compartir de todo el histórico, por hogar y día (cuentas contadas). */
export async function loadInviteShares(db: Db = defaultDb, includeInternal = false): Promise<InviteShare[]> {
  const counted = sql`(${includeInternal}::boolean OR (u.role <> 'admin' AND u.suspended_at IS NULL))`
  const res = await db.execute(sql`
    SELECT COALESCE(e.household_id, u.primary_household_id)::text AS household_id,
           to_char(e.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS count
      FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.name = 'invite_shared' AND ${counted}
     GROUP BY 1, 2
  `)
  return (res.rows as any[]).map((r) => ({
    householdId: r.household_id ? String(r.household_id) : null,
    day: String(r.day),
    count: Number(r.count),
  }))
}

export async function loadKFactor(weeks: readonly string[], includeInternal: boolean, db: Db = defaultDb) {
  const [shares, signups] = await Promise.all([loadInviteShares(db, includeInternal), loadInvitedSignups(db, includeInternal)])
  return buildKFactor(weeks, shares, signups)
}
