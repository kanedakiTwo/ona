/**
 * Who came through a household of Miguel's circle (PRO-1017, D-129, D-132
 * point 2; specs/metrics.md → «Círculo e invitaciones»).
 *
 * Miguel's circle are the campaign links `circulo-*`, `beta-privada-*` and
 * «colegio-estudio» (also written «colegio estudio»): they count apart from
 * strangers. But someone who signs up, or joins the waitlist, with the
 * **personal link of a household** of that circle doesn't know Miguel: they
 * count as «desconocido por invitación», and for the 13-nov signal (D-020).
 * Someone invited by any other household is `invita` (first degree).
 *
 * Counts only: the codes and household ids stay in this process.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'

type Db = typeof defaultDb

/** How a sign-up or waitlist entry arrived through someone's personal link. */
export const INVITATION_ORIGINS = ['invita', 'desconocido-por-invitacion'] as const
export type InvitationOrigin = (typeof INVITATION_ORIGINS)[number]

/** `campaigns[].origin` in GET /admin/metrics. */
export const CAMPAIGN_ORIGINS = ['circulo', 'campaña', ...INVITATION_ORIGINS, 'sin-enlace'] as const
export type CampaignOrigin = (typeof CAMPAIGN_ORIGINS)[number]

/** Lowercase, no accents, spaces and underscores as hyphens: «Colegio Estudio» → `colegio-estudio`. */
function campaignSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
}

/** Pure: whether a campaign name is one of Miguel's circle (D-129). */
export function isCircleCampaign(name: string | null | undefined): boolean {
  if (!name) return false
  const s = campaignSlug(name)
  return /^circulo(-|$)/.test(s) || /^beta-privada(-|$)/.test(s) || s === 'colegio-estudio'
}

/** Pure: the origin of someone who came with an inviter's code (null = no code). */
export function invitationOrigin(invitedByCode: string | null | undefined, circleCodes: ReadonlySet<string>): InvitationOrigin | null {
  if (!invitedByCode) return null
  return circleCodes.has(invitedByCode) ? 'desconocido-por-invitacion' : 'invita'
}

/** Pure: a household's row in `campaigns` — its campaign link first, else who invited it. */
export function campaignOrigin(campaign: string | null, invitation: InvitationOrigin | null): CampaignOrigin {
  if (campaign) return isCircleCampaign(campaign) ? 'circulo' : 'campaña'
  return invitation ?? 'sin-enlace'
}

/**
 * Households of the circle: a member signed up with a circle campaign link.
 * The names are read here and filtered by `isCircleCampaign`, so the rule lives in one place.
 */
export async function loadCircleHouseholds(db: Db = defaultDb): Promise<Set<string>> {
  const res = await db.execute(sql`
    SELECT DISTINCT u.primary_household_id::text AS household_id, c.name
      FROM users u JOIN invite_campaigns c ON c.id = u.invite_campaign_id
     WHERE u.primary_household_id IS NOT NULL
  `)
  return new Set(
    (res.rows as Array<{ household_id: string; name: string }>).filter((r) => isCircleCampaign(r.name)).map((r) => r.household_id),
  )
}

/**
 * Personal invitation codes of the circle's households: their members' account codes, and the
 * waitlist codes of list people who already have an account in one of them.
 */
export async function loadCircleCodes(db: Db = defaultDb): Promise<Set<string>> {
  const households = await loadCircleHouseholds(db)
  if (households.size === 0) return new Set()
  const ids = sql.join([...households].map((h) => sql`${h}::uuid`), sql`, `)
  const res = await db.execute(sql`
    SELECT u.referral_code AS code FROM users u
     WHERE u.referral_code IS NOT NULL AND u.primary_household_id IN (${ids})
    UNION
    SELECT w.referral_code AS code FROM waitlist_entries w JOIN users u ON u.email = w.email
     WHERE u.primary_household_id IN (${ids})
  `)
  return new Set((res.rows as Array<{ code: string | null }>).map((r) => r.code).filter((c): c is string => !!c))
}
