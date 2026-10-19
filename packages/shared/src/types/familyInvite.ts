/**
 * «Familia en el mismo hogar» (D-088; specs/household.md → «Invitar al
 * hogar por WhatsApp»). An invitation to join THIS household (the couple,
 * the family): same menu, list, favourites and pantry. Not «Invitar a otro
 * hogar» (PRO-163), which brings a different household to Mimoia.
 */
import { BRAND_NAME } from '../constants/brand.js'

/** Days a household invitation link lasts (PRO-260: 30, was 7). Single use. */
export const HOUSEHOLD_INVITE_TTL_DAYS = 30

/**
 * Where an invitation was prepared (PRO-263 counts sent and accepted per
 * moment): «Mi casa» (`casa`), the sign-up (`alta`), the first visit to the
 * shopping list (`compra`) or Mimo, in the web chat or WhatsApp (`mimo`).
 */
export const HOUSEHOLD_INVITE_SOURCES = ['casa', 'alta', 'compra', 'mimo'] as const
export type HouseholdInviteSource = (typeof HOUSEHOLD_INVITE_SOURCES)[number]

export function isHouseholdInviteSource(v: unknown): v is HouseholdInviteSource {
  return typeof v === 'string' && (HOUSEHOLD_INVITE_SOURCES as readonly string[]).includes(v)
}

/** When an invitation created at `now` stops working. */
export function householdInviteExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + HOUSEHOLD_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/** Public path of an invitation (the web origin goes in front). */
export function householdInvitePath(token: string): string {
  return `/invites/${token}`
}

/**
 * The message «Enviar por WhatsApp» opens (and Mimo hands over), with the
 * link. First person, plain, no health claims.
 */
export function familyInviteShareText(inviteUrl: string): string {
  return `Te invito a nuestra casa en ${BRAND_NAME}: así compartimos el menú de la semana y la lista de la compra, y lo que uno apunta lo ve el otro. Entra con este enlace (vale ${HOUSEHOLD_INVITE_TTL_DAYS} días): ${inviteUrl}`
}
