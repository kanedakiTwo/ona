/**
 * «Corre la voz» (PRO-1019, D-122 punto 4, specs/newsletter.md): every
 * newsletter carries the recipient's own invite link and two buttons, share
 * on WhatsApp and copy. The link is the household's `/i/<code>` for an
 * account (D-132, PRO-162) and the list's `?invita=<code>` for a waitlist
 * person (PRO-130). Pure: the same links in the email and in the click
 * redirect.
 */
import {
  REFERRAL_CODE_RE,
  inviteHouseholdShareText,
  waitlistReferralUrl,
  waitlistShareText,
  whatsappShareHref,
} from '@ona/shared'
import type { InviteKind, NewsletterSlotLink } from './newsletterStats.js'

const web = (origin: string) => origin.replace(/\/+$/, '')

/** The person's own invite link. */
export function personalInviteUrl(origin: string, code: string, kind: InviteKind): string {
  return kind === 'hogar' ? `${web(origin)}/i/${code}` : waitlistReferralUrl(origin, code)
}

/** What WhatsApp opens with: the same message as the app's buttons, with their link. */
export function correLaVozShareText(origin: string, code: string, kind: InviteKind): string {
  const link = personalInviteUrl(origin, code, kind)
  return kind === 'hogar' ? inviteHouseholdShareText(link) : waitlistShareText(link)
}

export function correLaVozWhatsappHref(origin: string, code: string, kind: InviteKind): string {
  return whatsappShareHref(correLaVozShareText(origin, code, kind))
}

/** An email can't copy: «Copiar» opens our page with the link and a copy button. */
export function correLaVozCopyUrl(origin: string, code: string, kind: InviteKind): string {
  return `${web(origin)}/newsletter/comparte?c=${encodeURIComponent(code)}&k=${kind}`
}

/** A well-formed code and kind from a click, or null. */
export function parseSlotParams(code: unknown, kind: unknown): { code: string; kind: InviteKind } | null {
  if (typeof code !== 'string' || !REFERRAL_CODE_RE.test(code)) return null
  if (kind !== 'lista' && kind !== 'hogar') return null
  return { code, kind }
}

/** Where a slot click goes: built here from the code, never taken from the request. */
export function slotDestination(link: NewsletterSlotLink, origin: string, code: string, kind: InviteKind): string {
  return link.button === 'whatsapp' ? correLaVozWhatsappHref(origin, code, kind) : correLaVozCopyUrl(origin, code, kind)
}
