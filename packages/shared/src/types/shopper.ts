/**
 * «¿Quién hace la compra?» (PRO-383, D-158; specs/auth.md, household.md,
 * whatsapp.md). Asked in the sign-up (web and WhatsApp) only to a household
 * of 2 adults or more, right after «¿Para cuántos cocinas?». Kept in the
 * household's ficha as the fact `shopper` (D-064). When someone else buys
 * («Otra persona de casa») or they take turns («Nos turnamos»), the next
 * screen offers to invite that person so the list reaches them every week.
 */
import { z } from 'zod'
import { BRAND_NAME } from '../constants/brand.js'

export const SHOPPERS = ['me', 'other', 'shared'] as const
export type Shopper = (typeof SHOPPERS)[number]

export const SHOPPER_QUESTION = '¿Quién hace la compra?'

/** The three answers, word for word (PRO-383). */
export const SHOPPER_LABELS: Record<Shopper, string> = {
  me: 'Yo',
  other: 'Otra persona de casa',
  shared: 'Nos turnamos',
}

export function isShopper(v: unknown): v is Shopper {
  return typeof v === 'string' && (SHOPPERS as readonly string[]).includes(v)
}

/** Only a household of 2 adults or more is asked. */
export function asksShopper(adults: number): boolean {
  return adults >= 2
}

/** «Otra persona» and «Nos turnamos» lead to the invitation. */
export function shopperInvites(who: Shopper | null | undefined): boolean {
  return who === 'other' || who === 'shared'
}

export const shopperSchema = z.enum(SHOPPERS)

/** The value of a `shopper` fact in the ficha (about the household). */
export const shopperFactValueSchema = z.object({ who: shopperSchema }).strict()

/** The message of the sign-up's invitation (web «Mandar invitación» and Mimo by WhatsApp). */
export function shopperInviteText(inviteUrl: string): string {
  return `Te he metido en nuestra casa de ${BRAND_NAME}: ahí tendrás el menú y la lista de la compra de cada semana. Entra aquí: ${inviteUrl}`
}
